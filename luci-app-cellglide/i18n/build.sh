#!/bin/sh
# Compiles i18n/<lang>/cellglide.po into root/usr/lib/lua/luci/i18n/cellglide.<lang>.lmo with
# LuCI's po2lmo (from an OpenWrt SDK with the luci feed: staging_dir/hostpkg/bin/po2lmo).
#   sh i18n/build.sh /path/to/po2lmo
set -e
cd "$(dirname "$0")/.."
po2lmo=${1:?usage: i18n/build.sh /path/to/po2lmo}
mkdir -p root/usr/lib/lua/luci/i18n
# LuCI names zh_Hans "zh-cn".
"$po2lmo" i18n/zh_Hans/cellglide.po root/usr/lib/lua/luci/i18n/cellglide.zh-cn.lmo
