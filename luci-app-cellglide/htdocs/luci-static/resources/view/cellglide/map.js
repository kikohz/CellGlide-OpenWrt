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

// Rows slide into the list, and into their new place when the order changes, as on the Mac
// and iPhone; with Reduce Motion they just change.
var MOTION = !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
var SPRING = 'cubic-bezier(.2, .9, .3, 1.05)';

// The two ways to show the map; both pages take the same calls (setData, focusPlace,
// setPaused). The choice is this browser's own.
var VIEWS = { globe: 'cellglide/globe.html', flat: 'cellglide/flat.html' };
var VIEW_KEY = 'cellglide-map-view';

// Whether the page around `from` is dark, from the first background behind it that isn't
// see-through: any theme, and Aurora's or Bootstrap's own day and night modes. A computed colour
// can be in any CSS syntax (oklch, say), so a 1-pixel canvas turns it into RGB.
var probe = null;
function isDark(from) {
	for (var node = from; node && node.nodeType == 1; node = node.parentNode) {
		var colour = window.getComputedStyle(node).backgroundColor;
		if (!colour || colour == 'transparent')
			continue;
		probe = probe || document.createElement('canvas').getContext('2d', { willReadFrequently: true });
		probe.clearRect(0, 0, 1, 1);
		probe.fillStyle = '#000';
		probe.fillStyle = colour;
		probe.fillRect(0, 0, 1, 1);
		var pixel = probe.getImageData(0, 0, 1, 1).data;
		if (pixel[3] < 128)
			continue;
		return (0.2126 * pixel[0] + 0.7152 * pixel[1] + 0.0722 * pixel[2]) / 255 < 0.5;
	}
	return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

// The square behind the map, as on the Mac: #f5f5f7 by day.
var BACKGROUND = { dark: '#09090b', light: '#f5f5f7' };

function savedView() {
	try { return VIEWS[window.localStorage.getItem(VIEW_KEY)] ? window.localStorage.getItem(VIEW_KEY) : 'globe'; }
	catch (e) { return 'globe'; }
}

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
	'.cg-globe { flex: 1 1 320px; max-width: 520px; aspect-ratio: 1; border-radius: 12px; overflow: hidden; }',
	'.cg-globe.cg-flat { flex-basis: 100%; max-width: none; aspect-ratio: 360 / 138; }',
	'.cg-views { display: inline-flex; margin-bottom: 1em; border: 1px solid rgba(128, 128, 128, .35); border-radius: 8px; overflow: hidden; }',
	'.cg-views button { border: 0; margin: 0; padding: .35em 1em; background: transparent; color: inherit; cursor: pointer; font: inherit; opacity: .7; }',
	'.cg-views button.cg-on { background: rgba(128, 128, 128, .25); opacity: 1; }',
	'.cg-globe iframe { width: 100%; height: 100%; border: 0; display: block; background: transparent; }',
	'.cg-side { flex: 1 1 320px; min-width: 0; }',
	'.cg-side .table .td { vertical-align: top; }',
	'.cg-row { cursor: pointer; }',
	'.cg-idle { opacity: .55; }',
	'.cg-note { font-size: 90%; opacity: .75; }',
	'.cg-rate { white-space: nowrap; font-variant-numeric: tabular-nums; }',
	'.cg-credit, .cg-credit a { font-size: 80%; opacity: .6; color: inherit; }'
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

		this.version = data[0].version || '';
		this.frame = E('iframe', { 'title': _('Traffic map'), 'loading': 'lazy' });
		this.box = E('div', { 'class': 'cg-globe' }, [ this.frame ]);
		// Not on the page yet: the page's own content decides the first look.
		this.dark = isDark(document.getElementById('maincontent') || document.body);
		this.box.style.background = this.dark ? BACKGROUND.dark : BACKGROUND.light;
		this.viewButtons = {
			globe: E('button', { 'type': 'button', 'click': L.bind(this.setView, this, 'globe') }, _('Globe')),
			flat: E('button', { 'type': 'button', 'click': L.bind(this.setView, this, 'flat') }, _('Flat map (experimental)'))
		};
		this.setView(savedView());
		this.frame.addEventListener('load', L.bind(function() {
			this.sent = null;
			this.appearance();
			this.draw();
		}, this));
		this.message = E('div');
		this.exit = E('p');
		this.rows = E('table', { 'class': 'table' });
		this.rowById = new Map();
		this.header = E('tr', { 'class': 'tr table-titles' }, [
			E('th', { 'class': 'th' }, _('Region')),
			E('th', { 'class': 'th' }, _('Total')),
			E('th', { 'class': 'th' }, _('Now'))
		]);
		// DB-IP's licence (CC BY 4.0) asks for this credit wherever its data is shown.
		this.credit = E('p', { 'class': 'cg-credit', 'style': 'display:none' }, [
			E('a', { 'href': 'https://db-ip.com', 'target': '_blank', 'rel': 'noopener' }, 'IP Geolocation by DB-IP')
		]);

		var page = E('div', { 'class': 'cbi-map' }, [
			E('style', {}, [ STYLE ]),
			E('h2', {}, _('CellGlide')),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Traffic map')),
				E('div', { 'class': 'cbi-section-descr' },
					_('Where the chosen devices\' traffic goes through the iPhone, by region. The addresses are located in this browser; nothing is sent anywhere.')),
				E('div', { 'class': 'cg-views', 'role': 'group' }, [ this.viewButtons.globe, this.viewButtons.flat ]),
				E('div', { 'class': 'cg-map' }, [
					this.box,
					E('div', { 'class': 'cg-side' }, [ this.exit, this.message, this.rows, this.credit ])
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

		// Day and night: the theme switching its mode (an attribute or class on the page) or the
		// system's setting; checked again a moment later, after the theme's own transition.
		var check = L.bind(function() {
			window.clearTimeout(this.lookTimer);
			window.requestAnimationFrame(L.bind(this.appearance, this));
			this.lookTimer = window.setTimeout(L.bind(this.appearance, this), 400);
		}, this);
		if (window.MutationObserver) {
			var watcher = new MutationObserver(check);
			watcher.observe(document.documentElement, { attributes: true });
			if (document.body)
				watcher.observe(document.body, { attributes: true });
		}
		if (window.matchMedia) {
			var query = window.matchMedia('(prefers-color-scheme: dark)');
			if (query.addEventListener)
				query.addEventListener('change', check);
		}

		this.update(data[0]);
		this.schedule();
		return page;
	},

	// Shows the globe or the flat map; the new page gets the data once it has loaded.
	setView: function(name) {
		if (name == this.view)
			return;
		this.view = name;
		try { window.localStorage.setItem(VIEW_KEY, name); } catch (e) {}
		for (var key in this.viewButtons) {
			this.viewButtons[key].classList.toggle('cg-on', key == name);
			this.viewButtons[key].setAttribute('aria-pressed', key == name ? 'true' : 'false');
		}
		this.box.classList.toggle('cg-flat', name == 'flat');
		this.frame.src = L.resource(VIEWS[name]) + '?v=' + encodeURIComponent(this.version) + (this.dark ? '' : '&look=light');
	},

	// Light or dark as the page around the map; the map's page follows (setAppearance).
	appearance: function() {
		if (this.box.parentNode)
			this.dark = isDark(this.box.parentNode);
		this.box.style.background = this.dark ? BACKGROUND.dark : BACKGROUND.light;
		var map = this.frame.contentWindow;
		if (map && map.setAppearance)
			map.setAppearance(this.dark);
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
		else if (!this.places.measuring() && !this.shown.some(function(p) { return p.active; }))
			note = [ E('strong', {}, _('Nothing is moving data right now.')), ' ',
				_('Showing the totals since %s.').format(clock(reply.since)) ];
		dom.content(this.message, note ? E('p', { 'class': 'cg-note' }, Array.isArray(note) ? note : [ note ]) : '');
		this.credit.style.display = this.database ? '' : 'none';

		var exitText = '';
		if (this.database && reply.state == 'up') {
			if (this.exitPlace)
				exitText = _('Leaving through the iPhone in %s, since %s.').format(this.exitPlace.location, clock(reply.since));
			else
				exitText = reply.exit ? _('The iPhone\'s exit couldn\'t be located.')
					: _('The iPhone\'s exit isn\'t known: the router finds it with curl, which isn\'t installed.');
		}
		dom.content(this.exit, [ exitText ]);

		// The first refresh has no rates yet: the list waits for the second, two seconds later.
		if (!this.database || reply.state != 'up' || this.places.measuring()) {
			this.list([], false);
			return;
		}
		// As on the Mac and iPhone, only what is moving data now: a place leaves the list when it
		// goes quiet and comes back when traffic resumes (the globe keeps a dim marker for it).
		// While nothing is moving, every place, greyed.
		var active = this.shown.filter(function(p) { return p.active; });
		this.list(active.length ? active : this.shown, !active.length);
	},

	// Updates the rows in place, keyed by place: new ones slide in from the side, the others
	// glide to their new position (measured before and after the move).
	list: function(places, idle) {
		var table = this.rows, byId = this.rowById;
		if (!places.length) {
			byId.clear();
			dom.content(table, '');
			return;
		}
		if (this.header.parentNode != table)
			table.insertBefore(this.header, table.firstChild);

		var before = new Map();
		if (MOTION)
			byId.forEach(function(row, id) { before.set(id, row.getBoundingClientRect().top); });

		var cursor = this.header, keep = new Set();
		for (var i = 0; i < places.length; i++) {
			var p = places[i], row = byId.get(p.id);
			keep.add(p.id);
			if (!row) {
				row = this.row();
				byId.set(p.id, row);
			}
			this.fill(row, p, idle);
			if (cursor.nextSibling !== row)
				table.insertBefore(row, cursor.nextSibling);
			cursor = row;
		}
		byId.forEach(function(row, id) {
			if (!keep.has(id)) {
				row.remove();
				byId.delete(id);
			}
		});

		if (!MOTION || !table.animate)
			return;
		byId.forEach(function(row, id) {
			if (!before.has(id)) {
				row.animate([ { opacity: 0, transform: 'translateX(24px)' }, { opacity: 1, transform: 'none' } ],
					{ duration: 380, easing: SPRING });
				return;
			}
			var shift = before.get(id) - row.getBoundingClientRect().top;
			if (Math.abs(shift) >= 1)
				row.animate([ { transform: 'translateY(' + shift + 'px)' }, { transform: 'none' } ],
					{ duration: 450, easing: SPRING });
		});
	},

	row: function() {
		var frame = this.frame, row = E('tr', { 'class': 'tr cg-row' });
		row.parts = {
			location: E('strong'),
			detail: E('span', { 'class': 'cg-note' }),
			total: E('td', { 'class': 'td cg-rate' }),
			now: E('td', { 'class': 'td cg-rate' })
		};
		dom.content(row, [
			E('td', { 'class': 'td' }, [ row.parts.location, E('br'), row.parts.detail ]),
			row.parts.total,
			row.parts.now
		]);
		row.addEventListener('click', function() {
			var p = row.place;
			if (p && frame.contentWindow && frame.contentWindow.focusPlace)
				frame.contentWindow.focusPlace(p.lat, p.lon);
		});
		return row;
	},

	// Only what changed is written, so a row keeps its hover and nothing reflows needlessly.
	fill: function(row, p, idle) {
		row.place = p;
		var text = {
			location: p.location,
			detail: N_(p.addresses, '%d address', '%d addresses').format(p.addresses) +
				(p.addresses > 1 ? ' · ' + _('busiest %s').format(p.address) : ' · ' + p.address),
			total: size(p.bytes),
			now: p.active ? '↓ %s/s ↑ %s/s'.format(size(p.downloadRate), size(p.uploadRate)) : '—'
		};
		for (var key in text)
			if (row.parts[key].textContent != text[key])
				row.parts[key].textContent = text[key];
		var title = _('Turn the globe to %s').format(p.location);
		if (row.title != title)
			row.title = title;
		row.classList.toggle('cg-idle', idle);
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
