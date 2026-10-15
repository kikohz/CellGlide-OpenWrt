# 通过 OpenWrt 路由器使用 CellGlide

让路由器后面的一台（或几台）设备，经 USB 线连着的 iPhone 上网。路由器上跑 `hev-socks5-tunnel`，把设备的流量转成 SOCKS5，通过 USB 转发到 iPhone 上的 CellGlide。

- 适用环境：OpenWrt 24.10 及以上（23.05 的软件源里没有 `hev-socks5-tunnel`）。24.10 用 `opkg`，25.12 用 `apk`。已在 Linksys MX4300、OpenWrt 25.12.5 上验证过。
- 实测：TCP 正常，在测试的 Mac 上约 150 Mbps。
- UDP（DNS、QUIC、游戏、语音等）需要 iOS 版 CellGlide 2.3 或更新版本，hev 配置里要写 `udp: 'tcp'`。旧版 App 上 TCP 照常能用，UDP 不通。

## 安装

OpenWrt 25.12（`apk`）：

```sh
apk update
apk add usbmuxd libimobiledevice-utils libusbmuxd-utils hev-socks5-tunnel curl
```

OpenWrt 24.10（`opkg`）：

```sh
opkg update
opkg install usbmuxd libimobiledevice-utils libusbmuxd-utils hev-socks5-tunnel curl
```

`curl` 只是用来测试，可以不装。`hev-socks5-tunnel` 软件包自带一个开机服务，默认是关着的，本文手动运行 hev，不用那个服务，也不要去改它的设置。

## 配对

iPhone 用 USB 线接到路由器，解锁屏幕，运行：

```sh
idevicepair pair
```

手机上弹出“要信任此电脑吗”，点“信任”。

## 转发手机的代理端口

CellGlide 在手机上的 SOCKS5 端口是 9876。用 `iproxy` 把它转到路由器本机的 19876：

```sh
iproxy -l 19876:9876 &
```

## 写 hev 配置

保存为 `/etc/cellglide-hev.yml`：

```yaml
tunnel:
  name: cgtun
  mtu: 1500
  ipv4: 198.18.0.1
socks5:
  port: 19876
  address: 127.0.0.1
  udp: 'tcp'
misc:
  log-level: warn
  log-file: /tmp/cellglide-hev.log
  tcp-read-write-timeout: 1800000
  udp-read-write-timeout: 30000
```

启动并拉起网卡：

```sh
hev-socks5-tunnel /etc/cellglide-hev.yml &
sleep 1
ip link set cgtun up
```

## 只让一台设备走手机

先运行 `ip rule` 看看已有的规则。如果你装了 mwan3 或 pbr，它们也会用策略路由，下面的表号 200 和优先级 100 要换成没被占用的数字（撤销时也用同一组数字）。

把下面的 `<设备IP>` 换成要走手机的那台设备的局域网地址，`<局域网段>` 换成你的局域网网段（例如 `192.168.1.0/24`）。局域网段那条路由不能少，否则这台设备访问路由器和局域网里的其他设备会不通。

```sh
ip route add default dev cgtun table 200
ip route add <局域网段> dev br-lan table 200
ip rule add from <设备IP> iif br-lan lookup 200 priority 100
nft insert rule inet fw4 forward iifname "br-lan" oifname "cgtun" accept comment "cellglide"
```

其他设备不受影响，仍然走原来的上网线路。

## DNS 的注意事项

设备的 DNS 请求发给路由器自己的 dnsmasq，这是发往路由器本机的流量，不会进上面的 200 表。所以 DNS 查询是从宽带出去的，不经过手机。后果是：宽带断了，这台设备就解析不了域名，即使手机还连着。

想让 DNS 也走手机，在那台设备上手动把 DNS 改成公共解析器（例如 1.1.1.1）。这样 DNS 请求会通过隧道走手机，其中的 UDP 部分需要 2.3 或更新版本的 App。让 App 在手机端做 DNS 解析是以后的事。

## 验证

路由器自己发出的请求走的是主路由表（宽带），所以直接在路由器上 `curl` 看到的是家里宽带的 IP，不能用来验证。

最直接的办法是在那台设备上运行：

```sh
curl -4 https://speed.cloudflare.com/cdn-cgi/trace
```

输出里的 `ip=` 应该是手机的出口 IP，而不是宽带的 IP。

只想在路由器上测，必须指定网卡：

```sh
curl --interface cgtun -4 https://speed.cloudflare.com/cdn-cgi/trace
```

测 UDP（需要 App 2.3 或更新版本）：在设备上把 DNS 手动设成 1.1.1.1（见上一节），然后访问任意网站，或者运行 `nslookup example.com 1.1.1.1`。`dig` 路由器默认没有，要用的话装 `bind-dig`。注意同样要在设备上测，在路由器上直接 `nslookup` 走的是宽带。

出问题时看 `/tmp/cellglide-hev.log`。

## 撤销

按相反的顺序删掉上面加的东西：

```sh
nft -a list chain inet fw4 forward
```

找到带 `comment "cellglide"` 的那一行，记下末尾的 `# handle N`，然后：

```sh
nft delete rule inet fw4 forward handle N
ip rule del from <设备IP> iif br-lan lookup 200 priority 100
ip route del <局域网段> dev br-lan table 200
ip route del default dev cgtun table 200
killall hev-socks5-tunnel iproxy
```

## 限制

- iPhone 上的 CellGlide 要一直开在前台，并且接着电源。
- 外网无法连入：不能做端口转发、DDNS。
- IPv6 暂时不走手机。
- 重载防火墙（例如在 LuCI 里保存防火墙设置）会让 nft 规则消失，但 `ip rule` 还在，这台设备就会没网，直到重新加上 nft 规则，或者删掉 `ip rule`。路由器本身仍可访问。
- IPv6：这台设备的 IPv6 仍然走宽带，`curl -4` 看不出来。
- 以上设置在路由器重启后全部失效，需要重新执行。开机自启以后会做成插件。
