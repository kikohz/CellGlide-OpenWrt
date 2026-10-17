# shellcheck shell=sh
# test_* functions are called by run.sh, not from here
# shellcheck disable=SC2317,SC2329
# Sourced by run.sh.

test_normalize_mac() {
	assert_eq "$(cg_normalize_mac AA-BB-CC-0D-ee-FF)" "aa:bb:cc:0d:ee:ff" "dashes and upper case"
	assert_eq "$(cg_normalize_mac 0c:11:22:33:44:55)" "0c:11:22:33:44:55" "already normal"
	cg_normalize_mac 0c:11:22:33:44 >/dev/null
	assert_eq "$?" "1" "too short"
	cg_normalize_mac 0c:11:22:33:44:zz >/dev/null
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
	assert_eq "$(cg_nft_ruleset 1.1.1.1 2606:4700:4700::1111 1 "" aa:bb:cc:dd:ee:ff 0c:11:22:33:44:55)" "table inet cellglide
delete table inet cellglide
table inet cellglide {
	set cg_devices {
		type ether_addr
		elements = { aa:bb:cc:dd:ee:ff, 0c:11:22:33:44:55 }
	}
	chain cg_mark {
		type filter hook prerouting priority mangle; policy accept;
		iifname \"br-lan\" ether saddr @cg_devices meta mark set meta mark | 0x10000
	}
	chain cg_dns {
		type nat hook prerouting priority dstnat; policy accept;
		iifname \"br-lan\" ether saddr @cg_devices meta nfproto ipv4 udp dport 53 dnat ip to 1.1.1.1
		iifname \"br-lan\" ether saddr @cg_devices meta nfproto ipv6 udp dport 53 dnat ip6 to 2606:4700:4700::1111
		iifname \"br-lan\" ether saddr @cg_devices meta nfproto ipv4 tcp dport 53 dnat ip to 1.1.1.1
		iifname \"br-lan\" ether saddr @cg_devices meta nfproto ipv6 tcp dport 53 dnat ip6 to 2606:4700:4700::1111
	}
}" "ruleset with DNS redirect"
}

test_nft_ruleset_empty() {
	assert_eq "$(cg_nft_ruleset 1.1.1.1 2606:4700:4700::1111 0 "")" "table inet cellglide
delete table inet cellglide
table inet cellglide {
	set cg_devices {
		type ether_addr
	}
	chain cg_mark {
		type filter hook prerouting priority mangle; policy accept;
		iifname \"br-lan\" ether saddr @cg_devices meta mark set meta mark | 0x10000
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
		'1792085847 9a:11:22:33:44:66 10.10.10.227 iPhone 01:9a' \
		'1792076972 0c:11:22:33:44:55 10.10.10.141 * 01:0c' | cg_leases 0c:11:22:33:44:55)
	assert_eq "$list" "9a:11:22:33:44:66  10.10.10.227     iPhone
0c:11:22:33:44:55  10.10.10.141     -  (via iPhone)" "lease table"
}

test_nft_ruleset_all() {
	assert_eq "$(cg_nft_ruleset 1.1.1.1 2606:4700:4700::1111 1 "" all)" "table inet cellglide
delete table inet cellglide
table inet cellglide {
	set cg_devices {
		type ether_addr
	}
	chain cg_mark {
		type filter hook prerouting priority mangle; policy accept;
		iifname \"br-lan\" meta mark set meta mark | 0x10000
	}
	chain cg_dns {
		type nat hook prerouting priority dstnat; policy accept;
		iifname \"br-lan\" meta nfproto ipv4 udp dport 53 dnat ip to 1.1.1.1
		iifname \"br-lan\" meta nfproto ipv6 udp dport 53 dnat ip6 to 2606:4700:4700::1111
		iifname \"br-lan\" meta nfproto ipv4 tcp dport 53 dnat ip to 1.1.1.1
		iifname \"br-lan\" meta nfproto ipv6 tcp dport 53 dnat ip6 to 2606:4700:4700::1111
	}
}" "every LAN device"
}

test_leases_all() {
	list=$(printf '%s\n' \
		'1792085847 9a:11:22:33:44:66 10.10.10.227 iPhone 01:9a' \
		'1792076972 0c:11:22:33:44:55 10.10.10.141 * 01:0c' | cg_leases all)
	assert_eq "$list" "9a:11:22:33:44:66  10.10.10.227     iPhone  (via iPhone)
0c:11:22:33:44:55  10.10.10.141     -  (via iPhone)" "every device marked"
}

test_status_value() {
	assert_eq "$(cg_status_value "Elok's iPhone")" "Eloks iPhone" "single quote dropped"
	assert_eq "$(cg_status_value "$(printf 'a\nb')")" "ab" "newline dropped"
	assert_eq "$(cg_status_value "iPhone 17 Pro")" "iPhone 17 Pro" "plain text kept"
	assert_eq "$(cg_status_value "Elok’s 手机")" "Elok’s 手机" "multibyte text kept whole"
}

test_nft_ruleset_local_dns() {
	assert_eq "$(cg_nft_ruleset 1.1.1.1 2606:4700:4700::1111 local:5354 "" aa:bb:cc:dd:ee:ff)" "table inet cellglide
delete table inet cellglide
table inet cellglide {
	set cg_devices {
		type ether_addr
		elements = { aa:bb:cc:dd:ee:ff }
	}
	chain cg_mark {
		type filter hook prerouting priority mangle; policy accept;
		iifname \"br-lan\" ether saddr @cg_devices meta mark set meta mark | 0x10000
	}
	chain cg_dns {
		type nat hook prerouting priority dstnat; policy accept;
		iifname \"br-lan\" ether saddr @cg_devices udp dport 53 redirect to :5354
		iifname \"br-lan\" ether saddr @cg_devices tcp dport 53 redirect to :5354
	}
}" "DNS answered by the router's forwarder to the iPhone"
}

test_nft_ruleset_guard() {
	assert_eq "$(cg_nft_ruleset 1.1.1.1 2606:4700:4700::1111 0 5354)" "table inet cellglide
delete table inet cellglide
table inet cellglide {
	set cg_devices {
		type ether_addr
	}
	chain cg_mark {
		type filter hook prerouting priority mangle; policy accept;
		iifname \"br-lan\" ether saddr @cg_devices meta mark set meta mark | 0x10000
	}
	chain cg_input {
		type filter hook input priority filter - 1; policy accept;
		meta l4proto { tcp, udp } th dport 5354 ct status dnat accept
		meta l4proto { tcp, udp } th dport 5354 drop
	}
}" "forwarder port only takes redirected DNS"
}

test_normalize_mac
test_hev_config
test_nft_ruleset_with_dns
test_nft_ruleset_empty
test_lan_routes
test_next_state
test_leases
test_nft_ruleset_all
test_leases_all
test_status_value
test_nft_ruleset_local_dns
test_nft_ruleset_guard
