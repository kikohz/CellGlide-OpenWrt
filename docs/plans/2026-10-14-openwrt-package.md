# OpenWrt cellglide 软件包 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做一个 OpenWrt 软件包 `cellglide`：路由器上被指定的设备（按 MAC）在 iPhone 插着并开始共享时经手机上网，手机不可用时自动回到宽带（或按配置断网）。

**Architecture:** 纯脚本包（PKGARCH all）。
- 纯函数（只打印文本）放在 `common.sh`，执行网络改动的函数放在 `net.sh`。`net.sh` 的每条命令都经过 `cg_run`，测试时只记录、不执行。
- 守护脚本每 5 秒探测一次手机：可用时启动 hev，加默认路由和 DNS 改写；不可用时撤掉。
- 策略规则常驻。`cgtun` 消失后，表 1986 里就没有默认路由，流量自然落回 main 表。
- iproxy 和守护脚本由 procd 管理；hev 由守护脚本启停。

**Tech Stack:** BusyBox ash、ucode + ucode-mod-socket、nftables（fw4）、iproute2（ip-tiny）、procd、UCI、OpenWrt SDK（`openwrt/gh-action-sdk@v11`）。

**Spec:** `Docs/Specs/2026-10-14-openwrt-package-design.md`

## Global Constraints

- 在从 main 新开的分支 `openwrt-package` 上开发。
- 包名 `cellglide`，`PKG_VERSION:=0.1.0`，`PKGARCH:=all`；源码在 `Router/OpenWrt/cellglide/`。
- 依赖：`usbmuxd`、`libusbmuxd-utils`、`libimobiledevice-utils`、`hev-socks5-tunnel`、`ucode`、`ucode-mod-socket`。不依赖 `ip-full` 和 `curl`（`ip-tiny` 已验证支持 fwmark 规则和 unreachable 路由；curl 可选）。
- 局域网网桥固定为 `br-lan`；隧道网卡名 `cgtun`，地址 `198.18.0.1` 和 `fc00::cafe:1`，MTU 1500，hev 用 `udp: 'tcp'`。
- 标记 `0x10000/0x10000`；路由表和规则优先级都是 `1986`；nft 表名 `inet cellglide`。
- fw4 扩展文件 `/usr/share/nftables.d/chain-pre/forward/cellglide.nft`，内容只放行 `br-lan → cgtun`。
- 端口：手机 SOCKS `9876`，iproxy 本机 `19876`。DNS 默认 `1.1.1.1` 和 `2606:4700:4700::1111`。
- 探测间隔 5 秒；连续 2 次失败才判为不可用，1 次成功就判为可用。
- 不修改路由器的 `/etc/config/network`、`firewall`、`dhcp`、`mwan3`，也不改 dnsmasq；卸载后不留下规则、路由和 nft 表。
- 所有脚本必须能在 BusyBox ash 下运行（`local` 可以用；不用 bash 专有语法）。shellcheck 用 `-s sh`，`SC3043`（local）全局忽略。
- 命令行输出用英文（与 OpenWrt 其他工具一致）；文档用中文。
- 路由器真机操作遵守“路由器尽量最小改动”：测试前后要导出 `network`、`firewall`、`dhcp` 的 UCI 配置，确认完全一致。
- 提交信息结尾：`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`（子代理用自己模型的署名）。推送前要征得用户同意。

## Review Focus

1. 用户输入大写或用横线分隔的 MAC（`AA-BB-CC-DD-EE-FF`），应当照常识别。→ Task 1 `test_normalize_mac`。
2. 还没指定任何设备时，nft 规则仍要能加载（空集合不能写 `elements = { }`）。→ Task 1 `test_nft_ruleset_empty`。
3. 手机在 hev 运行中途断开，或 hev 自己崩溃，守护脚本应当重新拉起或切回宽带，而不是卡在“可用”。→ Task 3 状态判断，加 Task 6 真机第 3 步。
4. 守护脚本被 `kill -9` 后，procd 重新拉起它，残留的 hev 和 `cgtun` 不能让新实例启动失败。→ Task 3 启动时清理残留，Task 6 第 8 步。
5. 运行中执行 `fw4 reload`（用户改防火墙会触发），被指定设备不能断网：`inet cellglide` 表不受影响，放行规则会被 fw4 重新带上。→ Task 6 第 7 步。

---

## File Structure

| 路径 | 职责 |
|---|---|
| `Router/OpenWrt/cellglide/Makefile` | OpenWrt 软件包定义、安装脚本 |
| `Router/OpenWrt/cellglide/files/etc/config/cellglide` | 默认 UCI 配置 |
| `Router/OpenWrt/cellglide/files/etc/init.d/cellglide` | procd 服务：iproxy 和守护脚本两个实例 |
| `Router/OpenWrt/cellglide/files/usr/lib/cellglide/common.sh` | 纯函数：MAC 规范化、hev 配置、nft 规则文本、局域网路由提取、状态机、租约列表 |
| `Router/OpenWrt/cellglide/files/usr/lib/cellglide/net.sh` | 网络改动：策略规则、表 1986、nft 加载与删除（经 `cg_run`） |
| `Router/OpenWrt/cellglide/files/usr/libexec/cellglide/probe` | ucode：SOCKS5 握手探测、UDP 走 TCP 支持检测 |
| `Router/OpenWrt/cellglide/files/usr/libexec/cellglide/daemon` | 守护脚本 |
| `Router/OpenWrt/cellglide/files/usr/sbin/cellglide` | 命令行 |
| `Router/OpenWrt/cellglide/files/usr/share/nftables.d/chain-pre/forward/cellglide.nft` | fw4 放行规则 |
| `Router/OpenWrt/tests/run.sh` | 测试入口（`busybox sh` / `sh`） |
| `Router/OpenWrt/tests/test_common.sh`、`test_net.sh` | 测试用例 |
| `.github/workflows/openwrt.yml` | shellcheck、测试、SDK 打包（25.12 apk、24.10 ipk） |
| `Docs/OpenWrt-Router.md` | 用户文档（改为装包方式） |

---

### Task 1: 纯函数库 common.sh 与测试框架

**Files:**
- Create: `Router/OpenWrt/cellglide/files/usr/lib/cellglide/common.sh`
- Create: `Router/OpenWrt/tests/run.sh`
- Test: `Router/OpenWrt/tests/test_common.sh`

**Interfaces:**
- Produces（后续任务直接调用，名称和参数不可改）：
  - 常量 `CG_MARK=0x10000`、`CG_TABLE=1986`、`CG_TUN=cgtun`、`CG_LAN=br-lan`
  - `cg_normalize_mac MAC` → 打印小写冒号格式，非法时返回 1
  - `cg_hev_config PORT` → 打印 hev YAML
  - `cg_nft_ruleset DNS4 DNS6 REDIRECT MAC...` → 打印替换 `inet cellglide` 表的 nft 脚本；REDIRECT 为 `1` 时含 DNS 改写链
  - `cg_lan_routes` → 从标准输入读 `ip route show` 的输出，打印非默认路由的前缀，每行一个
  - `cg_next_state STATE FAILS PROBE` → 打印 `"<up|down> <fails>"`；PROBE 为 `0` 表示探测成功
  - `cg_leases MAC...` → 从标准输入读 `/tmp/dhcp.leases`，打印 `MAC  IP  NAME`，被指定的设备行尾加 `  (via iPhone)`
  - 测试辅助（只在 `run.sh` 里）：`assert_eq ACTUAL EXPECTED NAME`

