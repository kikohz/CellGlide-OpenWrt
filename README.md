# CellGlide for OpenWrt

English | [简体中文](README.zh-CN.md)

Lets chosen devices behind an OpenWrt router go online through an iPhone plugged into the router's USB port and running [CellGlide](https://cellglide.com). When the iPhone is unplugged or stops sharing, those devices go back to the broadband line on their own.

- OpenWrt 24.10 (`.ipk`) and 25.12 (`.apk`). Plain scripts, so one package fits every architecture.
- UDP (DNS, QUIC, calls, games) needs CellGlide 2.3 or later on the iPhone.
- A web interface under Services › CellGlide, in English and Chinese.
- Download: [GitHub Releases](https://github.com/kikohz/CellGlide-OpenWrt/releases). Install and use: [docs/OpenWrt-Router.md](docs/OpenWrt-Router.md).

## Layout

| Path | What's there |
|---|---|
| `cellglide/` | The service package: daemon, iPhone probe, DNS forwarder, reporting the router to the iPhone, and the `cellglide` command |
| `luci-app-cellglide/` | The web interface (Services › CellGlide), with its Chinese translation built in |
| `tests/` | Shell tests (`run.sh`) and an nft ruleset syntax check (`nft-check.sh`) |
| `docs/` | The user guide in English and Chinese; `docs/design/` holds the design notes and implementation plan (Chinese) |

## Development

```sh
# Tests, run with busybox: the same shell as on the router
busybox sh tests/run.sh
# Do the generated nft rulesets parse? (needs nft and root; checks only, changes nothing)
sudo sh tests/nft-check.sh
```

Packages are built with the official OpenWrt SDK, using this repository as a feed:

```sh
echo "src-link cellglide /path/to/CellGlide-OpenWrt" > feeds.conf
grep -E "^src-git (packages|luci) " feeds.conf.default >> feeds.conf
./scripts/feeds update -a && ./scripts/feeds install cellglide luci-app-cellglide
make defconfig && make package/cellglide/compile package/luci-app-cellglide/compile
```

After changing the Chinese translation (`luci-app-cellglide/i18n/zh_Hans/cellglide.po`), rebuild the compiled file that ships in the package with the SDK's po2lmo:

```sh
sh luci-app-cellglide/i18n/build.sh /path/to/sdk/staging_dir/hostpkg/bin/po2lmo
```

CI (`.github/workflows/build.yml`) runs shellcheck, the tests and syntax checks, then builds both package formats with the SDK. Pushing a `v*` tag attaches the packages to a GitHub Release.

## History

This project started inside the CellGlide app's repository and moved here, history included, on 2026-10-16. The iPhone side the router relies on (UDP carried over TCP) lives in the CellGlide app.

## License

[GPL-2.0-only](LICENSE), the same as OpenWrt.
