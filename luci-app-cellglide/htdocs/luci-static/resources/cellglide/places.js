'use strict';
'require baseclass';

// The traffic map's sums, as in the Mac app (GeoIPDatabase, DestinationGroups, MapPlaces,
// MapActivity): the location database, places by region, what is moving now and how large
// each marker is. Runs in the browser; the router only counts bytes per address.

// The CGIP file (Scripts/build-geoip.py in the app's repository), version 1: a 20-byte
// header, the regions, then sorted range starts with their region for IPv4 (4 bytes each)
// and for IPv6 (the address's first 8 bytes), all little-endian.
function Database(buffer) {
	var view = new DataView(buffer), bytes = new Uint8Array(buffer);
	if (buffer.byteLength < 20 || String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) != 'CGIP' || view.getUint16(4, true) != 1)
		throw new Error('malformed');
	var count = view.getUint32(6, true);
	this.v4Count = view.getUint32(10, true);
	this.v6Count = view.getUint32(14, true);
	this.month = view.getUint16(18, true) + 200000;
	if (count > (buffer.byteLength - 20) / 7)
		throw new Error('malformed');

	var text = new TextDecoder(), offset = 20;
	this.regions = new Array(count);
	for (var i = 0; i < count; i++) {
		if (offset + 7 > buffer.byteLength)
			throw new Error('malformed');
		var length = bytes[offset + 6];
		if (offset + 7 + length > buffer.byteLength)
			throw new Error('malformed');
		var country = String.fromCharCode(bytes[offset], bytes[offset + 1]);
		var name = text.decode(bytes.subarray(offset + 7, offset + 7 + length));
		this.regions[i] = {
			label: name ? name + ', ' + country : country,
			lat: view.getInt16(offset + 2, true) / 100,
			lon: view.getInt16(offset + 4, true) / 100
		};
		offset += 7 + length;
	}
	this.v4Starts = offset;
	this.v4Regions = this.v4Starts + 4 * this.v4Count;
	this.v6Starts = this.v4Regions + 2 * this.v4Count;
	this.v6Regions = this.v6Starts + 8 * this.v6Count;
	if (this.v6Regions + 2 * this.v6Count != buffer.byteLength)
		throw new Error('malformed');
	this.view = view;
}

// An IPv6 address's first 64 bits as two unsigned 32-bit halves; null if it isn't one.
function ipv6Prefix(address) {
	if (!/^[0-9a-fA-F:.]+$/.test(address))
		return null;
	var halves = address.split('::');
	if (halves.length > 2)
		return null;
	var head = halves[0] ? halves[0].split(':') : [], tail = halves.length == 2 && halves[1] ? halves[1].split(':') : [];
	// An embedded IPv4 address (::ffff:1.2.3.4) is in the last 64 bits: it can't change the prefix.
	var words = head.concat(halves.length == 2 ? new Array(Math.max(8 - head.length - tail.length, 0)).fill('0') : [], tail);
	if (words.length < 4 || (halves.length == 1 && words.length != 8 && !/\./.test(address)))
		return null;
	var group = [];
	for (var i = 0; i < 4; i++) {
		if (!/^[0-9a-fA-F]{1,4}$/.test(words[i]))
			return null;
		group.push(parseInt(words[i], 16));
	}
	return [ (group[0] * 0x10000 + group[1]) >>> 0, (group[2] * 0x10000 + group[3]) >>> 0 ];
}

function ipv4Value(address) {
	var parts = address.split('.');
	if (parts.length != 4)
		return null;
	var value = 0;
	for (var i = 0; i < 4; i++) {
		if (!/^[0-9]{1,3}$/.test(parts[i]) || +parts[i] > 255)
			return null;
		value = value * 256 + +parts[i];
	}
	return value;
}

Database.prototype = {
	// The region of an address, or null (private networks, unlisted ranges).
	region: function(address) {
		var view = this.view, v4 = ipv4Value(address), found = -1, low, high, mid, at;
		if (v4 != null) {
			low = 0; high = this.v4Count - 1;
			while (low <= high) {
				mid = (low + high) >>> 1;
				if (view.getUint32(this.v4Starts + mid * 4, true) <= v4) { found = mid; low = mid + 1; }
				else high = mid - 1;
			}
			at = this.v4Regions;
		}
		else {
			var v6 = ipv6Prefix(address);
			if (!v6)
				return null;
			low = 0; high = this.v6Count - 1;
			while (low <= high) {
				mid = (low + high) >>> 1;
				var hi = view.getUint32(this.v6Starts + mid * 8 + 4, true), lo = view.getUint32(this.v6Starts + mid * 8, true);
				if (hi < v6[0] || (hi == v6[0] && lo <= v6[1])) { found = mid; low = mid + 1; }
				else high = mid - 1;
			}
			at = this.v6Regions;
		}
		if (found < 0)
			return null;
		var index = view.getUint16(at + found * 2, true);
		return index == 0xFFFF || index >= this.regions.length ? null : this.regions[index];
	}
};

