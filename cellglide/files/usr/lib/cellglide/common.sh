# shellcheck shell=sh
# CG_* constants are used by the files that source this one
# shellcheck disable=SC2034
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

# An nft script that replaces table inet cellglide. Arguments: IPv4 DNS, IPv6 DNS, what to
# do with the chosen devices' DNS while the iPhone is usable (0 leave it to the router,
# 1 send it to the IPv4/IPv6 DNS through the iPhone, local:PORT hand it to the router's
# forwarder to the iPhone's resolver on PORT), the forwarder's port (it then accepts only
# what nft redirected to it; empty for none), then their MACs, or the single word "all" for
# every device on the LAN.
# Set and chain names carry a cg_ prefix: plain words like devices, mark and dns are nft keywords.
cg_nft_ruleset() {
	local dns4="$1" dns6="$2" redirect="$3" guard="$4" elements="" match="ether saddr @cg_devices " mac proto
	shift 4
	for mac in "$@"; do
		if [ "$mac" = all ]; then
			match=""
			elements=""
			break
		fi
		elements="${elements:+$elements, }$mac"
	done
	printf 'table inet cellglide\ndelete table inet cellglide\ntable inet cellglide {\n'
	printf '\tset cg_devices {\n\t\ttype ether_addr\n'
	if [ -n "$elements" ]; then
		printf '\t\telements = { %s }\n' "$elements"
	fi
	printf '\t}\n'
	printf '\tchain cg_mark {\n\t\ttype filter hook prerouting priority mangle; policy accept;\n'
	printf '\t\tiifname "%s" %smeta mark set meta mark | %s\n\t}\n' "$CG_LAN" "$match" "$CG_MARK"
	if [ -n "$guard" ]; then
		printf '\tchain cg_input {\n\t\ttype filter hook input priority filter - 1; policy accept;\n'
		printf '\t\tmeta l4proto { tcp, udp } th dport %s ct status dnat accept\n' "$guard"
		printf '\t\tmeta l4proto { tcp, udp } th dport %s drop\n\t}\n' "$guard"
	fi
	case "$redirect" in
	local:*)
		printf '\tchain cg_dns {\n\t\ttype nat hook prerouting priority dstnat; policy accept;\n'
		for proto in udp tcp; do
			printf '\t\tiifname "%s" %s%s dport 53 redirect to :%s\n' "$CG_LAN" "$match" "$proto" "${redirect#local:}"
		done
		printf '\t}\n'
		;;
	1)
		printf '\tchain cg_dns {\n\t\ttype nat hook prerouting priority dstnat; policy accept;\n'
		for proto in udp tcp; do
			printf '\t\tiifname "%s" %smeta nfproto ipv4 %s dport 53 dnat ip to %s\n' "$CG_LAN" "$match" "$proto" "$dns4"
			printf '\t\tiifname "%s" %smeta nfproto ipv6 %s dport 53 dnat ip6 to %s\n' "$CG_LAN" "$match" "$proto" "$dns6"
		done
		printf '\t}\n'
		;;
	esac
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
# marking the MACs given as arguments (or every device for "all").
cg_leases() {
	local chosen=" $* " mac ip name flag
	while read -r _ mac ip name _; do
		case "$chosen" in
		*" all "* | *" $mac "*) flag="  (via iPhone)" ;;
		*) flag="" ;;
		esac
		[ "$name" = "*" ] && name="-"
		printf '%s  %-15s  %s%s\n' "$mac" "$ip" "$name" "$flag"
	done
}

# Makes outside text (an iPhone's name) safe for the status file, which is sourced as
# key='value' lines: no single quotes or line breaks. Not truncated: BusyBox cut counts
# bytes and could split a multibyte character.
cg_status_value() {
	printf '%s' "$1" | tr -d "'\r\n"
}
