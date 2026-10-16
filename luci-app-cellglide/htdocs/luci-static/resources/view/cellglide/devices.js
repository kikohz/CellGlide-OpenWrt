'use strict';
'require view';
'require dom';
'require rpc';
'require uci';
'require ui';

var callLeases = rpc.declare({ object: 'luci-rpc', method: 'getDHCPLeases', expect: { '': {} } });

function normalizeMAC(mac) {
	var m = String(mac || '').trim().toLowerCase().replace(/-/g, ':');
	return /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(m) ? m : null;
}

return view.extend({
	load: function() {
		return Promise.all([ uci.load('cellglide'), callLeases() ]);
	},

	render: function(data) {
		var leases = (data[1] && data[1].dhcp_leases) || [];
		var self = this;

		// One entry per MAC: the chosen devices from UCI, then every DHCP lease.
		this.rows = [];
		var byMAC = {};
		uci.sections('cellglide', 'device', function(section) {
			var mac = normalizeMAC(section.mac);
			if (!mac || byMAC[mac])
				return;
			byMAC[mac] = { mac: mac, section: section['.name'], alias: section.name || '', host: '', ip: '', on: true, manual: true };
			self.rows.push(byMAC[mac]);
		});
		leases.forEach(function(lease) {
			var mac = normalizeMAC(lease.macaddr);
			if (!mac)
				return;
			var entry = byMAC[mac];
			if (!entry) {
				entry = byMAC[mac] = { mac: mac, section: null, alias: '', on: false };
				self.rows.push(entry);
			}
			entry.host = lease.hostname || '';
			entry.ip = lease.ipaddr || '';
			entry.manual = false;
		});

		this.allBox = E('input', { 'type': 'checkbox', 'id': 'cellglide-all', 'checked': uci.get('cellglide', 'main', 'all') == '1' ? '' : null,
			'change': function() { self.refreshDisabled(); } });
		this.table = E('table', { 'class': 'table' });
		this.drawTable();

		var macInput = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'placeholder': 'aa:bb:cc:dd:ee:ff' });
		var nameInput = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'placeholder': _('Name (optional)') });
		var addButton = E('button', {
			'class': 'btn cbi-button cbi-button-add',
			'click': function() {
				var mac = normalizeMAC(macInput.value);
				if (!mac) {
					ui.addNotification(null, E('p', [ _('Not a MAC address: %s').format(macInput.value) ]), 'warning');
					return;
				}
				var entry = byMAC[mac];
				if (!entry) {
					entry = byMAC[mac] = { mac: mac, section: null, alias: '', host: '', ip: '', on: false, manual: true };
					self.rows.push(entry);
				}
				entry.on = true;
				if (nameInput.value.trim())
					entry.alias = nameInput.value.trim();
				macInput.value = nameInput.value = '';
				self.drawTable();
			}
		}, _('Add'));

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('CellGlide')),
			E('div', { 'class': 'cbi-section' }, [
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title', 'for': 'cellglide-all' }, _('Every device')),
					E('div', { 'class': 'cbi-value-field' }, [
						this.allBox, ' ', E('label', { 'for': 'cellglide-all' }, _('Send every device on the LAN through the iPhone')),
						E('div', { 'class': 'cbi-value-description' },
							_('When on, the switches below don\'t matter. System updates, cloud sync and TV streaming then all use the iPhone\'s data.'))
					])
				])
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Devices')),
				E('div', { 'class': 'cbi-section-descr' }, _('Recognized by MAC address, so a new IP address doesn\'t matter.')),
				this.table
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Add a device by hand')),
				E('div', { 'class': 'cbi-section-descr' }, _('For devices that aren\'t in the DHCP leases, such as a NAS or printer with a fixed IP address.')),
				E('div', { 'class': 'cbi-value' }, [ macInput, ' ', nameInput, ' ', addButton ])
			])
		]);
	},

	drawTable: function() {
		var self = this;
		var rows = [ E('tr', { 'class': 'tr table-titles' }, [
			E('th', { 'class': 'th' }, _('Name')),
			E('th', { 'class': 'th' }, _('IP address')),
			E('th', { 'class': 'th' }, _('MAC address')),
			E('th', { 'class': 'th center' }, _('Through iPhone'))
		]) ];

		if (!this.rows.length)
			rows.push(E('tr', { 'class': 'tr placeholder' }, [
				E('td', { 'class': 'td', 'colspan': 4 }, E('em', {}, _('No devices yet. They appear here once they get an address from this router.')))
			]));

		this.rows.forEach(function(entry) {
			entry.aliasInput = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'value': entry.alias,
				'placeholder': entry.host || _('Note'), 'style': 'width:12em' });
			entry.box = E('input', { 'type': 'checkbox', 'checked': entry.on ? '' : null,
				'change': function(ev) { entry.on = ev.target.checked; } });
			rows.push(E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [ entry.aliasInput,
					entry.host && entry.alias ? E('div', { 'style': 'opacity:.65;font-size:90%' }, [ entry.host ]) : '',
					entry.manual ? E('div', { 'style': 'opacity:.65;font-size:90%' }, _('Added by hand')) : '' ]),
				E('td', { 'class': 'td' }, [ entry.ip || '—' ]),
				E('td', { 'class': 'td' }, E('code', {}, [ entry.mac ])),
				E('td', { 'class': 'td center' }, entry.box)
			]));
		});

		dom.content(this.table, rows);
		this.refreshDisabled();
	},

	refreshDisabled: function() {
		var all = this.allBox.checked;
		this.rows.forEach(function(entry) {
			if (entry.box)
				entry.box.disabled = all;
		});
	},

	handleSave: function() {
		uci.set('cellglide', 'main', 'all', this.allBox.checked ? '1' : null);
		this.rows.forEach(function(entry) {
			var alias = entry.aliasInput ? entry.aliasInput.value.trim() : entry.alias;
			if (entry.on && !entry.section) {
				entry.section = uci.add('cellglide', 'device');
				uci.set('cellglide', entry.section, 'mac', entry.mac);
			}
			if (entry.on)
				uci.set('cellglide', entry.section, 'name', alias || null);
			else if (entry.section) {
				uci.remove('cellglide', entry.section);
				entry.section = null;
			}
			entry.alias = alias;
		});
		return uci.save();
	},

	handleReset: function() {
		location.reload();
	}
});
