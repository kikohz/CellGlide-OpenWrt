# OpenWrt 软件包：指定设备经 iPhone 上网 设计

日期：2026-10-14　状态：已确认　前提：iOS CellGlide 2.3（hev 的 UDP 走 TCP，已合并进 main，未发布）

## 背景

`Docs/OpenWrt-Router.md` 里的手动步骤已在 Linksys MX4300（OpenWrt 25.12.5）上验证可行：TCP 约 150 Mbps，UDP 也能通（QUIC、DNS）；修掉上行 UDP 突发丢包后，Cloudflare 测速丢包为 0%。

手动方式的问题：
- 要敲十几条命令；
- 重启后全部失效；
- 拔掉手机后，被指定的设备会断网，要手动撤销；
- 设备的 DNS 仍走路由器的宽带，出口地区和 DNS 对不上；
- IPv6 仍走宽带。

## 目标

做一个 OpenWrt 软件包 `cellglide`。装上、配对一次、写下要走手机的设备之后：
- 手机插上并在 CellGlide 里开始共享，这些设备就经手机上网（IPv4、IPv6、DNS 都走手机）；
- 手机拔掉或停止共享，这些设备自动回到宽带，不断网；
- 路由器重启后自动恢复；
- 不改动路由器原有的 WAN、DHCP、DNS、mwan3 等设置，卸载后不留痕迹。

## 不做（这一版）

- 网页界面（LuCI）：下一版单独设计。
- 宽带断了自动切到手机（备用线路）。
- 整个局域网都走手机。也能通过配置实现，但不作为主要用法测试。
- 路由器自身的流量走手机。
- 同时接多台 iPhone。

## 组成

纯脚本包，没有需要编译的代码，架构是 `all`，同一个包能装在所有路由器上。

依赖都在 OpenWrt 官方源里：`usbmuxd`、`libusbmuxd-utils`（提供 `iproxy`）、`libimobiledevice-utils`（提供 `idevicepair`、`idevice_id`）、`hev-socks5-tunnel`，以及 `ucode` 和 `ucode-mod-socket`（SOCKS 握手探测用；BusyBox 的 `nc` 没有超时选项，做不了）。

| 文件 | 作用 |
|---|---|
| `/etc/config/cellglide` | UCI 配置 |
| `/etc/init.d/cellglide` | procd 服务：开机启动，管理守护脚本 |
| `/usr/libexec/cellglide/daemon` | 守护脚本：检测手机，启停 iproxy 和 hev，维护路由 |
| `/usr/sbin/cellglide` | 命令行：添加或删除设备、查看状态、配对 |
| `/usr/libexec/cellglide/probe` | ucode 小脚本：SOCKS5 握手探测，以及检测 App 是否支持 UDP 走 TCP |
| `/usr/share/nftables.d/chain-pre/forward/cellglide.nft` | fw4 扩展：放行 `br-lan → cgtun`（见“防火墙”） |

打标记和 DNS 改写放在独立的 `inet cellglide` 表里，由守护脚本直接用 `nft` 建立和删除。fw4 重载只会清空它自己的 `inet fw4` 表，不会动这张表。

hev 不使用它自带的开机服务，由我们的守护脚本单独启动一份，配置文件放在 `/var/run/cellglide/hev.yml`。

## 配置

```
config cellglide 'main'
	option enabled '1'
	option socks_port '9876'        # 手机上 CellGlide 的 SOCKS 端口
	option local_port '19876'       # iproxy 在路由器本机监听的端口
	option fallback 'broadband'     # 手机不可用时：broadband 回到宽带；block 禁止上网
	option dns '1.1.1.1'            # 指定设备的 DNS 改发到这里，经手机出去
	option dns6 '2606:4700:4700::1111'  # 同上，IPv6 的 DNS 请求

config device
	option name 'MacBook'
	option mac 'aa:bb:cc:dd:ee:ff'
```

设备用 MAC 地址指定，不用 IP，因为 DHCP 分配的 IP 会变。

命令行：

