include $(TOPDIR)/rules.mk

PKG_NAME:=cellglide
PKG_VERSION:=0.2.0
PKG_RELEASE:=2

PKG_MAINTAINER:=kikohz <kikohz@gmail.com>
PKG_LICENSE:=GPL-2.0-only

include $(INCLUDE_DIR)/package.mk

define Package/cellglide
  SECTION:=net
  CATEGORY:=Network
  TITLE:=Route chosen LAN devices through an iPhone running CellGlide
  URL:=https://cellglide.com
  DEPENDS:=+usbmuxd +libusbmuxd-utils +libimobiledevice-utils +hev-socks5-tunnel +kmod-tun +ucode +ucode-mod-socket +ucode-mod-fs +ucode-mod-uci
  PKGARCH:=all
endef

define Package/cellglide/description
  Sends the traffic of chosen LAN devices (by MAC address) through an iPhone
  plugged into the router's USB port and sharing with the CellGlide app.
  When the iPhone is unplugged or stops sharing, those devices go back to the
  broadband line.
endef

define Package/cellglide/conffiles
/etc/config/cellglide
endef

define Build/Compile
endef

define Package/cellglide/install
	$(INSTALL_DIR) $(1)/etc/config $(1)/etc/init.d $(1)/usr/sbin
	$(INSTALL_DIR) $(1)/usr/lib/cellglide $(1)/usr/libexec/cellglide
	$(INSTALL_DIR) $(1)/usr/share/nftables.d/chain-pre/forward
	$(INSTALL_CONF) ./files/etc/config/cellglide $(1)/etc/config/cellglide
	$(INSTALL_BIN) ./files/etc/init.d/cellglide $(1)/etc/init.d/cellglide
	$(INSTALL_BIN) ./files/usr/sbin/cellglide $(1)/usr/sbin/cellglide
	$(INSTALL_DATA) ./files/usr/lib/cellglide/common.sh $(1)/usr/lib/cellglide/common.sh
	$(INSTALL_DATA) ./files/usr/lib/cellglide/net.sh $(1)/usr/lib/cellglide/net.sh
	echo "$(PKG_VERSION)-r$(PKG_RELEASE)" > $(1)/usr/lib/cellglide/version
	$(INSTALL_BIN) ./files/usr/libexec/cellglide/daemon $(1)/usr/libexec/cellglide/daemon
	$(INSTALL_BIN) ./files/usr/libexec/cellglide/probe $(1)/usr/libexec/cellglide/probe
	$(INSTALL_BIN) ./files/usr/libexec/cellglide/report $(1)/usr/libexec/cellglide/report
	$(INSTALL_BIN) ./files/usr/libexec/cellglide/dns $(1)/usr/libexec/cellglide/dns
	$(INSTALL_DATA) ./files/usr/share/nftables.d/chain-pre/forward/cellglide.nft $(1)/usr/share/nftables.d/chain-pre/forward/cellglide.nft
endef

# The firewall include only takes effect after fw4 reloads.
define Package/cellglide/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || fw4 -q reload
exit 0
endef

define Package/cellglide/prerm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || /etc/init.d/cellglide stop
exit 0
endef

define Package/cellglide/postrm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || fw4 -q reload
exit 0
endef

$(eval $(call BuildPackage,cellglide))
