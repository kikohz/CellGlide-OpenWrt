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
# Re-setup flushes table 1986, which also removes a live cgtun default route, so callers
# must call cg_tunnel_up afterwards. Per family the table is flushed and given its
# unreachable route before the fwmark rule is (re)added, so marked packets never fall
# through to the main table during the change. Returns 1 if any command failed.
cg_setup() {
	local fallback="$1" lan4="$2" lan6="$3" family prefix rc=0
	for family in 4 6; do
		cg_quiet ip -"$family" route flush table "$CG_TABLE"
		if [ "$fallback" = block ]; then
			cg_run ip -"$family" route add unreachable default metric 4000000000 table "$CG_TABLE" || rc=1
		fi
		cg_quiet ip -"$family" rule del priority "$CG_TABLE"
		cg_run ip -"$family" rule add fwmark "$CG_MARK/$CG_MARK" lookup "$CG_TABLE" priority "$CG_TABLE" || rc=1
	done
	for prefix in $lan4; do
		cg_run ip -4 route add "$prefix" dev "$CG_LAN" table "$CG_TABLE" || rc=1
	done
	for prefix in $lan6; do
		cg_run ip -6 route add "$prefix" dev "$CG_LAN" table "$CG_TABLE" || rc=1
	done
	return $rc
}

# Returns 1 if either route replace failed.
cg_tunnel_up() {
	local family rc=0
	for family in 4 6; do
		cg_run ip -"$family" route replace default dev "$CG_TUN" table "$CG_TABLE" || rc=1
	done
	return $rc
}

cg_tunnel_down() {
	local family
	for family in 4 6; do
		cg_quiet ip -"$family" route del default dev "$CG_TUN" table "$CG_TABLE"
	done
}

cg_teardown() {
	local family
	for family in 4 6; do
		cg_quiet ip -"$family" rule del priority "$CG_TABLE"
		cg_quiet ip -"$family" route flush table "$CG_TABLE"
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
