# Changelog / 更新记录

## Unreleased

- Traffic map, as on the Mac: Services › CellGlide › Traffic map shows on a globe where the chosen devices' traffic goes through the iPhone, with an arc from the iPhone's exit to each region moving data now, and lists the regions moving data now, busiest first, with their traffic and current speed (rows slide in, out and into place as on the Mac). A flat map (experimental, Natural Earth's countries) can stand in for the globe, and both follow the LuCI theme's day or night look. The kernel counts bytes per address (nftables sets, only while the iPhone is in use); the addresses are located in the browser with the apps' location data, which the router downloads to `/tmp`. The globe draws at 30 frames a second and stops while it's off screen or the tab is hidden.
- Diagnostics, as on the Mac: Services › CellGlide › Diagnostics sends CellGlide's status, settings, log and network checks to CellGlide and gives you a report code, or saves them as a file. Names, MAC, web and email addresses are removed and IP addresses shortened on the router before anything is sent. From the command line: `cellglide diag` and `cellglide diag send`.
- Fixed: opening the Settings page could leave every LuCI page on "Loading view…" while the iPhone was slow to answer, because checking the pairing held up rpcd. It now uses what the service last found.

- 和 Mac 一样的流量地图：“服务 › CellGlide › 流量地图”用地球显示被选设备经 iPhone 的流量去了哪里，从 iPhone 的出口到每个正在传数据的地区画弧线，并按流量从多到少列出正在传数据的地区、它们的流量和当前速度（和 Mac 一样，行会滑入、滑出和换位）。也可以换成平面地图（实验，用 Natural Earth 的国家轮廓），地球和平面地图都跟随 LuCI 主题的日间或夜间模式。由内核按地址计数（nftables 集合，只在使用 iPhone 时计数）；地址用 App 的位置数据在浏览器里定位，位置数据由路由器下载到 `/tmp`。地球每秒画 30 帧，滚出屏幕或切到别的标签页时停止。
- 和 Mac 一样的诊断功能：“服务 › CellGlide › 诊断”可以把 CellGlide 的状态、设置、日志和网络检查发给 CellGlide 并给出报告编号，也可以存成文件。发送前先在路由器上去掉名字、MAC 地址、网址和邮箱，IP 地址只保留第一段。命令行：`cellglide diag` 和 `cellglide diag send`。
- 修复：iPhone 响应慢时，打开设置页可能让所有 LuCI 页面停在“加载视图中”，因为检查配对会卡住 rpcd。现在改用后台服务最近一次的检查结果。

## 0.2.1 — 2026-10-22

Packages: `cellglide` 0.2.1-r1, `luci-app-cellglide` 0.2.1-r1.

- Fixed: on routers with IPv6 turned off, the tunnel never started ("the tunnel did not start"), because hev-socks5-tunnel exits when it can't give the tunnel an IPv6 address. The IPv6 address is now left out when IPv6 is off.
- When the tunnel doesn't start, the status, the system log and the Status page say what hev reported. A failure that repeats is logged once.
- Fixed: upgrading the `cellglide` package left the old daemon running until the service was restarted or the router rebooted. An upgrade now restarts the service.

软件包：`cellglide` 0.2.1-r1、`luci-app-cellglide` 0.2.1-r1。

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
