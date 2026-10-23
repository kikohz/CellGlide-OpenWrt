# Using CellGlide through an OpenWrt router

English | [简体中文](OpenWrt-Router.zh-CN.md)

## What this is

Chosen devices behind the router go online through an iPhone connected to the router with a USB cable. The `cellglide` package on the router takes care of pairing, forwarding and the routing rules. When the iPhone is unplugged or stops sharing, those devices go back to the broadband line on their own.

Devices you haven't chosen are not affected, and the router's own traffic never goes through the iPhone.

## What you need

- OpenWrt 24.10 or 25.12. 23.05 is not supported: its package feeds don't have `hev-socks5-tunnel`.
- CellGlide 2.3 or later for iOS. With an older app TCP works but UDP doesn't, and DNS is answered by the router itself (over broadband); `cellglide status` says so.
- A USB cable from the iPhone to the router's USB port.
- While in use, CellGlide has to be on screen on the iPhone and sharing.

## Install

Download the packages from [GitHub Releases](https://github.com/kikohz/CellGlide-OpenWrt/releases) (`v0.2.1`): `cellglide` is the service, and `luci-app-cellglide` is the web interface in the router's admin pages (you can install only the first if you don't want the web interface). Copy them to `/tmp` on the router, then install.

OpenWrt 25.12 (`apk`):

```sh
apk update
apk add --allow-untrusted ./cellglide-0.2.1-r1.apk ./luci-app-cellglide-0.2.1-r1.apk
```

OpenWrt 24.10 (`opkg`):

```sh
opkg update
opkg install ./cellglide_0.2.1-r1_all.ipk ./luci-app-cellglide_0.2.1-r1_all.ipk
```

The dependencies come from the official feeds during install: `usbmuxd`, `libusbmuxd-utils`, `libimobiledevice-utils`, `hev-socks5-tunnel`, `kmod-tun`, `ucode`, `ucode-mod-socket`. That's why you run `update` first, and why the router needs to be online.

The packages aren't signed, so `apk` needs `--allow-untrusted`. Each release comes with a `SHA256SUMS` file to check the downloads against.

The web interface follows the language of the router's admin pages: English if they're in English, Chinese if a Chinese LuCI language is installed and chosen. The Chinese translation is built into `luci-app-cellglide`, so there's no separate translation package, and installing doesn't change the admin pages' language setting.

After installing, the service is enabled and started. Check it with `cellglide status`.

## Web interface

With `luci-app-cellglide` installed, the router's admin pages have three pages under Services › CellGlide:

- **Status**: whether the iPhone is connected and in use, whether UDP works, and the exit IP. When the iPhone can't be used, it says why and what to do (not plugged in, not paired, not sharing).
- **Devices**: the devices on the router (from the DHCP leases), each with a "through iPhone" switch and an optional name. You can also send every device through the iPhone at once, or add a device that isn't in the list by hand. Click "Save & Apply" when done. To remove a device you added by hand, clear its name, untick it and save.
- **Settings**: the on/off switch, whether chosen devices go back to broadband or are blocked when the iPhone is unavailable, DNS, the pairing button, and under Advanced the ports and the name shown on the iPhone.

Everything the commands below do can also be done in the web interface.

Like a Mac, the router reports its name to the iPhone, so it shows up under connected devices on CellGlide's home screen (the router's hostname by default).

## Pairing

Plug the iPhone into the router, unlock it, and run:

```sh
cellglide pair
```

When the iPhone asks "Trust This Computer?", tap Trust.

## Choosing devices

First list the devices on the router to find the MAC address of the one that should use the iPhone:

```sh
cellglide list
```

Add the device; the name is optional:

```sh
cellglide add AA:BB:CC:DD:EE:FF "My Mac"
```

To send it back to broadband:

```sh
cellglide remove AA:BB:CC:DD:EE:FF
```

You can also send every device on the LAN through the iPhone:

```sh
cellglide add all
```

To go back to only the devices you added one by one:

```sh
cellglide remove all
```

With every device on the iPhone, the whole household's system updates, cloud sync and TV streaming use the phone's data, and usage climbs fast. The router's own traffic (packages, updates) still uses broadband, and devices on the LAN still reach each other as before.

## Getting started

Open CellGlide on the iPhone and start sharing. Then check on the router:

```sh
cellglide status
```

When everything works it shows `in use`, and UDP shows `works`. On a chosen device, run `curl -4 https://speed.cloudflare.com/cdn-cgi/trace`: `ip=` should be the iPhone's exit address.

## DNS

While the iPhone is in use, the chosen devices' DNS is answered by CellGlide on the iPhone and follows the app's DNS settings (encrypted DNS, caching, falling back to the carrier's DNS when encrypted DNS can't be reached), just as on a Mac. This path runs over TCP, so it works with older versions of the app too.