- [ ] **Step 1: 写测试入口和失败的测试**

`Router/OpenWrt/tests/run.sh`：

```sh
#!/bin/sh
# Runs the package's shell tests. Use busybox sh where available: it is the router's shell.
#   busybox sh Router/OpenWrt/tests/run.sh
cd "$(dirname "$0")" || exit 1
FILES=../cellglide/files
FAILED=0
PASSED=0

assert_eq() {
	if [ "$1" = "$2" ]; then
		PASSED=$((PASSED + 1))
	else
		FAILED=$((FAILED + 1))
		printf 'FAIL %s\n--- expected\n%s\n--- actual\n%s\n' "$3" "$2" "$1"
	fi
}

. "$FILES/usr/lib/cellglide/common.sh"
[ -f "$FILES/usr/lib/cellglide/net.sh" ] && . "$FILES/usr/lib/cellglide/net.sh"
for test in ./test_*.sh; do
	. "$test"
done
echo "$PASSED passed, $FAILED failed"
[ "$FAILED" = 0 ]
```

`Router/OpenWrt/tests/test_common.sh`：

```sh
# shellcheck shell=sh
# Sourced by run.sh.

test_normalize_mac() {
	assert_eq "$(cg_normalize_mac AA-BB-CC-0D-ee-FF)" "aa:bb:cc:0d:ee:ff" "dashes and upper case"
	assert_eq "$(cg_normalize_mac 0c:29:8f:0a:99:12)" "0c:29:8f:0a:99:12" "already normal"
	cg_normalize_mac 0c:29:8f:0a:99 >/dev/null
	assert_eq "$?" "1" "too short"
	cg_normalize_mac 0c:29:8f:0a:99:zz >/dev/null
	assert_eq "$?" "1" "not hex"
	cg_normalize_mac "" >/dev/null
	assert_eq "$?" "1" "empty"
}

test_hev_config() {
	assert_eq "$(cg_hev_config 19876)" "tunnel:
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
  udp-read-write-timeout: 30000" "hev config"
}

test_nft_ruleset_with_dns() {
	assert_eq "$(cg_nft_ruleset 1.1.1.1 2606:4700:4700::1111 1 aa:bb:cc:dd:ee:ff 0c:29:8f:0a:99:12)" "table inet cellglide
delete table inet cellglide
table inet cellglide {
	set devices {
		type ether_addr
		elements = { aa:bb:cc:dd:ee:ff, 0c:29:8f:0a:99:12 }
	}
	chain mark {
		type filter hook prerouting priority mangle; policy accept;
		iifname \"br-lan\" ether saddr @devices meta mark set meta mark | 0x10000
	}
	chain dns {
		type nat hook prerouting priority dstnat; policy accept;
		iifname \"br-lan\" ether saddr @devices meta nfproto ipv4 udp dport 53 dnat ip to 1.1.1.1
		iifname \"br-lan\" ether saddr @devices meta nfproto ipv6 udp dport 53 dnat ip6 to 2606:4700:4700::1111
		iifname \"br-lan\" ether saddr @devices meta nfproto ipv4 tcp dport 53 dnat ip to 1.1.1.1
		iifname \"br-lan\" ether saddr @devices meta nfproto ipv6 tcp dport 53 dnat ip6 to 2606:4700:4700::1111
	}
}" "ruleset with DNS redirect"
}

test_nft_ruleset_empty() {
	assert_eq "$(cg_nft_ruleset 1.1.1.1 2606:4700:4700::1111 0)" "table inet cellglide
delete table inet cellglide
table inet cellglide {
	set devices {
		type ether_addr
	}
	chain mark {
		type filter hook prerouting priority mangle; policy accept;
		iifname \"br-lan\" ether saddr @devices meta mark set meta mark | 0x10000
	}
}" "no devices, no DNS redirect"
}

test_lan_routes() {
	routes=$(printf '%s\n' \
		'10.10.10.0/24 proto kernel scope link src 10.10.10.1' \
		'default via 10.10.10.254' \
		'fd1e:f1ee:8b51::/64 proto kernel metric 256 pref medium' \
		'fe80::/64 proto kernel metric 256 pref medium' | cg_lan_routes)
	assert_eq "$routes" "10.10.10.0/24
fd1e:f1ee:8b51::/64
fe80::/64" "LAN prefixes without default"
}

test_next_state() {
	assert_eq "$(cg_next_state down 0 0)" "up 0" "one success is enough"
	assert_eq "$(cg_next_state up 0 1)" "up 1" "one failure keeps it up"
	assert_eq "$(cg_next_state up 1 1)" "down 2" "two failures bring it down"
	assert_eq "$(cg_next_state up 1 0)" "up 0" "success resets the count"
	assert_eq "$(cg_next_state down 5 1)" "down 6" "stays down"
}

test_leases() {
	list=$(printf '%s\n' \
		'1792085847 9a:da:5c:9c:8f:68 10.10.10.227 iPhone 01:9a' \
		'1792076972 0c:29:8f:0a:99:12 10.10.10.141 * 01:0c' | cg_leases 0c:29:8f:0a:99:12)
	assert_eq "$list" "9a:da:5c:9c:8f:68  10.10.10.227     iPhone
0c:29:8f:0a:99:12  10.10.10.141     -  (via iPhone)" "lease table"
}

test_normalize_mac
test_hev_config
test_nft_ruleset_with_dns
test_nft_ruleset_empty
test_lan_routes
test_next_state
test_leases
```

- [ ] **Step 2: 运行，确认失败**

Run: `busybox sh Router/OpenWrt/tests/run.sh || sh Router/OpenWrt/tests/run.sh`
Expected: 报错 `common.sh: not found` 或大量 FAIL，退出码非 0。
（Mac 上若没有 busybox，用 `sh`；CI 和路由器上用 busybox。）

- [ ] **Step 3: 写 common.sh**

