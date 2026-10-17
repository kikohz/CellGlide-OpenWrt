# CellGlide for OpenWrt

[English](README.md) | 简体中文

让 OpenWrt 路由器后面选定的设备，经 USB 连着的 iPhone（上面运行 [CellGlide](https://cellglide.com)）上网；手机拔掉或停止共享时自动回到宽带。

- 支持 OpenWrt 24.10（`.ipk`）和 25.12（`.apk`），纯脚本，所有架构通用。
- UDP（DNS、QUIC、通话、游戏）需要 iPhone 上的 CellGlide 2.3 或更新版本。
- 路由器后台的网页界面在“服务 › CellGlide”，有中文和英文。
- 下载：[GitHub Releases](https://github.com/kikohz/CellGlide-OpenWrt/releases)。安装和使用说明：[docs/OpenWrt-Router.zh-CN.md](docs/OpenWrt-Router.zh-CN.md)。

## 目录

| 路径 | 内容 |
|---|---|
| `cellglide/` | 后台服务包：守护进程、iPhone 探测、DNS 转发、向手机报名字、命令行 `cellglide` |
| `luci-app-cellglide/` | 路由器后台的网页界面（服务 › CellGlide），中文翻译已打包在内 |
| `tests/` | shell 测试（`run.sh`）和 nft 规则语法检查（`nft-check.sh`） |
| `docs/` | 中英文使用说明；`docs/design/` 里是设计文档、网页界面功能清单和实施计划（中文） |

## 开发

```sh
# 测试，用 busybox 跑和路由器上一样的 shell
busybox sh tests/run.sh
# 生成的 nft 规则能否被解析（需要 nft 和 root，只检查不改动）
sudo sh tests/nft-check.sh
```

打包用 OpenWrt 官方 SDK，把这个仓库当作一个 feed：

```sh
echo "src-link cellglide /path/to/CellGlide-OpenWrt" > feeds.conf
grep -E "^src-git (packages|luci) " feeds.conf.default >> feeds.conf
./scripts/feeds update -a && ./scripts/feeds install cellglide luci-app-cellglide
make defconfig && make package/cellglide/compile package/luci-app-cellglide/compile
```

改了中文翻译（`luci-app-cellglide/i18n/zh_Hans/cellglide.po`）后，用 SDK 里的 po2lmo 重新生成打包用的文件：

```sh
sh luci-app-cellglide/i18n/build.sh /path/to/sdk/staging_dir/hostpkg/bin/po2lmo
```

CI（`.github/workflows/build.yml`）会跑 shellcheck、测试和语法检查，并用 SDK 打出两种包；推送 `v*` 标签时把包附到 GitHub Releases。

## 历史

这个项目原来在 CellGlide App 的仓库里，2026-10-16 连同提交历史一起搬到这里。iPhone 端支持路由器所需的“UDP 走 TCP”在 CellGlide App 里。

## 许可证

[GPL-2.0-only](LICENSE)，和 OpenWrt 一致。
