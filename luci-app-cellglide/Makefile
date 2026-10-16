include $(TOPDIR)/rules.mk

LUCI_TITLE:=Web interface for CellGlide (an iPhone as the internet connection)
# luci-base is left out on purpose: every router that can open this page has it, and
# listing it makes the SDK try to build the whole LuCI runtime.
LUCI_DEPENDS:=+cellglide
LUCI_PKGARCH:=all

PKG_VERSION:=0.2.0
PKG_RELEASE:=1

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
