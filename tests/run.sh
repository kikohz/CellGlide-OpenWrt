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

# shellcheck source=/dev/null
. "$FILES/usr/lib/cellglide/common.sh"
# shellcheck source=/dev/null
[ -f "$FILES/usr/lib/cellglide/net.sh" ] && . "$FILES/usr/lib/cellglide/net.sh"
for test in ./test_*.sh; do
	# shellcheck source=/dev/null
	. "$test"
done
echo "$PASSED passed, $FAILED failed"
[ "$FAILED" = 0 ]