```
cellglide pair                          # 配对手机（弹出“信任此电脑”）
cellglide add aa:bb:cc:dd:ee:ff MacBook
cellglide remove aa:bb:cc:dd:ee:ff
cellglide list                          # 列出局域网里的设备（来自 DHCP 租约），方便找 MAC
cellglide status                        # 手机是否连上、是否在共享、出口 IP、已指定的设备
```

## 工作方式

### 1. 守护脚本

每 5 秒检查一次：
1. `idevice_id -l` 能看到手机；
2. 通过 `127.0.0.1:19876` 和手机做一次 SOCKS5 握手（`05 01 00` → `05 00`），确认 CellGlide 正在共享。

两项都通过，状态记为“可用”；连续两次失败，记为“不可用”。

- **变为可用**：生成 hev 配置并启动 hev，等 `cgtun` 出现后加路由。
- **变为不可用**：停止 hev，`cgtun` 随之消失，路由跟着自动失效（见下文）。
- `iproxy` 一直运行，手机不在时它只是连不上，不影响其他功能。
- 进程异常退出时，由 procd 重新拉起守护脚本；hev 由守护脚本自己拉起。

hev 配置：

```yaml
tunnel:
  name: cgtun
  mtu: 1500
  ipv4: 198.18.0.1
  ipv6: 'fc00::cafe:1'
socks5:
  address: 127.0.0.1
  port: 19876
  udp: 'tcp'
misc:
  log-level: warn
  udp-read-write-timeout: 30000
```

### 2. 选流量：按 MAC 打标记

`inet cellglide` 表在 `prerouting`（mangle 优先级）里，给源 MAC 在名单里、且从 `br-lan` 进来的包打标记 `0x10000/0x10000`。

选这个标记位，是因为它和 mwan3（默认掩码 `0x3F00`）、fw4 用到的位都不冲突。

### 3. 策略路由

```
ip  rule add fwmark 0x10000/0x10000 lookup 1986 priority 1986
ip -6 rule add fwmark 0x10000/0x10000 lookup 1986 priority 1986
表 1986：default dev cgtun；局域网网段（IPv4 和 IPv6 前缀）dev br-lan
```

**规则常驻，路由跟着 `cgtun` 走。** Linux 在一张路由表里查不到匹配的路由时，会接着查下一条规则。手机断开 → hev 停止 → `cgtun` 消失 → 表 1986 里的默认路由被内核删掉 → 这些设备自动落回 main 表，也就是宽带。所以不需要在断开时抢着改规则。

- `fallback 'block'` 时，表 1986 里再加一条低优先级的 `unreachable default`。手机不可用时，这些设备直接上不了网，避免流量悄悄从宽带出去。
- 局域网网段在启动时从 `br-lan` 的地址读出，保证这些设备之间、以及和路由器之间的通信不受影响。

### 4. 防火墙

fw4 的 forward 链默认会拒绝 `br-lan → cgtun`，而另一张表里的 accept 越不过它。所以放行规则用 fw4 官方的包内扩展目录 `/usr/share/nftables.d/chain-pre/forward/cellglide.nft`，内容只有一行：`iifname "br-lan" oifname "cgtun" accept`。

fw4 重载时会自动带上这个文件；卸载软件包时删除它，再 `fw4 reload`。

不需要 NAT：hev 是在用户态接收连接的，出去的源地址是手机。

### 5. DNS

被指定设备发出的 DNS（UDP 和 TCP 53，目标是路由器自己或任意地址）在 `dstnat` 里改写为 `option dns` 指定的地址（默认 1.1.1.1；IPv6 的请求改写为 `option dns6`）。改写后，这些包按上面的策略路由经手机出去。

这样做之后：
- DNS 和出口来自同一个网络，CDN 分配的节点和出口地区一致；
- dnsmasq 不用改，其他设备照常使用路由器的 DNS；
- 局域网里的主机名（`xxx.lan`）对这些设备不能解析。这是已知限制，写进文档。

手机不可用、回到宽带时，改写同样停止生效（规则只在“可用”状态下加载），避免 DNS 发往一个走不通的地址。