// Unpacks the raw-deflate file the router keeps. Needs DecompressionStream (Chrome 80,
// Safari 16.4, Firefox 113).
function inflate(buffer) {
	if (typeof DecompressionStream != 'function')
		return Promise.reject(new Error('unsupported'));
	var stream = new Blob([ buffer ]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
	return new Response(stream).arrayBuffer();
}

// The busiest places drawn and listed, as on the Mac and iPhone.
var SHOWN = 24;
// How far back "now" reaches, in seconds: a place idle this long loses its arc.
var WINDOW = 6;
// Addresses keep their region between refreshes; past this many the memory starts over.
var CACHE_LIMIT = 20000;

var Places = baseclass.extend({
	__init__: function(database) {
		this.database = database;
		this.cache = new Map();
		this.samples = [];
	},

	region: function(address) {
		var cache = this.cache;
		if (cache.has(address))
			return cache.get(address);
		if (cache.size >= CACHE_LIMIT)
			cache.clear();
		var region = this.database.region(address);
		cache.set(address, region);
		return region;
	},

	// Totals per region from the router's [address, sent, received] rows, busiest first,
	// each with its busiest address and how many addresses it covers.
	groups: function(totals) {
		var merged = new Map();
		for (var i = 0; i < totals.length; i++) {
			var row = totals[i], bytes = row[1] + row[2];
			if (!bytes)
				continue;
			var region = this.region(row[0]);
			if (!region)
				continue;
			var group = merged.get(region.label);
			if (!group) {
				group = { id: region.label, location: region.label, lat: region.lat, lon: region.lon,
					up: 0, down: 0, address: row[0], top: bytes, addresses: 0 };
				merged.set(region.label, group);
			}
			group.up += row[1];
			group.down += row[2];
			group.addresses++;
			if (bytes > group.top || (bytes == group.top && row[0] < group.address)) {
				group.address = row[0];
				group.top = bytes;
			}
		}
		return Array.from(merged.values()).sort(function(a, b) {
			var difference = (b.up + b.down) - (a.up + a.down);
			return difference || (a.location < b.location ? -1 : a.location > b.location ? 1 : 0);
		});
	},

	// Bytes a second per group since the oldest kept sample, about WINDOW seconds ago; then
	// keeps this one. Every group is sampled, not only the shown ones, so a place climbing into
	// the list doesn't count its whole history as new traffic.
	rates: function(groups, now) {
		var current = new Map(), rates = new Map(), baseline = this.samples[0];
		for (var i = 0; i < groups.length; i++)
			current.set(groups[i].id, groups[i]);
		if (baseline) {
			var seconds = Math.max(now - baseline.time, 0.5);
			current.forEach(function(group, id) {
				var before = baseline.totals.get(id), up = group.up - (before ? before.up : 0), down = group.down - (before ? before.down : 0);
				// Totals fall when a session starts over or an idle address expires: no traffic, not negative.
				rates.set(id, { up: Math.max(up, 0) / seconds, down: Math.max(down, 0) / seconds });
			});
		}
		var kept = [];
		this.samples.push({ time: now, totals: new Map(Array.from(current, function(entry) {
			return [ entry[0], { up: entry[1].up, down: entry[1].down } ];
		})) });
		for (var j = this.samples.length - 1; j >= 0; j--)
			if (now - this.samples[j].time >= WINDOW) { kept = this.samples.slice(j); break; }
		if (kept.length)
			this.samples = kept;
		return rates;
	},

	// The shown places with their rates and marker weights (log of the traffic, so small
	// places stay visible). `now` in seconds.
	update: function(totals, now) {
		var groups = this.groups(totals), rates = this.rates(groups, now);
		var shown = groups.slice(0, SHOWN).map(function(group) {
			var rate = rates.get(group.id) || { up: 0, down: 0 };
			return {
				id: group.id, location: group.location, lat: group.lat, lon: group.lon,
				bytes: group.up + group.down, uploadRate: rate.up, downloadRate: rate.down,
				active: rate.up > 0 || rate.down > 0, address: group.address, addresses: group.addresses
			};
		});
		var logs = shown.map(function(place) { return Math.log10(Math.max(place.bytes, 1)); });
		var top = Math.max.apply(null, logs), bottom = Math.min.apply(null, logs);
		shown.forEach(function(place, i) { place.weight = top > bottom ? (logs[i] - bottom) / (top - bottom) : 1; });
		return shown;
	},

	reset: function() {
		this.samples = [];
	}
});

return baseclass.extend({
	Database: Database,
	Places: Places,
	inflate: inflate
});