```sh
# shellcheck shell=sh
# Pure helpers for the cellglide daemon and command line: they only print text.

CG_MARK=0x10000
CG_TABLE=1986
CG_TUN=cgtun
CG_LAN=br-lan

# Prints a MAC address as lowercase, colon-separated hex; fails for anything else.
cg_normalize_mac() {
	local mac
	mac=$(printf '%s' "$1" | tr 'ABCDEF-' 'abcdef:')
	case "$mac" in
	[0-9a-f][0-9a-f]:[0-9a-f][0-9a-f]:[0-9a-f][0-9a-f]:[0-9a-f][0-9a-f]:[0-9a-f][0-9a-f]:[0-9a-f][0-9a-f])
		printf '%s\n' "$mac"
		;;
	*) return 1 ;;
	esac
}

# hev-socks5-tunnel configuration. UDP rides inside the SOCKS TCP connection,
# because iproxy forwards TCP only.
cg_hev_config() {
	cat <<EOF
tunnel:
  name: $CG_TUN
  mtu: 1500
  ipv4: 198.18.0.1
  ipv6: 'fc00::cafe:1'
socks5:
  address: 127.0.0.1
  port: $1
  udp: 'tcp'
misc:
  log-level: warn
  udp-read-write-timeout: 30000
EOF
}

# An nft script that replaces table inet cellglide. Arguments: IPv4 DNS, IPv6 DNS,
# 1 to redirect the chosen devices' DNS (only while the iPhone is usable), then their MACs.
cg_nft_ruleset() {
	local dns4="$1" dns6="$2" redirect="$3" elements="" mac proto
	shift 3
	for mac in "$@"; do
		elements="${elements:+$elements, }$mac"
	done
	printf 'table inet cellglide\ndelete table inet cellglide\ntable inet cellglide {\n'
	printf '\tset devices {\n\t\ttype ether_addr\n'
	if [ -n "$elements" ]; then
		printf '\t\telements = { %s }\n' "$elements"
	fi
	printf '\t}\n'
	printf '\tchain mark {\n\t\ttype filter hook prerouting priority mangle; policy accept;\n'
	printf '\t\tiifname "%s" ether saddr @devices meta mark set meta mark | %s\n\t}\n' "$CG_LAN" "$CG_MARK"
	if [ "$redirect" = 1 ]; then
		printf '\tchain dns {\n\t\ttype nat hook prerouting priority dstnat; policy accept;\n'
		for proto in udp tcp; do
			printf '\t\tiifname "%s" ether saddr @devices meta nfproto ipv4 %s dport 53 dnat ip to %s\n' "$CG_LAN" "$proto" "$dns4"
			printf '\t\tiifname "%s" ether saddr @devices meta nfproto ipv6 %s dport 53 dnat ip6 to %s\n' "$CG_LAN" "$proto" "$dns6"
		done
		printf '\t}\n'
	fi
	printf '}\n'
}

# Reads `ip route show` output and prints each non-default destination prefix.
cg_lan_routes() {
	awk '$1 != "default" && $1 != "unreachable" { print $1 }'
}

# Arguments: current state (up|down), consecutive failures, probe result (0 = success).
# Prints the next state and failure count. One success is enough; two failures in a row
# are needed to give up, so a single slow probe doesn't bounce the devices.
cg_next_state() {
	local fails
	if [ "$3" = 0 ]; then
		echo "up 0"
		return
	fi
	fails=$(($2 + 1))
	if [ "$fails" -ge 2 ]; then
		echo "down $fails"
	else
		echo "$1 $fails"
	fi
}

# Reads dnsmasq leases ("expiry mac ip name clientid") and prints one device per line,
# marking the MACs given as arguments.
cg_leases() {
	local chosen=" $* " mac ip name flag
	while read -r _ mac ip name _; do
		case "$chosen" in
		*" $mac "*) flag="  (via iPhone)" ;;
		*) flag="" ;;
		esac
		[ "$name" = "*" ] && name="-"
		printf '%s  %-15s  %s%s\n' "$mac" "$ip" "$name" "$flag"
	done
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `busybox sh Router/OpenWrt/tests/run.sh`（没有 busybox 时用 `sh`）
Expected: `N passed, 0 failed`，退出码 0。

- [ ] **Step 5: 提交**

```bash
git add Router/OpenWrt/cellglide/files/usr/lib/cellglide/common.sh Router/OpenWrt/tests/run.sh Router/OpenWrt/tests/test_common.sh
git commit -m "OpenWrt: pure helpers for the cellglide package, with shell tests"
```

---

### Task 2: 网络改动 net.sh（可记录的命令）

**Files:**
- Create: `Router/OpenWrt/cellglide/files/usr/lib/cellglide/net.sh`
- Test: `Router/OpenWrt/tests/test_net.sh`

**Interfaces:**
- Consumes: Task 1 的 `CG_MARK`、`CG_TABLE`、`CG_TUN`、`CG_LAN`
- Produces：
  - `cg_run CMD...`：`CG_DRYRUN` 非空时把命令追加到该文件，否则直接执行
  - `cg_setup FALLBACK LAN4 LAN6`：先清空规则和表 1986，再重建。LAN4 和 LAN6 是换行分隔的前缀列表；FALLBACK 为 `block` 时加 unreachable 默认路由
  - `cg_tunnel_up` / `cg_tunnel_down`：在表 1986 里加或删 `default dev cgtun`（IPv4 和 IPv6）
  - `cg_teardown`：删规则、清空表 1986、删 nft 表
  - `cg_nft_apply`：从标准输入读 nft 脚本；正常模式下执行 `nft -f -`，`CG_DRYRUN` 非空时追加到该文件

- [ ] **Step 1: 写失败的测试**

`Router/OpenWrt/tests/test_net.sh`：

```sh
# shellcheck shell=sh
# Sourced by run.sh. Records commands instead of running them.

recorded() {
	CG_DRYRUN=$(mktemp)
	"$@"
	cat "$CG_DRYRUN"
	rm -f "$CG_DRYRUN"
	CG_DRYRUN=""
}

test_setup_broadband() {
	assert_eq "$(recorded cg_setup broadband '10.10.10.0/24' 'fd1e::/64
fe80::/64')" "ip -4 rule del priority 1986
ip -4 rule add fwmark 0x10000/0x10000 lookup 1986 priority 1986
ip -4 route flush table 1986
ip -6 rule del priority 1986
ip -6 rule add fwmark 0x10000/0x10000 lookup 1986 priority 1986
ip -6 route flush table 1986
ip -4 route add 10.10.10.0/24 dev br-lan table 1986
ip -6 route add fd1e::/64 dev br-lan table 1986
ip -6 route add fe80::/64 dev br-lan table 1986" "setup, back to broadband"
}

test_setup_block() {
	assert_eq "$(recorded cg_setup block '10.10.10.0/24' '')" "ip -4 rule del priority 1986
ip -4 rule add fwmark 0x10000/0x10000 lookup 1986 priority 1986
ip -4 route flush table 1986
ip -4 route add unreachable default metric 4000000000 table 1986
ip -6 rule del priority 1986
ip -6 rule add fwmark 0x10000/0x10000 lookup 1986 priority 1986
ip -6 route flush table 1986
ip -6 route add unreachable default metric 4000000000 table 1986
ip -4 route add 10.10.10.0/24 dev br-lan table 1986" "setup, blocked without the iPhone"
}

test_tunnel_routes() {
	assert_eq "$(recorded cg_tunnel_up)" "ip -4 route replace default dev cgtun table 1986
ip -6 route replace default dev cgtun table 1986" "tunnel up"
	assert_eq "$(recorded cg_tunnel_down)" "ip -4 route del default dev cgtun table 1986
ip -6 route del default dev cgtun table 1986" "tunnel down"
}

test_teardown() {
	assert_eq "$(recorded cg_teardown)" "ip -4 rule del priority 1986
ip -4 route flush table 1986
ip -6 rule del priority 1986
ip -6 route flush table 1986
nft delete table inet cellglide" "teardown"
}


test_nft_apply() {
	CG_DRYRUN=$(mktemp)
	echo "table inet cellglide {}" | cg_nft_apply
	assert_eq "$(cat "$CG_DRYRUN")" "table inet cellglide {}" "nft script recorded"
	rm -f "$CG_DRYRUN"
	CG_DRYRUN=""
}