When CellGlide DNS is turned off in the app, a fallback DNS server (1.1.1.1 by default) is used through the iPhone instead. If the app doesn't support UDP yet, DNS is left to the router. `cellglide status` and the Status page show which one is in use.

## When the iPhone is unavailable

Unplug the iPhone, or stop sharing in the app, and about 10 seconds later the chosen devices are back on broadband. Plug it back in and start sharing, and within 10 seconds they use the iPhone again.

If you'd rather have no internet than use broadband, switch to `block`:

```sh
uci set cellglide.main.fallback=block
uci commit cellglide
/etc/init.d/cellglide reload
```

To go back, replace `block` with `broadband`.

## Configuration

The configuration file is `/etc/config/cellglide`. Run `/etc/init.d/cellglide reload` after changing it.

| Option | Default | Meaning |
| --- | --- | --- |
| `enabled` | `1` | With `0` the service does nothing |
| `socks_port` | `9876` | CellGlide's SOCKS5 port on the iPhone |
| `local_port` | `19876` | The port on the router it's forwarded to |
| `fallback` | `broadband` | What happens when the iPhone is unavailable: `broadband` goes back to broadband, `block` cuts the chosen devices off |
| `dns` | `1.1.1.1` | Fallback DNS: when CellGlide DNS is off on the iPhone, the chosen devices' IPv4 DNS goes here through the iPhone (needs UDP, so app 2.3 or later) |
| `dns6` | `2606:4700:4700::1111` | The same for IPv6 |
| `dns_port` | `5354` | The port where the router takes the chosen devices' DNS before handing it to the iPhone |
| `local_watch_port` | `19088` | The local port forwarded to the iPhone's port 8088 (used for DNS and for reporting the router's name) |
| `name` | unset | The name shown on the iPhone; the router's hostname when unset |
| `all` | unset | With `1` every device on the LAN uses the iPhone, the same as `cellglide add all` |

Each chosen device is a `device` section with `mac` and `name`. You normally add them with `cellglide add` rather than by hand. Names given in the web interface to devices that aren't chosen are kept in `alias` sections (also `mac` and `name`); they're only for display and don't affect which devices use the iPhone.

## Known limitations

- Locking the iPhone or sending the app to the background stops sharing; about 10 seconds later the devices are back on broadband.
- Chosen devices can't resolve `xxx.lan` names. IP addresses still work, and so do `.local` names.
- Nothing can reach the devices from the internet: no port forwarding, no DDNS.
- The router's own traffic doesn't use the iPhone.
- One iPhone at a time.
- If you also run other proxy packages (sing-box, OpenClash and so on), exclude these devices from them.

## Troubleshooting

**`not in use (the tunnel did not start …)`**: the iPhone is reachable and sharing, but `hev-socks5-tunnel` on the router couldn't create the `cgtun` interface. Since this version the message ends with what hev said:

- `socks5 tunnel ipv6`: IPv6 is turned off on the router. Versions up to 0.2.0 always gave the tunnel an IPv6 address, which fails then; update the package. 0.2.1 and later leave IPv6 out when it's off.
- `socks5 tunnel open (…)`: the TUN device can't be opened. Check that `kmod-tun` is installed and loaded (`lsmod | grep tun`, `ls -l /dev/net/tun`); a reboot after installing it helps on some builds.

When reporting a problem, include the output of:

```sh
cellglide status
logread -e cellglide -e hev | tail -n 30
cat /etc/openwrt_release
apk info -v 2>/dev/null | grep -E "cellglide|hev|kmod-tun" || opkg list-installed | grep -E "cellglide|hev|kmod-tun"
cat /proc/sys/net/ipv6/conf/all/disable_ipv6 /proc/sys/net/ipv6/conf/default/disable_ipv6
```

## Uninstall

```sh
apk del luci-app-cellglide cellglide
```

On 24.10:

```sh
opkg remove luci-app-cellglide cellglide
```

Uninstalling removes every rule. `/etc/config/cellglide` is a configuration file and may be kept, which is normal. The dependencies are not removed.

---

## Appendix: manual setup (without the package)

This is how to set it up entirely by hand, without the package, kept for reference. Don't use the manual setup and the package at the same time.

One (or a few) devices behind the router go online through an iPhone connected with a USB cable. The router runs `hev-socks5-tunnel`, which turns the device's traffic into SOCKS5 and sends it over USB to CellGlide on the iPhone.

- Works on: OpenWrt 24.10 and later (23.05's feeds don't have `hev-socks5-tunnel`). 24.10 uses `opkg`, 25.12 uses `apk`. Tested on a Linksys MX4300 with OpenWrt 25.12.5.
- Measured: TCP works, about 150 Mbps on the test Mac.
- UDP (DNS, QUIC, games, voice and so on) needs CellGlide 2.3 or later for iOS, with `udp: 'tcp'` in the hev configuration. With an older app TCP works as usual but UDP doesn't.