DoH 和 DoT（443、853 端口）本来就是普通的 TCP 连接，会自然经手机出去。

### 6. IPv6

手机的蜂窝网络通常有 IPv6（T-Mobile 是纯 IPv6 加 464XLAT），所以 IPv6 也经手机出去：hev 网卡上配了 IPv6 地址，表 1986 有 IPv6 默认路由。

如果手机没有 IPv6，CellGlide 会连接失败，设备的浏览器会自动改用 IPv4（Happy Eyeballs），不会卡住。

### 7. 状态

守护脚本把状态写入 `/var/run/cellglide/status`，包括：手机 UDID、可用或不可用、状态变化的时间、最近一次出错的原因。`cellglide status` 读这个文件，再经 `cgtun` 访问 `https://speed.cloudflare.com/cdn-cgi/trace` 查出口 IP。这一步需要 curl，没装就跳过。

## 打包与发布

- 源码放在本仓库的 `Router/OpenWrt/cellglide/`，按 OpenWrt 软件包格式写 `Makefile`。
- 用 GitHub Actions 加 OpenWrt 官方 SDK 容器，打出两种包：OpenWrt 25.12 的 `.apk`，24.10 的 `.ipk`。手动触发，或者推送 `openwrt-*` 标签时触发，产物上传到 GitHub Releases。
- `Docs/OpenWrt-Router.md` 改为：
  1. 装依赖；
  2. 下载并安装 `cellglide` 包；
  3. `cellglide pair`；
  4. `cellglide add`；
  5. 在手机上开始共享。

  原来的手动步骤移到附录。
- 25.12 的 `apk` 默认要求软件包签名。我们的包没有签名，安装时要加 `--allow-untrusted`，文档里写明。以后考虑自建带签名的软件源。

## 兼容

| 情况 | 结果 |
|---|---|
| iOS App 2.3 及以上 | TCP 和 UDP 都走手机 |
| 旧版 App | TCP 正常；UDP 不通（包括改写后的 DNS）。`cellglide status` 检测到旧 App 时给出提示：方法是用 0x05 命令握手，如果被回“不支持”，就提示升级 App |
| 路由器开着 mwan3 | 标记位不冲突；策略规则优先级 1986 排在 mwan3 规则之前，被指定设备的流量不经 mwan3 |
| 其他代理插件（如 sing-box、OpenClash） | 不保证兼容。如果它们也劫持了这些设备的流量，以先匹配的为准。文档建议把被指定设备从那些插件里排除 |

## 风险

- `cgtun` 消失后路由回落，依赖内核删除绑定在该网卡上的路由。这是 Linux 的标准行为，实测时要验证。
- 手机锁屏或 App 退到后台会停止共享（iOS 上架版只能在前台共享）。守护脚本最多约 10 秒后发现，设备回到宽带。文档里要写清楚。
- DNS 改写会让这些设备无法解析局域网主机名。

## 测试

**脚本测试**（在 Mac 上用 shellcheck，在路由器上跑一次）：
- 生成的 hev 配置、nft 规则文件和期望的文本一致；
- 状态判断：模拟握手成功或失败的序列，检查状态切换（连续两次失败才切到不可用）。

**真机测试**（MX4300，iOS 开发版）：
1. 安装包、配对、指定这台 Mac。Mac 的出口 IP 是手机的，DNS 解析经手机（Google ECS 显示手机网段），浏览器能用 HTTP/3，Cloudflare 测速丢包 0%。
2. 其他设备的出口不变。
3. 拔掉手机：10 秒内 Mac 回到宽带，网页照常打开。再插回去并开始共享：自动切回手机。
4. 改为 `fallback 'block'` 后拔掉手机：Mac 上不了网，其他设备正常。
5. 重启路由器：服务自动恢复。
6. 卸载：表 1986、ip 规则、nft 表和防火墙扩展文件全部消失。保存的 network、firewall、dhcp 配置与安装前完全相同。
7. 用 `udp-in-tcp` 之前的 App（上架版 2.2.0）：`cellglide status` 提示需要升级。