test_setup_broadband
test_setup_block
test_tunnel_routes
test_teardown
test_nft_apply
```


- [ ] **Step 2: 运行，确认失败**

Run: `busybox sh Router/OpenWrt/tests/run.sh`
Expected: `test_net.sh` 的用例报 `cg_setup: not found` 一类错误，或 FAIL，退出码非 0。

- [ ] **Step 3: 写 net.sh**

```sh
# shellcheck shell=sh
# Network changes for cellglide. Every command goes through cg_run, so the tests can
# record the commands instead of running them (set CG_DRYRUN to a file).

cg_run() {
	if [ -n "$CG_DRYRUN" ]; then
		echo "$*" >>"$CG_DRYRUN"
	else
		"$@"
	fi
}

# For commands that may fail harmlessly, such as deleting a rule that isn't there.
cg_quiet() {
	cg_run "$@" 2>/dev/null || true
}

# Policy rules and table 1986. Marked packets look up table 1986. While the iPhone is in
# use it holds a default route via cgtun; when cgtun goes away the kernel drops that route
# and the lookup falls through to the main table (broadband), unless FALLBACK is "block".
# LAN4 and LAN6 are newline-separated prefixes kept on br-lan, so chosen devices still
# reach the rest of the LAN.
cg_setup() {
	local fallback="$1" lan4="$2" lan6="$3" family prefix
	for family in 4 6; do
		cg_quiet ip -$family rule del priority "$CG_TABLE"
		cg_run ip -$family rule add fwmark "$CG_MARK/$CG_MARK" lookup "$CG_TABLE" priority "$CG_TABLE"
		cg_quiet ip -$family route flush table "$CG_TABLE"
		if [ "$fallback" = block ]; then
			cg_run ip -$family route add unreachable default metric 4000000000 table "$CG_TABLE"
		fi
	done
	for prefix in $lan4; do
		cg_run ip -4 route add "$prefix" dev "$CG_LAN" table "$CG_TABLE"
	done
	for prefix in $lan6; do
		cg_run ip -6 route add "$prefix" dev "$CG_LAN" table "$CG_TABLE"
	done
}

cg_tunnel_up() {
	local family
	for family in 4 6; do
		cg_run ip -$family route replace default dev "$CG_TUN" table "$CG_TABLE"
	done
}

cg_tunnel_down() {
	local family
	for family in 4 6; do
		cg_quiet ip -$family route del default dev "$CG_TUN" table "$CG_TABLE"
	done
}

cg_teardown() {
	local family
	for family in 4 6; do
		cg_quiet ip -$family rule del priority "$CG_TABLE"
		cg_quiet ip -$family route flush table "$CG_TABLE"
	done
	cg_quiet nft delete table inet cellglide
}

# Reads an nft script on stdin and loads it atomically.
cg_nft_apply() {
	if [ -n "$CG_DRYRUN" ]; then
		cat >>"$CG_DRYRUN"
	else
		nft -f -
	fi
}
```

注意：`cg_quiet` 在记录模式下也会把命令写进文件（测试期望里包含 `rule del` 和 `route flush`，就是这个原因）。

- [ ] **Step 4: 运行，确认通过**

Run: `busybox sh Router/OpenWrt/tests/run.sh`
Expected: `N passed, 0 failed`。

- [ ] **Step 5: 提交**

```bash
git add Router/OpenWrt/cellglide/files/usr/lib/cellglide/net.sh Router/OpenWrt/tests/test_net.sh
git commit -m "OpenWrt: policy routing and nft changes behind a recordable runner"
```

---

### Task 3: 探测脚本、守护脚本、procd 服务、默认配置、fw4 放行规则

**Files:**
- Create: `Router/OpenWrt/cellglide/files/usr/libexec/cellglide/probe`
- Create: `Router/OpenWrt/cellglide/files/usr/libexec/cellglide/daemon`
- Create: `Router/OpenWrt/cellglide/files/etc/init.d/cellglide`
- Create: `Router/OpenWrt/cellglide/files/etc/config/cellglide`
- Create: `Router/OpenWrt/cellglide/files/usr/share/nftables.d/chain-pre/forward/cellglide.nft`

**Interfaces:**
- Consumes: Task 1 的全部函数；Task 2 的 `cg_setup`、`cg_tunnel_up`、`cg_tunnel_down`、`cg_teardown`、`cg_nft_apply`
- Produces:
  - `probe greet PORT`：退出码 0 表示 CellGlide 在共享，非 0 表示不可用
  - `probe udp PORT`：退出码 0 表示支持 UDP 走 TCP，3 表示 App 太旧，其他值表示无法判断
  - 状态文件 `/var/run/cellglide/status`：shell 可 source 的 `key='value'` 行，键为 `state`（up/down）、`since`（epoch 秒）、`device`（UDID）、`udp`（yes/no/unknown）、`error`（文字）
  - UCI：`cellglide.main` 的 `enabled socks_port local_port fallback dns dns6`；`device` 段的 `mac name`

这一任务没有能在 Mac 上跑的单元测试（全是进程和网络副作用）。它的测试是：Step 6 在路由器上手动运行，Step 7 跑 shellcheck。完整的真机验证在 Task 6。

- [ ] **Step 1: 写 probe（ucode）**

```
#!/usr/bin/ucode
// Talks to the SOCKS5 server CellGlide shares over USB, reached through iproxy.
//   probe greet PORT  exit 0 when the server answers the SOCKS5 greeting
//   probe udp PORT    exit 0 when it accepts hev's UDP-in-TCP command (0x05),
//                     3 when it refuses it (CellGlide before 2.3), 1 otherwise
'use strict';

import * as socket from 'socket';

const mode = ARGV[0], port = +ARGV[1];

function read_exact(conn, count) {
	let data = '';
	while (length(data) < count) {
		const ready = socket.poll(2000, conn);
		if (!ready || !ready[0][1])
			return null;
		const chunk = conn.recv(count - length(data));
		if (!length(chunk))
			return null;
		data += chunk;
	}
	return data;
}

if ((mode != 'greet' && mode != 'udp') || !port) {
	warn('usage: probe greet|udp PORT\n');
	exit(2);
}

// iproxy accepts the TCP connection even without an iPhone, then closes it,
// so a successful connect alone proves nothing.
const conn = socket.connect('127.0.0.1', port, null, 2000);
if (!conn)
	exit(1);

conn.send(chr(5, 1, 0));
if (read_exact(conn, 2) != chr(5, 0)) {
	conn.close();
	exit(1);
}

if (mode == 'udp') {
	conn.send(chr(5, 5, 0, 1, 0, 0, 0, 0, 0, 0));
	const reply = read_exact(conn, 2);
	conn.close();
	if (reply == null)
		exit(1);
	exit(ord(reply, 1) == 0 ? 0 : 3);
}

conn.close();
exit(0);
```

- [ ] **Step 2: 写 daemon**

```sh
#!/bin/sh
# Watches the iPhone and moves the chosen devices between it and the broadband line.
# Run by procd (/etc/init.d/cellglide); SIGTERM undoes every change it made.

