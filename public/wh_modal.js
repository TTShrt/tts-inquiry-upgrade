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

  function isTruthy(v) { return String(v == null ? '' : v).toLowerCase().trim() === 'true'; }   // ✅ REDESIGN: local helper (dashboards have their own)
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
    // ✅ LPQUOTE: dynamic List-Price rows count into the WH totals (mirrors server computeWarehouseTotals)
    var lpArr = [];
    try { lpArr = JSON.parse(String(item['LP Rows'] || '[]')); if (!Array.isArray(lpArr)) lpArr = []; } catch (eT) { lpArr = []; }
    lpArr.forEach(function (r) {
      var c = item['LP ' + r.i + ' Cost S' + sel];
      if (c === undefined || c === null || String(c).trim() === '') c = item['LP ' + r.i + ' Cost'];
      cost += num(c);
      price += num(item['LP ' + r.i + ' Price']);
    });
    var gp = price > 0 ? Math.round((price - cost) / price * 100) : null;
    return { cost: cost, price: price, gp: gp };
  };

  /* ----------------------------- styles ----------------------------------- */
  function injectStyles() {
    if (document.getElementById('whm-styles')) return;
    var css = [
      /* ===== REDESIGN 2026-09-03: one accent (cobalt band on the selected supplier), grey-scale everything else ===== */
      '.whm-ov{position:fixed;inset:0;background:rgba(23,32,51,.55);display:flex;align-items:flex-start;justify-content:center;padding:22px 16px;overflow:auto;z-index:9999;font-family:inherit;font-feature-settings:"tnum" 1}',
      '.whm-ov.whm-hidden{display:none}',
      '.whm{width:100%;max-width:1160px;background:#fff;border-radius:14px;box-shadow:0 30px 60px -20px rgba(0,0,0,.55);color:#172033;font-size:12.5px;overflow:hidden}',
      '.whm-hd{display:flex;align-items:center;gap:14px;padding:13px 20px 11px;border-bottom:1px solid #e3e8ef}',
      '.whm-title{font-size:15px;font-weight:600;letter-spacing:-.01em;white-space:nowrap}',
      '.whm-meta{font-size:12px;color:#5b6b82;white-space:nowrap}.whm-meta b{color:#172033;font-weight:600}',
      '.whm-hint{font-size:11.5px;color:#95a3b8;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right}',
      '.whm-lptoggle{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#5b6b82;cursor:pointer;user-select:none;white-space:nowrap}.whm-lptoggle input{accent-color:#2457d6;cursor:pointer}',
      '.whm-x{cursor:pointer;color:#95a3b8;font-size:22px;line-height:1;border:none;background:none;padding:0 2px}.whm-x:hover{color:#172033}',
      '.whm-common{display:flex;gap:18px;align-items:stretch;padding:12px 20px;border-bottom:1px solid #e3e8ef;background:#f5f7fa}',
      '.whm-cleft{flex:1;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px 12px;align-content:start;min-width:0}',
      '.whm-svc{grid-column:span 2}',
      '.whm-f{display:flex;flex-direction:column;gap:4px;min-width:0}',
      '.whm-f>label{font-size:11px;color:#5b6b82;font-weight:500;white-space:nowrap}',
      '.whm-checks{display:flex;flex-wrap:wrap;gap:6px 12px}',
      '.whm-chk{display:flex;align-items:center;gap:5px;font-size:12px;white-space:nowrap;cursor:pointer}',
      '.whm-in,.whm-sel{height:30px;border:1px solid #e3e8ef;border-radius:7px;font-family:inherit;font-size:12px;color:#172033;padding:0 8px;background:#fff;width:100%}',
      '.whm-in:focus,.whm-sel:focus{outline:none;border-color:#2457d6;box-shadow:0 0 0 3px rgba(36,87,214,.14)}',
      '.whm-note{flex:0 0 220px;display:flex;flex-direction:column;gap:4px}',
      '.whm-note textarea{flex:1;min-height:62px;width:100%;border:1px solid #e3e8ef;border-radius:7px;font-family:inherit;font-size:12px;color:#172033;padding:7px 9px;resize:vertical;line-height:1.5}',
      '.whm-tablewrap{max-height:48vh;overflow:auto}',
      '.whm-table{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed}',
      '.whm-table th,.whm-table td{padding:0 12px;text-align:center;vertical-align:middle;font-size:12.5px}',
      '.whm-table th.l,.whm-table td.l{text-align:left}.whm-table th.r,.whm-table td.r{text-align:right}',
      '.whm-table thead th{position:sticky;top:0;z-index:3;background:#fff;border-bottom:1px solid #e3e8ef;font-size:11.5px;color:#5b6b82;font-weight:500;padding:12px 12px 8px;vertical-align:bottom}',
      '.whm-table thead th.whm-svc-h{padding-left:20px}',
      '.whm-table tbody td{height:34px;border-bottom:1px solid #eef2f6}',
      '.whm-table tbody tr[data-row]:hover td{background:#fafbfd}',
      '.whm-table td.whm-svc,.whm-table td.l{padding-left:20px;font-weight:500;color:#172033}',
      '.whm-unit{font-size:11px;color:#95a3b8;font-weight:400;margin-left:8px;white-space:nowrap}',
      '.whm-lpnote{cursor:help;color:#95a3b8}',
      '.whm-table thead th.whm-col{padding:0;vertical-align:bottom}',
      '.whm-sh{display:grid;grid-template-columns:14px 1fr;grid-template-rows:18px 18px;column-gap:8px;row-gap:2px;align-items:center;padding:9px 12px 8px;border-top:3px solid transparent;height:64px;cursor:pointer}',
      '.whm-radio{grid-row:1;grid-column:1;display:flex;align-items:center}.whm-radio input{width:12px;height:12px;margin:0;accent-color:#2457d6;cursor:pointer}',
      '.whm-sname{grid-row:1;grid-column:2;border:0;border-bottom:1px dashed #c5cfdc;background:transparent;font-family:inherit;font-size:12px;font-weight:600;color:#172033;text-align:right;width:100%;min-width:0;padding:0 0 1px}',
      '.whm-sname:disabled{border-bottom-color:transparent;color:#172033}.whm-sname:focus{outline:none;border-bottom:1px solid #2457d6}',
      '.whm-sh-tr{grid-row:2;grid-column:2;display:flex;align-items:center;justify-content:flex-end;gap:6px;white-space:nowrap}',
      '.whm-tot{font-size:12px;color:#5b6b82;font-weight:500}',
      '.whm-low{font-size:10px;color:#2fbf8f;font-weight:600;border:1px solid #bfeedc;background:#e6f8f0;border-radius:4px;padding:0 5px;line-height:15px}.whm-low:empty{display:none}',
      'th.whm-col.sel .whm-sh{border-top-color:#2457d6;background:#edf2ff}th.whm-col.sel .whm-tot{color:#2457d6;font-weight:600}',
      'th.whm-col.empty .whm-sh{opacity:.55}',
      '.whm-table td.whm-col{text-align:right}',
      '.whm-cell{height:28px;width:100%;max-width:120px;font-size:12.5px;text-align:right;border:1px solid transparent;border-radius:6px;font-family:inherit;color:#5b6b82;padding:0 8px;background:transparent}',
      '.whm-cell::placeholder{color:#d5dce6}',
      '.whm-cell:disabled{color:#5b6b82;background:transparent}',
      '.whm-table td.whm-col.sel{background:#edf2ff}.whm-table td.whm-col.sel .whm-cell{color:#172033;font-weight:600}',
      '.whm-col.dim{opacity:1}',
      '.whm-srcg .whm-cell[data-cost],.whm-srcg .whm-cell[data-costbare]{border-color:#e3e8ef;background:#fff;color:#172033}',
      '.whm-srcg .whm-cell[data-cost]:focus,.whm-srcg .whm-cell[data-costbare]:focus{outline:none;border-color:#2457d6;box-shadow:0 0 0 3px rgba(36,87,214,.14)}',
      '.whm-srcg .whm-table td.whm-col.sel{background:transparent}.whm-srcg .whm-table td.whm-col.sel .whm-cell{font-weight:500}',
      '.whm-srcg th.whm-col.sel .whm-sh{border-top-color:transparent;background:transparent}.whm-srcg th.whm-col.sel .whm-tot{color:#5b6b82;font-weight:500}',
      '.whm-srcg .whm-sh{cursor:default}',
      '.whm-qcol .whm-cell{text-align:left;max-width:none;border-color:#e3e8ef;background:#fff;color:#172033}',
      '.whm-cell[data-field]{border-color:#e3e8ef;background:#fff;color:#172033}',
      '.whm-perd{height:26px;font-size:11px;border:1px solid #e3e8ef;border-radius:6px;width:100%;font-family:inherit;color:#172033;background:#fff;padding:0 4px}',
      '.whm-oqcol{text-align:center}.whm-oq{cursor:pointer;width:14px;height:14px;accent-color:#2fbf8f}',
      '.whm-exist{color:#95a3b8;font-style:italic}',
      '.whm-table td.whm-pcol{text-align:right;padding-right:16px;padding-left:8px}',
      '.whm-pw{position:relative;display:inline-block}',
      '.whm-pcol .whm-cell{width:104px;max-width:104px;border:1px solid #e3e8ef;border-radius:7px;padding:0 10px;font-size:13px;font-weight:600;color:#172033;background:#fff}',
      '.whm-pcol .whm-cell:focus{outline:none;border-color:#2457d6;box-shadow:0 0 0 3px rgba(36,87,214,.14)}',
      '.whm-pcol .whm-cell.auto{color:#2457d6}',
      '.whm-pcol .whm-cell:disabled{background:transparent;border-color:transparent}',
      '.whm-man{position:absolute;left:-10px;top:50%;width:6px;height:6px;border-radius:50%;background:#d98b16;transform:translateY(-50%);display:none}.whm-pw.manual .whm-man{display:block}',
      '.whm-in-desc{text-align:left;max-width:none;border:1px dashed #c5cfdc;background:#fffdf3;color:#172033}',
      '.whm-table td.whm-gpcol{text-align:right;padding-right:20px;padding-left:4px}',
      '.whm-gp{font-size:12px;font-weight:600;color:#d5dce6}',
      '.whm-table tr.whm-grp td{background:#f5f7fa;height:30px;border-top:1px solid #e3e8ef;border-bottom:1px solid #e3e8ef;cursor:pointer;user-select:none;font-size:12px;font-weight:600;color:#172033;text-align:left}',
      '.whm-table tr.whm-grp td.whm-pcol,.whm-table tr.whm-grp td.r{text-align:right;color:#5b6b82;font-weight:500}',
      '.whm-chev{display:inline-block;width:14px;color:#95a3b8;font-size:10px;transition:transform .15s}',
      'tr.whm-grp.closed .whm-chev{transform:rotate(-90deg)}tr.whm-rowhide{display:none}',
      '.whm-vnote{padding:10px 20px 12px;border-top:1px solid #e3e8ef;background:#fff}',
      '.whm-vnote textarea{width:100%;min-height:40px;border:1px solid #e3e8ef;border-radius:8px;font-family:inherit;font-size:12.5px;color:#172033;padding:7px 10px;resize:vertical;line-height:1.5}',
      '.whm-vnote textarea::placeholder{color:#95a3b8}.whm-vnote textarea:disabled{background:#f5f7fa;color:#5b6b82}',
      '.whm-ft{display:flex;align-items:center;gap:22px;padding:12px 20px;border-top:1px solid #e3e8ef;background:#f5f7fa;flex-wrap:wrap}',
      '.whm-tot{display:flex;gap:22px;align-items:baseline;flex-wrap:wrap}',
      '.whm-tot-i .k{font-size:11px;color:#5b6b82;display:block;margin-bottom:1px}.whm-tot-i b{font-size:14px;font-weight:600;color:#172033}',
      '.whm-tot-i.via b{color:#2457d6}.whm-tot-i.gp b{font-size:18px}',
      '.whm-ft-r{margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.whm-send{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;font-weight:600;color:#172033;cursor:pointer;user-select:none;padding:6px 12px;border:1px solid #e3e8ef;border-radius:8px;background:#fff;margin-right:6px}',
      '.whm-send input{accent-color:#2457d6;width:15px;height:15px;cursor:pointer;margin:0}.whm-send em{font-style:normal;font-weight:400;font-size:11.5px;color:#95a3b8}',
      '.whm-send.on{border-color:#c7d5fb;background:#edf2ff}.whm-send.on em{color:#2457d6}',
      '.whm-lockstate{font-size:11px;font-weight:600;color:#b45309}',
      '.whm-btn{height:32px;padding:0 14px;border:1px solid #e3e8ef;background:#fff;border-radius:8px;font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit;color:#172033}',
      '.whm-btn:hover{background:#f5f7fa}.whm-btn.q{color:#5b6b82}',
      '.whm-btn.pri{background:#2457d6;border-color:#2457d6;color:#fff}.whm-btn.pri:hover{background:#1e4bc0}',
      '.whm-btn.sel{border-color:#2457d6;color:#2457d6}',
      '.whm-save-state{font-size:11px;color:#2fbf8f;margin-right:4px}',
      '.whm-hide{display:none !important}.whm-vis-hidden{visibility:hidden}'
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
    // ✅ REDESIGN (2026-09-03, per Lina): show 3 supplier columns by default. The data model
    //    keeps all 5 (Cost S1..S5); a 4th/5th column appears only when that supplier already
    //    holds data on this quote (name or any cost) or is the selected one — nothing gets hidden.
    var supCols = [];
    for (var w0 = 1; w0 <= SUP; w0++) {
      var hasData = String(get('Supplier ' + w0 + ' Name') || '').trim() !== '';
      if (!hasData) { for (var kk0 in item) { if (kk0.slice(-8) === ' Cost S' + w0 && String(item[kk0] == null ? '' : item[kk0]).trim() !== '') { hasData = true; break; } } }
      if (w0 <= 3 || hasData || w0 === sel) supCols.push(w0);
    }

    var headCols = '';
    supCols.forEach(function (w) {
      headCols +=
        '<th class="whm-col cost ' + (w === sel ? 'sel' : 'dim') + '" data-w="' + w + '">' +
          '<div class="whm-sh">' +
            '<span class="whm-radio"><input type="radio" name="whm-selwh" value="' + w + '" ' + (w === sel ? 'checked' : '') + (canEditPrice ? '' : ' disabled') + ' title="Quote via this supplier"></span>' +
            '<input class="whm-sname" data-sname="' + w + '" value="' + esc(supNames[w - 1]) + '" placeholder="Supplier ' + w + '" ' + (canEditCost ? '' : 'disabled') + '>' +
            '<span class="whm-sh-tr"><span class="whm-low" data-low="' + w + '"></span><span class="whm-tot" data-tot="' + w + '"></span></span>' +
          '</div>' +
        '</th>';
    });

    ov.innerHTML =
      '<div class="whm" role="dialog" aria-label="Warehouse cost and price">' +
        '<div class="whm-hd">' +
          '<span class="whm-title">Warehouse cost &amp; price</span>' +
          '<span class="whm-meta">Quote <b>' + esc(quote) + '</b>' + (get('Customer ID') ? ' for <b>' + esc(get('Customer ID')) + '</b>' : '') + (get('Requested By') ? ' \u2014 ' + esc(get('Requested By')) : '') + '</span>' +
          '<span class="whm-hint">' + (canEditCost ? 'Fill each supplier\u2019s cost. Sales picks the supplier and sees the auto price.' : 'Cost is read-only. Pick a supplier; price is auto-derived (25% GP) and you can override it.') + '</span>' +
          (lpMode ? '<label class="whm-lptoggle" title="Show the TTS List Price under each Price as a reference"><input type="checkbox" data-showlp> Show TTS list price</label>' : '') +
          '<button class="whm-x" data-close aria-label="Close">\u00d7</button></div>' +

        '<div class="whm-common">' +
          '<div class="whm-cleft">' +
            '<div class="whm-f whm-svc"><label>Service type</label><div class="whm-checks">' +
              ['Transload', 'Distribution', 'Fulfillment'].concat(svcChecked('Storage') ? ['Storage'] : []).map(function (t) {   // ✅ SUBTYPE: Storage shown only on legacy data
                return '<label class="whm-chk"><input type="checkbox" data-svc="' + t + '" ' + (svcChecked(t) ? 'checked' : '') + (canEditCommon ? '' : ' disabled') + '> ' + t + '</label>';
              }).join('') +
            '</div></div>' +
            '<div class="whm-f whm-svc"><label>Sub-option</label><div class="whm-checks">' +   // ✅ SUBTYPE: grouped under their parent service type; a group shows only when its parent is checked
              ['Transload', 'Distribution', 'Fulfillment'].map(function (pt) {
                var subs = { 'Transload': ['FCL-Pallet to Pallet', 'FCL-Floor to Pallet', 'FCL-Floor to Floor', 'LTL-Pallet to Pallet'], 'Distribution': ['FCL-Palletized IB + LTL out', 'FCL-Floorload IB + LTL out'], 'Fulfillment': ['FCL-Palletized IB + SP out', 'FCL-Floorload IB + SP out'] }[pt];
                return '<span data-svcsubgrp="' + pt + '" style="' + (svcChecked(pt) ? '' : 'display:none;') + '">' +
                  '<span class="whm-subgrp-lbl">' + pt + ':</span>' +
                  subs.map(function (sb) {
                    return '<label class="whm-chk"><input type="checkbox" data-svcsub="' + sb + '" data-parent="' + pt + '" ' + (svcSubChecked(sb) ? 'checked' : '') + (canEditCommon ? '' : ' disabled') + '> ' + sb + '</label>';
                  }).join('') + '</span>';
              }).join('') +
            '</div></div>' +
            '<div class="whm-f" style="grid-column:1/-1;"><label>Service detail</label><div class="whm-ro">' + (esc(get('Warehouse Service Detail')) || '\u2014') + '</div></div>' +   // ✅ SUBTYPE: read-only, set at inquiry creation (cargo details live here)
            field('Container size', selectHTML('Container Size', get('Container Size'), ["20'", "40'", "40' HQ", "45'", "53'", 'LCL / other'], canEditCommon)) +
            field('Container weight', inputHTML('Gross Weight', get('Gross Weight'), 'e.g. 18,000 lbs', canEditCommon)) +
            field('# of containers', inputHTML('# of Containers', get('# of Containers'), 'e.g. 3', canEditCommon)) +
            field('ETA', dateHTML('ETA', get('ETA'), canEditCommon)) +
            field('Commodity', inputHTML('Commodity', get('Commodity'), 'e.g. furniture', canEditCommon)) +
            field('Total pkgs / container', inputHTML('Packages Per Container', get('Packages Per Container'), 'e.g. 480', canEditCommon)) +
          '</div>' +
          '<div class="whm-note"><label>Note</label><textarea data-field="Warehouse Note" ' + (canEditCommon ? '' : 'disabled') + '>' + esc(get('Warehouse Note')) + '</textarea></div>' +
        '</div>' +

        '<div class="whm-tablewrap"><table class="whm-table' + (lpMode ? ' whm-lp' : '') + '">' +
          '<colgroup>' +
            (lpMode ? '<col style="width:34%">' : '<col style="width:26px"><col style="width:150px"><col style="width:88px"><col style="width:70px">') +
            supCols.map(function (w) { return '<col class="whm-supc" data-w="' + w + '">'; }).join('') +
            (showPrice ? '<col style="width:118px"><col style="width:58px">' : '') +
          '</colgroup>' +
          '<thead><tr>' +
            (lpMode ? '<th class="l whm-svc-h">Service</th>' : '<th class="whm-oqcol" title="Include this row in the quote sheet">\uD83D\uDCC4</th><th class="l whm-svc-h">Service</th><th class="l whm-qcol">Qty / detail</th><th>Unit</th>') +
            headCols +
            (showPrice ? '<th class="r whm-pcol">Price</th><th class="r whm-gpcol">GP</th>' : '') +
          '</tr></thead>' +
          '<tbody data-rows></tbody>' +
        '</table></div>' +

        '<div class="whm-vnote">' +
          '<textarea data-field="WH Vendor Note" placeholder="' + (canEditCost ? 'Note from the supplier, or anything Sales should know (lead time, MOQ, validity\u2026)' : 'Supplier note') + '" ' + (canEditCost ? '' : 'disabled') + '>' + esc(get('WH Vendor Note')) + '</textarea>' +
        '</div>' +

        '<div class="whm-ft">' +
          '<div class="whm-tot">' +
            '<span class="whm-tot-i via"><span class="k">Quoting via</span><b data-via>Supplier ' + sel + '</b></span>' +
            '<span class="whm-tot-i"><span class="k">Cost</span><b data-tcost>$0</b></span>' +
            (showPrice ? '<span class="whm-tot-i"><span class="k">Price</span><b data-tprice>$0</b></span>' : '') +
            (showPrice ? '<span class="whm-tot-i gp"><span class="k">Gross profit</span><b data-tgp>\u2014</b></span>' : '') +
          '</div>' +
          '<div class="whm-ft-r">' +
            (role === 'sourcing' ? '<label class="whm-send" data-sendwrap><input type="checkbox" data-sendsales ' + (isTruthy(item['warehouseCostSent']) ? 'checked' : '') + '> <span>Send cost to Sales</span><em data-sendstate></em></label>' : '') +   // ✅ REDESIGN: Sourcing sends from inside the modal (same flags as the dashboard checkbox)
            '<span class="whm-lockstate" data-lockstate></span>' +
            '<span class="whm-save-state" data-savestate></span>' +
            (canLockRole ? '<button class="whm-btn q" data-lock></button>' : '') +
            ((role === 'sales' || role === 'manager') ? '<button class="whm-btn q whm-export" type="button" title="Export Quotation (Print / PDF) \u2014 prices appear after Send to Sales" onclick="window.open(\'/quotation_print.html?q=\' + encodeURIComponent(\'' + esc(quote) + '\'), \'_blank\')">Export PDF</button>' : '') +   // ✅ EXPORT: moved to the footer
            '<button class="whm-btn" data-close>Close</button>' +
            '<button class="whm-btn pri" data-save>Save changes</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(ov);
    // ✅ LPQUOTE: tiny extra styles (once)
    if (!document.getElementById('whm-lp-css')) {
      var stLp = document.createElement('style'); stLp.id = 'whm-lp-css';
      stLp.textContent = '.whm-lpref{font-size:10.5px;color:#95a3b8;text-align:right;line-height:1.1;margin-top:2px;display:none;}.whm.whm-showlp .whm-lpref{display:block;}.whm.whm-showlp .whm-table tbody td{height:44px;}.whm-lptoggle{margin-left:auto;display:inline-flex;align-items:center;gap:5px;font-size:11px;color:#475569;cursor:pointer;user-select:none;}.whm-lptoggle input{cursor:pointer;}.whm-in-desc{background:#fefce8;border-style:dashed;}.whm-lpnote{cursor:help;color:#94a3b8;}.whm-subgrp-lbl{font-size:11px;color:#64748b;font-weight:600;margin:0 4px 0 10px;}.whm-ro{font-size:12px;color:#334155;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:7px 10px;min-height:18px;white-space:pre-wrap;}.whm-export{margin-left:auto;margin-right:10px;background:#4361ee;color:#fff;border-color:#4361ee;}';
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
          // (2026-09-03) List Price is no longer pre-filled into the Price column — see server lp-quote-init.
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
      rowsHTML += '<tr class="whm-grp" data-g="' + gi + '"><td colspan="4" class="l"><span class="whm-chev">\u25be</span>' + g.icon + ' ' + g.name + '</td>' +
        '<td colspan="' + supCols.length + '"></td>' +
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
        supCols.forEach(function (w) {
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
              '<input class="whm-cell" data-cost="' + esc(fld) + '" data-w="' + w + '" value="' + esc(cv) + '" placeholder="\u2014" ' + (canEditCost ? '' : 'disabled') + '></td>';
          }
        });
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
          h += '<tr class="whm-grp" data-g="lp' + gi + '"><td class="l"><span class="whm-chev">\u25be</span>' + esc(sec || 'Services') + '</td>' +
            '<td colspan="' + supCols.length + '"></td>' +
            (showPrice ? '<td class="r" data-gsub="lp' + gi + '"></td><td></td>' : '') + '</tr>';
        }
        var fld = 'LP ' + r.i;
        h += '<tr data-row data-g="lp' + gi + '" data-field="' + esc(fld) + '" data-kind="lp">';
        h += '<td class="l whm-svc">' + (r.custom
          ? '<input class="whm-cell whm-in-desc" style="text-align:left" data-lpdesc="' + r.i + '" value="' + esc(get(fld + ' Desc')) + '" placeholder="Add a custom line item" ' + ((canEditCommon || canEditCost) ? '' : 'disabled') + '>'
          : esc(r.description) + (r.unit ? '<span class="whm-unit">' + esc(r.unit) + '</span>' : '') + (r.notes ? ' <span class="whm-lpnote" title="' + esc(r.notes) + '">\u24D8</span>' : '')) + '</td>';
        supCols.forEach(function (w2) {
          h += '<td class="whm-col cost ' + (w2 === sel ? 'sel' : 'dim') + '" data-w="' + w2 + '">' +
            '<input class="whm-cell" data-cost="' + esc(fld) + '" data-w="' + w2 + '" value="' + esc(get(fld + ' Cost S' + w2)) + '" placeholder="\u2014" ' + (canEditCost ? '' : 'disabled') + '></td>';
        });
        if (showPrice) {
          h += '<td class="whm-pcol"><span class="whm-pw"><i class="whm-man" title="Manually set \u2014 will not be overwritten by the auto price"></i><input class="whm-cell" data-price="' + esc(fld) + '" value="' + esc(get(fld + ' Price')) + '" placeholder="" ' + (canEditPrice ? '' : 'disabled') + '></span>' +
            ((!r.custom && String(r.listPrice).trim() !== '') ? '<div class="whm-lpref">List ' + esc(r.listPrice) + '</div>' : '') + '</td>';
          h += '<td class="r whm-gpcol"><span class="whm-gp" data-gp="' + esc(fld) + '">\u2014</span></td>';
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

    // ✅ LPQUOTE (2026-09-03): live mirror of the server's autoPriceLpRows rule so Sales sees the
    //    vendor-driven price the moment a supplier is picked / a cost changes (server re-derives
    //    on save; both use price = cost / 0.75, nearest $10 at ≥ $50, nearest $1 below).
    //    Manual-override protection mirrors the server: only rewrite an empty price or one
    //    still equal to the last auto value (tracked in data-auto).
    function lpAutoFrom(costNum) {
      var raw = costNum / 0.75;
      if (raw >= 50) { var precise = Math.round(raw * 100) / 100; return String(Math.round(precise / 10) * 10); }
      return String(Math.max(1, Math.round(raw)));
    }
    function applyAutoLp() {
      if (!lpMode || !canEditPrice) return;
      var touched = [];
      ov.querySelectorAll('tr[data-row][data-kind="lp"]').forEach(function (tr) {
        var fld = tr.getAttribute('data-field');
        var pEl = tr.querySelector('.whm-cell[data-price]'); if (!pEl || pEl.disabled) return;
        var cEl = tr.querySelector('.whm-cell[data-cost][data-w="' + sel + '"]');
        var n = cEl ? num(cEl.value) : 0;
        if (!(n > 0)) return;                                   // no cost → leave price alone
        var auto = lpAutoFrom(n), cur = String(pEl.value).trim(), last = pEl.getAttribute('data-auto') || '';
        if (cur === '' || cur === last) {
          if (cur !== auto) { pEl.value = auto; set(fld + ' Price', auto); touched.push(fld + ' Price'); }
          pEl.setAttribute('data-auto', auto);
        }
      });
      return touched;
    }
    // ✅ REDESIGN: Sourcing sends the warehouse cost to Sales from inside the modal. Same three
    //    flags the dashboard's WH-row checkbox writes (costSaved / costSent / costDraft), same
    //    endpoint (postUpdate) — no new save path.
    function setSendUI(on) {
      var wrap = ov.querySelector('[data-sendwrap]'); if (!wrap) return;
      var cb = wrap.querySelector('[data-sendsales]'), st = wrap.querySelector('[data-sendstate]');
      cb.checked = !!on; wrap.classList.toggle('on', !!on);
      st.textContent = on ? 'Sent \u2014 Sales can see this cost' : 'Sales can\u2019t see this cost yet';
    }
    function initSend() {
      var wrap = ov.querySelector('[data-sendwrap]'); if (!wrap) return;
      var cb = wrap.querySelector('[data-sendsales]');
      var confirmedWH = isTruthy(item['warehouseSalesConfirmed']) || isTruthy(item['warehouseManagerConfirmed']);
      cb.disabled = confirmedWH;
      if (confirmedWH) wrap.title = 'Confirmed by Sales/Manager \u2014 cost can no longer be re-sent from here';
      setSendUI(cb.checked);
      cb.addEventListener('change', async function () {
        var want = cb.checked;
        if (want) {
          var anyCost = false; ov.querySelectorAll('.whm-cell[data-cost],.whm-cell[data-costbare]').forEach(function (i) { if (String(i.value).trim() !== '') anyCost = true; });
          if (!anyCost) { cb.checked = false; window.alert('Enter at least one supplier cost before sending to Sales.'); return; }
        }
        cb.disabled = true;
        var ok = await postUpdate({ 'warehouseCostSaved': 'true', 'warehouseCostSent': want ? 'true' : 'false', 'warehouseCostDraft': want ? 'false' : 'true' });
        cb.disabled = confirmedWH;
        if (!ok) { setSendUI(!want); return; }
        setSendUI(want); flashSaved(want ? '\u2713 sent to Sales' : '\u2713 unsent'); onSaved();
      });
    }
    function initLpToggle() {
      var cb = ov.querySelector('[data-showlp]'); if (!cb) return;
      var root = ov.querySelector('.whm');
      var on = false; try { on = localStorage.getItem('whm_show_lp') === '1'; } catch (e0) {}
      cb.checked = on; root.classList.toggle('whm-showlp', on);
      cb.addEventListener('change', function () {
        root.classList.toggle('whm-showlp', cb.checked);
        try { localStorage.setItem('whm_show_lp', cb.checked ? '1' : '0'); } catch (e1) {}
      });
    }
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
      renderSupStrip();   // ✅ keep the per-supplier header totals live
      // ✅ REDESIGN: price inputs — auto-derived shows in cobalt, manual override gets the amber dot
      ov.querySelectorAll('tr[data-row][data-kind="lp"] .whm-cell[data-price]').forEach(function (pEl) {
        var v = String(pEl.value).trim(), a = pEl.getAttribute('data-auto') || '';
        var isAuto = v !== '' && v === a;
        pEl.classList.toggle('auto', isAuto);
        var pw = pEl.closest('.whm-pw'); if (pw) pw.classList.toggle('manual', v !== '' && !isAuto);
      });
    }
    function money(v) { return '$' + Math.round(v).toLocaleString(); }
    function supNameFor(w) { var el = ov.querySelector('.whm-sname[data-sname="' + w + '"]'); return (el && el.value.trim()) || ('Supplier ' + w); }

    // ✅ MOCKUP: supplier comparison strip. Per Lina (2026-08-27):
    //   totals count ONLY rows whose OnQuote box is checked (legacy rows have no
    //   OnQuote box and are therefore excluded); in LP-snapshot mode every LP row
    //   counts (the snapshot IS the quote). Suppliers with no cost anywhere are hidden.
    function renderSupStrip() {
      // ✅ REDESIGN: per-supplier totals now live in the column headers (no separate strip).
      //    Rule (per Lina 2026-08-27): only OnQuote-checked rows count; LP-snapshot rows all count.
      var totals = {}, hasAny = {};
      supCols.forEach(function (w) { totals[w] = 0; hasAny[w] = false; });
      ov.querySelectorAll('tr[data-row]').forEach(function (tr) {
        var g = String(tr.getAttribute('data-g') || '');
        var oq = tr.querySelector('.whm-oq');
        var counts = (oq && oq.checked) || g.indexOf('lp') === 0;
        tr.querySelectorAll('.whm-cell[data-cost]').forEach(function (inp) {
          var w2 = +inp.getAttribute('data-w'); if (!(w2 in totals)) return;
          var v = num(inp.value);
          if (String(inp.value).trim() !== '') hasAny[w2] = true;
          if (counts && v) totals[w2] += v;
        });
      });
      var min = null;
      supCols.forEach(function (w3) { if (hasAny[w3] && totals[w3] > 0 && (min === null || totals[w3] < min)) min = totals[w3]; });
      var nWith = supCols.filter(function (w4) { return hasAny[w4] && totals[w4] > 0; }).length;
      supCols.forEach(function (w5) {
        var th = ov.querySelector('th.whm-col[data-w="' + w5 + '"]'); if (!th) return;
        th.classList.toggle('empty', !hasAny[w5]);
        var tEl = th.querySelector('[data-tot]'), lEl = th.querySelector('[data-low]');
        if (tEl) tEl.textContent = hasAny[w5] ? money(totals[w5]) : '';
        if (lEl) lEl.textContent = (nWith > 1 && hasAny[w5] && totals[w5] === min && totals[w5] > 0) ? 'Lowest' : '';
      });
    }

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
        // Saved cost stays Sourcing-only (masked from Sales) until "Send cost to Sales" is
        // ticked, which clears the draft flag. A send/unsend request carries the draft flag
        // itself, so don't override it there. (Server invariant: Draft=true forces Sent=false.)
        if (!('warehouseCostDraft' in fields)) payload['warehouseCostDraft'] = 'true';
      } else {
        // Sales/Manager: only a real PRICE edit commits the quote and locks Sourcing.
        // Picking a supplier, editing the Note or common info must NOT lock Sourcing.
        var touchedPrice = Object.keys(fields).some(function (k) { return / Price$/.test(k); });
        if (touchedPrice) payload['warehousePriceSaved'] = 'true';
      }
      for (var k in fields) payload[k] = fields[k];
      // ✅ FIX (intentional clear): the server's /inquiries/update silently drops any field
      // sent as '' unless it's listed in __clearFields (a guard against autosave/checkbox
      // races accidentally wiping a saved value). manager_dashboard.html and
      // sales_dashboard_v2.html already send this signal; this modal never did, so clearing
      // a Price/Cost/Desc field here and hitting Save looked like it worked (no error) but the
      // old value silently stuck in the DB. Flag any field the user emptied that was
      // previously non-empty, exactly like those two dashboards do.
      var clears = [];
      for (var ck in fields) {
        if (String(fields[ck] == null ? '' : fields[ck]).trim() === '' && String(item[ck] == null ? '' : item[ck]).trim() !== '') {
          clears.push(ck);
        }
      }
      if (clears.length) payload.__clearFields = clears;
      try {
        var res = await fetch('/inquiries/update', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin', body: JSON.stringify(payload)
        });
        if (!res.ok) { var t = await res.text(); console.error('WH save failed:', t); flashSaved(''); return false; }
        // ✅ REDESIGN: any Sourcing cost save re-drafts the scope (server forces Sent=false) —
        //    mirror that on the in-modal "Send cost to Sales" box so it never shows stale "sent".
        if (role === 'sourcing' && !('warehouseCostDraft' in fields)) setSendUI(false);
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
      if (r) { sel = +r.value; set('Selected Supplier', String(sel)); applySel(); var autoKeys = applyAutoLp() || []; recalc(); autosave(['Selected Supplier'].concat(autoKeys)); return; }
      if (e.target.matches('[data-svc]')) {
        // ✅ SUBTYPE: service type single-select (mirrors the inquiry form)
        if (e.target.checked) ov.querySelectorAll('[data-svc]').forEach(function (pc) { if (pc !== e.target) pc.checked = false; });
        rebuildServiceTypes();
        // ✅ SUBTYPE: sub-option groups follow their parent; unchecking a parent clears its sub
        var changed = ['Service Types'];
        ov.querySelectorAll('[data-svcsubgrp]').forEach(function (grp) {
          var pOn = false;
          ov.querySelectorAll('[data-svc]').forEach(function (pc) { if (pc.getAttribute('data-svc') === grp.getAttribute('data-svcsubgrp') && pc.checked) pOn = true; });
          grp.style.display = pOn ? '' : 'none';
          if (!pOn) grp.querySelectorAll('[data-svcsub]').forEach(function (sc) {
            if (sc.checked) { sc.checked = false; rebuildServiceSubtypes(); if (changed.indexOf('Service Subtypes') < 0) changed.push('Service Subtypes'); }
          });
        });
        autosave(changed); return;
      }
      if (e.target.matches('[data-svcsub]')) {   // ✅ SUBTYPE: single-select (one sub-option drives the quote template)
        var LP_PAGES = { 'FCL-Pallet to Pallet': 'tl_fcl_p2p', 'FCL-Floor to Pallet': 'tl_fcl_f2p', 'FCL-Floor to Floor': 'tl_fcl_f2f', 'LTL-Pallet to Pallet': 'tl_ltl_p2p', 'FCL-Palletized IB + LTL out': 'db_fcl_pal', 'FCL-Floorload IB + LTL out': 'db_fcl_floor', 'FCL-Palletized IB + SP out': 'ff_fcl_pal', 'FCL-Floorload IB + SP out': 'ff_fcl_floor' };
        var prevChecked = [];
        ov.querySelectorAll('[data-svcsub]').forEach(function (cb) { if (cb !== e.target && cb.checked) prevChecked.push(cb); });
        if (e.target.checked) prevChecked.forEach(function (cb) { cb.checked = false; });
        var newSub = e.target.checked ? e.target.getAttribute('data-svcsub') : '';
        var newKey = newSub ? (LP_PAGES[newSub] || '') : '';
        var curKey = String(get('LP Page Key') || '');
        // ✅ LPQUOTE: quote table follows the sub-option — rebuild the snapshot when it changes
        if (newKey && curKey && newKey !== curKey) {
          if (!window.confirm('Switching the sub-option rebuilds the quote table from the new List Price template.\nCosts and prices entered for the current rows will be CLEARED. Continue?')) {
            e.target.checked = false;
            prevChecked.forEach(function (cb) { cb.checked = true; });
            return;
          }
          rebuildServiceSubtypes(); autosave(['Service Subtypes']);
          fetch('/api/lp-quote-init', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ q: quote, force: true, sub: newSub }) })
            .then(function (rr) { return rr.json().then(function (dd) { return { ok: rr.ok, d: dd }; }); })
            .then(function (x) {
              if (!x.ok) { window.alert((x.d && x.d.error) || 'Failed to rebuild the quote template.'); return; }
              for (var kk in item) { if (kk.indexOf('LP ') === 0) delete item[kk]; }
              item['Service Subtypes'] = newSub;
              item['LP Rows'] = JSON.stringify(x.d.rows);
              item['LP Page Key'] = x.d.pageKey || '';
              // (2026-09-03) no List-Price pre-fill on rebuild either
              if (document.body.contains(ov)) { ov.remove(); WHModal.open(opts); }
              onSaved();
            })
            .catch(function (e4) { console.error('lp rebuild error:', e4); });
          return;
        }
        // ✅ LPQUOTE: first-time sub selection on an inquiry with no snapshot — build it now and re-render
        if (newKey && !curKey) {
          rebuildServiceSubtypes(); autosave(['Service Subtypes']);
          fetch('/api/lp-quote-init', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ q: quote, sub: newSub }) })
            .then(function (rr) { return rr.json().then(function (dd) { return { ok: rr.ok, d: dd }; }); })
            .then(function (x) {
              if (!x.ok) { window.alert((x.d && x.d.error) || 'Failed to prepare the quote template.'); return; }
              item['Service Subtypes'] = newSub;
              item['LP Rows'] = JSON.stringify(x.d.rows);
              item['LP Page Key'] = x.d.pageKey || '';
              // (2026-09-03) no List-Price pre-fill on first sub-option selection either
              if (document.body.contains(ov)) { ov.remove(); WHModal.open(opts); }
              onSaved();
            })
            .catch(function (e5) { console.error('lp first-init error:', e5); });
          return;
        }
        rebuildServiceSubtypes(); autosave(['Service Subtypes']); return;
      }
      if (e.target.matches('[data-onquote]')) {
        var oqKey = e.target.getAttribute('data-onquote') + ' OnQuote';
        set(oqKey, e.target.checked ? 'true' : 'false');
        recalc();   // ✅ MOCKUP: strip totals follow the OnQuote rule live
        autosave([oqKey]);
        return;
      }
      var keys = trackField(e.target);
      if (e.target.hasAttribute('data-cost')) keys = keys.concat(applyAutoLp() || []);   // ✅ LPQUOTE: cost edit → live auto price
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
      // ✅ MOCKUP: click a comparison card = pick that supplier (reuses the existing
      //   radio change pipeline: set + applySel + recalc + autosave, zero new save logic)
      // ✅ REDESIGN: clicking anywhere on a supplier header picks it (Sales/Manager); the radio's
      //    existing change pipeline (set + applySel + auto price + recalc + autosave) does the work.
      var supTh = e.target.closest('th.whm-col');
      if (supTh && canEditPrice && !e.target.matches('input')) {
        var rw = ov.querySelector('input[name="whm-selwh"][value="' + supTh.getAttribute('data-w') + '"]');
        if (rw && !rw.checked && !rw.disabled) { rw.checked = true; rw.dispatchEvent(new Event('change', { bubbles: true })); }
        return;
      }
      // ✅ MOCKUP: group header toggles its rows (accordion)
      var grpTr = e.target.closest('tr.whm-grp');
      if (grpTr) {
        var gKey = grpTr.getAttribute('data-g');
        var closed = grpTr.classList.toggle('closed');
        ov.querySelectorAll('tr[data-row][data-g="' + gKey + '"]').forEach(function (r5) {
          r5.classList.toggle('whm-rowhide', closed);
        });
        return;
      }
      if (e.target.closest('[data-close]')) return close();
      if (e.target.closest('[data-save]')) {
        // commit everything in draft at once
        rebuildServiceTypes();
        if (Object.keys(draft).length === 0) { flashSaved('\u2713 nothing to save'); return; }
        postUpdate(draft).then(function (ok) { if (ok) { flashSaved('\u2713 saved'); onSaved(); } });
      }
    });
    document.addEventListener('keydown', function esckey(ev) { if (ev.key === 'Escape') { close(); document.removeEventListener('keydown', esckey); } });

    applySel();
    applyLockUI();
    initLpToggle();
    initSend();
    // seed data-auto for rows whose saved price already equals the auto value (so later
    // supplier/cost changes may still update them); prices differing from auto are treated
    // as manual and left alone. No draft/save is triggered here.
    (function seedAuto() {
      if (!lpMode) return;
      ov.querySelectorAll('tr[data-row][data-kind="lp"]').forEach(function (tr) {
        var pEl = tr.querySelector('.whm-cell[data-price]'); var cEl = tr.querySelector('.whm-cell[data-cost][data-w="' + sel + '"]');
        var n = cEl ? num(cEl.value) : 0; if (!pEl || !(n > 0)) return;
        var auto = lpAutoFrom(n); if (String(pEl.value).trim() === auto) pEl.setAttribute('data-auto', auto);
      });
    })();
    recalc();
  };
})();
