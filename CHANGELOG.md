# Changelog / 更新记录

## Unreleased

Packages: `cellglide` 0.2.0-r3, `luci-app-cellglide` 0.2.0-r4.

- Fixed: on routers with IPv6 turned off, the tunnel never started ("the tunnel did not start"), because hev-socks5-tunnel exits when it can't give the tunnel an IPv6 address. The IPv6 address is now left out when IPv6 is off.
- When the tunnel doesn't start, the status, the system log and the Status page say what hev reported. A failure that repeats is logged once.
- Fixed: upgrading the `cellglide` package left the old daemon running until the service was restarted or the router rebooted. An upgrade now restarts the service.

软件包：`cellglide` 0.2.0-r3、`luci-app-cellglide` 0.2.0-r4。

- 修复：路由器关闭了 IPv6 时隧道始终起不来（“the tunnel did not start”），因为 hev-socks5-tunnel 给隧道配不上 IPv6 地址就会退出。现在关闭 IPv6 时不再配 IPv6 地址。
- 隧道起不来时，状态、系统日志和状态页都会写明 hev 的报错；反复出现的同一个错误只记一次日志。
- 修复：升级 `cellglide` 软件包后，旧的守护进程会一直跑到手动重启服务或重启路由器为止。现在升级会自动重启服务。

## 0.2.0 — 2026-10-17

Packages: `cellglide` 0.2.0-r2, `luci-app-cellglide` 0.2.0-r3.

- A web interface under Services › CellGlide: Status (iPhone, sharing, UDP, DNS, exit IP, refreshed every 5 seconds), Devices (choose devices by MAC, every-device switch, add by hand, names) and Settings (back to broadband or block when the iPhone is unavailable, on/off, pairing). Chinese translation built in; it follows the router's LuCI language.
- The chosen devices' DNS follows the DNS settings of CellGlide on the iPhone, encrypted DNS included, as on a Mac.
- The router reports its name to the iPhone, where it shows up among CellGlide's connected devices.
- `cellglide add all` sends every device on the LAN through the iPhone.
- Tested on a Linksys MX4300 with OpenWrt 25.12.5. The 24.10 packages are built with the official SDK but not yet tested on a router.

软件包：`cellglide` 0.2.0-r2、`luci-app-cellglide` 0.2.0-r3。

- 路由器后台“服务 › CellGlide”里的网页界面：状态页（手机、共享状态、UDP、DNS、出口 IP，每 5 秒刷新）、设备页（按 MAC 选设备、所有设备开关、手动添加、备注名）、设置页（手机不可用时回到宽带或断网、启用开关、配对）。中文翻译已包含在内，跟随路由器后台的语言。
- 选中设备的 DNS 跟随 iPhone 上 CellGlide 的 DNS 设置（包括加密 DNS），和 Mac 一样。
- 路由器会把自己的名字报给 iPhone，显示在 CellGlide 的“已连接的设备”里。
- `cellglide add all` 让局域网所有设备都走手机。
- 已在 Linksys MX4300（OpenWrt 25.12.5）上实测。24.10 的包已用官方 SDK 构建，尚未在真机上测试。

## 0.1.0

The first package: the `cellglide` command (pair, add, remove, list, status), the daemon that moves chosen devices between the iPhone and broadband, and the procd service.

第一个软件包：命令行 `cellglide`（pair、add、remove、list、status）、在手机和宽带之间切换被选设备的守护进程，以及 procd 服务。