. /lib/functions.sh
. /usr/lib/cellglide/common.sh
. /usr/lib/cellglide/net.sh

RUN=/var/run/cellglide
PROBE=/usr/libexec/cellglide/probe
HEV_PID=""
STATE=down
FAILS=0
UDP=unknown
DEVICE=""
ERROR=""
MACS=""

add_device() {
	local mac
	config_get mac "$1" mac
	mac=$(cg_normalize_mac "$mac") && MACS="$MACS $mac"
}

config_load cellglide
config_get LOCAL_PORT main local_port 19876
config_get FALLBACK main fallback broadband
config_get DNS4 main dns 1.1.1.1
config_get DNS6 main dns6 2606:4700:4700::1111
config_foreach add_device device

log() {
	logger -t cellglide "$*"
}

write_status() {
	printf "state='%s'\nsince='%s'\ndevice='%s'\nudp='%s'\nerror='%s'\n" \
		"$STATE" "$SINCE" "$DEVICE" "$UDP" "$ERROR" >"$RUN/status.tmp" &&
		mv "$RUN/status.tmp" "$RUN/status"
}

lan_routes() {
	ip -"$1" route show table main dev "$CG_LAN" | cg_lan_routes
}

load_nft() {
	# shellcheck disable=SC2086 # one argument per MAC
	cg_nft_ruleset "$DNS4" "$DNS6" "$1" $MACS | cg_nft_apply
}

hev_stop() {
	if [ -n "$HEV_PID" ]; then
		kill "$HEV_PID" 2>/dev/null
		wait "$HEV_PID" 2>/dev/null
		HEV_PID=""
	fi
}

hev_alive() {
	[ -n "$HEV_PID" ] && kill -0 "$HEV_PID" 2>/dev/null
}

# A previous instance killed with SIGKILL leaves its hev (and cgtun) behind.
kill_stale_hev() {
	local pid
	for pid in $(pgrep -f "hev-socks5-tunnel $RUN/hev.yml"); do
		kill "$pid" 2>/dev/null
	done
}

go_up() {
	local tries=0
	hev_stop
	kill_stale_hev
	cg_hev_config "$LOCAL_PORT" >"$RUN/hev.yml"
	hev-socks5-tunnel "$RUN/hev.yml" &
	HEV_PID=$!
	while [ ! -d "/sys/class/net/$CG_TUN" ] && [ "$tries" -lt 10 ]; do
		sleep 1
		tries=$((tries + 1))
	done
	if [ ! -d "/sys/class/net/$CG_TUN" ]; then
		ERROR="the tunnel did not start"
		hev_stop
		return 1
	fi
	cg_setup "$FALLBACK" "$(lan_routes 4)" "$(lan_routes 6)"
	cg_tunnel_up
	load_nft 1
	"$PROBE" udp "$LOCAL_PORT"
	case $? in
	0) UDP=yes ;;
	3) UDP=no ;;
	*) UDP=unknown ;;
	esac
	log "using the iPhone for:${MACS:- no devices yet}"
}

go_down() {
	load_nft 0
	cg_tunnel_down
	hev_stop
	log "iPhone unavailable ($ERROR), devices use: $FALLBACK"
}

cleanup() {
	hev_stop
	cg_teardown
	rm -f "$RUN/status" "$RUN/status.tmp" "$RUN/hev.yml"
	exit 0
}

trap cleanup INT TERM

mkdir -p "$RUN"
kill_stale_hev
cg_setup "$FALLBACK" "$(lan_routes 4)" "$(lan_routes 6)"
load_nft 0
SINCE=$(date +%s)
write_status

