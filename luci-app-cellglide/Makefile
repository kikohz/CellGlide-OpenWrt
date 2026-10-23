include $(TOPDIR)/rules.mk

LUCI_TITLE:=Web interface for CellGlide (an iPhone as the internet connection)
# luci-base is left out on purpose: every router that can open this page has it, and
# listing it makes the SDK try to build the whole LuCI runtime.
LUCI_DEPENDS:=+cellglide
LUCI_PKGARCH:=all

PKG_VERSION:=0.2.1
PKG_RELEASE:=1

PKG_MAINTAINER:=kikohz <kikohz@gmail.com>
PKG_LICENSE:=GPL-2.0-only

include $(TOPDIR)/feeds/luci/luci.mk

# Translations ship inside this package (root/usr/lib/lua/luci/i18n/*.lmo, compiled from
# i18n/ by i18n/build.sh), not as luci-i18n-* packages: the pages follow the router's LuCI
# language, and installing never adds a language to the router. They live in i18n/, not
# po/, so luci.mk doesn't split them out.

# call BuildPackage - OpenWrt buildroot signature
