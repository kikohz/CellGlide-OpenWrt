# 通过 OpenWrt 路由器使用 CellGlide

让路由器后面的一台（或几台）设备，经 USB 线连着的 iPhone 上网。路由器上跑 `hev-socks5-tunnel`，把设备的流量转成 SOCKS5，通过 USB 转发到 iPhone 上的 CellGlide。

- 适用环境：OpenWrt 23.05 及以上，用 `apk` 或 `opkg` 安装软件包。已在 Linksys MX4300、OpenWrt 25.12.5 上验证过。
- 实测：TCP 正常，在测试的 Mac 上约 150 Mbps。
- UDP（DNS、QUIC、游戏、语音等）需要 iOS 版 CellGlide 2.3 或更新版本，hev 配置里要写 `udp: 'tcp'`。旧版 App 上 TCP 照常能用，UDP 不通。

## 安装

下面以 `apk` 为例，用 `opkg` 的把 `apk add` 换成 `opkg install`。

```sh
apk update
apk add usbmuxd libimobiledevice-utils libusbmuxd-utils hev-socks5-tunnel curl
```

`curl` 只是用来测试，可以不装。`hev-socks5-tunnel` 软件包自带一个开机服务，默认是关着的。本文手动运行它，不用那个服务：

```sh
uci set hev-socks5-tunnel.@instance[0].enabled='0'
uci commit hev-socks5-tunnel
```

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
ip link set cgtun up
```

## 只让一台设备走手机

先把下面的 `<设备IP>` 换成要走手机的那台设备的局域网地址，`<局域网段>` 换成你的局域网网段（例如 `192.168.1.0/24`）。局域网段那条路由不能少，否则这台设备访问路由器和局域网里的其他设备会不通。

```sh
ip route add default dev cgtun table 200
ip route add <局域网段> dev br-lan table 200
ip rule add from <设备IP> iif br-lan lookup 200 priority 100
nft insert rule inet fw4 forward iifname "br-lan" oifname "cgtun" accept comment "cellglide"
```

其他设备不受影响，仍然走原来的上网线路。

## 验证

在那台设备上，或者在路由器上用 `curl` 测 TCP：

```sh
curl -4 https://speed.cloudflare.com/cdn-cgi/trace
```

输出里的 `ip=` 应该是手机的出口 IP，而不是家里宽带的 IP。

再测 UDP（需要 App 是 2.3 或更新版本）：

```sh
dig @1.1.1.1 example.com
```

能返回解析结果就说明 UDP 通了。如果 `curl` 正常、`dig` 超时，先检查手机上的 CellGlide 版本。

出问题时看 `/tmp/cellglide-hev.log`。

## 撤销

按相反的顺序删掉上面加的东西：

```sh
nft -a list chain inet fw4 forward
```

找到带 `comment "cellglide"` 的那一行，记下末尾的 `# handle N`，然后：

```sh
nft delete rule inet fw4 forward handle N
ip rule del priority 100
ip route flush table 200
killall hev-socks5-tunnel iproxy
```

## 限制

- iPhone 上的 CellGlide 要一直开在前台，并且接着电源。
- 外网无法连入：不能做端口转发、DDNS。
- IPv6 暂时不走手机。
- 以上设置在路由器重启后全部失效，需要重新执行。开机自启以后会做成插件。
- DNS 目前直接按设备原来的设置走，经过隧道出去。手机上的 DNS 中转（端口 8088）以后再接入。