while :; do
	DEVICE=$(idevice_id -l 2>/dev/null | head -n 1)
	if [ -z "$DEVICE" ]; then
		probe=1
		ERROR="no iPhone connected"
	elif "$PROBE" greet "$LOCAL_PORT"; then
		probe=0
		ERROR=""
	else
		probe=1
		ERROR="CellGlide is not sharing"
	fi
	next=$(cg_next_state "$STATE" "$FAILS" "$probe")
	FAILS=${next#* }
	next=${next% *}
	if [ "$next" = up ] && { [ "$STATE" = down ] || ! hev_alive; }; then
		# Also restarts hev if it exited while the iPhone was in use.
		if go_up; then
			[ "$STATE" = down ] && SINCE=$(date +%s)
			STATE=up
		else
			STATE=down
		fi
	elif [ "$next" = down ] && [ "$STATE" = up ]; then
		go_down
		STATE=down
		SINCE=$(date +%s)
	fi
	write_status
	# Sleep in the background so SIGTERM is handled right away.
	sleep 5 &
	wait $!
done
```

- [ ] **Step 3: 写 procd 服务**

`files/etc/init.d/cellglide`：

```sh
#!/bin/sh /etc/rc.common
# Runs iproxy (the iPhone's SOCKS port on this router) and the cellglide daemon.

USE_PROCD=1
START=99
STOP=10

start_service() {
	local enabled local_port socks_port

	config_load cellglide
	config_get_bool enabled main enabled 1
	[ "$enabled" = 1 ] || return 0
	config_get local_port main local_port 19876
	config_get socks_port main socks_port 9876

	procd_open_instance iproxy
	procd_set_param command /usr/bin/iproxy -l "$local_port:$socks_port"
	procd_set_param respawn
	procd_close_instance

	procd_open_instance daemon
	procd_set_param command /usr/libexec/cellglide/daemon
	procd_set_param respawn
	procd_set_param term_timeout 10
	procd_set_param stdout 1
	procd_set_param stderr 1
	procd_close_instance
}

service_triggers() {
	procd_add_reload_trigger cellglide
}
```

- [ ] **Step 4: 写默认配置和 fw4 放行规则**

`files/etc/config/cellglide`：

```
config cellglide 'main'
	option enabled '1'
	option socks_port '9876'
	option local_port '19876'
	option fallback 'broadband'
	option dns '1.1.1.1'
	option dns6 '2606:4700:4700::1111'
```

`files/usr/share/nftables.d/chain-pre/forward/cellglide.nft`：

```
# cellglide: let chosen LAN devices out through the iPhone tunnel.
iifname "br-lan" oifname "cgtun" accept comment "cellglide"
```

- [ ] **Step 5: 设置可执行位**

```bash
chmod +x Router/OpenWrt/cellglide/files/usr/libexec/cellglide/probe \
  Router/OpenWrt/cellglide/files/usr/libexec/cellglide/daemon \
  Router/OpenWrt/cellglide/files/etc/init.d/cellglide
```

- [ ] **Step 6: 在路由器上检查语法和探测（只读，不改路由器设置）**

路由器在 `root@10.10.10.1`。只把脚本拷到 `/tmp`，不安装、不启动服务：

```bash
scp -O Router/OpenWrt/cellglide/files/usr/libexec/cellglide/probe Router/OpenWrt/cellglide/files/usr/libexec/cellglide/daemon root@10.10.10.1:/tmp/
ssh root@10.10.10.1 'sh -n /tmp/daemon && echo daemon-syntax-ok'
```

Expected：`daemon-syntax-ok`。probe 的语法在下面不带参数运行时检查。

如果路由器上还没装 `ucode-mod-socket`，**先问用户**再执行 `apk add ucode-mod-socket`（它本来就是这个包的依赖）。装好后，在手机插着、CellGlide 在共享时运行：

```bash
ssh root@10.10.10.1 'ucode /tmp/probe; echo usage=$?'
ssh root@10.10.10.1 '(iproxy -l 19876:9876 >/dev/null 2>&1 &); sleep 1; ucode /tmp/probe greet 19876; echo greet=$?; ucode /tmp/probe udp 19876; echo udp=$?; ucode /tmp/probe greet 19999; echo closed=$?; kill $(pgrep -f "iproxy -l 19876")'
```

Expected：先打印用法，`usage=2`（说明脚本能解析）；然后 `greet=0`、`udp=0`（开发版 App）、`closed=1`。最后确认 `pgrep -f "iproxy -l 19876"` 没有输出。

- [ ] **Step 7: shellcheck**

Run（Mac 上没有 shellcheck 时，先问用户是否 `brew install shellcheck`；否则留给 Task 5 的 CI）：

```bash
shellcheck -s sh -e SC3043 Router/OpenWrt/cellglide/files/usr/lib/cellglide/*.sh Router/OpenWrt/cellglide/files/usr/libexec/cellglide/daemon Router/OpenWrt/tests/*.sh
```

Expected：没有输出。init 脚本用 `shellcheck -s sh -e SC3043,SC2034,SC2154 Router/OpenWrt/cellglide/files/etc/init.d/cellglide`（rc.common 里定义的变量 shellcheck 看不到）。

- [ ] **Step 8: 提交**

```bash
git add Router/OpenWrt/cellglide/files
git commit -m "OpenWrt: cellglide daemon, iPhone probe, procd service and firewall include"
```

---

### Task 4: 命令行 cellglide

**Files:**
- Create: `Router/OpenWrt/cellglide/files/usr/sbin/cellglide`

**Interfaces:**
- Consumes: `cg_normalize_mac`、`cg_leases`（Task 1）；状态文件格式（Task 3）
- Produces: 命令 `cellglide pair|add|remove|list|status`

UCI 命令只在路由器上有，这个任务的测试是 Step 2 在路由器上用临时配置目录（`uci -c`）跑一遍。

- [ ] **Step 1: 写命令行**

```sh
#!/bin/sh
# cellglide: choose which LAN devices go out through the iPhone, and check on it.

. /usr/lib/cellglide/common.sh

STATUS=/var/run/cellglide/status
UCI="uci${CELLGLIDE_UCI_DIR:+ -c $CELLGLIDE_UCI_DIR}"

usage() {
	cat <<'EOF'
Usage: cellglide <command>
  pair               Pair the iPhone plugged into this router (tap Trust on the phone)
  add MAC [NAME]     Send this device's traffic through the iPhone
  remove MAC         Send this device back to the broadband line
  list               Show devices on the LAN; chosen ones are marked
  status             Show whether the iPhone is in use
EOF
	exit 1
}

# Prints the chosen MACs, one per line.
chosen() {
	local i=0 mac
	while mac=$($UCI -q get "cellglide.@device[$i].mac"); do
		cg_normalize_mac "$mac"
		i=$((i + 1))
	done
}

# Prints the index of the device section holding this MAC.
index_of() {
	local i=0 mac
	while mac=$($UCI -q get "cellglide.@device[$i].mac"); do
		if [ "$(cg_normalize_mac "$mac")" = "$1" ]; then
			echo "$i"
			return 0
		fi
		i=$((i + 1))
	done
	return 1
}

apply() {
	$UCI commit cellglide
	[ -n "$CELLGLIDE_UCI_DIR" ] || /etc/init.d/cellglide reload
}

mac_argument() {
	cg_normalize_mac "$1" || {
		echo "Not a MAC address: $1 (example: aa:bb:cc:dd:ee:ff)" >&2
		exit 1
	}
}

show_status() {
	local state since device udp error mac name i=0
	if [ ! -f "$STATUS" ]; then
		echo "cellglide is not running. Start it with: /etc/init.d/cellglide start"
		exit 1
	fi
	. "$STATUS"
	if [ -z "$device" ]; then
		echo "iPhone:  not connected"
	else
		echo "iPhone:  $device"
	fi
	if [ "$state" = up ]; then
		echo "State:   in use since $(date -d "@$since" '+%Y-%m-%d %H:%M:%S')"
	else
		echo "State:   not in use ($error)"
	fi
	case "$udp" in
	yes) echo "UDP:     works" ;;
	no) echo "UDP:     needs CellGlide 2.3 or later on the iPhone (TCP works)" ;;
	esac
	if [ "$state" = up ] && command -v curl >/dev/null; then
		echo "Exit IP: $(curl -s -m 5 --interface "$CG_TUN" https://speed.cloudflare.com/cdn-cgi/trace | sed -n 's/^ip=//p')"
	fi
	echo "Devices:"
	while mac=$($UCI -q get "cellglide.@device[$i].mac"); do
		name=$($UCI -q get "cellglide.@device[$i].name")
		echo "  $mac${name:+  $name}"
		i=$((i + 1))
	done
	[ "$i" = 0 ] && echo "  none yet. Add one with: cellglide add MAC [NAME]"
	return 0
}

case "$1" in
pair)
	exec idevicepair pair
	;;
add)
	mac=$(mac_argument "$2") || exit 1
	if index_of "$mac" >/dev/null; then
		echo "$mac already uses the iPhone"
		exit 0
	fi
	section=$($UCI add cellglide device)
	$UCI set "cellglide.$section.mac=$mac"
	[ -n "$3" ] && $UCI set "cellglide.$section.name=$3"
	apply
	echo "$mac now uses the iPhone"
	;;
remove)
	mac=$(mac_argument "$2") || exit 1
	i=$(index_of "$mac") || {
		echo "$mac is not in the list"
		exit 1
	}
	$UCI delete "cellglide.@device[$i]"
	apply
	echo "$mac is back on the broadband line"
	;;
list)
	# shellcheck disable=SC2046 # one argument per MAC
	cg_leases $(chosen) </tmp/dhcp.leases
	;;
status)
	show_status
	;;
*)
	usage
	;;
esac
```

`CELLGLIDE_UCI_DIR` 只用于测试：指向一个临时配置目录，此时不会去重载服务。

- [ ] **Step 2: 在路由器上用临时配置测试（不碰 /etc/config）**

```bash
scp -O Router/OpenWrt/cellglide/files/usr/sbin/cellglide root@10.10.10.1:/tmp/cellglide-cli
ssh root@10.10.10.1 'mkdir -p /tmp/cgtest/lib /tmp/cgconf && printf "config cellglide main\n" >/tmp/cgconf/cellglide'
scp -O Router/OpenWrt/cellglide/files/usr/lib/cellglide/common.sh root@10.10.10.1:/tmp/cgtest/lib/
ssh root@10.10.10.1 'sed "s#/usr/lib/cellglide#/tmp/cgtest/lib#" /tmp/cellglide-cli >/tmp/cgtest/cli; export CELLGLIDE_UCI_DIR=/tmp/cgconf; C="sh /tmp/cgtest/cli";
$C add AA-BB-CC-DD-EE-FF MacBook; $C add aa:bb:cc:dd:ee:ff; $C add 0c:29:8f:0a:99:12; $C add nonsense; echo bad=$?;
cat /tmp/cgconf/cellglide; $C remove aa:bb:cc:dd:ee:ff; $C remove aa:bb:cc:dd:ee:ff; echo missing=$?;
$C list | head -3; $C status; echo status=$?; $C; echo usage=$?'
ssh root@10.10.10.1 'rm -rf /tmp/cgtest /tmp/cgconf /tmp/cellglide-cli'
```

Expected：
- 第一次 add 输出 `aa:bb:cc:dd:ee:ff now uses the iPhone`；第二次输出 `already uses the iPhone`；
- `nonsense` 报 `Not a MAC address`，`bad=1`；
- 配置文件里有两个 `device` 段，MAC 都是小写；
- 第一次 remove 输出 `back on the broadband line`；第二次输出 `not in the list`，`missing=1`；
- list 打印租约，`0c:29:8f:0a:99:12` 那行带 `(via iPhone)`；
- status 输出 `cellglide is not running`，`status=1`；
- 不带参数时打印用法，`usage=1`。

- [ ] **Step 3: 提交**

```bash
chmod +x Router/OpenWrt/cellglide/files/usr/sbin/cellglide
git add Router/OpenWrt/cellglide/files/usr/sbin/cellglide
git commit -m "OpenWrt: cellglide command to pair, choose devices and show status"
```

---

### Task 5: 软件包 Makefile 与 CI 打包

**Files:**
- Create: `Router/OpenWrt/cellglide/Makefile`
- Create: `.github/workflows/openwrt.yml`

**Interfaces:**
- Consumes: Task 1–4 的全部文件路径
- Produces: GitHub Actions 产物 `cellglide-openwrt-25.12`（.apk）和 `cellglide-openwrt-24.10`（.ipk）；推送 `openwrt-*` 标签时附到 Release

- [ ] **Step 1: 写 Makefile**

```make
include $(TOPDIR)/rules.mk

PKG_NAME:=cellglide
PKG_VERSION:=0.1.0
PKG_RELEASE:=1

include $(INCLUDE_DIR)/package.mk

define Package/cellglide
  SECTION:=net
  CATEGORY:=Network
  TITLE:=Route chosen LAN devices through an iPhone running CellGlide
  URL:=https://cellglide.com
  DEPENDS:=+usbmuxd +libusbmuxd-utils +libimobiledevice-utils +hev-socks5-tunnel +ucode +ucode-mod-socket
  PKGARCH:=all
endef

define Package/cellglide/description
  Sends the traffic of chosen LAN devices (by MAC address) through an iPhone
  plugged into the router's USB port and sharing with the CellGlide app.
  When the iPhone is unplugged or stops sharing, those devices go back to the
  broadband line.
endef

define Package/cellglide/conffiles
/etc/config/cellglide
endef

define Build/Compile
endef

define Package/cellglide/install
	$(INSTALL_DIR) $(1)/etc/config $(1)/etc/init.d $(1)/usr/sbin
	$(INSTALL_DIR) $(1)/usr/lib/cellglide $(1)/usr/libexec/cellglide
	$(INSTALL_DIR) $(1)/usr/share/nftables.d/chain-pre/forward
	$(INSTALL_CONF) ./files/etc/config/cellglide $(1)/etc/config/cellglide
	$(INSTALL_BIN) ./files/etc/init.d/cellglide $(1)/etc/init.d/cellglide
	$(INSTALL_BIN) ./files/usr/sbin/cellglide $(1)/usr/sbin/cellglide
	$(INSTALL_DATA) ./files/usr/lib/cellglide/common.sh $(1)/usr/lib/cellglide/common.sh
	$(INSTALL_DATA) ./files/usr/lib/cellglide/net.sh $(1)/usr/lib/cellglide/net.sh
	$(INSTALL_BIN) ./files/usr/libexec/cellglide/daemon $(1)/usr/libexec/cellglide/daemon
	$(INSTALL_BIN) ./files/usr/libexec/cellglide/probe $(1)/usr/libexec/cellglide/probe
	$(INSTALL_DATA) ./files/usr/share/nftables.d/chain-pre/forward/cellglide.nft $(1)/usr/share/nftables.d/chain-pre/forward/cellglide.nft
endef

# The firewall include only takes effect after fw4 reloads.
define Package/cellglide/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || fw4 -q reload
exit 0
endef

define Package/cellglide/prerm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || /etc/init.d/cellglide stop
exit 0
endef

define Package/cellglide/postrm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || fw4 -q reload
exit 0
endef

$(eval $(call BuildPackage,cellglide))
```

- [ ] **Step 2: 写 CI**

`.github/workflows/openwrt.yml`：

```yaml
# Lints and tests the OpenWrt package, then builds it with the official SDK:
# an .apk for OpenWrt 25.12 and an .ipk for 24.10. The package is
# architecture-independent, so one x86-64 SDK per release is enough.
name: OpenWrt package

on:
  push:
    paths: ['Router/OpenWrt/**', '.github/workflows/openwrt.yml']
    tags: ['openwrt-*']
  workflow_dispatch:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - name: Install busybox
        run: sudo apt-get update && sudo apt-get install -y busybox
      - name: shellcheck
        run: |
          cd Router/OpenWrt
          shellcheck -s sh -e SC3043 cellglide/files/usr/lib/cellglide/*.sh \
            cellglide/files/usr/libexec/cellglide/daemon cellglide/files/usr/sbin/cellglide tests/*.sh
          shellcheck -s sh -e SC3043,SC2034,SC2154 cellglide/files/etc/init.d/cellglide
      - name: Tests (busybox ash)
        run: busybox sh Router/OpenWrt/tests/run.sh

  build:
    needs: check
    runs-on: ubuntu-latest
    strategy:
      matrix:
        include:
          - release: '25.12'
            arch: x86-64-openwrt-25.12
            ext: apk
          - release: '24.10'
            arch: x86-64-openwrt-24.10
            ext: ipk
    steps:
      - uses: actions/checkout@v5
      - name: Build with the OpenWrt SDK
        uses: openwrt/gh-action-sdk@v11
        env:
          ARCH: ${{ matrix.arch }}
          FEED_DIR: ${{ github.workspace }}/Router/OpenWrt
          FEEDNAME: cellglide
          PACKAGES: cellglide
      - name: Collect the package
        run: |
          mkdir -p out
          find bin/packages -name "cellglide*.${{ matrix.ext }}" -exec cp {} out/ \;
          ls -l out
          test -n "$(ls out)"
      - uses: actions/upload-artifact@v4
        with:
          name: cellglide-openwrt-${{ matrix.release }}
          path: out/*
      - name: Attach to the release
        if: startsWith(github.ref, 'refs/tags/openwrt-')
        uses: softprops/action-gh-release@v3
        with:
          files: out/*
```

- [ ] **Step 3: 本地检查 YAML 和 Makefile 缩进**

Run：

```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/openwrt.yml')); print('yaml ok')"
grep -nP '^ {2,}\$\(INSTALL' Router/OpenWrt/cellglide/Makefile && echo "Makefile recipe lines must start with a tab" || echo "tabs ok"
```

Expected：`yaml ok`、`tabs ok`。如果本机 Python 没有 yaml 模块，改用 `ruby -ryaml -e "YAML.load_file('.github/workflows/openwrt.yml'); puts 'yaml ok'"`。

- [ ] **Step 4: 提交**

```bash
git add Router/OpenWrt/cellglide/Makefile .github/workflows/openwrt.yml
git commit -m "OpenWrt: package Makefile and CI building .apk (25.12) and .ipk (24.10)"
```

- [ ] **Step 5: 跑 CI（需要用户同意推送）**

这一步需要把分支推到 GitHub。**先问用户**，同意后执行：

```bash
git push -u origin openwrt-package
gh run watch "$(gh run list --branch openwrt-package --workflow openwrt.yml --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status
```

Expected：check 和两个 build 都成功。失败时按日志修复：常见的是 SDK 的 shfmt 检查 init 脚本格式，用 tab 缩进、`case` 分支和 OpenWrt 自带的 init 脚本保持一致。修好后提交，再推送。

---

### Task 6: 文档与真机验证

**Files:**
- Modify: `Docs/OpenWrt-Router.md`（整篇改写；原有手动步骤移到附录）

- [ ] **Step 1: 改写文档**

结构（中文，平实自然）：
1. 这是什么：路由器后面选定的设备经 USB 连着的 iPhone 上网；手机拔掉自动回宽带。
2. 需要什么：OpenWrt 24.10 或 25.12；iOS CellGlide 2.3 或更新版本（旧版 UDP 不通，`cellglide status` 会提示）；App 在前台开始共享。
3. 安装：
   - 25.12：`apk update && apk add --allow-untrusted ./cellglide-0.1.0-r1.apk`。安装时会顺带从官方源装好依赖。说明包没有签名，所以要加 `--allow-untrusted`。
   - 24.10：`opkg update && opkg install ./cellglide_0.1.0-1_all.ipk`。
   - 下载地址：GitHub Releases（`openwrt-0.1.0`）。
4. 配对：`cellglide pair`，在手机上点“信任”。
5. 选设备：`cellglide list` 找 MAC，`cellglide add MAC 名字`。
6. 在手机上打开 CellGlide 开始共享；`cellglide status` 查看。
7. 手机不可用时：默认回到宽带；要断网就执行：
   ```
   uci set cellglide.main.fallback=block
   uci commit cellglide
   /etc/init.d/cellglide reload
   ```
8. 已知限制：
   - 手机锁屏或 App 退到后台会停止共享，大约 10 秒后回到宽带；
   - 被选设备无法解析 `xxx.lan`，用 IP 访问不受影响，`.local` 也不受影响；
   - 外网连不进来；
   - 路由器自己的流量不走手机；
   - 一次只支持一台 iPhone；
   - 和其他代理插件（sing-box、OpenClash 等）同时用时，把这些设备从那些插件里排除。
9. 卸载：`apk del cellglide` 或 `opkg remove cellglide`，所有规则都会撤掉。
10. 附录：原来的手动步骤（保留现有内容，标题改为“附录：手动配置（不装软件包）”）。

- [ ] **Step 2: 提交文档**

```bash
git add Docs/OpenWrt-Router.md
git commit -m "Docs: install the cellglide package on OpenWrt"
```

- [ ] **Step 3: 真机验证（控制者和用户一起做，每一步改动路由器前先告诉用户）**

前提：Task 5 的 CI 产物已下载（`gh run download --name cellglide-openwrt-25.12 -D build.noindex/openwrt`）；iPhone 装着开发版（含 UDP 走 TCP），插在路由器上。

1. **备份**：
   ```bash
   ssh root@10.10.10.1 'for c in network firewall dhcp; do uci export $c; done' > build.noindex/openwrt/uci-before.txt
   ssh root@10.10.10.1 'nft list ruleset' > build.noindex/openwrt/nft-before.txt
   ssh root@10.10.10.1 'ip rule; ip -6 rule' > build.noindex/openwrt/rules-before.txt
   ```
2. **安装和配对**：
   ```bash
   scp -O build.noindex/openwrt/cellglide-*.apk root@10.10.10.1:/tmp/
   ssh root@10.10.10.1 'apk add --allow-untrusted /tmp/cellglide-*.apk'
   ```
   然后 `cellglide pair`（已配对时应直接成功），`cellglide add <Mac 的 en0 MAC> Mac`。
   `cellglide status` 应显示 `in use`、`UDP: works`，出口 IP 是手机的。在 Mac 上验证：
   - `curl -4 -s https://speed.cloudflare.com/cdn-cgi/trace` 显示手机 IP；
   - `dig +short TXT o-o.myaddr.l.google.com @10.10.10.1` 里的 `edns0-client-subnet` 是手机网段；
   - 请用户跑一次 Cloudflare 测速，丢包 0%。
3. **拔掉手机**（请用户操作）：10 秒内 Mac 的出口变回宽带，网页照常打开；`cellglide status` 显示 `not in use (no iPhone connected)`。插回并开始共享：10 秒内切回手机。再让用户只在 App 里停止共享（不拔线）：同样回到宽带。
4. **其他设备不受影响**：确认 `ip rule` 只多了优先级 1986 这一条；用另一台设备（或路由器自己：`curl -4 -s https://speed.cloudflare.com/cdn-cgi/trace`）查看，出口仍是宽带。
5. **block 模式**：
   ```
   uci set cellglide.main.fallback=block
   uci commit cellglide
   /etc/init.d/cellglide reload
   ```
   拔掉手机后，Mac 上不了网，其他设备正常；改回 `broadband`。
6. **重启路由器**（先问用户）：重启后服务自动启动，手机插着时自动恢复。
7. **fw4 重载**：运行中执行 `fw4 reload`，Mac 不断网；`nft list chain inet fw4 forward | grep cellglide` 仍能看到放行规则。
8. **kill -9**：`kill -9 $(pgrep -f cellglide/daemon)`。procd 重新拉起后，Mac 仍经手机上网；`pgrep -f hev-socks5-tunnel` 只有一个进程。
9. **旧 App**：如果用户方便，装上架版 2.2.0 试一下，`cellglide status` 应显示 `UDP: needs CellGlide 2.3 or later`。不方便就跳过，在汇报里说明。
10. **卸载并核对**：
    ```bash
    ssh root@10.10.10.1 'apk del cellglide'
    ssh root@10.10.10.1 'for c in network firewall dhcp; do uci export $c; done' | diff build.noindex/openwrt/uci-before.txt - && echo uci-same
    ssh root@10.10.10.1 'nft list ruleset' | diff build.noindex/openwrt/nft-before.txt - && echo nft-same
    ssh root@10.10.10.1 'ip rule; ip -6 rule' | diff build.noindex/openwrt/rules-before.txt - && echo rules-same
    ```
    Expected：三个都相同。`/etc/config/cellglide` 是 conffile，`apk del` 可能会保留它，这符合惯例，在汇报里说明。依赖包（usbmuxd 等）保留不动。

- [ ] **Step 4: 汇报结果**

把每一步的结果（通过、失败或跳过及原因）写进最终汇报。发现的问题按 hunt 的方式先找根因，修复后补测试再提交。
