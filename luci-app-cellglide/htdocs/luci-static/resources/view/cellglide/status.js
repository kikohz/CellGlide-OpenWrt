'use strict';
'require view';
'require dom';
'require poll';
'require rpc';

var callStatus = rpc.declare({ object: 'luci.cellglide', method: 'status', expect: {} });
var callStart = rpc.declare({ object: 'luci.cellglide', method: 'start', expect: {} });

function clock(epoch) {
	var d = new Date(epoch * 1000);
	return '%02d:%02d'.format(d.getHours(), d.getMinutes());
}

function link(path, text) {
	return E('a', { 'href': L.url('admin/services/cellglide', path) }, text + ' ›');
}

function devicesText(s) {
	if (s.all)
		return _('Every device on the LAN');
	return N_(s.devices, '%d chosen device', '%d chosen devices').format(s.devices);
}

// What the user should see first: in use, or why not and what to do about it.
function banner(s) {
	var fallback = s.fallback == 'block'
		? _('Meanwhile the chosen devices have no internet (block mode).')
		: _('Meanwhile the chosen devices use the broadband line.');
	var kind, title, text, action = null;

	if (!s.running) {
		kind = 'warning';
		title = s.enabled ? _('CellGlide is not running') : _('CellGlide is turned off');
		text = s.enabled ? _('Start the service to use the iPhone.') : _('Turn it on in Settings to use the iPhone.');
		if (s.enabled)
			action = E('button', {
				'class': 'btn cbi-button cbi-button-apply',
				'click': function(ev) {
					ev.target.disabled = true;
					return callStart().then(function() { location.reload(); });
				}
			}, _('Start'));
		else
			action = link('settings', _('Settings'));
	}
	else if (s.state == 'up') {
		kind = 'success';
		title = _('Using the iPhone\'s connection');
		text = s.all
			? _('Every device on the LAN goes online through the iPhone, since %s.').format(clock(s.since))
			: N_(s.devices, '%d chosen device goes online through the iPhone, since %s.',
				'%d chosen devices go online through the iPhone, since %s.').format(s.devices, clock(s.since));
	}
	else {
		kind = 'warning';
		switch (s.reason) {
		case 'no-iphone':
			title = _('No iPhone connected');
			text = _('Plug the iPhone into the router\'s USB port, open CellGlide and tap Start sharing.');
			break;
		case 'not-paired':
			title = _('The iPhone isn\'t paired with this router');
			text = _('Pair it in Settings, then tap Trust on the iPhone.');
			action = link('settings', _('Pair'));
			break;
		case 'not-sharing':
			title = _('CellGlide isn\'t sharing');
			text = _('Open CellGlide on the iPhone and tap Start sharing. Keep it on screen while in use.');
			break;
		case 'tunnel':
			title = _('The connection to the iPhone didn\'t start');
			text = _('It retries every few seconds. If this stays, check the system log for cellglide.');
			break;
		default:
			title = _('Waiting for the iPhone');
			text = _('Checking every 5 seconds.');
		}
		text += ' ' + fallback;
	}

	return E('div', { 'class': 'alert-message ' + kind }, [
		E('h4', {}, [ title ]),
		E('p', {}, [ text ]),
		action ? E('p', {}, action) : ''
	]);
}

function row(label, value, extra) {
	return E('tr', { 'class': 'tr' }, [
		E('td', { 'class': 'td left', 'width': '30%' }, [ label ]),
		E('td', { 'class': 'td left' }, Array.isArray(value) ? value : [ value ]),
		E('td', { 'class': 'td right' }, extra || '')
	]);
}

// Every outside string goes in an array: E() and dom.append set a lone string child as
// innerHTML, and an iPhone's name or a hostname is chosen by whoever owns the device.
function small(text) {
	return E('div', { 'style': 'opacity:.65;font-size:90%' }, [ text ]);
}

function table(s) {
	var phone = s.device
		? [ E('strong', {}, [ s.name || _('iPhone') ]), small('UDID ' + s.device) ]
		: _('Not connected');
	var sharing = s.state == 'up' ? _('In use since %s').format(clock(s.since)) : _('Not in use');
	var udp;
	switch (s.udp) {
	case 'yes': udp = _('Works'); break;
	case 'no': udp = [ _('Needs CellGlide 2.3 or later on the iPhone'), small(_('Websites work; calls, games and other UDP apps don\'t yet.')) ]; break;
	default: udp = s.state == 'up' ? _('Unknown') : '—';
	}
	var rows = [
		row(_('iPhone'), phone),
		row(_('Sharing'), sharing),
		row(_('UDP'), udp)
	];
	if (s.state == 'up') {
		var dns;
		switch (s.dns) {
		case 'phone': dns = _('Follows the DNS settings in CellGlide on the iPhone'); break;
		case 'public': dns = [ E('span', {}, [ _('%s through the iPhone').format(s.dns4) ]), small(_('CellGlide DNS is off on the iPhone.')) ]; break;
		default: dns = _('Answered by the router (over broadband)');
		}
		rows.push(row(_('DNS'), dns));
	}
	if (s.state == 'up' && s.exit)
		rows.push(row(_('Exit IP'), [ E('span', {}, [ s.exit ]), small(_('The address websites see from the chosen devices')) ]));
	rows.push(row(_('Devices'), devicesText(s), link('devices', _('Manage devices'))));
	rows.push(row(_('When the iPhone is unavailable'),
		s.fallback == 'block' ? _('Block (no internet)') : _('Back to broadband'), link('settings', _('Change'))));
	return E('table', { 'class': 'table' }, rows);
}

return view.extend({
	load: function() {
		return callStatus();
	},

	render: function(status) {
		var body = E('div', {}, [ banner(status), table(status) ]);

		poll.add(function() {
			return callStatus().then(function(s) {
				dom.content(body, [ banner(s), table(s) ]);
			});
		}, 5);

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('CellGlide')),
			E('div', { 'class': 'cbi-map-descr' }, _('Use the iPhone plugged into this router as the internet connection for chosen devices.')),
			E('div', { 'class': 'cbi-section' }, body),
			E('div', { 'class': 'cbi-section-descr' }, _('Refreshed every 5 seconds.'))
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