### Install

OpenWrt 25.12 (`apk`):

```sh
apk update
apk add usbmuxd libimobiledevice-utils libusbmuxd-utils hev-socks5-tunnel curl
```

OpenWrt 24.10 (`opkg`):

```sh
opkg update
opkg install usbmuxd libimobiledevice-utils libusbmuxd-utils hev-socks5-tunnel curl
```

`curl` is only for testing and can be left out. The `hev-socks5-tunnel` package comes with a boot service that's off by default. This guide runs hev by hand and doesn't use that service; leave its settings alone.

### Pairing

Connect the iPhone to the router with a USB cable, unlock it, and run:

```sh
idevicepair pair
```

When the iPhone asks "Trust This Computer?", tap Trust.

### Forwarding the iPhone's proxy port

CellGlide's SOCKS5 port on the iPhone is 9876. `iproxy` forwards it to port 19876 on the router:

```sh
iproxy -l 19876:9876 &
```

### The hev configuration

Save as `/etc/cellglide-hev.yml`:

```yaml
tunnel:
  name: cgtun
  mtu: 1500
  ipv4: 198.18.0.1
socks5:
  port: 19876
  address: 127.0.0.1
  udp: 'tcp'
misc:
  log-level: warn
  log-file: /tmp/cellglide-hev.log
  tcp-read-write-timeout: 1800000
  udp-read-write-timeout: 30000
```

Start it and bring the interface up:

```sh
hev-socks5-tunnel /etc/cellglide-hev.yml &
sleep 1
ip link set cgtun up
```

### Sending only one device through the iPhone

Run `ip rule` first to see the existing rules. If you use mwan3 or pbr, they use policy routing too; pick a table number and priority that aren't taken instead of 200 and 100 below (and use the same numbers when undoing).

Replace `<device IP>` with the LAN address of the device that should use the iPhone, and `<LAN prefix>` with your LAN (for example `192.168.1.0/24`). The LAN route is required: without it the device can't reach the router or other devices on the LAN.

```sh
ip route add default dev cgtun table 200
ip route add <LAN prefix> dev br-lan table 200
ip rule add from <device IP> iif br-lan lookup 200 priority 100
nft insert rule inet fw4 forward iifname "br-lan" oifname "cgtun" accept comment "cellglide"
```

Other devices are not affected and keep using their usual connection.

### A note on DNS

The device sends its DNS queries to dnsmasq on the router. That's traffic to the router itself, so it never enters table 200, and DNS goes out over broadband rather than the iPhone. As a result, when broadband is down the device can't resolve names even though the iPhone is connected.

To send DNS through the iPhone as well, set the device's DNS by hand to a public resolver (for example 1.1.1.1). DNS then goes through the tunnel to the iPhone; its UDP part needs app 2.3 or later. Having the app resolve DNS on the iPhone was left for later (the package does this).

### Checking

Requests the router makes itself use the main routing table (broadband), so `curl` on the router shows your broadband address and proves nothing.

The most direct check is to run this on the device:

```sh
curl -4 https://speed.cloudflare.com/cdn-cgi/trace
```

`ip=` in the output should be the iPhone's exit address, not your broadband address.

To test from the router, you have to name the interface:

```sh
curl --interface cgtun -4 https://speed.cloudflare.com/cdn-cgi/trace
```

To test UDP (needs app 2.3 or later): set the device's DNS to 1.1.1.1 by hand (see the previous section), then open any website or run `nslookup example.com 1.1.1.1`. The router doesn't have `dig` by default; install `bind-dig` if you want it. Again, test on the device: `nslookup` on the router goes over broadband.

If something goes wrong, look at `/tmp/cellglide-hev.log`.

### Undoing it

Remove what you added, in reverse order:

```sh
nft -a list chain inet fw4 forward
```

Find the line with `comment "cellglide"`, note the `# handle N` at its end, then:

```sh
nft delete rule inet fw4 forward handle N
ip rule del from <device IP> iif br-lan lookup 200 priority 100
ip route del <LAN prefix> dev br-lan table 200
ip route del default dev cgtun table 200
killall hev-socks5-tunnel iproxy
```

### Limitations

- CellGlide has to stay on screen on the iPhone, and the iPhone should be on power.
- Nothing can reach the device from the internet: no port forwarding, no DDNS.
- IPv6 doesn't go through the iPhone yet.
- Reloading the firewall (for example saving firewall settings in LuCI) removes the nft rule but not the `ip rule`, so the device has no internet until you add the nft rule again or delete the `ip rule`. The router itself stays reachable.
- IPv6: the device's IPv6 still uses broadband, which `curl -4` doesn't show.
- None of this survives a reboot; run it again after restarting. (Starting it at boot is what the package does.)
