/* ============================================================================
 * wh_modal.js  —  Warehouse cost & price modal (shared component)
 * Drop-in: <script src="/wh_modal.js"></script>  (served by express.static)
 *
 * Public API:
 *   WHModal.open({ item, role, onSaved })
 *       item    : the inquiry object (one row from /inquiries)
 *       role    : 'sourcing' | 'manager' | 'sales' | 'ops_view'
 *       onSaved : optional callback() fired after a successful save
 *   WHModal.totals(item) -> { cost:Number, price:Number, gp:Number|null }
 *       handy for rendering the dashboard summary row (WH cost / price / GP)
 *
 * Field model mirrors server.js (additive WH redesign). No field is renamed.
 * Saving posts to POST /inquiries/update with the quote id + changed fields +
 * the right saved flag (warehouseCostSaved for sourcing, warehousePriceSaved otherwise).
 * Server enforces per-role write permissions and recomputes WH Cost/Price Total.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.WHModal) return;

  var SUP = 5;

  // [label, field, default unit, isStorage, kind]   kind: 'template' | 'legacy'
  var GROUPS = [
    { name: 'Inbound', icon: '\uD83D\uDCE5', buckets: [
      ['Order processing',        'Order Processing',  'Order',     false, 'template'],
      ['Inbound \u2014 floor load','Inbound Floor Load','Carton',    false, 'template'],
      ['Inbound \u2014 palletized','Inbound Palletized','Pallet',    false, 'template'],
      ['Sorting',                  'Sorting',           'SKU',       false, 'template'],
      ['Palletizing',              'Palletizing',       'Pallet',    false, 'template'],
      ['OW handling fee',          'OW Handling Fee',   'Container', false, 'template'],
      ['Others',                   'Inbound Others',    '',          false, 'template'],
      ['Inbound (existing)',       'Inbound',           '',          false, 'legacy'],
    ]},
    { name: 'Outbound', icon: '\uD83D\uDCE4', buckets: [
      ['Outbound order processing','Outbound Order Processing','BOL',     false, 'template'],
      ['Order picking',            'Order Picking',          'Pallet',    false, 'template'],
      ['Staging & palletizing',    'Staging Palletizing',    'Pallet',    false, 'template'],
      ['Pallet fee',               'Outbound Pallet Fee',    'Pallet',    false, 'template'],
      ['Handling out',             'Handling Out',           'Container', false, 'template'],
      ['Floor-load loading',       'Floor Load Loading',     'Container', false, 'template'],
      ['Fulfillment / small parcel','Fulfillment',           'Unit',      false, 'template'],
      ['Outbound (existing)',      'Outbound',               '',          false, 'legacy'],
      ['Pallet fee (existing)',    'Pallet Fee',             '',          false, 'legacy'],
    ]},
    { name: 'Storage', icon: '\uD83C\uDFEC', buckets: [
      ['Per pallet \u2014 stackable',     'Storage Pallet Stackable',    'Pallet',    true, 'template'],
      ['Per pallet \u2014 non-stackable', 'Storage Pallet NonStackable', 'Pallet',    true, 'template'],
      ['Per crate',                       'Storage Crate',               'Crate',     true, 'template'],
      ['Per bundle',                      'Storage Bundle',              'Bundle',    true, 'template'],
      ['Per sack',                        'Storage Sack',                'Sack',      true, 'template'],
      ['Per container',                   'Storage Container',           'Container', true, 'template'],
      ['Per CBF',                         'Storage CBF',                 'CBF',       true, 'template'],
      ['Per CBM',                         'Storage CBM',                 'CBM',       true, 'template'],
      ['Storage (existing)',              'Storage',                     '',          false, 'legacy'],
    ]},
    { name: 'Other / surcharge', icon: '\uD83D\uDEE0\uFE0F', buckets: [
      ['Label / labeling',     'Label',             'Each',      false, 'template'],
      ['Depalletizing',        'Depalletizing',     'Pallet',    false, 'template'],
      ['Repacking',            'Repacking',         'Each',      false, 'template'],
      ['Block & brace',        'Block Brace',       'Container', false, 'template'],
      ['Pallet / crate repair','Pallet Crate Repair','Each',     false, 'template'],
      ['Rush order',           'Rush Order',        'Order',     false, 'template'],
      ['Rework / other',       'Rework Other',      'Each',      false, 'template'],
      ['Others',               'Others',            '',          false, 'template'],
      ['Cross dock (existing)','Cross Dock',        '',          false, 'legacy'],
    ]},
  ];

  // bucket fields that contribute to totals (used by WHModal.totals)
  var ALL_BARE = [];
  GROUPS.forEach(function (g) { g.buckets.forEach(function (b) { ALL_BARE.push(b[1]); }); });

  function num(v) {
    var n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
    return isFinite(n) ? n : 0;
  }
  function selIdx(item) {
    var s = parseInt(item['Selected Supplier'], 10);
    return (s >= 1 && s <= SUP) ? s : 1;
  }
  // selected cost for a bucket: template -> Cost S{sel} (fallback to bare for old reused docs); legacy -> bare
  function selectedCost(item, field, kind, sel) {
    if (kind === 'legacy') return item[field];
    var v = item[field + ' Cost S' + sel];
    if (v != null && String(v).trim() !== '') return v;
    // old reused docs: value lives in the bare field, no supplier columns yet
    return item[field];
  }

  var WHModal = window.WHModal = {};

  WHModal.totals = function (item) {
    item = item || {};
    var sel = selIdx(item), cost = 0, price = 0;
    GROUPS.forEach(function (g) {
      g.buckets.forEach(function (b) {
        cost += num(selectedCost(item, b[1], b[4], sel));
        price += num(item[b[1] + ' Price']);
      });
    });
    var gp = price > 0 ? Math.round((price - cost) / price * 100) : null;
    return { cost: cost, price: price, gp: gp };
  };

  /* ----------------------------- styles ----------------------------------- */
  function injectStyles() {
    if (document.getElementById('whm-styles')) return;
    var css = [
      '.whm-ov{position:fixed;inset:0;background:rgba(20,24,32,.5);display:flex;align-items:flex-start;justify-content:center;padding:26px 16px;overflow:auto;z-index:9999;font-family:inherit}',
      '.whm-ov.whm-hidden{display:none}',
      '.whm{width:100%;max-width:1060px;background:#fff;border-radius:12px;border:1px solid #e3e6ea;box-shadow:0 18px 60px rgba(0,0,0,.28);color:#1f2430;font-size:13px}',
      '.whm-hd{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #e3e6ea}',
      '.whm-hd h3{margin:0;font-size:16px;font-weight:600}',
      '.whm-x{cursor:pointer;color:#9aa1ab;font-size:20px;line-height:1;border:none;background:none}',
      '.whm-common{display:flex;gap:18px;align-items:stretch;padding:12px 18px;border-bottom:1px solid #e3e6ea;background:#f0faf3;box-shadow:inset 4px 0 0 #22c55e}',
      '.whm-cleft{flex:1;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px 12px;align-content:start;min-width:0}',
      '.whm-svc{grid-column:span 2}',
      '.whm-f{display:flex;flex-direction:column;gap:4px;min-width:0}',
      '.whm-f>label{font-size:10px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.3px;white-space:nowrap}',
      '.whm-checks{display:flex;flex-wrap:wrap;gap:6px 12px}',
      '.whm-chk{display:flex;align-items:center;gap:5px;font-size:12px;white-space:nowrap;cursor:pointer}',
      '.whm-in,.whm-sel{height:30px;border:1px solid #cfd4da;border-radius:6px;font-family:inherit;font-size:12px;color:#1f2430;padding:0 7px;background:#fff;width:100%}',
      '.whm-in:focus,.whm-sel:focus{outline:none;border:2px solid #2563eb;padding:0 6px}',
      '.whm-note{flex:0 0 200px;display:flex;flex-direction:column;gap:4px}',
      '.whm-note textarea{flex:1;min-height:62px;width:100%;border:1px solid #cfd4da;border-radius:6px;font-family:inherit;font-size:12px;color:#1f2430;padding:7px 9px;resize:vertical;line-height:1.5}',
      '.whm-vbar{display:flex;align-items:center;gap:8px;padding:8px 18px;border-bottom:1px solid #e3e6ea}',
      '.whm-note2{font-size:11px;color:#9aa1ab;margin-left:auto}',
      '.whm-tablewrap{max-height:46vh;overflow:auto;padding:4px 18px}',
      '.whm-table{width:100%;border-collapse:collapse;table-layout:fixed}',
      '.whm-table th,.whm-table td{padding:5px 4px;text-align:center;vertical-align:middle;font-size:12px}',
      '.whm-table th.l,.whm-table td.l{text-align:left}',
      '.whm-table th.r,.whm-table td.r{text-align:right}',
      '.whm-table thead th{font-size:10px;color:#6b7280;font-weight:500;border-bottom:1px solid #e3e6ea;padding-bottom:7px}',
      '.whm-cell{height:28px;width:100%;font-size:12px;text-align:right;border:1px solid #cfd4da;border-radius:5px;font-family:inherit;color:#1f2430;padding:0 5px;background:#fff}',
      '.whm-cell:focus{outline:none;border:2px solid #2563eb;padding:0 4px}',
      '.whm-cell:disabled{background:#f3f4f6;color:#9aa1ab}',
      '.whm-sname{height:24px;font-size:11px;text-align:center;border:1px solid #cfd4da;border-radius:5px;width:100%;font-family:inherit;color:#1f2430;padding:0 3px;background:#fff}',
      '.whm-radio{display:flex;justify-content:center;margin-bottom:3px}',
      '.whm-grp td{background:#f7f8fa;font-size:12px;font-weight:600;cursor:pointer;border-top:1px solid #e3e6ea}',
      '.whm-unit{font-size:10px;color:#6b7280;background:#f7f8fa;border:1px solid #e3e6ea;padding:1px 6px;border-radius:5px;white-space:nowrap}',
      '.whm-perd{height:26px;font-size:11px;border:1px solid #cfd4da;border-radius:5px;width:100%;font-family:inherit;color:#1f2430;background:#fff;padding:0 3px}',
      '.whm-gp{font-size:11px;font-weight:600;color:#9aa1ab}',
      '.whm-col.sel .whm-cell{border:2px solid #2563eb;padding:0 4px}',
      '.whm-col.dim{opacity:.72}',
      '.whm-srcg .whm-col.sel .whm-cell{border:1px solid #cfd4da;padding:0 5px}',
      '.whm-srcg .whm-col.dim{opacity:1}',
      '.whm-oqcol{text-align:center}',
      '.whm-oq{cursor:pointer;width:14px;height:14px;accent-color:#15803d}',
      '.whm-exist{color:#9aa1ab;font-style:italic}',
      '.whm-vnote{padding:8px 18px 4px;border-top:1px solid #eef0f2;display:flex;flex-direction:column;gap:4px;background:#eef4ff;box-shadow:inset 4px 0 0 #3b82f6}',
      '.whm-vnote>label{font-size:10px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.3px}',
      '.whm-vnote textarea{width:100%;min-height:40px;border:1px solid #cfd4da;border-radius:6px;font-family:inherit;font-size:12px;color:#1f2430;padding:6px 9px;resize:vertical;line-height:1.5}',
      '.whm-vnote textarea:disabled{background:#f3f4f6;color:#6b7280}',
      '.whm-table th.whm-col.cost, .whm-table td.whm-col.cost{background:#eef4ff}',
      '.whm-table th.whm-pcol, .whm-table td.whm-pcol{background:#fff5ea}',
      '.whm-table th.whm-qcol, .whm-table td.whm-qcol{background:#f0faf3}',
      '.whm-legend{display:flex;align-items:center;gap:14px;flex-wrap:wrap;font-size:11px;color:#475569}',
      '.whm-chip{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}',
      '.whm-sw{width:11px;height:11px;border-radius:3px;display:inline-block}',
      '.whm-sw.g{background:#22c55e}.whm-sw.b{background:#3b82f6}.whm-sw.o{background:#f59e0b}',
      '.whm-ft{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 18px;border-top:1px solid #e3e6ea;background:#f7f8fa;flex-wrap:wrap}',
      '.whm-tot{display:flex;gap:16px;align-items:center;flex-wrap:wrap;font-size:13px}',
      '.whm-tot b{font-weight:600}',
      '.whm-btn{height:32px;padding:0 14px;border:1px solid #cfd4da;background:#fff;border-radius:8px;font-size:13px;cursor:pointer;font-family:inherit;color:#1f2430}',
      '.whm-btn:hover{background:#f7f8fa}',
      '.whm-btn.pri{border:2px solid #2563eb;color:#2563eb;font-weight:500}',
      '.whm-btn.sel{border:2px solid #2563eb;color:#2563eb}',
      '.whm-save-state{font-size:11px;color:#15803d;margin-right:6px}',
      '.whm-hide{display:none !important}',
      '.whm-vis-hidden{visibility:hidden}'
    ].join('\n');
    var st = document.createElement('style');
    st.id = 'whm-styles';
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ----------------------------- open ------------------------------------- */
  WHModal.open = function (opts) {
    opts = opts || {};
    var item = opts.item || {};
    var role = String(opts.role || '').toLowerCase();
    var onSaved = typeof opts.onSaved === 'function' ? opts.onSaved : function () {};
    var quote = String(item['Quotation #'] || '').trim();

    var canEditCost = role === 'sourcing';
    var canEditPrice = role === 'sales' || role === 'manager';
    var showCost = true;   // all roles view cost+GP; server masks unsent (draft) cost. Only Sourcing can EDIT cost.
    var showPrice = role !== 'sourcing';   // Sourcing (like TRUCK) only enters cost — Price & GP are hidden from it
    var canEditCommon = role === 'sales' || role === 'manager';   // green zone (common info + top Note) is Sales/Manager; Sourcing read-only

    // ── Issue 4: manual supplier lock. Independent field 'WH Locked By' ('', 'sales', 'manager').
    // When locked, freeze supplier radio + Sourcing cost + Price. Green zone & OnQuote stay editable.
    // Sales may lock/unlock its OWN ('sales') lock; Manager may lock/unlock ANY; a Manager lock blocks Sales.
    var canLockRole = (role === 'sales' || role === 'manager');

    injectStyles();

    var draft = {};                            // changed fields pending save
    var sel = selIdx(item);
    function get(f) { return (f in draft) ? draft[f] : (item[f] == null ? '' : item[f]); }
    function set(f, v) { draft[f] = v; }

    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]); }); };

    /* ---- build DOM ---- */
    var ov = document.createElement('div');
    ov.className = 'whm-ov' + (role === 'sourcing' ? ' whm-srcg' : '');

    var supNames = [];
    for (var s = 1; s <= SUP; s++) supNames.push(get('Supplier ' + s + ' Name'));
    var svcTypes = String(get('Service Types') || '');
    function svcChecked(t) { return svcTypes.split(/[;,]/).map(function (x) { return x.trim().toLowerCase(); }).indexOf(t.toLowerCase()) !== -1; }
    var svcSubs = String(get('Service Subtypes') || '');   // ✅ SUBTYPE
    function svcSubChecked(t) { return svcSubs.split(/[;,]/).map(function (x) { return x.trim().toLowerCase(); }).indexOf(t.toLowerCase()) !== -1; }
    // ✅ LPQUOTE: List-Price snapshot state — when present, the quote table renders from it
    var lpRows = [];
    try { lpRows = JSON.parse(String(get('LP Rows') || '[]')); if (!Array.isArray(lpRows)) lpRows = []; } catch (eLp) { lpRows = []; }
    var lpMode = lpRows.length > 0;
    var lpPending = !lpMode && svcSubs.trim() !== '';

    var headCols = '';
    for (var w = 1; w <= SUP; w++) {
      headCols +=
        '<th class="whm-col cost ' + (w === sel ? 'sel' : 'dim') + '" data-w="' + w + '">' +
          '<div class="whm-radio"><input type="radio" name="whm-selwh" value="' + w + '" ' + (w === sel ? 'checked' : '') + (canEditPrice ? '' : ' disabled') + '></div>' +
          '<input class="whm-sname" data-sname="' + w + '" value="' + esc(supNames[w - 1]) + '" placeholder="Sup ' + w + '" ' + (canEditCost ? '' : 'disabled') + '>' +
        '</th>';
    }

    ov.innerHTML =
      '<div class="whm" role="dialog" aria-label="Warehouse cost and price">' +
        '<div class="whm-hd"><h3>Warehouse cost &amp; price \u2014 Quote ' + esc(quote) + '</h3><button class="whm-x" data-close aria-label="Close">\u00d7</button></div>' +

        '<div class="whm-common">' +
          '<div class="whm-cleft">' +
            '<div class="whm-f whm-svc"><label>Service type</label><div class="whm-checks">' +
              ['Transload', 'Distribution', 'Fulfillment'].concat(svcChecked('Storage') ? ['Storage'] : []).map(function (t) {   // ✅ SUBTYPE: Storage shown only on legacy data
                return '<label class="whm-chk"><input type="checkbox" data-svc="' + t + '" ' + (svcChecked(t) ? 'checked' : '') + (canEditCommon ? '' : ' disabled') + '> ' + t + '</label>';
              }).join('') +
            '</div></div>' +
            '<div class="whm-f whm-svc"><label>Sub-option</label><div class="whm-checks">' +   // ✅ SUBTYPE
              [['Transload','FCL-Pallet to Pallet'],['Transload','FCL-Floor to Pallet'],['Transload','FCL-Floor to Floor'],['Transload','LTL-Pallet to Pallet'],['Distribution','FCL-Palletized IB + LTL out'],['Distribution','FCL-Floorload IB + LTL out'],['Fulfillment','FCL-Palletized IB + SP out'],['Fulfillment','FCL-Floorload IB + SP out']].map(function (st) {
                return '<label class="whm-chk" title="' + st[0] + '"><input type="checkbox" data-svcsub="' + st[1] + '" ' + (svcSubChecked(st[1]) ? 'checked' : '') + (canEditCommon ? '' : ' disabled') + '> ' + st[1] + '</label>';
              }).join('') +
            '</div></div>' +
            field('Container size', selectHTML('Container Size', get('Container Size'), ["20'", "40'", "40' HQ", "45'", "53'", 'LCL / other'], canEditCommon)) +
            field('Container weight', inputHTML('Gross Weight', get('Gross Weight'), 'e.g. 18,000 lbs', canEditCommon)) +
            field('# of containers', inputHTML('# of Containers', get('# of Containers'), 'e.g. 3', canEditCommon)) +
            field('ETA', dateHTML('ETA', get('ETA'), canEditCommon)) +
            field('Commodity', inputHTML('Commodity', get('Commodity'), 'e.g. furniture', canEditCommon)) +
            field('Total pkgs / container', inputHTML('Packages Per Container', get('Packages Per Container'), 'e.g. 480', canEditCommon)) +
          '</div>' +
          '<div class="whm-note"><label>Note</label><textarea data-field="Warehouse Note" ' + (canEditCommon ? '' : 'disabled') + '>' + esc(get('Warehouse Note')) + '</textarea></div>' +
        '</div>' +

        '<div class="whm-vbar"><div class="whm-legend">' +
          '<span class="whm-chip"><span class="whm-sw g"></span>Sales / Customer Portal</span>' +
          '<span class="whm-chip"><span class="whm-sw b"></span>Sourcing (Matthew): supplier cost &amp; notes</span>' +
          '<span class="whm-chip"><span class="whm-sw o"></span>Sales: price</span>' +
          '<span class="whm-note2">' + (canEditCost ? 'Sales picks the supplier' : 'Cost read-only \u2014 you edit price') + '</span>' +
        '</div></div>' +

        '<div class="whm-tablewrap"><table class="whm-table">' +
          '<colgroup>' +
            '<col style="width:26px"><col style="width:150px"><col style="width:88px"><col style="width:70px">' +
            (function () { var c = ''; for (var i = 0; i < SUP; i++) c += '<col>'; return c; })() +
            (showPrice ? '<col style="width:80px"><col style="width:48px">' : '') +
          '</colgroup>' +
          '<thead><tr>' +
            '<th class="whm-oqcol" title="Include this row in the quote sheet">\uD83D\uDCC4</th><th class="l">Service</th><th class="l whm-qcol">Qty / detail</th><th>Unit</th>' +
            headCols +
            (showPrice ? '<th class="r whm-pcol">Price</th><th class="r">GP</th>' : '') +
          '</tr></thead>' +
          '<tbody data-rows></tbody>' +
        '</table></div>' +

        '<div class="whm-vnote">' +
          '<label>' + (canEditCost ? 'Supplier note (Sourcing)' : 'Supplier note') + '</label>' +
          '<textarea data-field="WH Vendor Note" placeholder="' + (canEditCost ? 'e.g. lead time, MOQ, validity, vendor-specific terms\u2026' : '') + '" ' + (canEditCost ? '' : 'disabled') + '>' + esc(get('WH Vendor Note')) + '</textarea>' +
        '</div>' +

        '<div class="whm-ft">' +
          '<div class="whm-tot">' +
            '<span class="cost"><span style="color:#6b7280">via</span> <b data-via>Supplier ' + sel + '</b></span>' +
            '<span class="cost"><span style="color:#6b7280">Cost</span> <b data-tcost>$0</b></span>' +
            (showPrice ? '<span><span style="color:#6b7280">Price</span> <b data-tprice>$0</b></span>' : '') +
            (showPrice ? '<span><span style="color:#6b7280">GP</span> <b data-tgp style="color:#15803d">\u2014</b></span>' : '') +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            '<span class="whm-lockstate" data-lockstate style="font-size:11px;font-weight:600;color:#b45309"></span>' +
            (canLockRole ? '<button class="whm-btn" data-lock></button>' : '') +
            '<span class="whm-save-state" data-savestate></span>' +
            '<button class="whm-btn" data-close>Close</button>' +
            '<button class="whm-btn pri" data-save>\u2713 Save</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(ov);
    // ✅ LPQUOTE: tiny extra styles (once)
    if (!document.getElementById('whm-lp-css')) {
      var stLp = document.createElement('style'); stLp.id = 'whm-lp-css';
      stLp.textContent = '.whm-lpref{font-size:10px;color:#94a3b8;text-align:right;margin-top:1px;}.whm-in-desc{background:#fefce8;border-style:dashed;}.whm-lpnote{cursor:help;color:#94a3b8;}';
      document.head.appendChild(stLp);
    }
    // ✅ LPQUOTE: first open of a sub-typed inquiry — build the snapshot server-side, then re-render
    if (lpPending) {
      fetch('/api/lp-quote-init', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ q: quote }) })
        .then(function (rr) { return rr.json().then(function (dd) { return { ok: rr.ok, d: dd }; }); })
        .then(function (x) {
          if (!document.body.contains(ov)) return;   // modal was closed meanwhile
          if (!x.ok) {
            var tdErr = ov.querySelector('tr td[colspan="20"]');
            if (tdErr) tdErr.textContent = (x.d && x.d.error) || 'Failed to prepare the quote template.';
            return;
          }
          item['LP Rows'] = JSON.stringify(x.d.rows);
          item['LP Page Key'] = x.d.pageKey || '';
          x.d.rows.forEach(function (r3) {
            if (!r3.custom && /^\d+(\.\d+)?$/.test(String(r3.listPrice)) && String(item['LP ' + r3.i + ' Price'] || '').trim() === '') {
              item['LP ' + r3.i + ' Price'] = String(r3.listPrice);
            }
          });
          ov.remove();
          WHModal.open(opts);   // re-render with the fresh snapshot
        })
        .catch(function (e3) { console.error('lp-quote-init error:', e3); });
    }

    /* small HTML builders used above */
    function field(label, inner) { return '<div class="whm-f"><label>' + label + '</label>' + inner + '</div>'; }
    function inputHTML(f, v, ph, editable) { return '<input class="whm-in" data-field="' + f + '" value="' + esc(v) + '" placeholder="' + ph + '" ' + (editable ? '' : 'disabled') + '>'; }
    function dateHTML(f, v, editable) { return '<input class="whm-in" type="date" data-field="' + f + '" value="' + esc(v) + '" ' + (editable ? '' : 'disabled') + '>'; }
    function selectHTML(f, v, opts2, editable) {
      return '<select class="whm-sel" data-field="' + f + '" ' + (editable ? '' : 'disabled') + '>' +
        '<option value=""></option>' +
        opts2.map(function (o) { return '<option ' + (String(v) === o ? 'selected' : '') + '>' + o + '</option>'; }).join('') +
        '</select>';
    }

    /* ---- rows ---- */
    var tbody = ov.querySelector('[data-rows]');
    var rowsHTML = '';
    GROUPS.forEach(function (g, gi) {
      rowsHTML += '<tr class="whm-grp" data-g="' + gi + '"><td colspan="4" class="l">' + g.icon + ' ' + g.name + '</td>' +
        '<td colspan="' + SUP + '"></td>' +
        (showPrice ? '<td class="r" data-gsub="' + gi + '"></td><td></td>' : '') +
        '</tr>';
      g.buckets.forEach(function (b, bi) {
        var label = b[0], fld = b[1], unit = b[2], storage = b[3], kind = b[4];
        // legacy rows only render when they hold a value (old docs)
        var legacyVal = kind === 'legacy' ? get(fld) : '';
        if (kind === 'legacy' && (legacyVal == null || String(legacyVal).trim() === '')) return;

        rowsHTML += '<tr data-row data-g="' + gi + '" data-field="' + esc(fld) + '" data-kind="' + kind + '">';
        rowsHTML += '<td class="whm-oqcol">' + (kind === 'template'
          ? '<input type="checkbox" class="whm-oq" data-onquote="' + esc(fld) + '" ' + (get(fld + ' OnQuote') === 'true' ? 'checked' : '') + (canEditCommon ? '' : ' disabled') + '>'
          : '') + '</td>';
        rowsHTML += '<td class="l ' + (kind === 'legacy' ? 'whm-exist' : '') + '">' + esc(label) + '</td>';
        // qty
        rowsHTML += '<td class="l whm-qcol">' + (kind === 'template'
          ? '<input class="whm-cell" style="text-align:left" data-field="' + esc(fld) + ' Qty" value="' + esc(get(fld + ' Qty')) + '" placeholder="qty / detail" ' + (canEditCommon ? '' : 'disabled') + '>'
          : '') + '</td>';
        // unit
        rowsHTML += '<td>' + (storage
          ? periodSelect(fld, get(fld + ' Period') || 'mo', unit, canEditCost)
          : (unit ? '<span class="whm-unit">' + unit + '</span>' : '')) + '</td>';
        // supplier cost columns
        for (var w = 1; w <= SUP; w++) {
          if (kind === 'legacy') {
            // single cost lives in the bare field; show it in the selected column, blank elsewhere
            var show = (w === sel);
            rowsHTML += '<td class="whm-col cost ' + (w === sel ? 'sel' : 'dim') + '" data-w="' + w + '">' +
              (show ? '<input class="whm-cell" data-costbare="' + esc(fld) + '" value="' + esc(get(fld)) + '" ' + (canEditCost ? '' : 'disabled') + '>' : '') + '</td>';
          } else {
            var cv = get(fld + ' Cost S' + w);
            if ((cv == null || String(cv).trim() === '') && w === sel) {
              var bare = get(fld);
              if (bare != null && String(bare).trim() !== '' && noSupplierCosts(fld)) cv = bare; // surface old reused value
            }
            rowsHTML += '<td class="whm-col cost ' + (w === sel ? 'sel' : 'dim') + '" data-w="' + w + '">' +
              '<input class="whm-cell" data-cost="' + esc(fld) + '" data-w="' + w + '" value="' + esc(cv) + '" placeholder="\u00b7" ' + (canEditCost ? '' : 'disabled') + '></td>';
          }
        }
        // price + gp (hidden from Sourcing, like TRUCK)
        if (showPrice) {
          rowsHTML += '<td class="whm-pcol"><input class="whm-cell" data-price="' + esc(fld) + '" value="' + esc(get(fld + ' Price')) + '" placeholder="0" ' + (canEditPrice ? '' : 'disabled') + '></td>';
          rowsHTML += '<td class="r"><span class="whm-gp" data-gp="' + esc(fld) + '">\u2014</span></td>';
        }
        rowsHTML += '</tr>';
      });
    });
    // ✅ LPQUOTE: with a snapshot, the fixed-bucket rows above are replaced by the List-Price rows
    function buildLpRowsHTML() {
      var h = '', lastSec = null, gi = -1;
      lpRows.forEach(function (r) {
        var sec = String(r.section || '');
        if (sec !== lastSec) {
          gi++; lastSec = sec;
          h += '<tr class="whm-grp" data-g="lp' + gi + '"><td colspan="4" class="l">\uD83D\uDCCB ' + esc(sec || 'Services') + '</td>' +
            '<td colspan="' + SUP + '"></td>' +
            (showPrice ? '<td class="r" data-gsub="lp' + gi + '"></td><td></td>' : '') + '</tr>';
        }
        var fld = 'LP ' + r.i;
        h += '<tr data-row data-g="lp' + gi + '" data-field="' + esc(fld) + '" data-kind="lp">';
        h += '<td class="whm-oqcol"></td>';
        h += '<td class="l">' + (r.custom
          ? '<input class="whm-cell whm-in-desc" style="text-align:left" data-lpdesc="' + r.i + '" value="' + esc(get(fld + ' Desc')) + '" placeholder="Custom line item description" ' + ((canEditCommon || canEditCost) ? '' : 'disabled') + '>'
          : esc(r.description) + (r.notes ? ' <span class="whm-lpnote" title="' + esc(r.notes) + '">\u24D8</span>' : '')) + '</td>';
        h += '<td class="l whm-qcol"><input class="whm-cell" style="text-align:left" data-field="' + esc(fld) + ' Qty" value="' + esc(get(fld + ' Qty')) + '" placeholder="qty / detail" ' + (canEditCommon ? '' : 'disabled') + '></td>';
        h += '<td>' + (r.unit ? '<span class="whm-unit">' + esc(r.unit) + '</span>' : '') + '</td>';
        for (var w2 = 1; w2 <= SUP; w2++) {
          h += '<td class="whm-col cost ' + (w2 === sel ? 'sel' : 'dim') + '" data-w="' + w2 + '">' +
            '<input class="whm-cell" data-cost="' + esc(fld) + '" data-w="' + w2 + '" value="' + esc(get(fld + ' Cost S' + w2)) + '" placeholder="\u00b7" ' + (canEditCost ? '' : 'disabled') + '></td>';
        }
        if (showPrice) {
          h += '<td class="whm-pcol"><input class="whm-cell" data-price="' + esc(fld) + '" value="' + esc(get(fld + ' Price')) + '" placeholder="0" ' + (canEditPrice ? '' : 'disabled') + '>' +
            ((!r.custom && String(r.listPrice).trim() !== '') ? '<div class="whm-lpref">LP ' + esc(r.listPrice) + '</div>' : '') + '</td>';
          h += '<td class="r"><span class="whm-gp" data-gp="' + esc(fld) + '">\u2014</span></td>';
        }
        h += '</tr>';
      });
      return h;
    }
    if (lpMode) rowsHTML = buildLpRowsHTML();
    if (lpPending) rowsHTML = '<tr><td colspan="20" class="l" style="padding:14px;color:#64748b;">Preparing quote template from TTS List Price\u2026</td></tr>';
    tbody.innerHTML = rowsHTML;

    function periodSelect(fld, v, unit, editable) {
      var base = (unit || 'Unit');
      return '<select class="whm-perd" data-field="' + esc(fld) + ' Period" ' + (editable ? '' : 'disabled') + '>' +
        ['mo', 'wk', 'day'].map(function (p) { return '<option value="' + p + '" ' + (v === p ? 'selected' : '') + '>' + base + '/' + p + '</option>'; }).join('') +
        '</select>';
    }
    function noSupplierCosts(fld) {
      for (var w = 1; w <= SUP; w++) { var v = get(fld + ' Cost S' + w); if (v != null && String(v).trim() !== '') return false; }
      return true;
    }

    /* ---- masking for sales ---- */
    if (!showCost) {
      ov.querySelectorAll('.cost').forEach(function (el) { el.classList.add('whm-hide'); });
    }

    /* ---- recalc ---- */
    function curSelectedCostFor(fld, kind) {
      if (kind === 'legacy') return num(get(fld));
      var el = ov.querySelector('.whm-cell[data-cost="' + cssEsc(fld) + '"][data-w="' + sel + '"]');
      return el ? num(el.value) : num(selectedCost(mergedItem(), fld, kind, sel));
    }
    function mergedItem() { var m = {}; for (var k in item) m[k] = item[k]; for (var k2 in draft) m[k2] = draft[k2]; return m; }
    function cssEsc(s) { return String(s).replace(/(["\\])/g, '\\$1'); }

    function recalc() {
      var tc = 0, tp = 0;
      ov.querySelectorAll('tr[data-row]').forEach(function (tr) {
        var fld = tr.getAttribute('data-field'), kind = tr.getAttribute('data-kind');
        var c = curSelectedCostFor(fld, kind);
        var pEl = tr.querySelector('.whm-cell[data-price]');
        var p = pEl ? num(pEl.value) : 0;
        var gpEl = tr.querySelector('[data-gp]');
        if (gpEl) {
          if (p > 0 && (c || p)) { var g = (p - c) / p * 100; gpEl.textContent = Math.round(g) + '%'; gpEl.style.color = g >= 0 ? '#15803d' : '#b91c1c'; }
          else { gpEl.textContent = '\u2014'; gpEl.style.color = '#9aa1ab'; }
        }
        if (c || p) { tc += c; tp += p; }
      });
      // group subtotals (price)
      GROUPS.forEach(function (g, gi) {
        var sub = 0;
        ov.querySelectorAll('tr[data-row][data-g="' + gi + '"]').forEach(function (tr) {
          var pEl = tr.querySelector('.whm-cell[data-price]'); if (pEl) sub += num(pEl.value);
        });
        var cell = ov.querySelector('[data-gsub="' + gi + '"]'); if (cell) cell.textContent = sub ? money(sub) : '';
      });
      // ✅ LPQUOTE: subtotals for List-Price sections (data-gsub="lpN" — no collision with numeric gi above)
      ov.querySelectorAll('[data-gsub^="lp"]').forEach(function (cell2) {
        var gi2 = cell2.getAttribute('data-gsub'), sub2 = 0;
        ov.querySelectorAll('tr[data-row][data-g="' + gi2 + '"]').forEach(function (tr2) {
          var pEl2 = tr2.querySelector('.whm-cell[data-price]'); if (pEl2) sub2 += num(pEl2.value);
        });
        cell2.textContent = sub2 ? money(sub2) : '';
      });
      var gp = tp > 0 ? Math.round((tp - tc) / tp * 100) + '%' : '\u2014';
      ov.querySelector('[data-tcost]').textContent = money(tc);
      var tpEl = ov.querySelector('[data-tprice]'); if (tpEl) tpEl.textContent = money(tp);
      var tgpEl = ov.querySelector('[data-tgp]'); if (tgpEl) tgpEl.textContent = gp;
      var nm = supNameFor(sel);
      ov.querySelector('[data-via]').textContent = nm;
    }
    function money(v) { return '$' + Math.round(v).toLocaleString(); }
    function supNameFor(w) { var el = ov.querySelector('.whm-sname[data-sname="' + w + '"]'); return (el && el.value.trim()) || ('Supplier ' + w); }

    function applySel() {
      ov.querySelectorAll('.whm-col').forEach(function (c) {
        var w = +c.getAttribute('data-w');
        c.classList.toggle('sel', w === sel);
        c.classList.toggle('dim', w !== sel);
      });
    }

    // ── Issue 4: reflect manual lock in the UI (freeze supplier radio + cost + price) ──
    function applyLockUI() {
      var lb = String(get('WH Locked By') || '').toLowerCase().trim();
      var locked = (lb === 'sales' || lb === 'manager');
      ov.querySelectorAll('input[name="whm-selwh"]').forEach(function (r) { r.disabled = !canEditPrice || locked; });
      ov.querySelectorAll('.whm-sname').forEach(function (s) { s.disabled = !canEditCost || locked; });
      ov.querySelectorAll('.whm-cell[data-cost],.whm-cell[data-costbare]').forEach(function (c) { c.disabled = !canEditCost || locked; });
      ov.querySelectorAll('.whm-cell[data-price]').forEach(function (p) { p.disabled = !canEditPrice || locked; });
      var st = ov.querySelector('[data-lockstate]');
      if (st) st.textContent = locked ? ('\uD83D\uDD12 Locked by ' + (lb === 'manager' ? 'Manager' : 'Sales')) : '';
      var b = ov.querySelector('[data-lock]');
      if (b) {
        if (!locked) {
          b.textContent = '\uD83D\uDD12 Lock'; b.disabled = false; b.setAttribute('data-act', 'lock'); b.title = '';
        } else {
          var canU = (lb === 'manager') ? (role === 'manager') : true; // sales lock: sales or manager can unlock
          b.textContent = '\uD83D\uDD13 Unlock'; b.disabled = !canU; b.setAttribute('data-act', 'unlock');
          b.title = canU ? '' : 'Locked by Manager \u2014 only a Manager can unlock';
        }
      }
    }

    /* ---- change tracking + autosave ---- */
    function trackField(el) {
      var f = el.getAttribute('data-field');
      if (f) { set(f, el.value); return [f]; }
      if (el.hasAttribute('data-lpdesc')) { set('LP ' + el.getAttribute('data-lpdesc') + ' Desc', el.value); return ['LP ' + el.getAttribute('data-lpdesc') + ' Desc']; }   // ✅ LPQUOTE
      if (el.hasAttribute('data-cost')) { set(el.getAttribute('data-cost') + ' Cost S' + el.getAttribute('data-w'), el.value); return [el.getAttribute('data-cost') + ' Cost S' + el.getAttribute('data-w')]; }
      if (el.hasAttribute('data-costbare')) { set(el.getAttribute('data-costbare'), el.value); return [el.getAttribute('data-costbare')]; }
      if (el.hasAttribute('data-price')) { set(el.getAttribute('data-price') + ' Price', el.value); return [el.getAttribute('data-price') + ' Price']; }
      if (el.hasAttribute('data-sname')) { set('Supplier ' + el.getAttribute('data-sname') + ' Name', el.value); return ['Supplier ' + el.getAttribute('data-sname') + ' Name']; }
      return [];
    }
    function rebuildServiceTypes() {
      var picked = [];
      ov.querySelectorAll('[data-svc]').forEach(function (cb) { if (cb.checked) picked.push(cb.getAttribute('data-svc')); });
      set('Service Types', picked.join('; '));
    }
    function rebuildServiceSubtypes() {   // ✅ SUBTYPE
      var picked = [];
      ov.querySelectorAll('[data-svcsub]').forEach(function (cb) { if (cb.checked) picked.push(cb.getAttribute('data-svcsub')); });
      set('Service Subtypes', picked.join('; '));
    }

    var saveTimer = null;
    function flashSaved(txt) { var el = ov.querySelector('[data-savestate]'); el.textContent = txt; if (txt) setTimeout(function () { if (el.textContent === txt) el.textContent = ''; }, 2500); }

    async function postUpdate(fields) {
      var payload = { 'Quotation #': quote, 'Saved': 'true' };
      if (role === 'sourcing') {
        payload['warehouseCostSaved'] = 'true';
        // Saved cost stays Sourcing-only (masked from Sales) until the row's
        // "Send to Sales" checkbox is ticked, which clears the draft flag.
        payload['warehouseCostDraft'] = 'true';
      } else {
        // Sales/Manager: only a real PRICE edit commits the quote and locks Sourcing.
        // Picking a supplier, editing the Note or common info must NOT lock Sourcing.
        var touchedPrice = Object.keys(fields).some(function (k) { return / Price$/.test(k); });
        if (touchedPrice) payload['warehousePriceSaved'] = 'true';
      }
      for (var k in fields) payload[k] = fields[k];
      try {
        var res = await fetch('/inquiries/update', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin', body: JSON.stringify(payload)
        });
        if (!res.ok) { var t = await res.text(); console.error('WH save failed:', t); flashSaved(''); return false; }
        return true;
      } catch (e) { console.error('WH save error:', e); return false; }
    }

    function autosave(changedKeys) {
      if (!changedKeys.length) return;
      var patch = {};
      changedKeys.forEach(function (k) { patch[k] = draft[k]; });
      clearTimeout(saveTimer);
      saveTimer = setTimeout(async function () {
        var ok = await postUpdate(patch);
        if (ok) { flashSaved('\u2713 saved'); onSaved(); }
      }, 300);
    }

    /* ---- events ---- */
    ov.addEventListener('change', function (e) {
      var r = e.target.closest('input[name="whm-selwh"]');
      if (r) { sel = +r.value; set('Selected Supplier', String(sel)); applySel(); recalc(); autosave(['Selected Supplier']); return; }
      if (e.target.matches('[data-svc]')) { rebuildServiceTypes(); autosave(['Service Types']); return; }
      if (e.target.matches('[data-svcsub]')) {   // ✅ SUBTYPE: single-select (one sub-option drives the quote template)
        if (e.target.checked) ov.querySelectorAll('[data-svcsub]').forEach(function (cb) { if (cb !== e.target) cb.checked = false; });
        rebuildServiceSubtypes(); autosave(['Service Subtypes']); return;
      }
      if (e.target.matches('[data-onquote]')) {
        var oqKey = e.target.getAttribute('data-onquote') + ' OnQuote';
        set(oqKey, e.target.checked ? 'true' : 'false');
        autosave([oqKey]);
        return;
      }
      var keys = trackField(e.target);
      recalc();
      if (keys.length) autosave(keys);
    });
    ov.addEventListener('blur', function (e) {
      if (e.target.matches('.whm-cell,.whm-in,.whm-sel,.whm-sname,.whm-perd,textarea')) {
        var keys = trackField(e.target);
        recalc();
        if (keys.length) autosave(keys);
      }
    }, true);
    ov.addEventListener('input', function (e) {
      if (e.target.matches('.whm-cell[data-cost],.whm-cell[data-costbare],.whm-cell[data-price]')) recalc();
    });

    function close() { clearTimeout(saveTimer); ov.remove(); }
    ov.addEventListener('click', function (e) {
      if (e.target === ov) return close();
      var lockBtn = e.target.closest('[data-lock]');
      if (lockBtn && !lockBtn.disabled) {
        var next = (lockBtn.getAttribute('data-act') === 'lock') ? role : '';
        set('WH Locked By', next);
        applyLockUI();
        postUpdate({ 'WH Locked By': next }).then(function (ok) { if (ok) { flashSaved('\u2713 saved'); onSaved(); } });
        return;
      }
      if (e.target.closest('[data-close]')) return close();
      if (e.target.closest('[data-save]')) {
        // commit everything in draft at once
        rebuildServiceTypes();
        if (Object.keys(draft).length === 0) { flashSaved('\u2713 nothing to save'); return; }
        postUpdate(draft).then(function (ok) { if (ok) { flashSaved('\u2713 saved'); onSaved(); close(); } });
      }
    });
    document.addEventListener('keydown', function esckey(ev) { if (ev.key === 'Escape') { close(); document.removeEventListener('keydown', esckey); } });

    applySel();
    applyLockUI();
    recalc();
  };
})();
