#!/bin/sh
# Checks that the generated nft rulesets parse, which the string tests in run.sh can't.
# Needs nft and root (nft -c talks to the kernel but changes nothing):
#   sudo sh tests/nft-check.sh
cd "$(dirname "$0")" || exit 1
# shellcheck source=/dev/null
. ../cellglide/files/usr/lib/cellglide/common.sh
status=0
check() {
	if cg_nft_ruleset "$@" | nft -c -f -; then
		echo "ok: $*"
	else
		echo "FAIL: $*"
		status=1
	fi
}
check 1.1.1.1 2606:4700:4700::1111 0 ""
check 1.1.1.1 2606:4700:4700::1111 1 "" aa:bb:cc:dd:ee:ff
check 9.9.9.9 2620:fe::fe 1 "" aa:bb:cc:dd:ee:ff 0c:11:22:33:44:55
check 1.1.1.1 2606:4700:4700::1111 1 "" all
check 1.1.1.1 2606:4700:4700::1111 0 "" all
check 1.1.1.1 2606:4700:4700::1111 local:5354 "" aa:bb:cc:dd:ee:ff
check 1.1.1.1 2606:4700:4700::1111 local:5354 "" all
check 1.1.1.1 2606:4700:4700::1111 local:5354 5354 aa:bb:cc:dd:ee:ff
check 1.1.1.1 2606:4700:4700::1111 0 5354 all
exit "$status"
