'use strict';
'require view';
'require dom';
'require rpc';
'require cellglide.places as places';

// Where the chosen devices' traffic goes through the iPhone, on the Mac's globe. The router
// counts bytes per address (rpcd's map) and keeps the location database; this page looks
// the addresses up, groups them by region and works out what is moving now. Nothing is sent
// anywhere. It asks the router only while it can be seen.

var callMap = rpc.declare({ object: 'luci.cellglide', method: 'map', expect: {} });
var callGeoip = rpc.declare({ object: 'luci.cellglide', method: 'map_geoip', params: [ 'force' ], expect: {} });

// As on the Mac.
var REFRESH = 2000;

// "420 MB", "1.2 GB": one decimal only below 10, as the apps write it.
function size(bytes) {
	var units = [ 'B', 'KB', 'MB', 'GB', 'TB' ], value = bytes, unit = 0;
	while (value >= 1000 && unit < units.length - 1) { value /= 1000; unit++; }
	return (value < 10 && unit > 0 ? value.toFixed(1) : value.toFixed(0)) + ' ' + units[unit];
}

function clock(epoch) {
	var d = new Date(epoch * 1000);
	return '%02d:%02d'.format(d.getHours(), d.getMinutes());
}

var STYLE = [
	'.cg-map { display: flex; flex-wrap: wrap; gap: 1.5em; align-items: flex-start; }',
	'.cg-globe { flex: 1 1 320px; max-width: 520px; aspect-ratio: 1; background: #09090b; border-radius: 12px; overflow: hidden; }',
	'.cg-globe iframe { width: 100%; height: 100%; border: 0; display: block; background: transparent; }',
	'.cg-side { flex: 1 1 320px; min-width: 0; }',
	'.cg-side .table .td { vertical-align: top; }',
	'.cg-row { cursor: pointer; }',
	'.cg-idle { opacity: .55; }',
	'.cg-note { font-size: 90%; opacity: .75; }',
	'.cg-rate { white-space: nowrap; font-variant-numeric: tabular-nums; }'
].join('\n');

