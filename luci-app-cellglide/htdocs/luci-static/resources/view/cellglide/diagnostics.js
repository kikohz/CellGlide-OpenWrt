'use strict';
'require view';
'require dom';
'require rpc';
'require ui';

var callDiag = rpc.declare({ object: 'luci.cellglide', method: 'diag', params: [ 'range', 'email', 'note' ], expect: {} });
var callSend = rpc.declare({ object: 'luci.cellglide', method: 'diag_send', params: [ 'range', 'email', 'note' ], expect: {} });
var callResult = rpc.declare({ object: 'luci.cellglide', method: 'diag_result', expect: {} });

function stamp() {
	var d = new Date();
	return '%04d%02d%02d-%02d%02d'.format(d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes());
}

function size(text) {
	var bytes = new Blob([ text ]).size;
	return bytes < 1024 ? _('%d bytes').format(bytes) : _('%d KB').format(Math.round(bytes / 1024));
}

function pretty(text) {
	try { return JSON.stringify(JSON.parse(text), null, 2); }
	catch (e) { return text; }
}

function save(text) {
	var url = URL.createObjectURL(new Blob([ text ], { type: 'application/json' }));
	var a = E('a', { 'href': url, 'download': 'cellglide-diagnostics-%s.json'.format(stamp()), 'style': 'display:none' });
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	window.setTimeout(function() { URL.revokeObjectURL(url); }, 10000);
}

function failure(result) {
	switch (result.error) {
	case 'too-frequent':
		return _('Too many reports from this network. Try again in a minute.');
	case 'offline':
		return _('Couldn\'t reach the CellGlide server. Check that this router is online, or use Export and send us the file.');
	case 'no-client':
		return _('This router can\'t send over HTTPS: neither curl nor uclient-fetch is installed. Use Export and send us the file.');
	default:
		return _('Couldn\'t send. Try again later, or use Export and send us the file.');
	}
}

return view.extend({
	render: function() {
		var self = this;

		this.range = 'day';
		var rangeButtons = [ [ 'day', _('Last 24 hours') ], [ 'week', _('Last 7 days') ] ].map(function(r) {
			return E('button', {
				'class': 'btn cbi-button' + (r[0] == self.range ? ' cbi-button-action' : ''),
				'data-range': r[0],
				'click': function(ev) {
					self.range = r[0];
					rangeButtons.forEach(function(b) {
						b.classList.toggle('cbi-button-action', b.getAttribute('data-range') == self.range);
					});
				}
			}, [ r[1] ]);
		});
		this.email = E('input', { 'type': 'email', 'class': 'cbi-input-text', 'placeholder': _('Optional'), 'maxlength': 200, 'style': 'width:100%' });
		this.note = E('textarea', { 'class': 'cbi-input-textarea', 'placeholder': _('Optional'), 'rows': 4, 'maxlength': 2000, 'style': 'width:100%' });
		this.result = E('div');
		this.sendButton = E('button', { 'class': 'btn cbi-button cbi-button-apply', 'click': ui.createHandlerFn(this, 'handleSend') }, _('Send'));

		var field = function(label, input, description) {
			return E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, label),
				E('div', { 'class': 'cbi-value-field' }, [ input, description ? E('div', { 'class': 'cbi-value-description' }, description) : '' ])
			]);
		};

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('CellGlide')),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Export log')),
				E('div', { 'class': 'cbi-section-descr' }, _('Saves the last 24 hours as a file on this computer, redacted the same way as a report you send.')),
				E('div', { 'class': 'cbi-value' }, [
					E('button', { 'class': 'btn cbi-button', 'click': ui.createHandlerFn(this, 'handleExport') }, _('Export…'))
				])
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Send diagnostics')),
				E('div', { 'class': 'cbi-section-descr' }, _('This sends CellGlide\'s status, settings and log, with device names and web addresses removed and IP addresses shortened to their first part. Nothing is uploaded until you click Send.')),
				field(_('Time range'), E('div', {}, [ rangeButtons[0], ' ', rangeButtons[1] ]),
					_('The router keeps its log in memory: it starts over when the router restarts, and usually holds much less than 7 days.')),
				field(_('Email'), this.email),
				field(_('What happened'), this.note),
				E('div', { 'class': 'cbi-page-actions' }, [
					E('button', { 'class': 'btn cbi-button', 'click': ui.createHandlerFn(this, 'handleView') }, _('View contents…')),
					' ', this.sendButton
				]),
				this.result
			])
		]);
	},

	args: function(range) {
		return [ range || this.range, this.email.value.trim(), this.note.value.trim() ];
	},

	report: function(range) {
		return callDiag.apply(null, this.args(range)).then(function(reply) {
			if (!reply || !reply.report)
				throw new Error(_('The report could not be made. Check the system log for cellglide.'));
			return reply.report;
		});
	},

	handleExport: function() {
		return this.report('day').then(save).catch(function(e) {
			ui.addNotification(null, E('p', [ e.message ]), 'warning');
		});
	},

	handleView: function() {
		return this.report().then(function(text) {
			ui.showModal(_('What will be sent'), [
				E('p', {}, [ _('%s in total.').format(size(text)) ]),
				E('pre', { 'style': 'max-height:60vh;overflow:auto;white-space:pre-wrap;word-break:break-all;font-size:85%' }, [ pretty(text) ]),
				E('div', { 'class': 'right' }, [
					E('button', { 'class': 'btn cbi-button', 'click': ui.hideModal }, _('Close'))
				])
			]);
		}).catch(function(e) {
			ui.addNotification(null, E('p', [ e.message ]), 'warning');
		});
	},

	handleSend: function() {
		var self = this;
		this.sendButton.disabled = true;
		dom.content(this.result, E('p', { 'class': 'spinning' }, _('Sending…')));

		var show = function(kind, text, extra) {
			self.sendButton.disabled = false;
			dom.content(self.result, E('div', { 'class': 'alert-message ' + kind }, [ E('p', {}, [ text ]), extra || '' ]));
		};

		// The router sends it in the background; ask every second for up to 45 seconds.
		var wait = function(tries) {
			return new Promise(function(resolve) { window.setTimeout(resolve, 1000); }).then(callResult).then(function(r) {
				if (r.state == 'sending' && tries > 0)
					return wait(tries - 1);
				if (r.state == 'sent')
					return show('success', _('Sent. Report code: %s').format(r.code), E('p', {}, _('Just send us this code.')));
				if (r.state == 'sending')
					return show('warning', _('Still sending. Try again later, or use Export and send us the file.'));
				return show('warning', failure(r));
			});
		};

		return callSend.apply(null, this.args()).then(function(reply) {
			if (!reply || !reply.ok)
				return show('warning', _('The report could not be made. Check the system log for cellglide.'));
			return wait(45);
		}).catch(function(e) {
			show('warning', e.message);
		});
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
