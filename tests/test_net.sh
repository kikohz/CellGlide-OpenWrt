# shellcheck shell=sh
# test_* functions are called by run.sh, not from here
# shellcheck disable=SC2317,SC2329
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
fe80::/64')" "ip -4 route flush table 1986
ip -4 rule del priority 1986
ip -4 rule add fwmark 0x10000/0x10000 lookup 1986 priority 1986
ip -6 route flush table 1986
ip -6 rule del priority 1986
ip -6 rule add fwmark 0x10000/0x10000 lookup 1986 priority 1986
ip -4 route add 10.10.10.0/24 dev br-lan table 1986
ip -6 route add fd1e::/64 dev br-lan table 1986
ip -6 route add fe80::/64 dev br-lan table 1986" "setup, back to broadband"
}

test_setup_block() {
	assert_eq "$(recorded cg_setup block '10.10.10.0/24' '')" "ip -4 route flush table 1986
ip -4 route add unreachable default metric 4000000000 table 1986
ip -4 rule del priority 1986
ip -4 rule add fwmark 0x10000/0x10000 lookup 1986 priority 1986
ip -6 route flush table 1986
ip -6 route add unreachable default metric 4000000000 table 1986
ip -6 rule del priority 1986
ip -6 rule add fwmark 0x10000/0x10000 lookup 1986 priority 1986
ip -4 route add 10.10.10.0/24 dev br-lan table 1986" "setup, blocked without the iPhone"
}

# A failing ip must surface as a non-zero status, while cg_quiet hides the failure.
test_failures_surface() {
	CG_DRYRUN=""
	ip() { return 1; }
	cg_setup broadband '' ''
	assert_eq "$?" 1 "setup reports a failed ip"
	cg_tunnel_up
	assert_eq "$?" 1 "tunnel up reports a failed ip"
	cg_quiet ip x
	assert_eq "$?" 0 "quiet ignores a failed ip"
	unset -f ip
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
test_failures_surface
