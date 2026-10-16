'use strict';
'require view';
'require form';
'require rpc';
'require ui';

var callStatus = rpc.declare({ object: 'luci.cellglide', method: 'status', expect: {} });
var callPaired = rpc.declare({ object: 'luci.cellglide', method: 'paired', expect: {} });
var callPair = rpc.declare({ object: 'luci.cellglide', method: 'pair', expect: {} });

return view.extend({
	load: function() {
		return Promise.all([ callStatus(), callPaired() ]);
	},

	render: function(data) {
		var status = data[0] || {}, paired = data[1] || {};
		var m, s, o;

		m = new form.Map('cellglide', _('CellGlide'),
			_('Use the iPhone plugged into this router as the internet connection for chosen devices.'));

		s = m.section(form.NamedSection, 'main', 'cellglide', _('Basic settings'));
		s.tab('general', _('General'));
		s.tab('advanced', _('Advanced'));

		o = s.taboption('general', form.Flag, 'enabled', _('Enable'),
			_('When off, every device uses the broadband line. The device list and settings are kept.'));
		o.default = '1';
		o.rmempty = false;

		o = s.taboption('general', form.ListValue, 'fallback', _('When the iPhone is unavailable'),
			_('Back to broadband: the chosen devices use the broadband line until the iPhone is back. Block: they have no internet, so nothing they send leaves over broadband.'));
		o.value('broadband', _('Back to broadband'));
		o.value('block', _('Block (no internet)'));
		o.default = 'broadband';

		o = s.taboption('general', form.Value, 'dns', _('DNS server (IPv4)'),
			_('The chosen devices\' DNS goes here through the iPhone. Only while the iPhone is in use and UDP works.'));
		o.datatype = 'ip4addr';
		o.placeholder = '1.1.1.1';

		o = s.taboption('general', form.Value, 'dns6', _('DNS server (IPv6)'));
		o.datatype = 'ip6addr';
		o.placeholder = '2606:4700:4700::1111';

		o = s.taboption('advanced', form.Value, 'name', _('Name shown on the iPhone'),
			_('Empty uses this router\'s hostname.'));
		o.placeholder = 'OpenWrt';
		o.datatype = 'maxlength(64)';

		o = s.taboption('advanced', form.Value, 'socks_port', _('iPhone proxy port'));
		o.datatype = 'port';
		o.placeholder = '9876';

		o = s.taboption('advanced', form.Value, 'local_port', _('Local proxy port'),
			_('The port on this router that leads to the iPhone\'s proxy.'));
		o.datatype = 'port';
		o.placeholder = '19876';

		s = m.section(form.NamedSection, 'main', 'cellglide', _('Pairing'),
			_('The iPhone has to trust this router once. Plug it in, unlock it, then pair.'));

		o = s.option(form.DummyValue, '_paired', _('iPhone'));
		o.cfgvalue = function() {
			if (!paired.device)
				return _('No iPhone connected');
			if (!paired.paired)
				return _('Not paired');
			return status.name ? _('Paired · %s').format(status.name) : _('Paired');
		};

		o = s.option(form.Button, '_pair', _('Pair'));
		o.inputtitle = _('Pair');
		o.inputstyle = 'apply';
		o.onclick = function() {
			ui.showModal(_('Pairing'), [
				E('p', { 'class': 'spinning' }, _('Tap Trust on the iPhone and enter its passcode.'))
			]);
			return callPair().then(function(result) {
				ui.hideModal();
				if (result.ok)
					ui.addNotification(null, E('p', _('Paired.')), 'info');
				else
					ui.addNotification(null, E('p', _('Pairing didn\'t finish: %s').format(result.output || _('no reply'))), 'warning');
			});
		};

		s = m.section(form.NamedSection, 'main', 'cellglide', _('About'));

		o = s.option(form.DummyValue, '_limits', _('Known limitations'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			return '<ul style="margin:0">' + [
				_('CellGlide on the iPhone has to stay on screen while sharing.'),
				_('Chosen devices can\'t reach LAN devices by .lan names; use IP addresses. .local names still work.'),
				_('Devices going through the iPhone can\'t be reached from the internet (no port forwarding).'),
				_('The router\'s own traffic (updates, DDNS) keeps using broadband.'),
				_('One iPhone at a time.')
			].map(function(text) { return '<li>' + text + '</li>'; }).join('') + '</ul>';
		};

		o = s.option(form.DummyValue, '_version', _('Version'));
		o.cfgvalue = function() { return 'cellglide ' + (status.version || '?'); };

		o = s.option(form.DummyValue, '_docs', _('Documentation'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			return '<a href="https://cellglide.com" target="_blank" rel="noreferrer">cellglide.com</a>';
		};

		return m.render();
	}
});