return view.extend({
	load: function() {
		return Promise.all([ callMap(), callGeoip(false).catch(function() { return {}; }) ]);
	},

	render: function(data) {
		this.places = null;
		this.database = null;
		this.loadingFile = null;
		this.since = null;
		this.sent = null;

		this.frame = E('iframe', {
			'src': L.resource('cellglide/globe.html') + '?v=' + encodeURIComponent(data[0].version || ''),
			'title': _('Traffic map'),
			'loading': 'lazy'
		});
		this.frame.addEventListener('load', L.bind(function() {
			this.sent = null;
			this.draw();
		}, this));
		this.message = E('div');
		this.exit = E('p');
		this.rows = E('table', { 'class': 'table' });

		var page = E('div', { 'class': 'cbi-map' }, [
			E('style', {}, [ STYLE ]),
			E('h2', {}, _('CellGlide')),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Traffic map')),
				E('div', { 'class': 'cbi-section-descr' },
					_('Where the chosen devices\' traffic goes through the iPhone, by region. The addresses are located in this browser; nothing is sent anywhere.')),
				E('div', { 'class': 'cg-map' }, [
					E('div', { 'class': 'cg-globe' }, [ this.frame ]),
					E('div', { 'class': 'cg-side' }, [ this.exit, this.message, this.rows ])
				])
			])
		]);

		// The globe draws only while it's on screen; the page asks the router only while it's shown.
		if (window.IntersectionObserver)
			new IntersectionObserver(L.bind(function(entries) {
				this.onScreen = entries[entries.length - 1].isIntersecting;
				this.pause();
			}, this)).observe(this.frame);
		this.onScreen = true;
		document.addEventListener('visibilitychange', L.bind(function() {
			this.pause();
			if (!document.hidden)
				this.refresh();
		}, this));

		this.update(data[0]);
		this.schedule();
		return page;
	},

	pause: function() {
		var globe = this.frame.contentWindow;
		if (globe && globe.setPaused)
			globe.setPaused(document.hidden || !this.onScreen);
	},

	schedule: function() {
		window.clearTimeout(this.timer);
		this.timer = window.setTimeout(L.bind(this.refresh, this), REFRESH);
	},

	refresh: function() {
		window.clearTimeout(this.timer);
		// A hidden tab asks nothing; showing it again refreshes at once.
		if (document.hidden || this.asking)
			return;
		this.asking = true;
		return callMap().then(L.bind(this.update, this)).catch(function() {}).then(L.bind(function() {
			this.asking = false;
			this.schedule();
		}, this));
	},

	// The location database, once per page: fetched from the router (the browser keeps it
	// cached, its name changes each month) and unpacked here.
	loadDatabase: function(file) {
		this.loadingFile = file;
		this.failure = null;
		return window.fetch(L.resource('cellglide/geoip/' + file)).then(function(response) {
			if (!response.ok)
				throw new Error('missing');
			return response.arrayBuffer();
		}).then(places.inflate).then(L.bind(function(buffer) {
			this.database = new places.Database(buffer);
			this.places = new places.Places(this.database);
			this.refresh();
		}, this)).catch(L.bind(function(e) {
			this.loadingFile = null;
			this.failure = e.message == 'unsupported' ? 'browser' : 'file';
			this.show(this.reply);
		}, this));
	},

	update: function(reply) {
		this.reply = reply;
		var geoip = reply.geoip || {};
		// After a failure only Try again loads it, so a broken file isn't fetched every refresh.
		if (geoip.file && geoip.file != this.loadingFile && !this.failure)
			this.loadDatabase(geoip.file);

		if (reply.state != 'up' || reply.since != this.since) {
			// A new session counts from zero; its rates start over too.
			this.since = reply.state == 'up' ? reply.since : null;
			if (this.places)
				this.places.reset();
		}

		this.shown = this.places && reply.state == 'up'
			? this.places.update(reply.totals || [], reply.now || Date.now() / 1000) : [];
		var exit = this.places && reply.exit ? this.places.region(reply.exit) : null;
		this.exitPlace = exit ? { lat: exit.lat, lon: exit.lon, location: exit.label } : null;
		this.show(reply);
		this.draw();
	},

	// Hands the globe what changed; the same data again is left alone.
	draw: function() {
		var globe = this.frame.contentWindow;
		if (!globe || !globe.setData || !this.shown)
			return;
		var data = {
			exit: this.exitPlace ? { lat: this.exitPlace.lat, lon: this.exitPlace.lon } : null,
			places: this.shown.map(function(p) {
				return { id: p.id, lat: p.lat, lon: p.lon, weight: Math.round(p.weight * 100) / 100, active: p.active };
			})
		};
		var text = JSON.stringify(data);
		if (text == this.sent)
			return;
		this.sent = text;
		globe.setData(data);
		this.pause();
	},

	show: function(reply) {
		var geoip = reply.geoip || {}, note = null;
		if (this.failure == 'browser')
			note = _('This browser can\'t unpack the location data. Use a recent Chrome, Edge, Safari or Firefox.');
		else if (!this.database && this.failure == 'file')
			note = [ _('The location data couldn\'t be loaded.') + ' ',
				E('button', { 'class': 'btn cbi-button', 'click': L.bind(this.retry, this) }, _('Try again')) ];
		else if (!this.database && geoip.busy)
			note = _('Downloading the location data (about 2 MB, once a month)…');
		else if (!this.database && geoip.failed)
			note = [ _('The router couldn\'t download the location data. Check that it is online.') + ' ',
				E('button', { 'class': 'btn cbi-button', 'click': L.bind(this.retry, this) }, _('Try again')) ];
		else if (!this.database)
			note = _('Loading the location data…');
		else if (reply.state != 'up')
			note = [ _('The map shows traffic while the chosen devices use the iPhone.') + ' ',
				E('a', { 'href': L.url('admin/services/cellglide/status') }, _('Status') + ' ›') ];
		else if (!this.shown.length)
			note = _('No traffic through the iPhone yet.');
		dom.content(this.message, note ? E('p', { 'class': 'cg-note' }, Array.isArray(note) ? note : [ note ]) : '');

		var exitText = '';
		if (this.database && reply.state == 'up') {
			if (this.exitPlace)
				exitText = _('Leaving through the iPhone in %s, since %s.').format(this.exitPlace.location, clock(reply.since));
			else
				exitText = reply.exit ? _('The iPhone\'s exit couldn\'t be located.')
					: _('The iPhone\'s exit isn\'t known: the router finds it with curl, which isn\'t installed.');
		}
		dom.content(this.exit, [ exitText ]);

		if (!this.database || reply.state != 'up' || !this.shown.length) {
			dom.content(this.rows, '');
			return;
		}
		var frame = this.frame, rows = [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, _('Region')),
				E('th', { 'class': 'th' }, _('Total')),
				E('th', { 'class': 'th' }, _('Now'))
			])
		];
		this.shown.forEach(function(p) {
			var detail = N_(p.addresses, '%d address', '%d addresses').format(p.addresses) +
				(p.addresses > 1 ? ' · ' + _('busiest %s').format(p.address) : ' · ' + p.address);
			rows.push(E('tr', {
				'class': 'tr cg-row' + (p.active ? '' : ' cg-idle'),
				'title': _('Turn the globe to %s').format(p.location),
				'click': function() {
					if (frame.contentWindow && frame.contentWindow.focusPlace)
						frame.contentWindow.focusPlace(p.lat, p.lon);
				}
			}, [
				E('td', { 'class': 'td' }, [ E('strong', {}, [ p.location ]), E('br'), E('span', { 'class': 'cg-note' }, [ detail ]) ]),
				E('td', { 'class': 'td cg-rate' }, [ size(p.bytes) ]),
				E('td', { 'class': 'td cg-rate' }, [ p.active
					? '↓ %s/s ↑ %s/s'.format(size(p.downloadRate), size(p.uploadRate)) : '—' ])
			]));
		});
		dom.content(this.rows, rows);
	},

	retry: function() {
		this.failure = null;
		this.loadingFile = null;
		return callGeoip(true).then(L.bind(this.refresh, this));
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
