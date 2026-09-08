const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const fetch = require('node-fetch');
const nodemailer = require('nodemailer');
require('dotenv').config();
console.log("🚀 THIS IS UPGRADE SERVER - NEW DB ONLY");

const USE_MOCK = process.env.USE_MOCK === 'true';

// ✅ In-memory mock store (grows during local dev)
let mockInquiries = [
  {
    "Date": "2/12/2026",
    "Customer ID": "TEST001",
    "Requested By": "Adam Chen",
    "username": "Adam Chen",
    "Inquiry Type": "Drayage",
    "Commodity": "Shoes",
    "Packages Per Container": "30",
    "Hazmat": "true",
    "Reefer": "false",
    "Bonded": "true",
    "Container Size": "40HQ",
    "Dry Van Type": "",
    "Legal or Over Weight": "Legal",
    "Gross Weight": "12000",
    "Live or Drop": "Live",
    "From": "Houston Port",
    "To City": "Houston",
    "To State": "TX",
    "To ZIP": "77001",
    "To": "Houston, TX 77001",
    "QTY": "1",
    "Quotation #": "000001",
    "Base Rate": 1200
    // 故意不放 Price、GP、Adjusted Price，讓系統重新算
  },

];

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

app.use(cookieParser(process.env.COOKIE_SECRET));
// ✅ #1 auth hardening: trust ONLY signed cookies. cookie-parser puts verified signed
// cookies in req.signedCookies; forged/tampered unsigned cookies never appear there.
// Pointing req.cookies at the verified set makes every existing req.cookies.x read
// forgery-proof — role / salesGroup / username can no longer be edited client-side.
app.use((req, _res, next) => { req.cookies = req.signedCookies || {}; next(); });
// ✅ Offboarding guard: a verified cookie is only honored while its username still exists in
// `users`. Deleting or renaming a user in `users` (+ deploy) invalidates that person's existing
// cookie on their very next request — not just future logins. Runs per-request; `users` is
// initialized at module load (below) before any request is served, so referencing it here is safe.
app.use((req, _res, next) => {
  const uname = req.cookies && req.cookies.username;
  const user = users.find(u => u.username === uname);
  req.cookies = user ? { username: user.username, role: user.role, salesGroup: user.salesGroup || '' } : {};
  next();
});

// ==============================
// ✅ Auth helpers (FIX requireRole)
// ==============================

app.use(bodyParser.json());

// ---- Security: neutralize NoSQL operator-injection in request inputs ----
// Recursively removes any key starting with '$' or containing '.' from the parsed body/query.
// This defuses payloads like { "Quotation #": { "$ne": null } } before they ever reach a query.
// (None of this app's real field names contain '$' or '.', so nothing legitimate is dropped.)
function deepMongoSanitize(obj) {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) { obj.forEach(deepMongoSanitize); return; }
  for (const key of Object.keys(obj)) {
    if (key.startsWith('$') || key.includes('.')) { delete obj[key]; }
    else { deepMongoSanitize(obj[key]); }
  }
}
app.use((req, _res, next) => {
  deepMongoSanitize(req.body);
  try { deepMongoSanitize(req.query); } catch (_) { /* query may be read-only on some Express versions */ }
  next();
});

// (Removed unauthenticated /__debug/db endpoint — it exposed DB metadata to anyone.)


function requireRole(role) {
  return (req, res, next) => {
    const r = String(req.cookies?.role || '').toLowerCase();
    if (r !== String(role).toLowerCase()) {
      return res.status(403).send('Forbidden');
    }
    next();
  };
}

function requireAnyRole(roles) {
  return (req, res, next) => {
    const r = String(req.cookies?.role || '').toLowerCase();
    const ok = roles.map(x => String(x).toLowerCase()).includes(r);
    if (!ok) return res.status(403).send('Forbidden');
    next();
  };
}


// ✅ #2: guard the sensitive role pages BEFORE express.static can serve them from /public.
// Otherwise express.static (below) returns these HTML files directly and the role guards
// further down never run. The manager & sourcing dashboards, plus all three role-home
// landing pages, are guarded here. The sales dashboard (sales_dashboard_v2.html) is
// intentionally left to the existing SPA fallback at the bottom of this file — it's served
// to every role as the default shell; its data is role-gated server-side via signed cookies.
app.get('/manager_dashboard.html', requireRole('manager'), (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'manager_dashboard.html')));
app.get('/sourcing_dashboard.html', requireRole('sourcing'), (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'sourcing_dashboard.html')));

// ✅ #2b: same guard treatment for the three role-home landing pages reached right after
// /login. sales_home.html is shared by 'sales' and 'ops_view' (matches the /login redirect
// logic above, which sends both roles there).
app.get('/manager_home.html', requireRole('manager'), (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'manager_home.html')));
app.get('/sourcing_home.html', requireRole('sourcing'), (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'sourcing_home.html')));
app.get('/sales_home.html', requireAnyRole(['sales', 'ops_view']), (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'sales_home.html')));

app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res, filePath) => {
    // ✅ Force browser to always check for latest version
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

const MONGO_URI =
  process.env.MONGO_URI_NEW ||
  process.env.MONGODB_URI ||
  process.env.MONGO_URI;

console.log('[BOOT] USE_MOCK=', USE_MOCK);
// ✅ MEMWATCH: never log credentials — print host portion of the URI only
console.log('[BOOT] MONGO_URI host =', String(MONGO_URI || '').split('@')[1] ? String(MONGO_URI).split('@')[1].split('/')[0] : '(not set)');

// ✅ MEMWATCH: memory watermark every 60s — diagnose OOM restarts (gradual climb vs sudden spike)
setInterval(() => {
  const m = process.memoryUsage();
  console.log('[MEM] rss=' + Math.round(m.rss / 1048576) + 'MB heapUsed=' + Math.round(m.heapUsed / 1048576) + 'MB');
}, 60000);

let conn = null;
if (!USE_MOCK && MONGO_URI) {
  conn = mongoose.createConnection(MONGO_URI);
  conn.on('connected', () => console.log('✅ MongoDB connected (NEW ONLY)'));
  conn.on('error', (err) => console.error('❌ MongoDB error:', err));
} else {
  console.log('⚠️ MongoDB skipped (USE_MOCK or missing MONGO_URI)');
}

const inquirySchema = new mongoose.Schema({}, { strict: false, optimisticConcurrency: true });
const Inquiry = conn ? conn.model('Inquiry', inquirySchema, 'inquiries') : null;
/**
 * Passwords: made intentionally harder to guess.
 */

// // ==============================
// ✅ USERS (NEW SYSTEM - SINGLE DATABASE)
// ==============================


const users = [

  // ==============================
  // 🟣 General Manager
  // ==============================
  {
    username: 'Lina Lee',
    passwordHash: 'scrypt$e1dfac5478a6ccda78a8364f0ac4337a$726366cfd5e10bfe4b850f2b984b1d6f676ffee440de28a00caa996c928e02aeb67ae3834dd86e0d7f8fa50ba85f2fb4fe4b21af8257d60130c3dc0397efe292',
    role: 'manager'
  },

  // ==============================
  // 🔵 TEAM3 (Adam Team)
  // ==============================
  {
    username: 'Adam Chen',
    passwordHash: 'scrypt$31bdcaa8e2d48f4bd847bae02c0b9b00$84b60b7a0129684d1106ba748992e4ce9c27ced9f1df31b16ffc9fa9980d16350c43c1a1bca0225936b71caf4c5c604681d81364a5c1b601b17a523eed15988d',
    role: 'sales',
    salesGroup: 'TEAM3'
  },
  {
    username: 'OPM TEAM3',
    passwordHash: 'scrypt$ece19be0dc96ae2a83e61467dffd7194$edc21d2ff572f001072e20acb2df2a59c158cca102b2998d904f8368b22384568b0feba6a00cfbb0c618f2608fd45efb8405e006efb6e137129ff8e2ba0e6e49',
    role: 'sales',
    salesGroup: 'TEAM3'
  },
  {
    username: 'OPS TEAM3',
    passwordHash: 'scrypt$8f2048bfc92faa48e3d61662f4a7be5c$1eadb01ba21808a22e899dc2def8e93a619e5c9726ceb9bf1df717d4ccccfd7e12fbebee01a9385ef5e1474054e6b573b887f538005aaf440b0c0296f7b818c1',
    role: 'ops_view',
    salesGroup: 'TEAM3'
  },

  // ==============================
  // 🟢 TEAM1 (Niurka Team)
  // ==============================
  {
    username: 'Niurka Guzman',
    passwordHash: 'scrypt$5bd0a1856c907c48cc98de078b134da3$55c3ccea83170e0964ddd6d36b4e6f497288f8c1629d02f5edf2d09da94b25a358116047665cf3c792d447b516f075f35d0abbe46834d8fbf2515e243660e5f4',
    role: 'sales',
    salesGroup: 'TEAM1'
  },
  {
    username: 'OPM TEAM1',
    passwordHash: 'scrypt$febb61bc09259ef27f6f0c4ca7eccdba$cef9223d9604ed45ec866f0f4885a92b4b58b52c9713348c20b7b5c7d9726ce1ae928270fe0fd3c73bf9b24445d8371d06fb9e879dcc877526ed9a14c0fe09bd',
    role: 'sales',
    salesGroup: 'TEAM1'
  },
  {
    username: 'OPS TEAM1',
    passwordHash: 'scrypt$8e3f867f8948fe11cb780b9bd8369281$ba6a5c7fa4aa289ab775e299958f19c6f4f06726049fd19d67053920408ae138a2495283b2ffd85e7d3c374dd295babbf425ffc374944cb60a44ecfd8e5a49be',
    role: 'ops_view',
    salesGroup: 'TEAM1'
  },

  // ==============================
  // 🟡 TEAM2 (Ellen Team)
  // ==============================
  {
    username: 'Ellen Lin',
    passwordHash: 'scrypt$3bcead88da9995680221333cb5b18766$12b9ba4d16e115a3a8a3518e448ec9d9e06c4c9921c8447ffef354f93a985dc935028e669a46978b88252edc34913a136d90d92cb6795cb1353abecfd9414453',
    role: 'sales',
    salesGroup: 'TEAM2'
  },
  {
    username: 'OPM TEAM2',
    passwordHash: 'scrypt$e588caf8cfab177d31beabd376bc48d8$b9dd86bd5f02100d74bb39a757087e2028a909dea5621f8bb3509f2e500194c4879b69e5c0bea68bc7601b36adc255ed228740672bf3dcc3c4629fe3f8b53e46',
    role: 'sales',
    salesGroup: 'TEAM2'
  },
  {
    username: 'OPS TEAM2',
    passwordHash: 'scrypt$37190724dd295e3aff928762ce95596d$412b81ffcedf889f8c565ddcbbdb30c1e77871da73244647673781e90f81a0c08d7a93b6a1feaca870995a16444b2b58aceb60a6ab8474987868f97283f3df0d',
    role: 'ops_view',
    salesGroup: 'TEAM2'
  },

  // ==============================
  // 🟤 Cross-team (TEAM2 + TEAM3)
  // ==============================
  {
    username: 'Aurora Peng',
    passwordHash: 'scrypt$9eec869a172a5c3e3002f1712f0c6502$701bc099c9436ea5ebedfd348259a6ee584366b4edfeca2a49e72ecc899bfa135a65d0e59e78f1f0b8a5ca171a7e6cfdab53f87aaa11d0dc1f774ec85b48ea90',
    role: 'sales',
    salesGroup: 'TEAM2,TEAM3'
  },

  // ==============================
  // 🟠 Sourcing
  // ==============================
  {
    username: 'Matthew Maultsby',
    passwordHash: 'scrypt$7ffd457652074e2600cb81fece59f784$1b33120af6ff74c13c625574e660e6f3e102bb3c0ebc0d62463c0fb2a41557c7cf6ed85e522a704f9ddf898a685a3082c286cc64d9e9aa81c7fb1871891c73c8',
    role: 'sourcing'
  }

];

// ✅ EMAIL: per-user sender email for quotation headers (additive; users array untouched).
// Unmapped users (OPM/OPS etc.) show NO email line on quotations — they don't normally send quotes.
// (If a company-default email is ever wanted here, use salesus@totalsolutionus.com per Lina.)
const USER_EMAILS = {
  'Lina Lee': 'linal@totalsolutionus.com',
  'Adam Chen': 'salescn@totalsolutionus.com',
  'Ellen Lin': 'sqcn@totalsolutionus.com',
  'Niurka Guzman': 'salesus@totalsolutionus.com',
  'Aurora Peng': 'sa@totalsolutionus.com'
};
// ✅ Multi-group support: salesGroup may be a comma list (e.g. 'TEAM2,TEAM3' for cross-team
// users like Aurora Peng). Single-group users parse to a one-element list — their behavior
// through every filter below is IDENTICAL to before.
function groupList(sg) {
  return String(sg || '').split(',').map(s => s.trim()).filter(Boolean);
}

// Shared by every quotation mutation. Never trust a client-supplied team.
function maskInquiryDocs(items, role) {
  if (role !== 'sales' && role !== 'ops_view') return items;
      const truckCostFields = [
        'Base Rate', 'Chassis', 'Pre-Pull', 'Yard Storage', 'Driver Waiting',
        'Over Weight', 'Chassis Split', 'Toll', 'Reefer Fee', 'Bond Fee', 'Drop Fee', 'Carrier',
        'Vendor Note'
      ];
      const truckPriceFields = [
        'Price', 'GP', 'Adjusted Price', 'Adjusted GP',
        'Chassis Price', 'Pre-Pull Price', 'Yard Storage Price', 'Driver Waiting Price',
        'Over Weight Price', 'Chassis Split Price', 'Toll Price', 'Reefer Fee Price',
        'Bond Fee Price', 'Drop Fee Price'
      ];
      const whCostFields = [
        'Order Processing', 'Inbound', 'Sorting', 'Palletizing', 'Pallet Fee',
        'Storage', 'Outbound', 'WH Vendor Note'
      ];
      const whPriceFields = [
        'Order Processing Price', 'Inbound Price', 'Sorting Price',
        'Palletizing Price', 'Pallet Fee Price', 'Storage Price', 'Outbound Price',
        'Vendor'
      ];
      // ▼ WH redesign: also mask new bucket costs, the 5 supplier costs, and the cost total
      WH_NEW_BUCKETS.forEach(b => { whCostFields.push(b[1]); whPriceFields.push(b[1] + ' Price'); });
      WH_TEMPLATE_BUCKETS.forEach(b => { for (let s = 1; s <= WH_SUPPLIER_COUNT; s++) whCostFields.push(b + ' Cost S' + s); });
      whCostFields.push('WH Cost Total');
      whPriceFields.push('Label Price', 'Cross Dock Price');

      return items.map(it => {
        const doc = { ...it };

        // ✅ Only mask when a NEW draft flag is explicitly set
        // truckingCostDraft='true' means Sourcing just saved but hasn't sent yet
        // Old data has no draft flag → always shows (backward compatible)
        if (String(doc['truckingCostDraft'] || '').toLowerCase().trim() === 'true') {
          truckCostFields.forEach(f => { doc[f] = ''; });
          truckPriceFields.forEach(f => { doc[f] = ''; });
        }
        if (String(doc['warehouseCostDraft'] || '').toLowerCase().trim() === 'true') {
          whCostFields.forEach(f => { doc[f] = ''; });
          whPriceFields.forEach(f => { doc[f] = ''; });
        }
        // ✅ LPQUOTE: dynamic List-Price row costs/prices obey the same draft mask
        if (String(doc['warehouseCostDraft'] || '').toLowerCase().trim() === 'true') {
          const lpN2 = lpRowCount(doc);
          for (let i = 1; i <= lpN2; i++) {
            doc['LP ' + i + ' Cost'] = '';
            doc['LP ' + i + ' Price'] = '';
            for (let s2 = 1; s2 <= WH_SUPPLIER_COUNT; s2++) doc['LP ' + i + ' Cost S' + s2] = '';
          }
        }
        return doc;
      });
}
function hasConfirmedQuotePrice(doc, scope) {
  const truck = (isTruthy(doc.truckingSalesConfirmed) || isTruthy(doc.truckingManagerConfirmed)) && !isTruthy(doc.truckingCostDraft) && String(doc['Adjusted Price'] ?? '').trim() !== '';
  const whPrice = String(doc['WH Price Total'] ?? '').trim() !== '' || WH_ALL_BUCKETS.some(b => String(doc[b + ' Price'] ?? '').trim() !== '') || Object.keys(doc).some(k => /^LP \d+ Price$/.test(k) && String(doc[k] ?? '').trim() !== '');
  const wh = (isTruthy(doc.warehouseSalesConfirmed) || isTruthy(doc.warehouseManagerConfirmed)) && !isTruthy(doc.warehouseCostDraft) && whPrice;
  return scope === 'TRUCK' ? truck : scope === 'WH' ? wh : truck || wh;
}
function canAccessInquiry(req, doc) {
  const role = req.cookies?.role;
  if (role === 'manager') return true;
  if (role === 'sourcing') return isTruthy(doc['Submitted To Sourcing']);
  if (role === 'sales' || role === 'ops_view') {
    return groupList(req.cookies.salesGroup).includes(String(doc.salesGroup || '').trim());
  }
  return false;
}
function requireInquiryAccess(req, res, doc) {
  if (canAccessInquiry(req, doc)) return true;
  res.status(403).json({ success: false, error: 'This quotation is outside your permitted scope.', message: 'This quotation is outside your permitted scope.' });
  return false;
}
function dbReady(res) {
  if (conn && conn.readyState === 1 && Inquiry) return true;
  res.status(503).json({ success: false, message: 'Database temporarily unavailable. Your existing data has not been cleared.' });
  return false;
}
function revisionFilter(doc) {
  return { _id: doc._id, __v: doc.__v == null ? { $exists: false } : doc.__v };
}
function gfBusy(doc) {
  return ['pending', 'uncertain'].includes(String(doc['GF Push State'] || ''));
}
// Carrier alternatives share one durable push key; lettered routes remain separate.
function gfRouteKey(q) {
  const m = String(q || '').trim().match(/^(\d{1,6})([A-Z])?(?:-([A-Z]|\d+))?$/i);
  if (!m) return '';
  return m[1].padStart(6, '0') + (m[2] || '').toUpperCase();
}
function gfRouteFilter(key) {
  return { 'Quotation #': { $regex: '^' + key + '(?:-(?:[A-Z]|[0-9]+))?$', $options: 'i' } };
}
function gfLedger() { return conn.collection('gf_pushes'); }
async function gfRouteState(key) {
  const ledger = await gfLedger().findOne({ _id: key });
  if (ledger && ledger.state !== 'ready') return ledger;
  const siblings = await Inquiry.find(gfRouteFilter(key)).lean();
  const sent = siblings.find(d => isTruthy(d['Pushed To GF']));
  const busy = siblings.find(gfBusy);
  if (sent || busy) {
    const d = sent || busy;
    const historical = { _id: key, state: sent ? 'succeeded' : d['GF Push State'], startedAt: d['GF Push Started At'] || '', sourceQuotation: d['Quotation #'], token: d['GF Push Token'] || 'legacy' };
    try {
      if (ledger) { const { _id, ...fields } = historical; await gfLedger().updateOne({ _id: key, state: 'ready' }, { $set: fields }); }
      else await gfLedger().insertOne(historical);
    } catch (err) { if (err.code !== 11000) throw err; }
    return await gfLedger().findOne({ _id: key });
  }
  return ledger;
}
async function overlayGfRoutes(docs) {
  if (!docs.length) return docs;
  const keys = [...new Set(docs.map(d => gfRouteKey(d['Quotation #'])).filter(Boolean))];
  if (!keys.length) return docs;
  const ledger = await gfLedger().find({ _id: { $in: keys } }).toArray();
  const states = new Map(ledger.map(d => [d._id, d]));
  // Include alternatives outside a date/row limit when deriving legacy status.
  const legacyKeys = keys.filter(key => !states.has(key) || states.get(key).state === 'ready');
  const legacy = legacyKeys.length ? await Inquiry.find({ $or: legacyKeys.map(gfRouteFilter), $and: [{ $or: [
    { 'Pushed To GF': { $in: ['true', true] } }, { 'GF Push State': { $in: ['pending', 'uncertain'] } }
  ] }] }, { 'Quotation #': 1, 'Pushed To GF': 1, 'GF Push State': 1, 'GF Push Started At': 1 }).lean() : [];
  for (const d of legacy) {
    const key = gfRouteKey(d['Quotation #']);
    if (!states.has(key) || states.get(key).state === 'ready') states.set(key, { state: isTruthy(d['Pushed To GF']) ? 'succeeded' : d['GF Push State'], startedAt: d['GF Push Started At'] });
    else if (isTruthy(d['Pushed To GF']) && !ledger.some(l => l._id === key && l.state !== 'ready')) states.set(key, { state: 'succeeded' });
  }
  return docs.map(d => {
    const state = states.get(gfRouteKey(d['Quotation #']));
    if (!state || state.state === 'ready') return d;
    return { ...d, 'Pushed To GF': state.state === 'succeeded' ? 'true' : 'false', 'GF Push State': state.state, 'GF Push Started At': state.startedAt || '', 'GF Push Source Quotation': state.sourceQuotation || '' };
  });
}
async function syncGfRoute(key, fields) {
  await Inquiry.updateMany(gfRouteFilter(key), { $set: fields, $inc: { __v: 1 } });
}
function conflict(res, message) {
  return res.status(409).json({ success: false, message: message || 'This quotation changed while you were editing. Reload it and try again.' });
}

// Authenticate sockets with the same signed username and current account definition.
io.use((socket, next) => {
  cookieParser(process.env.COOKIE_SECRET)(socket.request, {}, () => {
    const username = socket.request.signedCookies?.username;
    const user = users.find(u => u.username === username);
    if (!user) return next(new Error('Not authenticated'));
    socket.data = socket.data || {};
    socket.data.username = user.username;
    next();
  });
});
io.on('connection', socket => {
  const user = users.find(u => u.username === socket.data.username);
  if (!user) return socket.disconnect(true);
  if (user.role === 'manager') socket.join('role:manager');
  if (user.role === 'sourcing') socket.join('role:sourcing');
  if (user.role === 'sales' || user.role === 'ops_view') {
    groupList(user.salesGroup).forEach(g => socket.join('team:' + g));
  }
});
const inquiryReads = new Map();
let inquiryReadEpoch = 0;
function readInquiryList(filter) {
  const key = inquiryReadEpoch + ':' + JSON.stringify(filter);
  if (inquiryReads.has(key)) return inquiryReads.get(key);
  const promise = Promise.resolve(Inquiry.find(filter).lean()).then(overlayGfRoutes).finally(() => inquiryReads.delete(key));
  inquiryReads.set(key, promise);
  return promise;
}
function broadcastInquiry(quotationId, knownDoc) {
  inquiryReadEpoch++;
  const send = doc => {
    let target = io.to('role:manager');
    if (doc) {
      if (isTruthy(doc['Submitted To Sourcing'])) target = target.to('role:sourcing');
      groupList(doc.salesGroup).forEach(g => { target = target.to('team:' + g); });
    }
    target.emit('inquiryUpdated', { quotationId });
  };
  if (knownDoc) return send(knownDoc);
  if (!Inquiry || !conn || conn.readyState !== 1) return send(null);
  Inquiry.findOne({ 'Quotation #': quotationId }, { salesGroup: 1, 'Submitted To Sourcing': 1 }).lean()
    .then(send).catch(err => console.warn('[notification]', err.message));
}

function emailFor(username, salesGroup) {
  return USER_EMAILS[String(username || '')] || '';
}


function simulateQuoteFull(baseRate, type) {
  baseRate = parseFloat(baseRate) || 0;
  const result = {
    baseRate,
    type,
    section: '',
    rawAdd: 0,
    adjustedAdd: 0,
    initialPrice: 0,
    finalPrice: 0,
    beautified: false,
    gp: 0,
    gpAdjusted: false,
    comments: [],
  };

  const config = {
    drayage: {
      minGP: 0.10, maxGP: 0.25, ranges: {
        '50-200': { add: 50, minPrice: 250 },
        '200-500': { add: 80, minPrice: 298 },
        '500-1500': { divide: 0.84, forceAddIfLt: 100 },
        '1500-2500': { slope: 0.2, baseAdd: 300 },
        '2500-5000': { slope: 0.2, baseAdd: 500 },
        '5000-INF': { slope: 0.25, baseAdd: 1000 },
      }
    },
    dryvan: {
      minGP: 0.18, maxGP: 0.30, ranges: {
        '50-200': { add: 80, minPrice: 250 },
        '200-500': { add: 100, minPrice: 298 },
        '500-1500': { divide: 0.80, forceAddIfLt: 100 },
        '1500-2500': { slope: 0.2, baseAdd: 400 },
        '2500-5000': { slope: 0.24, baseAdd: 600 },
        '5000-INF': { slope: 0.325, baseAdd: 1200 },
      }
    },
    flatbed: {
      minGP: 0.18, maxGP: 0.30, ranges: {
        '50-200': { add: 80, minPrice: 250 },
        '200-500': { add: 100, minPrice: 298 },
        '500-1500': { divide: 0.80, forceAddIfLt: 100 },
        '1500-2500': { slope: 0.2, baseAdd: 400 },
        '2500-5000': { slope: 0.24, baseAdd: 600 },
        '5000-INF': { slope: 0.325, baseAdd: 1200 },
      }
    }
  };

  const normalizedType = (type || '').toLowerCase().replace(/\s+/g, '');
  const { minGP, maxGP, ranges } = config[normalizedType] || config.drayage;

  function beautify(price) {
    const floorPrice = Math.ceil(baseRate / (1 - minGP));

    // Very small prices: just round to nearest 5
    if (price < 300) return Math.max(Math.ceil(price), floorPrice);

    // ===== Rule 1: Near-thousand avoidance =====
    // Only when price is in the "900s" of its thousand bracket (e.g., 1912, 2943)
    // Pull down to x,895 to avoid looking like it's crossing the next thousand
    const remainder = price % 1000;

    if (price >= 1000 && remainder > 900) {
      const target895 = Math.floor(price / 1000) * 1000 + 895;
      if (target895 >= floorPrice) {
        result.beautified = true;
        result.comments.push(`接近 $${Math.floor(price / 1000) * 1000 + 1000}，调整 → $${target895}`);
        return target895;
      }
    }

    // ===== Rule 2: Tier-based ending beautification =====
    let endings;
    if (price < 1500) {
      // Small orders: charm pricing — x95, x85, x50, x45, x35, x25, x75
      endings = [95, 85, 75, 50, 45, 35, 25];
    } else if (price <= 3000) {
      // Medium orders: professional — x50, x80, x00
      endings = [50, 80, 0];
    } else {
      // Large orders: corporate — x00, x50
      endings = [0, 50];
    }

    // Generate candidates from nearby hundreds, pick the closest
    let best = null;
    let bestDist = Infinity;

    for (let off = -2; off <= 2; off++) {
      const baseH = (Math.floor(price / 100) + off) * 100;
      for (const e of endings) {
        const c = baseH + e;
        if (c < floorPrice || c <= 0) continue;
        const d = Math.abs(c - price);
        if (d < bestDist) { bestDist = d; best = c; }
      }
    }

    // Only beautify if adjustment is reasonable (within 5% or $50)
    const maxAdj = Math.max(price * 0.05, 50);
    if (best !== null && bestDist <= maxAdj && best !== Math.ceil(price)) {
      result.beautified = true;
      result.comments.push(`美化报价：${Math.ceil(price)} → ${best}`);
      return best;
    }

    return price;
  }

  function enforceMinGP(price) {
    const gp = (price - baseRate) / price;
    if (gp < minGP) {
      const adjusted = Math.ceil(baseRate / (1 - minGP));
      result.gpAdjusted = true;
      result.comments.push(`GP ${Math.round(gp * 100)}% < ${minGP * 100}%，提升报价 → ${adjusted}`);
      return adjusted;
    }
    return price;
  }


  function enforceMaxGP(price) {
    const gp = (price - baseRate) / price;
    if (gp > maxGP) {
      const adjusted = Math.ceil(baseRate / (1 - maxGP));
      result.gpAdjusted = true;
      result.comments.push(`GP ${Math.round(gp * 100)}% > ${maxGP * 100}%，压缩报价 → ${adjusted}`);
      return adjusted;
    }
    return price;
  }

  let price = baseRate;
  for (let key in ranges) {
    const [minStr, maxStr] = key.split('-');
    const min = parseFloat(minStr);
    const max = maxStr === 'INF' ? Infinity : parseFloat(maxStr);
    const logic = ranges[key];

    if (baseRate >= min && baseRate < max) {
      result.section = `$${min}–$${maxStr}`;
      if (logic.add !== undefined) {
        price = baseRate + logic.add;
        result.rawAdd = logic.add;
        result.comments.push(`固定加值 $${logic.add}`);
        if (price < logic.minPrice) {
          price = logic.minPrice;
          result.comments.push(`低于最低报价，调整为 $${price}`);
        }
      } else if (logic.divide !== undefined) {
        price = baseRate / logic.divide;
        result.comments.push(`除以 ${logic.divide} 计算报价`);
        if ((price - baseRate) < logic.forceAddIfLt && price > 1000) {
          price += logic.forceAddIfLt;
          result.comments.push(`加值不足 $${logic.forceAddIfLt}，强制加价`);
        }
      } else if (logic.slope !== undefined) {
        const add = logic.baseAdd + (baseRate - min) * logic.slope;
        result.rawAdd = Math.round(add);
        price = baseRate + add;
        result.comments.push(`线性加价 → $${add.toFixed(2)}`);
        if (type === 'drayage') {
          price = enforceMinGP(price);
        } else if (type === 'dryvan' || type === 'flatbed') {
          price = enforceMinGP(price);
          price = enforceMaxGP(price);
        }
      }
      break;
    }
  }

  result.initialPrice = Math.ceil(price);
  let beautified = beautify(result.initialPrice);
  let finalGP = (beautified - baseRate) / beautified;

  // Safety net: if beautification dropped GP below minimum, cancel it
  if (finalGP < minGP) {
    result.comments.push(`美化被取消：GP ${Math.round(finalGP * 100)}% < ${minGP * 100}%`);
    beautified = result.initialPrice;
  }

  result.finalPrice = Math.ceil(beautified);
  result.gp = parseFloat(((result.finalPrice - baseRate) / result.finalPrice).toFixed(4));

  return result;
}

/* =========================
   V2 Helpers (minimal add)
   ========================= */

function toNumber(val) {
  if (val === null || val === undefined) return NaN;
  const n = parseFloat(String(val).toString().replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : NaN;
}

function isTruthy(val) {
  if (val === true) return true;
  const s = String(val || '').toLowerCase().trim();
  return s === 'true' || s === '1' || s === 'yes' || s === 'y';
}

function setIfEmpty(doc, key, value) {
  const cur = doc[key];
  const empty = cur === undefined || cur === null || String(cur).trim() === '';
  if (empty) {
    // ✅ FIX: dual write — .set() for persistence + direct assign for readback
    doc[key] = value;
    if (typeof doc.set === 'function' && typeof doc.markModified === 'function') {
      doc.set(key, value);
    }
  }
}


function applyTruckingUnits(doc) {
  setIfEmpty(doc, 'Base Rate Unit', 'Container');

  setIfEmpty(doc, 'Chassis Unit', 'Day');
  setIfEmpty(doc, 'Pre-Pull Unit', 'Container');
  setIfEmpty(doc, 'Yard Storage Unit', 'Day');
  setIfEmpty(doc, 'Driver Waiting Unit', 'Hour');
  setIfEmpty(doc, 'Chassis Split Unit', 'Split');
  setIfEmpty(doc, 'Over Weight Unit', 'Container');

  setIfEmpty(doc, 'Toll Unit', 'Container');
  setIfEmpty(doc, 'Reefer Fee Unit', 'Container');
  setIfEmpty(doc, 'Bond Fee Unit', 'Container');
  setIfEmpty(doc, 'Drop Fee Unit', 'Container');   // ✅ Drop Fee (2026-08-27)
}

// ==================== Warehouse redesign (additive, backward-compatible) ====================
// Each template bucket gets: <name> (mirrored selected-supplier cost) / <name> Price /
// <name> Unit / <name> Qty / <name> Cost S1..S5 ; storage buckets also get <name> Period.
// [group, name, default unit, isStorage]
const WH_NEW_BUCKETS = [
  ['Inbound', 'Inbound Floor Load', 'Carton', false],
  ['Inbound', 'Inbound Palletized', 'Pallet', false],
  ['Inbound', 'OW Handling Fee', 'Container', false],
  ['Inbound', 'Inbound Others', '', false],
  ['Outbound', 'Outbound Order Processing', 'BOL', false],
  ['Outbound', 'Order Picking', 'Pallet', false],
  ['Outbound', 'Staging Palletizing', 'Pallet', false],
  ['Outbound', 'Outbound Pallet Fee', 'Pallet', false],
  ['Outbound', 'Handling Out', 'Container', false],
  ['Outbound', 'Floor Load Loading', 'Container', false],
  ['Outbound', 'Fulfillment', 'Unit', false],
  ['Storage', 'Storage Pallet Stackable', 'Pallet', true],
  ['Storage', 'Storage Pallet NonStackable', 'Pallet', true],
  ['Storage', 'Storage Crate', 'Crate', true],
  ['Storage', 'Storage Bundle', 'Bundle', true],
  ['Storage', 'Storage Sack', 'Sack', true],
  ['Storage', 'Storage Container', 'Container', true],
  ['Storage', 'Storage CBF', 'CBF', true],
  ['Storage', 'Storage CBM', 'CBM', true],
  ['Other', 'Depalletizing', 'Pallet', false],
  ['Other', 'Repacking', 'Each', false],
  ['Other', 'Block Brace', 'Container', false],
  ['Other', 'Pallet Crate Repair', 'Each', false],
  ['Other', 'Rush Order', 'Order', false],
  ['Other', 'Rework Other', 'Each', false],
  ['Other', 'Others', '', false],
];
// existing buckets reused as multi-supplier template buckets (keep their existing cost/price/unit)
const WH_REUSED_BUCKETS = ['Order Processing', 'Sorting', 'Palletizing', 'Label'];
// every bucket that uses 5 supplier costs + a mirrored selected cost
const WH_TEMPLATE_BUCKETS = WH_NEW_BUCKETS.map(b => b[1]).concat(WH_REUSED_BUCKETS);
// legacy single-cost buckets kept for backward-compat (shown as "(existing)" in the modal)
const WH_LEGACY_BUCKETS = ['Inbound', 'Outbound', 'Pallet Fee', 'Storage', 'Cross Dock'];
// all bare cost field names that contribute to WH totals (template + legacy)
const WH_ALL_BUCKETS = WH_TEMPLATE_BUCKETS.concat(WH_LEGACY_BUCKETS);

// ✅ LPQUOTE: dynamic List-Price quote rows. The row set is snapshotted per inquiry into the
// 'LP Rows' field (JSON) the first time the WH modal opens; costs/prices live in
// 'LP <i> Cost S1..S5' / 'LP <i> Cost' (selected) / 'LP <i> Price' / 'LP <i> Qty' / 'LP <i> Desc'.
const LP_SUBTYPE_PAGES = {
  'FCL-Pallet to Pallet': 'tl_fcl_p2p',
  'FCL-Floor to Pallet': 'tl_fcl_f2p',
  'FCL-Floor to Floor': 'tl_fcl_f2f',
  'LTL-Pallet to Pallet': 'tl_ltl_p2p',
  'FCL-Palletized IB + LTL out': 'db_fcl_pal',
  'FCL-Floorload IB + LTL out': 'db_fcl_floor',
  'FCL-Palletized IB + SP out': 'ff_fcl_pal',
  'FCL-Floorload IB + SP out': 'ff_fcl_floor'
};
function lpRowCount(doc) {
  try { const a = JSON.parse(String(doc['LP Rows'] || '[]')); return Array.isArray(a) ? a.length : 0; }
  catch (e) { return 0; }
}
const WH_SUPPLIER_COUNT = 5;

// ═══════════════════════════════ ✅ DELGROUP fields ═══════════════════════════════
// Field lists used ONLY by /api/delete-quotation-group to decide whether a line is
// "empty" (no cost, no price entered). Deliberately duplicated (not imported) from
// /inquiries/update's local TRUCK_COST_FIELDS/TRUCK_PRICE_FIELDS so that route's
// scope is never touched. WH side reuses the existing WH_ALL_BUCKETS/WH_TEMPLATE_BUCKETS
// module-level constants above so the two stay in sync automatically.
// ✅ DELGROUP rule (per Lina, 2026-09-04): deletability is decided by Sourcing's Cost only.
// Price fields are ignored on purpose — several Price fields (Chassis/Yard Storage/Driver
// Waiting/Pre-Pull Price) get a system default auto-filled the moment an inquiry is created,
// before Sourcing ever touches it, so checking Price would block deletion of untouched/junk
// submissions. Kept as a separate constant (not reusing DELQ_TRUCK_FIELDS name) so any other
// caller expecting the old cost+price field list is unaffected.
const DELQ_TRUCK_COST_FIELDS = [
  'Base Rate', 'Chassis', 'Pre-Pull', 'Yard Storage', 'Driver Waiting',
  'Over Weight', 'Chassis Split', 'Toll', 'Reefer Fee', 'Bond Fee', 'Drop Fee'
];

function delqEmptyVal(v) {
  return v === undefined || v === null || String(v).trim() === '';
}

function delqTruckLineEmpty(doc) {
  return DELQ_TRUCK_COST_FIELDS.every(f => delqEmptyVal(doc[f]));
}

function delqWhLineEmpty(doc) {
  // ✅ DELGROUP rule (per Lina, 2026-09-04): Cost only, Price ignored — see comment above
  // DELQ_TRUCK_COST_FIELDS for why. Same rule applied consistently to the WH side.
  for (const b of WH_ALL_BUCKETS) {
    if (!delqEmptyVal(doc[b])) return false;
  }
  for (const b of WH_TEMPLATE_BUCKETS) {
    for (let s = 1; s <= WH_SUPPLIER_COUNT; s++) {
      if (!delqEmptyVal(doc[b + ' Cost S' + s])) return false;
    }
  }
  // ✅ LPQUOTE: dynamic List-Price rows — Cost only, same rule
  try {
    const lpArr = JSON.parse(String(doc['LP Rows'] || '[]'));
    if (Array.isArray(lpArr)) {
      for (const r of lpArr) {
        if (!delqEmptyVal(doc['LP ' + r.i + ' Cost'])) return false;
        for (let s = 1; s <= WH_SUPPLIER_COUNT; s++) {
          if (!delqEmptyVal(doc['LP ' + r.i + ' Cost S' + s])) return false;
        }
      }
    }
  } catch (eLP) { /* malformed LP Rows treated as no LP data */ }
  return true;
}

// A line (main or sub) is deletable only when it has NO cost/price anywhere (truck or WH side —
// a doc could in theory carry either) AND is not already locked by the existing cost-sent/confirmed rule.
function delqLineEmpty(doc) {
  return delqTruckLineEmpty(doc) && delqWhLineEmpty(doc);
}
function delqLineLocked(doc) {
  return isTruthy(doc['truckingCostSent']) || isTruthy(doc['warehouseCostSent']) ||
         isTruthy(doc['truckingSalesConfirmed']) || isTruthy(doc['truckingManagerConfirmed']) ||
         isTruthy(doc['warehouseSalesConfirmed']) || isTruthy(doc['warehouseManagerConfirmed']);
}
// ═══════════════════════════════ DELGROUP fields end ═══════════════════════════════

// Ensure new WH fields exist with sane defaults (idempotent; safe on old docs).
function applyWarehouseDefaults(doc) {
  // Migrate legacy single-cost values before adding blank supplier columns. Otherwise
  // syncSelectedSupplierCost mistakes new defaults for an intentional cleared supplier.
  for (const name of WH_TEMPLATE_BUCKETS) {
    const hasSupplierColumns = Array.from({ length: WH_SUPPLIER_COUNT }, (_, i) => name + ' Cost S' + (i + 1)).some(k => doc[k] !== undefined);
    if (!hasSupplierColumns && String(doc[name] ?? '').trim() !== '') {
      const key = name + ' Cost S1';
      doc[key] = doc[name];
      if (typeof doc.set === 'function') doc.set(key, doc[name]);
    }
  }

  setIfEmpty(doc, 'Selected Supplier', '1');
  for (let s = 1; s <= WH_SUPPLIER_COUNT; s++) setIfEmpty(doc, 'Supplier ' + s + ' Name', '');
  setIfEmpty(doc, 'ETA', '');
  setIfEmpty(doc, '# of Containers', '');
  setIfEmpty(doc, 'Service Types', '');
  setIfEmpty(doc, 'Service Subtypes', '');   // ✅ SUBTYPE
  for (const [, name, unit, storage] of WH_NEW_BUCKETS) {
    setIfEmpty(doc, name, '');
    setIfEmpty(doc, name + ' Unit', unit);
    setIfEmpty(doc, name + ' Price', '');
    setIfEmpty(doc, name + ' Qty', '');
    for (let s = 1; s <= WH_SUPPLIER_COUNT; s++) setIfEmpty(doc, name + ' Cost S' + s, '');
    if (storage) setIfEmpty(doc, name + ' Period', 'mo');
  }
  for (const name of WH_REUSED_BUCKETS) {
    setIfEmpty(doc, name + ' Qty', '');
    for (let s = 1; s <= WH_SUPPLIER_COUNT; s++) setIfEmpty(doc, name + ' Cost S' + s, '');
  }
}

// Mirror the selected supplier's cost into the bare bucket field so existing GP / auto-price /
// masking logic keeps working unchanged. Only overwrites when that supplier's cost is non-empty,
// so OLD single-cost docs (no supplier columns) keep their legacy value untouched.
function syncSelectedSupplierCost(doc) {
  let sel = parseInt(doc['Selected Supplier'], 10);
  if (!(sel >= 1 && sel <= WH_SUPPLIER_COUNT)) sel = 1;
  const isMongoDoc = typeof doc.set === 'function' && typeof doc.markModified === 'function';
  for (const name of WH_TEMPLATE_BUCKETS) {
    const v = doc[name + ' Cost S' + sel];
    if (Array.from({length: WH_SUPPLIER_COUNT}, (_, i) => name + ' Cost S' + (i + 1)).some(k => doc[k] !== undefined)) {
      doc[name] = v == null ? '' : v;
      if (isMongoDoc) doc.set(name, doc[name]);
    }
  }
  // ✅ LPQUOTE: same mirroring for dynamic List-Price rows
  const lpN = lpRowCount(doc);
  for (let i = 1; i <= lpN; i++) {
    const lv = doc['LP ' + i + ' Cost S' + sel];
    if (Array.from({length: WH_SUPPLIER_COUNT}, (_, n) => 'LP ' + i + ' Cost S' + (n + 1)).some(k => doc[k] !== undefined)) {
      doc['LP ' + i + ' Cost'] = lv == null ? '' : lv;
      if (isMongoDoc) doc.set('LP ' + i + ' Cost', doc['LP ' + i + ' Cost']);
    }
  }
}

// Compute WH cost/price totals across all buckets (template selected-cost + legacy single-cost).
function computeWarehouseTotals(doc) {
  const num = v => {
    const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
    return isFinite(n) ? n : 0;
  };
  let cost = 0, price = 0;
  const hasSelection = Object.keys(doc.toObject ? doc.toObject() : doc).some(k => k.endsWith(' OnQuote'));
  if (!lpRowCount(doc)) for (const name of WH_ALL_BUCKETS) {
    if (hasSelection && !WH_LEGACY_BUCKETS.includes(name) && !isTruthy(doc[name + ' OnQuote'])) continue;
    cost += num(doc[name]); price += num(doc[name + ' Price']);
  }
  // ✅ LPQUOTE: dynamic List-Price rows count into the WH totals
  const lpN = lpRowCount(doc);
  for (let i = 1; i <= lpN; i++) { cost += num(doc['LP ' + i + ' Cost']); price += num(doc['LP ' + i + ' Price']); }
  const c = cost ? String(Math.round(cost * 100) / 100) : '';
  const p = price ? String(Math.round(price * 100) / 100) : '';
  const isMongoDoc = typeof doc.set === 'function' && typeof doc.markModified === 'function';
  doc['WH Cost Total'] = c; if (isMongoDoc) doc.set('WH Cost Total', c);
  doc['WH Price Total'] = p; if (isMongoDoc) doc.set('WH Price Total', p);
}

function applyWarehouseUnits(doc) {
  setIfEmpty(doc, 'Order Processing Unit', '');
  setIfEmpty(doc, 'Inbound Unit', '');
  setIfEmpty(doc, 'Outbound Unit', '');
  setIfEmpty(doc, 'Sorting Unit', '');
  setIfEmpty(doc, 'Palletizing Unit', 'Pallet');
  setIfEmpty(doc, 'Pallet Fee Unit', 'Pallet');
  setIfEmpty(doc, 'Storage Unit', '');
  setIfEmpty(doc, 'Label Unit', 'Label');
  setIfEmpty(doc, 'Cross Dock Unit', '');
}

function autoPriceTruckingItem(prevDoc, doc, costField, priceField, calcFn) {
  const prevCost = prevDoc ? prevDoc[costField] : undefined;
  const newCost = doc[costField];

  const calc = (v) => calcFn(v, doc);

  const newAuto = calc(newCost);
  if (newAuto === '') return;

  const oldAuto = calc(prevCost);
  const curPrice = doc[priceField];

  const curEmpty = curPrice === undefined || curPrice === null || String(curPrice).trim() === '';
  const curPriceStr = (curPrice === undefined || curPrice === null) ? '' : String(curPrice).trim();

  const shouldUpdate =
    curEmpty ||
    curPriceStr === String(oldAuto).trim();

  // ✅ FIX: dual write — .set() for persistence + direct assign for readback
  const isMongoDoc = typeof doc.set === 'function' && typeof doc.markModified === 'function';
  const val = shouldUpdate ? String(newAuto) : curPriceStr;
  doc[priceField] = val;
  if (isMongoDoc) doc.set(priceField, val);
}

// ==================== 新版：25% GP + 美化到最近的10 ====================
function beautifyPrice(num) {
  if (!num || isNaN(num) || num <= 0) return '';
  const precise = Math.round(num * 100) / 100;   // 先精确到两位小数
  return Math.round(precise / 10) * 10;          // 四舍五入到最近的10（匹配你举的338→340）
}

function autoPriceWarehouseItem(prevDoc, doc, costField, priceField) {
  const prevCost = prevDoc ? prevDoc[costField] : undefined;
  const newCost = doc[costField];

  // 如果成本为空或无效，清空价格
  const n = toNumber(newCost);
  // ✅ FIX: dual write — .set() for persistence + direct assign for readback
  const isMongoDoc = typeof doc.set === 'function' && typeof doc.markModified === 'function';
  const safeWrite = (k, v) => { doc[k] = v; if (isMongoDoc) doc.set(k, v); };

  if (!Number.isFinite(n) || n <= 0) {
    safeWrite(priceField, '');
    return;
  }

  // 25% GP → 售价 = cost / 0.75
  let targetPrice = n / 0.75;

  // 美化
  const beautified = beautifyPrice(targetPrice);

  const newAuto = String(beautified);

  // ==================== 保留手动覆盖逻辑（重要！）================
  const oldAuto = toNumber(prevCost) ? String(beautifyPrice(toNumber(prevCost) / 0.75)) : '';
  const curPrice = doc[priceField];
  const curEmpty = !curPrice || String(curPrice).trim() === '';
  const curPriceStr = String(curPrice || '').trim();

  const shouldUpdate =
    curEmpty ||
    curPriceStr === oldAuto;

  const val = shouldUpdate ? newAuto : curPriceStr;
  safeWrite(priceField, val);
}

function applyTruckingAutoPrices(prevDoc, doc) {
  // ✅ FIX: dual write — .set() for persistence + direct assign for readback
  const isMongoDoc = typeof doc.set === 'function' && typeof doc.markModified === 'function';
  const safeSet = (key, val) => { doc[key] = val; if (isMongoDoc) doc.set(key, val); };

  // Fixed (but allow manual override)
  const fixed = [
    { priceField: 'Chassis Price', value: 45 },
    { priceField: 'Yard Storage Price', value: 55 },
    { priceField: 'Driver Waiting Price', value: 100 },

    // ✅ NEW: Pre-Pull default price
    { priceField: 'Pre-Pull Price', value: 175 },
  ];


  for (const f of fixed) {
    const prevPrice = prevDoc ? prevDoc[f.priceField] : undefined;
    const curPrice = doc[f.priceField];

    const curEmpty = curPrice === undefined || curPrice === null || String(curPrice).trim() === '';
    const curStr = curEmpty ? '' : String(curPrice).trim();
    const oldFixed = String(f.value);

    const shouldUpdate =
      curEmpty ||
      curStr === String(prevPrice || '').trim() && String(prevPrice || '').trim() === oldFixed ||
      curStr === oldFixed;

    if (shouldUpdate) safeSet(f.priceField, oldFixed);
  }

  // Pre-Pull Price = Cost + $25
  autoPriceTruckingItem(prevDoc, doc, 'Pre-Pull', 'Pre-Pull Price', (c) => {
    const n = toNumber(c);
    if (!Number.isFinite(n)) return '';
    return String(Math.round(n + 25));
  });

  // Chassis Split Price = Cost + $25
  autoPriceTruckingItem(prevDoc, doc, 'Chassis Split', 'Chassis Split Price', (c) => {
    const n = toNumber(c);
    if (!Number.isFinite(n)) return '';
    return String(Math.round(n + 25));
  });

  // Toll Price = Cost + $25
  autoPriceTruckingItem(prevDoc, doc, 'Toll', 'Toll Price', (c) => {
    const n = toNumber(c);
    if (!Number.isFinite(n)) return '';
    return String(Math.round(n + 25));
  });

  // Reefer Fee Price = Cost + $30
  autoPriceTruckingItem(prevDoc, doc, 'Reefer Fee', 'Reefer Fee Price', (c) => {
    const n = toNumber(c);
    if (!Number.isFinite(n)) return '';
    return String(Math.round(n + 30));
  });

  // ✅ Drop Fee (2026-08-27): NO auto-price by design — Sales enters the price manually (per Lina).

  // Bond Fee Price = Cost + $30
  autoPriceTruckingItem(prevDoc, doc, 'Bond Fee', 'Bond Fee Price', (c) => {
    const n = toNumber(c);
    if (!Number.isFinite(n)) return '';
    return String(Math.round(n + 30));
  });
}

function applyWarehouseAutoPrices(prevDoc, doc) {
  const items = [
    { cost: 'Order Processing', price: 'Order Processing Price' },
    { cost: 'Inbound', price: 'Inbound Price' },
    { cost: 'Outbound', price: 'Outbound Price' },
    { cost: 'Sorting', price: 'Sorting Price' },
    { cost: 'Palletizing', price: 'Palletizing Price' },
    { cost: 'Pallet Fee', price: 'Pallet Fee Price' },
    { cost: 'Storage', price: 'Storage Price' },
    { cost: 'Label', price: 'Label Price' },
    { cost: 'Cross Dock', price: 'Cross Dock Price' },
  ];
  // ▼ WH redesign: auto-price the new buckets too (25% GP, same rule)
  for (const b of WH_NEW_BUCKETS) items.push({ cost: b[1], price: b[1] + ' Price' });

  for (const it of items) {
    autoPriceWarehouseItem(prevDoc, doc, it.cost, it.price);
  }
}

function applyBaseRateAutoPriceAndGP(doc) {
  console.log('[GP FIX] applyBaseRateAutoPriceAndGP 被呼叫');

  if (!doc || typeof doc !== 'object') return;

  const baseRate = Number(doc['Base Rate']) || 0;
  const inquiryType = String(doc['Inquiry Type'] || '').trim();

  if (baseRate <= 0 || !inquiryType) {
    console.log('[GP FIX] 條件不滿足，跳過');
    return;
  }

  const simulated = simulateQuoteFull(baseRate, inquiryType);

  // ✅ FIX: dual write — .set() for persistence + direct assign for readback
  const isMongoDoc = typeof doc.set === 'function' && typeof doc.markModified === 'function';
  const safeWrite = (k, v) => { doc[k] = v; if (isMongoDoc) doc.set(k, v); };

  // Price
  const priceVal = simulated.finalPrice ? Math.round(Number(simulated.finalPrice)) : '';
  safeWrite('Price', priceVal);

  // GP —— 強制存成數字（0.1603），不再存字串
  const finalPrice = Number(simulated.finalPrice) || 0;
  const baseRateNum = Number(baseRate) || 0;
  let gpNumber = 0;
  if (finalPrice > 0) {
    gpNumber = (finalPrice - baseRate) / finalPrice;
  }
  const gpVal = isNaN(gpNumber) ? 0 : gpNumber;
  safeWrite('GP', gpVal);

  console.log('[GP FINAL FIX] 寫入的 GP 數字 =', gpVal);

  // Adjusted GP（保持原樣，已正常）
  const adjPrice = Number(doc['Adjusted Price']) || 0;
  let adjGPNumber = 0;
  if (adjPrice > 0) {
    adjGPNumber = (adjPrice - baseRateNum) / adjPrice;
  }
  const adjGPVal = isNaN(adjGPNumber) || !isFinite(adjGPNumber) ? '—' : (adjGPNumber * 100).toFixed(2) + '%';
  safeWrite('Adjusted GP', adjGPVal);

  console.log('[GP FIX] 寫入結果：', {
    Price: priceVal,
    GP: gpVal,
    'Adjusted Price': doc['Adjusted Price'],
    'Adjusted GP': adjGPVal
  });
}

function isTruckingConfirmed(doc) {
  return isTruthy(doc['truckingSalesConfirmed']) || isTruthy(doc['truckingManagerConfirmed']);
}

function isWarehouseConfirmed(doc) {
  return isTruthy(doc['warehouseSalesConfirmed']) || isTruthy(doc['warehouseManagerConfirmed']);
}

function detectAnyChange(existing, incoming, fields) {
  for (const f of fields) {
    const a = (existing && existing[f] !== undefined) ? String(existing[f]).trim() : '';
    const b = (incoming && incoming[f] !== undefined) ? String(incoming[f]).trim() : '';
    if (b !== '' && a !== b) return true;
  }
  return false;
}

const loginAttempts = new Map();
async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 1024) return false;
  const parts = String(encoded || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const actual = await new Promise((resolve, reject) => crypto.scrypt(password, parts[1], 64, (err, key) => err ? reject(err) : resolve(key)));
  const expected = Buffer.from(parts[2], 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
}
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  console.log('[DEBUG] /login called with username:', username);

  const now = Date.now();
  for (const [key, entry] of loginAttempts) if (entry.until <= now) loginAttempts.delete(key);
  const ip = (req.ip || req.socket?.remoteAddress || 'unknown') + ':' + String(username || '').slice(0, 128);
  const entry = loginAttempts.get(ip) || { count: 0, until: now + 15 * 60 * 1000 };
  if (entry.count >= 20) return res.status(429).json({ success: false, message: 'Too many login attempts. Please try again later.' });
  entry.count++;
  if (loginAttempts.size < 10000 || loginAttempts.has(ip)) loginAttempts.set(ip, entry);
  const user = users.find(u => u.username === username);
  let valid = false;
  try { valid = await verifyPassword(password, (user || users[0]).passwordHash); }
  catch (err) { return res.status(503).json({ success: false, message: 'Login temporarily unavailable.' }); }
  if (!user || !valid) return res.json({ success: false, message: 'Invalid credentials' });
  loginAttempts.delete(ip);

  // ✅ cookies — SameSite:Lax ensures cookies are sent on same-origin POST/GET in all browsers (Chrome, Edge, Firefox, Safari)
  const cookieOpts = { sameSite: 'Lax', httpOnly: true, secure: true, signed: true, maxAge: 8 * 60 * 60 * 1000 };
  res.cookie('username', user.username, cookieOpts);
  res.cookie('role', user.role, cookieOpts);
  res.cookie('salesGroup', user.salesGroup || '', cookieOpts);

  const role = String(user.role || '').toLowerCase();

  let redirect = '/index.html';
  if (role === 'manager') redirect = '/manager_home.html';
  else if (role === 'sourcing') redirect = '/sourcing_home.html';
  else if (role === 'sales' || role === 'ops_view') redirect = '/sales_home.html';

  return res.json({
    success: true,
    redirect,
    username: user.username,
    role: user.role,
    salesGroup: user.salesGroup || '' // ✅ NEW
  });
});

// ✅ Helper: find inquiry by Quotation # (Mongo NEW DB only + mock fallback)
async function findInquiryByQuote(quote) {
  const q = String(quote || '').trim();
  if (!q) return null;

  // mock mode
  if (USE_MOCK || !conn || conn.readyState !== 1 || !Inquiry) {
    return mockInquiries.find(x => String(x['Quotation #'] || '').trim() === q) || null;
  }

  // mongo mode (NEW DB only)
  return await Inquiry.findOne({ 'Quotation #': q }).lean();
}


// ══════ KPI Dashboard API ══════
app.get('/api/kpi', async (req, res) => {
  if (!req.cookies?.username) return res.status(401).json({ success: false, message: 'Please sign in again.' });
  if (!['sales', 'ops_view', 'sourcing', 'manager'].includes(req.cookies.role)) return res.status(403).json({ success: false, message: 'Not authorized.' });
  if (!dbReady(res)) return;
  try {
    const role = String(req.cookies.role || '').toLowerCase();
    const username = String(req.cookies.username || '');
    const salesGroup = String(req.cookies.salesGroup || '');

    if (!Inquiry || !conn || conn.readyState !== 1) {
      return res.json({ error: 'DB not ready' });
    }

    // ✅ KPIPROJ: fetch ONLY the fields the KPI math below actually reads (verified against all
    // three role branches: sales/ops_view, sourcing, manager). Full docs carry dozens of WH/LP/
    // supplier-cost fields and were costing ~130MB of RSS per dashboard load at 2737 docs.
    const KPI_PROJECTION = {
      'Quotation #': 1, 'External Quotation #': 1, 'Customer ID': 1, 'From': 1, salesGroup: 1,
      'Date': 1, createdAt: 1, 'GP': 1, 'Assigned Sales': 1, username: 1, 'Selected': 1,
      truckingSalesConfirmed: 1, truckingManagerConfirmed: 1,
      warehouseSalesConfirmed: 1, warehouseManagerConfirmed: 1,
      truckingCostSent: 1, warehouseCostSent: 1,
      truckingCostSaved: 1, warehouseCostSaved: 1, 'Submitted To Sourcing': 1,
      'Adjusted Price': 1, 'WH Price Total': 1, truckingCostDraft: 1, warehouseCostDraft: 1
    };

    // Get all main lines (no dash-suffix = main quotation)
    let kpiFilter = {};
    if (role === 'sales' || role === 'ops_view') {
      const myGroups = groupList(salesGroup);
      const groupUsers = salesGroup ? users.filter(u => groupList(u.salesGroup).some(g => myGroups.includes(g))).map(u => u.username) : [username];
      kpiFilter = { $or: [
        { salesGroup: { $in: myGroups } },
        { $and: [ { salesGroup: { $in: ['', null] } }, { $or: [
          { 'Assigned Sales': { $in: groupUsers } },
          { 'Assigned Sales': { $in: ['', null] }, username: { $in: groupUsers } }
        ] } ] }
      ] };
    }
    if (role === 'sourcing') kpiFilter['Submitted To Sourcing'] = 'true';
    const allDocs = await Inquiry.find(kpiFilter, KPI_PROJECTION).lean();
    console.log('[READ] /api/kpi rows=' + allDocs.length);   // ✅ MEMWATCH: full-collection load

    // Filter main lines only (e.g. 004790, not 004790-1)
    const mainLines = allDocs.filter(d => {
      const q = String(d['Quotation #'] || '');
      return q && !/-\d+$/.test(q) && !/-[A-Z]$/i.test(q);
    });

    // Helper
    const isTrue = v => String(v || '').toLowerCase().trim() === 'true';

    // Combined status helpers (check BOTH truck and warehouse)
    const isConfirmed = d => hasConfirmedQuotePrice(d);
    const isCostSent = d => isTrue(d.truckingCostSent) || isTrue(d.warehouseCostSent);
    const isCostSaved = d => isTrue(d.truckingCostSaved) || isTrue(d.warehouseCostSaved);
    const thisMonth = new Date();
    const monthStart = new Date(thisMonth.getFullYear(), thisMonth.getMonth(), 1);

    // Filter by role
    let docs = mainLines;
    if (role === 'sales' || role === 'ops_view') {
      if (salesGroup) {
        const myGroups = groupList(salesGroup);
        const groupUsers = users.filter(u => groupList(u.salesGroup).some(g => myGroups.includes(g))).map(u => u.username);
        docs = mainLines.filter(d => {
          const docGroup = String(d.salesGroup || '').trim();
          if (docGroup) return myGroups.includes(docGroup);          // stamped docs: authoritative
          return groupUsers.includes(d['Assigned Sales'] || d.username); // legacy unstamped docs
        });
      } else {
        docs = mainLines.filter(d => (d['Assigned Sales'] || d.username) === username);
      }
    }

    const total = docs.length;

    // Date filter for this month
    const thisMonthDocs = docs.filter(d => {
      const dateStr = d['Date'] || d.createdAt;
      if (!dateStr) return false;
      const dt = new Date(dateStr);
      return dt >= monthStart;
    });

    let kpi = {};

    if (role === 'sales' || role === 'ops_view') {
      const confirmed = docs.filter(d => isConfirmed(d)).length;
      const sourcingQuoted = docs.filter(d => isCostSent(d) && !isConfirmed(d)).length;
      const awaitingSourcing = docs.filter(d => !isCostSent(d) && !isConfirmed(d)).length;

      // Average GP for this sales user/group
      let gpSum = 0, gpCount = 0;
      docs.forEach(d => {
        const gp = parseFloat(d['GP']);
        if (Number.isFinite(gp) && gp > 0 && gp < 1) {
          gpSum += gp;
          gpCount++;
        }
      });
      const avgGP = gpCount > 0 ? (gpSum / gpCount * 100).toFixed(1) : '—';

      kpi = {
        role: 'sales',
        total,
        thisMonth: thisMonthDocs.length,
        awaitingSourcing,
        sourcingQuoted,
        confirmed,
        avgGP,
        recentInquiries: docs.slice(-5).reverse().map(d => ({
          quote: d['External Quotation #'] || d['Quotation #'],
          customer: d['Customer ID'] || '',
          date: d['Date'] || '',
          status: isConfirmed(d) ? 'Confirmed' :
                  isCostSent(d) ? 'Sourcing Quoted' : 'Pending'
        }))
      };

    } else if (role === 'sourcing') {
      const confirmed = docs.filter(d => isConfirmed(d)).length;
      const sentToSales = docs.filter(d => isCostSent(d) && !isConfirmed(d)).length;
      const savedNotSent = docs.filter(d => isCostSaved(d) && !isCostSent(d) && !isConfirmed(d)).length;
      const newInquiries = docs.filter(d => !isCostSaved(d) && !isCostSent(d) && !isConfirmed(d)).length;

      // Find urgent (>24h without response)
      const now = Date.now();
      const urgent = docs.filter(d => {
        if (isCostSaved(d) || isCostSent(d)) return false;
        const dt = new Date(d['Date'] || d.createdAt);
        return (now - dt.getTime()) > 24 * 60 * 60 * 1000;
      }).length;

      kpi = {
        role: 'sourcing',
        total,
        thisMonth: thisMonthDocs.length,
        newInquiries,
        savedNotSent,
        sentToSales,
        confirmed,
        urgent,
        recentInquiries: docs.slice(-5).reverse().map(d => ({
          quote: d['External Quotation #'] || d['Quotation #'],
          customer: d['Customer ID'] || '',
          from: d['From'] || '',
          date: d['Date'] || '',
          status: isCostSent(d) ? 'Sent' :
                  isCostSaved(d) ? 'Saved' : 'New'
        }))
      };

    } else if (role === 'manager') {
      const isMgrConfirmed = d => isTrue(d.truckingManagerConfirmed) || isTrue(d.warehouseManagerConfirmed);
      const isSalesConfirmed = d => hasConfirmedQuotePrice(d) && (isTrue(d.truckingSalesConfirmed) || isTrue(d.warehouseSalesConfirmed));
      const pendingApproval = docs.filter(d => isSalesConfirmed(d) && !isMgrConfirmed(d)).length;
      const managerConfirmed = docs.filter(d => isMgrConfirmed(d)).length;
      const awaitingSourcing = docs.filter(d => !isCostSent(d)).length;

      // Average GP
      let gpSum = 0, gpCount = 0;
      allDocs.forEach(d => {
        const gp = parseFloat(d['GP']);
        if (Number.isFinite(gp) && gp > 0 && gp < 1) {
          gpSum += gp;
          gpCount++;
        }
      });
      const avgGP = gpCount > 0 ? (gpSum / gpCount * 100).toFixed(1) : '—';

      kpi = {
        role: 'manager',
        total,
        thisMonth: thisMonthDocs.length,
        pendingApproval,
        managerConfirmed,
        awaitingSourcing,
        avgGP,
        recentInquiries: docs.slice(-5).reverse().map(d => ({
          quote: d['External Quotation #'] || d['Quotation #'],
          customer: d['Customer ID'] || '',
          date: d['Date'] || '',
          status: isMgrConfirmed(d) ? 'Confirmed' :
                  isSalesConfirmed(d) ? 'Pending Approval' :
                  isCostSent(d) ? 'Quoted' : 'In Progress'
        }))
      };
    }

    res.json(kpi);
  } catch (err) {
    console.error('KPI error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/inquiries', async (req, res) => {
  // ✅ New permission model: ops_view is strictly read-only
  const role = String(req.cookies?.role || '').toLowerCase();
  if (!['sales', 'sourcing', 'manager'].includes(role)) {
    return res.status(403).send(role === 'ops_view' ? 'OPS view-only cannot create inquiry.' : 'Not authorized.');
  }

  try {
    const raw = req.body || {};
    if (!USE_MOCK && !dbReady(res)) return;

    // ✅ Inherit salesGroup from parent (for Sourcing adding sub-lines)
    let inheritedGroup = ''
    let inheritedSubmitted = '';
    const parentQ = String(raw['Parent Quotation #'] || raw.parentQuotation || '').trim();
    if (parentQ) {
      const parentDoc = await findInquiryByQuote(parentQ);
      if (!parentDoc) return res.status(404).json({ success: false, message: 'Parent quotation not found.' });
      if (!requireInquiryAccess(req, res, parentDoc)) return;
      inheritedGroup = String(parentDoc?.salesGroup || '').trim();
      inheritedSubmitted = String(parentDoc?.['Submitted To Sourcing'] || '').trim();
    }

    // ✅ final salesGroup priority:
    // cookie (sales/opm submit) > body (if provided) > inherited(parent) > ''
    // Multi-group creators (cookie like 'TEAM2,TEAM3' — e.g. Aurora Peng) are the exception:
    // the comma list must NEVER be stamped onto a document (it would match no single team's
    // filter). They must pick ONE of their teams per inquiry; the body value is only honored
    // when it's one of their own groups.
    const _cookieGroups = groupList(req.cookies?.salesGroup);
    const _bodyGroup = String(raw.salesGroup || raw['salesGroup'] || '').trim();
    let finalSalesGroup;
    if (_cookieGroups.length > 1) {
      finalSalesGroup = (_cookieGroups.includes(_bodyGroup) ? _bodyGroup : '') || inheritedGroup || '';
      if (!finalSalesGroup) {
        return res.status(400).json({ success: false, message: 'Please select which team this inquiry belongs to (' + _cookieGroups.join(' / ') + ').' });
      }
    } else {
      finalSalesGroup =
        (_cookieGroups[0] || '') ||
        _bodyGroup ||
        inheritedGroup ||
        '';
    }

    if (parentQ) finalSalesGroup = inheritedGroup;

    // 構建保存的資料（保留你原有的 raw 映射邏輯）
    const data = {
      Date: new Date().toLocaleDateString(),
      'Customer ID': raw['Customer ID'] || raw.customerId || '',
      'Requested By': req.cookies.username || raw['Requested By'] || raw.requestedBy || '',
      username: req.cookies.username || raw.username || raw['Requested By'] || raw.requestedBy || '',
      'Created By': req.cookies.username || '',
      'Created Role': req.cookies.role || '',

      // ===== Source & Assignment (internal) =====
      'Source': raw['Source'] || raw.source || 'internal',
      'Assigned Sales': raw['Assigned Sales'] || raw.assignedSales || (String(req.cookies.role || '').toLowerCase() === 'sales' ? (req.cookies.username || '') : ''),
      'External Quotation #': raw['External Quotation #'] || raw.externalQuotation || '',
      'GF Ref': raw['GF Ref'] || raw.gfRef || '',

      // ===== Workflow =====
      // Internal system-created inquiries (Sales/Manager) go to Sourcing immediately.
      // Sub-lines inherit from parent when available.
      'Submitted To Sourcing': raw['Submitted To Sourcing'] || raw.submittedToSourcing || inheritedSubmitted || 'true',
      'Submitted To Sourcing At': raw['Submitted To Sourcing At'] || raw.submittedToSourcingAt || '',


      // ✅ IMPORTANT: persist salesGroup so Sales can see it after team filtering
      salesGroup: finalSalesGroup,

      'Inquiry Type': raw['Inquiry Type'] || raw.inquiryType || '',
      'Container Size': raw['Container Size'] || raw.containerSize || '',
      'Dry Van Type': raw['Dry Van Type'] || raw.dryVanType || '',
      'Legal or Over Weight': raw['Legal or Over Weight'] || raw.legalOverWeight || '',
      'Gross Weight': raw['Gross Weight'] || raw.grossWeight || '',
      'Live or Drop': raw['Live or Drop'] || raw.liveOrDrop || '',
      'From': raw['From'] || raw.from || '',
      'To City': raw['To City'] || raw.toCity || '',
      'To State': raw['To State'] || raw.toState || '',
      'To ZIP': raw['To ZIP'] || raw.toZip || '',
      'To': raw['To'] || raw.to || '',
      'QTY': raw['QTY'] || raw.qty || '',
      'Quotation #': String(raw['Quotation #'] || '').trim(),

      'Parent Quotation #': String(raw['Parent Quotation #'] || raw.parentQuotation || '').trim(),
      'Type': raw['Type'] || raw.type || '',
      'Commodity': raw['Commodity'] || raw.commodity || '',
      'Package Type': raw['Package Type'] || raw.packageType || '',
      'Packages Per Container': raw['Packages Per Container'] || raw.packagesPerContainer || '',
      'Hazmat': raw['Hazmat'] || raw.hazmat || 'false',
      'Reefer': raw['Reefer'] || raw.reefer || 'false',
      'Bonded': raw['Bonded'] || raw.bonded || 'false',

      // Common info filled in the WH green block (mirrors public endpoint + quote modal)
      'Service Types': raw['Service Types'] || raw.serviceTypes || '',
      'Service Subtypes': raw['Service Subtypes'] || raw.serviceSubtypes || '',   // ✅ SUBTYPE
      'ETA': raw['ETA'] || raw.eta || '',
      '# of Containers': raw['# of Containers'] || raw.numContainers || '',

      'Need Warehouse Service': raw['Need Warehouse Service'] || raw.needWarehouseService || 'false',
      'Warehouse Services': raw['Warehouse Services'] || raw.warehouseServices || '',
      'Warehouse Service Detail': raw['Warehouse Service Detail'] || raw.warehouseServiceDetail || '',
      'Estimated Pallets': raw['Estimated Pallets'] || raw.estimatedPallets || '',
      'Estimated Boxes': raw['Estimated Boxes'] || raw.estimatedBoxes || '',
      'Estimated SKU Count': raw['Estimated SKU Count'] || raw.estimatedSkuCount || '',
      'Storage Duration': raw['Storage Duration'] || raw.storageDuration || '',
      'Storage Duration Unit': raw['Storage Duration Unit'] || raw.storageDurationUnit || '',
      'Warehouse Note': raw['Warehouse Note'] || raw.warehouseNote || '',

      'Base Rate': raw['Base Rate'] || '',
      'Adjusted Price': raw['Adjusted Price'] || '',
      'Adjusted GP': raw['Adjusted GP'] || '',
      'Chassis': raw['Chassis'] || '',
      'Pre-Pull': raw['Pre-Pull'] || '',
      'Yard Storage': raw['Yard Storage'] || '',
      'Driver Waiting': raw['Driver Waiting'] || '',
      'Over Weight': raw['Over Weight'] || '',
      'Chassis Split': raw['Chassis Split'] || '',
      'Toll': raw['Toll'] || '',
      'Drop Fee': raw['Drop Fee'] || '',
      'Reefer Fee': raw['Reefer Fee'] || '',
      'Bond Fee': raw['Bond Fee'] || '',

      'Chassis Price': raw['Chassis Price'] || '',
      'Pre-Pull Price': raw['Pre-Pull Price'] || '',
      'Yard Storage Price': raw['Yard Storage Price'] || '',
      'Driver Waiting Price': raw['Driver Waiting Price'] || '',
      'Over Weight Price': raw['Over Weight Price'] || '',
      'Chassis Split Price': raw['Chassis Split Price'] || '',
      'Toll Price': raw['Toll Price'] || '',
      'Drop Fee Price': raw['Drop Fee Price'] || '',
      'Reefer Fee Price': raw['Reefer Fee Price'] || '',
      'Bond Fee Price': raw['Bond Fee Price'] || '',

      'Base Rate Unit': raw['Base Rate Unit'] || '',
      'Chassis Unit': raw['Chassis Unit'] || '',
      'Pre-Pull Unit': raw['Pre-Pull Unit'] || '',
      'Yard Storage Unit': raw['Yard Storage Unit'] || '',
      'Driver Waiting Unit': raw['Driver Waiting Unit'] || '',
      'Chassis Split Unit': raw['Chassis Split Unit'] || '',
      'Over Weight Unit': raw['Over Weight Unit'] || '',
      'Toll Unit': raw['Toll Unit'] || '',
      'Drop Fee Unit': raw['Drop Fee Unit'] || '',
      'Reefer Fee Unit': raw['Reefer Fee Unit'] || '',
      'Bond Fee Unit': raw['Bond Fee Unit'] || '',

      'Order Processing': raw['Order Processing'] || '',
      'Order Processing Unit': raw['Order Processing Unit'] || '',
      'Order Processing Price': raw['Order Processing Price'] || '',

      'Inbound': raw['Inbound'] || '',
      'Inbound Unit': raw['Inbound Unit'] || '',
      'Inbound Price': raw['Inbound Price'] || '',

      'Outbound': raw['Outbound'] || '',
      'Outbound Unit': raw['Outbound Unit'] || '',
      'Outbound Price': raw['Outbound Price'] || '',

      'Sorting': raw['Sorting'] || '',
      'Sorting Unit': raw['Sorting Unit'] || '',
      'Sorting Price': raw['Sorting Price'] || '',

      'Palletizing': raw['Palletizing'] || '',
      'Palletizing Unit': raw['Palletizing Unit'] || '',
      'Palletizing Price': raw['Palletizing Price'] || '',

      'Pallet Fee': raw['Pallet Fee'] || '',
      'Pallet Fee Unit': raw['Pallet Fee Unit'] || '',
      'Pallet Fee Price': raw['Pallet Fee Price'] || '',

      'Storage': raw['Storage'] || '',
      'Storage Unit': raw['Storage Unit'] || '',
      'Storage Price': raw['Storage Price'] || '',

      'Label': raw['Label'] || '',
      'Label Unit': raw['Label Unit'] || '',
      'Label Price': raw['Label Price'] || '',

      'Cross Dock': raw['Cross Dock'] || '',
      'Cross Dock Unit': raw['Cross Dock Unit'] || '',
      'Cross Dock Price': raw['Cross Dock Price'] || '',

      'Note': raw['Note'] || raw.note || '',
      'Truck Inquiry Note': raw['Truck Inquiry Note'] || raw.truckInquiryNote || '',

      // ===== Sourcing cost send/save flags (scope-specific) =====
      'truckingCostSaved': raw['truckingCostSaved'] || 'false',
      'truckingCostSent': raw['truckingCostSent'] || 'false',
      'truckingCostDraft': raw['truckingCostDraft'] || '',
      'warehouseCostSaved': raw['warehouseCostSaved'] || 'false',
      'warehouseCostSent': raw['warehouseCostSent'] || 'false',
      'warehouseCostDraft': raw['warehouseCostDraft'] || '',

      // ===== Sales/Manager price save flags (scope-specific) =====
      'truckingPriceSaved': raw['truckingPriceSaved'] || 'false',
      'warehousePriceSaved': raw['warehousePriceSaved'] || 'false',

      // ===== Legacy fields (kept for backward compatibility with existing dashboards) =====
      'Selected': raw['Selected'] || 'false',
      'Cost Sent': raw['Cost Sent'] || raw['Cost Sent'] || 'false',

      // ===== Confirm flags =====
      'truckingSalesConfirmed': raw['truckingSalesConfirmed'] || 'false',
      'truckingManagerConfirmed': raw['truckingManagerConfirmed'] || 'false',
      'warehouseSalesConfirmed': raw['warehouseSalesConfirmed'] || 'false',
      'warehouseManagerConfirmed': raw['warehouseManagerConfirmed'] || 'false',
    };

    // ✅ 必填檢查
    if (!data['Quotation #'] || String(data['Quotation #']).trim() === '') {
      return res.status(400).json({ success: false, message: 'Missing Quotation #' });
    }

    // ✅ 防重複
    let existed;
    if (USE_MOCK) {
      existed = mockInquiries.find(x => x['Quotation #'] === data['Quotation #']);
    } else {
      existed = await Inquiry.findOne({ 'Quotation #': data['Quotation #'] });
    }
    if (existed) {
      return res.status(400).json({ success: false, message: 'Quotation # already exists' });
    }

    // ✅ 自動計算邏輯
    applyTruckingUnits(data);
    applyWarehouseUnits(data);
    applyWarehouseDefaults(data);
    syncSelectedSupplierCost(data);
    applyBaseRateAutoPriceAndGP(data);
    applyTruckingAutoPrices(null, data);
    applyWarehouseAutoPrices(null, data);
    computeWarehouseTotals(data);

    // ✅ 儲存
    let saved;
    if (USE_MOCK) {
      data['_id'] = Date.now().toString();
      mockInquiries.push(data);
      saved = data;
    } else {
      const inquiry = new Inquiry(data);
      saved = await inquiry.save();
    }

    broadcastInquiry(saved['Quotation #'], saved);

    return res.json({ success: true, data: maskInquiryDocs([JSON.parse(JSON.stringify(saved))], role)[0] });

  } catch (err) {
    // ✅ Duplicate-key race guard: with the unique index on 'Quotation #', a double-click
    // second insert fails at DB level with E11000 — return a friendly 400 instead of 500.
    if (err && (err.code === 11000 || String(err.message || '').indexOf('E11000') >= 0)) {
      return res.status(400).json({ success: false, message: 'Quotation # already exists' });
    }
    console.error('[ERROR] Create inquiry failed:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
});

// (Dashboard page guards are registered above, before express.static. The old duplicate
//  routes that used to live here were dead — static/#2-guards handle these paths first.)



app.get('/inquiries', async (req, res) => {
  if (!req.cookies?.username) return res.status(401).json({ success: false, message: 'Please sign in again.' });
  if (!['sales', 'ops_view', 'sourcing', 'manager'].includes(req.cookies.role)) return res.status(403).json({ success: false, message: 'Not authorized.' });
  if (!dbReady(res)) return;
  // ✅ Prevent Edge/Chrome from caching API responses — ensures fresh data on every fetch
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  try {
    const mongoReady = !!conn && conn.readyState === 1 && !!Inquiry;

    const role = String(req.cookies?.role || '').toLowerCase();
    const salesGroup = String(req.cookies?.salesGroup || '').trim();

    // ✅ read source
    // ✅ read source
    if (!mongoReady) return res.status(503).json({ success: false, message: 'Database temporarily unavailable.' });   // 关键：Mongo不通就不要用mock

    // ✅ Push the role filter into the query (sales uses the salesGroup_1 index) instead of
    // fetching every doc and filtering in JS. Verified equivalent to the in-JS filters below:
    // stored values are clean ('true' only; exact group names, no case/space variants), and
    // docs missing the field are excluded by both. The JS filters below are kept unchanged and
    // simply become no-ops on the already-narrowed set, so results are identical.
    let queryFilter = {};
    if (role === 'sourcing') queryFilter = { 'Submitted To Sourcing': 'true' };
    else if ((role === 'sales' || role === 'ops_view') && salesGroup) queryFilter = { salesGroup: { $in: groupList(salesGroup) } };

    // ✅ WIN90: default view = last N days only (by _id timestamp — createdAt missing on all docs,
    // verified V3). A non-empty q searches the FULL history instead (no date boundary), mirroring
    // the Quotation List semantics: quotation-number-like input matches the whole base family by
    // prefix; anything else matches To ZIP / Customer ID by prefix. Role filters above always
    // remain in force (AND), so sales/ops still only ever see their own group.
    const winQ = String(req.query.q || '').trim();
    if (winQ) {
      const winEsc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const winS = winQ.toUpperCase().replace(/^TTSQT-?/, '');
      const winM = winS.match(/^(\d{1,6})([A-Z])?(?:-([A-Z]|\d+))?$/);
      // Always try ZIP + Customer ID by prefix; ALSO try the quotation family when the input
      // parses as a quote number. 5-digit ZIPs (e.g. 98203) parse as quote numbers too, so
      // exclusive branching would shadow ZIP search — a single $or covers both readings.
      const winOr = [
        { 'To ZIP': { $regex: '^' + winEsc(winQ) } },
        { 'Customer ID': { $regex: '^' + winEsc(winQ), $options: 'i' } }
      ];
      if (winM) {
        const winBase = String(winM[1]).padStart(6, '0').slice(-6);
        winOr.push({ 'Quotation #': { $regex: '^' + winEsc(winBase) } });
      }
      queryFilter.$or = winOr;
    } else {
      const winDays = Math.min(Math.max(parseInt(req.query.days, 10) || 90, 1), 3650);
      queryFilter._id = { $gte: new mongoose.Types.ObjectId(
        Math.floor((Date.now() - winDays * 86400000) / 1000).toString(16).padStart(8, '0') + '0000000000000000'
      ) };
    }

    const inquiries = await readInquiryList(queryFilter);
    console.log('[READ] /inquiries role=' + (role || '?') + ' rows=' + inquiries.length + (winQ ? ' q=1' : ''));   // ✅ MEMWATCH

    // ✅ manager sees all
    if (role === 'manager') {
      return res.json(inquiries);
    }

    // ✅ sourcing sees only "Submitted To Sourcing" inquiries
    if (role === 'sourcing') {
      return res.json(inquiries.filter(it => String(it['Submitted To Sourcing'] || '').toLowerCase().trim() === 'true'));
    }

    // ✅ sales/ops_view: filter by salesGroup + mask unsent costs
    if ((role === 'sales' || role === 'ops_view') && salesGroup) {
      const _myGroups = groupList(salesGroup);
      const filtered = inquiries.filter(it => _myGroups.includes(String(it.salesGroup || '').trim()));

      // ✅ Strip cost data AND auto-calculated prices that Sourcing hasn't "sent" yet
      const masked = maskInquiryDocs(filtered, role);

      return res.json(masked);
    }

    // fallback: no group = nothing
    return res.json([]);
  } catch (err) {
    console.error('❌ /inquiries error:', err);
    return res.status(500).json({ success: false, message: 'Server error while loading inquiries' });
  }
});

// ✅ EXPORT: read-only data endpoint for quotation_print.html (new; additive only).
// Security model (three layers, mirrors GET /inquiries):
//   1. role gate — only sales & manager may export (sourcing/ops_view: 403)
//   2. salesGroup gate — sales can only export inquiries of their own group
//   3. sent-flag gate — draft (unsent) prices are stripped exactly like GET /inquiries,
//      so an export can never reveal prices Sourcing hasn't sent. Applies to BOTH roles.
// Output is a WHITELIST: only identity + customer-facing Price/Unit fields are returned.
// Cost fields, supplier costs (S1-S5), GP and Adjusted GP are never included.
app.get('/api/quotation-print', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  try {
    const role = String(req.cookies?.role || '').toLowerCase();
    const username = String(req.cookies?.username || '');
    const salesGroup = String(req.cookies?.salesGroup || '').trim();
    if (!role) {
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }
    if (role !== 'sales' && role !== 'manager') {
      return res.status(403).json({ error: 'Not authorized to export quotations.' });
    }
    const mongoReady = !!conn && conn.readyState === 1 && !!Inquiry;
    if (!mongoReady) return res.status(503).json({ error: 'Database not ready. Please retry.' });

    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'Missing quotation number.' });

    const doc = await Inquiry.findOne({ 'Quotation #': q }).lean();
    if (!doc) return res.status(404).json({ error: 'Quotation ' + q + ' not found.' });

    if (role === 'sales' && !groupList(salesGroup).includes(String(doc.salesGroup || '').trim())) {
      return res.status(403).json({ error: 'This quotation belongs to another sales group.' });
    }

    const isTrueStr = v => String(v || '').toLowerCase().trim() === 'true';
    const truckDraft = isTrueStr(doc['truckingCostDraft']);
    const whDraft = isTrueStr(doc['warehouseCostDraft']);

    // Whitelisted identity fields (no cost / GP / supplier data)
    const out = {};
    const idFields = [
      'Quotation #', 'Date', 'Customer ID', 'Requested By', 'Assigned Sales',
      'Inquiry Type', 'Dry Van Type', 'Container Size', 'QTY',
      'From', 'To', 'To City', 'To State', 'To ZIP',
      'Legal or Over Weight', 'Gross Weight', 'Commodity', 'Packages Per Container',
      'Service Types', 'Warehouse Services', 'Warehouse Service Detail'
    ];
    idFields.forEach(f => { if (doc[f] != null) out[f] = doc[f]; });
    if (doc['Service Subtypes'] != null) out['Service Subtypes'] = doc['Service Subtypes'];   // ✅ SUBTYPE (export whitelist)

    // Trucking price/unit fields — stripped entirely while sourcing draft is unsent
    if (!truckDraft) {
      const truckBuckets = ['Chassis', 'Pre-Pull', 'Yard Storage', 'Driver Waiting',
        'Over Weight', 'Chassis Split', 'Toll', 'Reefer Fee', 'Bond Fee', 'Drop Fee', 'Layover'];
      ['Adjusted Price', 'Price', 'Base Rate Unit'].forEach(f => { if (doc[f] != null) out[f] = doc[f]; });
      truckBuckets.forEach(b => {
        if (doc[b + ' Price'] != null) out[b + ' Price'] = doc[b + ' Price'];
        if (doc[b + ' Unit'] != null) out[b + ' Unit'] = doc[b + ' Unit'];
      });
    }

    // Warehouse price/unit/qty fields — stripped entirely while warehouse draft is unsent
    if (!whDraft) {
      // ✅ LPQUOTE: dynamic List-Price rows go on the export too
      if (doc['LP Rows'] != null) out['LP Rows'] = doc['LP Rows'];
      if (doc['LP Page Key'] != null) out['LP Page Key'] = doc['LP Page Key'];
      // ✅ LPQUOTE: warehouse quotes print the service page's policy notes from the Excel master
      if (out['LP Page Key']) {
        const lpPg = await conn.collection('list_prices').findOne({ pageKey: out['LP Page Key'] }, { projection: { pageNote: 1 } });
        if (lpPg && lpPg.pageNote) out['LP Page Note'] = lpPg.pageNote;
      }
      const lpN = lpRowCount(doc);
      for (let i = 1; i <= lpN; i++) {
        if (doc['LP ' + i + ' Price'] != null) out['LP ' + i + ' Price'] = doc['LP ' + i + ' Price'];
        if (doc['LP ' + i + ' Qty'] != null) out['LP ' + i + ' Qty'] = doc['LP ' + i + ' Qty'];
        if (doc['LP ' + i + ' Desc'] != null) out['LP ' + i + ' Desc'] = doc['LP ' + i + ' Desc'];
      }
      WH_ALL_BUCKETS.forEach(b => {
        if (doc[b + ' Price'] != null) out[b + ' Price'] = doc[b + ' Price'];
        if (doc[b + ' Unit'] != null) out[b + ' Unit'] = doc[b + ' Unit'];
        if (doc[b + ' Qty'] != null) out[b + ' Qty'] = doc[b + ' Qty'];
        if (doc[b + ' Period'] != null) out[b + ' Period'] = doc[b + ' Period'];
        if (doc[b + ' OnQuote'] != null) out[b + ' OnQuote'] = doc[b + ' OnQuote'];
      });
    }

    // Nothing exportable at all → tell the user why instead of printing an empty sheet
    const hasMain = String(out['Adjusted Price'] || out['Price'] || '').trim() !== '';
    const hasSelection = Object.keys(out).some(k => k.endsWith(' OnQuote'));
    const hasWh = WH_ALL_BUCKETS.some(b => (!hasSelection || WH_LEGACY_BUCKETS.includes(b) || isTruthy(out[b + ' OnQuote'])) && String(out[b + ' Price'] || '').trim() !== '');
    const hasLp = Object.keys(out).some(k => /^LP \d+ Price$/.test(k) && String(out[k]).trim() !== '');   // ✅ LPQUOTE
    if (!hasMain && !hasWh && !hasLp) {
      return res.status(409).json({ error: 'No prices have been sent to Sales for this quotation yet. Please complete pricing in the system first. \u4EF7\u683C\u5C1A\u672A\u53D1\u9001\u7ED9 Sales\uFF0C\u6682\u65E0\u6CD5\u5BFC\u51FA\u62A5\u4EF7\u5355\u3002' });
    }

    return res.json({ inquiry: out, username, email: emailFor(username, salesGroup) });   // ✅ EMAIL
  } catch (err) {
    console.error('❌ /api/quotation-print error:', err);
    return res.status(500).json({ error: 'Server error while loading quotation.' });
  }
});

// ✅ LISTPRICE: TTS List Price module (new; additive only). Collections used:
//   list_prices        — master price pages (seeded by seed_list_prices.js; GM-only writes via script)
//   list_price_quotes  — archival record of every customer quotation downloaded by Sales/Manager
//   counters           — atomic TTSLP-XXXXXX sequence
// No route here writes to `inquiries` or to `list_prices`.

function lpAuth(req, res, write) {
  const role = String(req.cookies?.role || '').toLowerCase();
  if (!role) { res.status(401).json({ error: 'Session expired. Please log in again.' }); return null; }
  // ✅ LPSEARCH: OPS (view-only roles) get READ access for order processing; writes stay Sales/Manager
  const READ_ROLES = ['sales', 'manager', 'ops_view', 'viewer'];
  if (write && role !== 'sales' && role !== 'manager') { res.status(403).json({ error: 'Not authorized for List Price downloads.' }); return null; }
  if (!write && READ_ROLES.indexOf(role) < 0) { res.status(403).json({ error: 'Not authorized for List Price.' }); return null; }
  if (!conn || conn.readyState !== 1) { res.status(503).json({ error: 'Database not ready. Please retry.' }); return null; }
  return {
    role,
    username: String(req.cookies?.username || ''),
    salesGroup: String(req.cookies?.salesGroup || '').trim()
  };
}

// Directory: page list without row data
app.get('/api/list-prices', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  try {
    const auth = lpAuth(req, res); if (!auth) return;
    const pages = await conn.collection('list_prices')
      .find({}, { projection: { sections: 0, pageNote: 0 } })
      .sort({ sortOrder: 1 }).toArray();
    return res.json({ pages });
  } catch (err) {
    console.error('❌ /api/list-prices error:', err);
    return res.status(500).json({ error: 'Server error while loading list prices.' });
  }
});

// Single page: full master data (read-only)
app.get('/api/list-price-page', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  try {
    const auth = lpAuth(req, res); if (!auth) return;
    const key = String(req.query.key || '').trim();
    if (!key) return res.status(400).json({ error: 'Missing page key.' });
    const page = await conn.collection('list_prices').findOne({ pageKey: key });
    if (!page) return res.status(404).json({ error: 'Price page not found. Has seed_list_prices.js been run?' });
    return res.json({ page });
  } catch (err) {
    console.error('❌ /api/list-price-page error:', err);
    return res.status(500).json({ error: 'Server error while loading price page.' });
  }
});

// Download record: called once per PDF download; assigns the TTSLP number and archives the snapshot
app.post('/api/list-price-quotes', async (req, res) => {
  try {
    const auth = lpAuth(req, res, true); if (!auth) return;   // ✅ LPSEARCH: write op
    const b = req.body || {};
    const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
    const company = clip(b.customer && b.customer.company, 200).trim();
    if (!company) return res.status(400).json({ error: 'Company Name is required before download.' });
    const pageKey = clip(b.pageKey, 60).trim();
    const master = await conn.collection('list_prices').findOne({ pageKey }, { projection: { title: 1, category: 1 } });
    if (!master) return res.status(400).json({ error: 'Unknown price page.' });
    if (!Array.isArray(b.sections) || b.sections.length === 0 || b.sections.length > 40) {
      return res.status(400).json({ error: 'Invalid snapshot.' });
    }
    // snapshot sanitize: fixed shape, capped sizes (adjusted price + original list price both kept)
    const sections = b.sections.map(s => ({
      heading: clip(s.heading, 300),
      rows: (Array.isArray(s.rows) ? s.rows : []).slice(0, 120).map(r => ({
        description: clip(r.description, 500),
        price: clip(r.price, 60),
        listPrice: clip(r.listPrice, 60),
        unit: clip(r.unit, 40),
        minChg: clip(r.minChg, 40),
        notes: clip(r.notes, 300),
        changed: !!r.changed
      }))
    }));
    const adjustedCount = sections.reduce((n, s) => n + s.rows.filter(r => r.changed).length, 0);

    // ✅ REVISE: revision of an existing archive — no new sequence number;
    // quoteNo becomes <root>-Updated-N (N = existing revision count + 1)
    const baseQ = clip(b.baseQuoteNo, 40);
    if (baseQ) {
      const baseRec = await conn.collection('list_price_quotes').findOne({ quoteNo: baseQ });
      if (!baseRec) return res.status(404).json({ error: 'Base record ' + baseQ + ' not found.' });
      if (auth.role === 'sales' && !groupList(auth.salesGroup).some(g => groupList(baseRec.salesGroup).includes(g))) {
        return res.status(403).json({ error: 'This record belongs to another sales group.' });
      }
      const root = baseQ.replace(/-Updated-\d+$/i, '');
      const rxRoot = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const revisions = await conn.collection('list_price_quotes').find({ quoteNo: new RegExp('^' + rxRoot + '-Updated-\\d+$', 'i') }, { projection: { quoteNo: 1 } }).toArray();
      const maximum = revisions.reduce((n, r) => Math.max(n, Number(String(r.quoteNo).match(/-Updated-(\d+)$/i)?.[1] || 0)), 0);
      const counters = conn.collection('counters');
      const counterKey = 'lp-revision:' + root;
      try { await counters.updateOne({ _id: counterKey }, { $max: { seq: maximum } }, { upsert: true }); }
      catch (err) { if (err.code !== 11000) throw err; }
      let next = await counters.findOneAndUpdate({ _id: counterKey }, { $inc: { seq: 1 } }, { returnDocument: 'after' });
      if (next && next.value !== undefined) next = next.value;
      if (!next || !Number.isSafeInteger(next.seq)) throw new Error('Unable to allocate revision number.');
      const quoteNo = root + '-Updated-' + next.seq;
      const record = {
        quoteNo, revisionOf: root, pageKey, pageTitle: master.title, category: master.category,
        customer: {
          company,
          contact: clip(b.customer && b.customer.contact, 120),
          phone: clip(b.customer && b.customer.phone, 60),
          address: clip(b.customer && b.customer.address, 300),
          paymentTerm: clip(b.customer && b.customer.paymentTerm, 60)
        },
        validThrough: clip(b.validThrough, 40), gfQuoteNo: clip(b.gfQuoteNo, 60),
        sections, adjustedCount, username: auth.username, role: auth.role, salesGroup: baseRec.salesGroup,
        createdAt: new Date()
      };
      await conn.collection('list_price_quotes').insertOne(record);
      return res.json({ quoteNo, revisionOf: root });
    }

    // atomic TTSLP sequence
    const counters = conn.collection('counters');
    let seqDoc = await counters.findOneAndUpdate(
      { _id: 'ttslp' }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' });
    if (seqDoc && seqDoc.value !== undefined) seqDoc = seqDoc.value;   // driver version compatibility
    if (!seqDoc || !seqDoc.seq) seqDoc = await counters.findOne({ _id: 'ttslp' });
    const quoteNo = 'TTSQT-' + String(seqDoc.seq).padStart(6, '0');   // ✅ LPSEARCH: unified customer-facing prefix (legacy TTSLP-xxxxxx records remain valid & searchable)

    await conn.collection('list_price_quotes').insertOne({
      quoteNo,
      pageKey,
      pageTitle: master.title || pageKey,
      category: master.category || '',
      customer: {
        company,
        contact: clip(b.customer && b.customer.contact, 120),
        phone: clip(b.customer && b.customer.phone, 60),
        address: clip(b.customer && b.customer.address, 300),
        paymentTerm: clip(b.customer && b.customer.paymentTerm, 60)
      },
      validThrough: clip(b.validThrough, 40),
      gfQuoteNo: clip(b.gfQuoteNo, 60),   // ✅ LISTPRICE: cross-reference to the GoFreight quotation
      sections,
      adjustedCount,
      username: auth.username,
      role: auth.role,
      salesGroup: auth.salesGroup,
      createdAt: new Date()
    });
    return res.json({ quoteNo });
  } catch (err) {
    console.error('❌ /api/list-price-quotes POST error:', err);
    return res.status(500).json({ error: 'Server error while recording the download.' });
  }
});

// ✅ LPSEARCH: single archived record with full snapshot (read-only; OPS allowed)
app.get('/api/list-price-quote-detail', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  try {
    const auth = lpAuth(req, res); if (!auth) return;
    const no = String(req.query.no || '').trim();
    if (!no) return res.status(400).json({ error: 'Missing quotation number.' });
    const rec = await conn.collection('list_price_quotes').findOne({ quoteNo: no });
    if (!rec) return res.status(404).json({ error: 'Record ' + no + ' not found.' });
    if (['sales', 'ops_view'].includes(auth.role) && !groupList(auth.salesGroup).some(g => groupList(rec.salesGroup).includes(g))) {
      return res.status(403).json({ error: 'This record belongs to another sales group.' });
    }
    return res.json({ record: rec });
  } catch (err) {
    console.error('\u274c /api/list-price-quote-detail error:', err);
    return res.status(500).json({ error: 'Server error while loading the record.' });
  }
});

// Recent downloads: manager sees all, sales sees own group
app.get('/api/list-price-quotes', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  try {
    const auth = lpAuth(req, res); if (!auth) return;
    const qStr = String(req.query.q || '').trim();   // ✅ LPSEARCH
    const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || (qStr ? 50 : 10), qStr ? 50 : 20));
    const groups = groupList(auth.salesGroup);
    const escapeGroup = g => g.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const filter = ['sales', 'ops_view'].includes(auth.role) ? { salesGroup: groups.length ? { $regex: '(^|,)(' + groups.map(escapeGroup).join('|') + ')(,|$)' } : { $in: [] } } : {};

    if (qStr) {
      const rx = new RegExp(qStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ quoteNo: rx }, { 'customer.company': rx }, { gfQuoteNo: rx }];
    }
    const recs = await conn.collection('list_price_quotes')
      .find(filter, { projection: { quoteNo: 1, pageTitle: 1, pageKey: 1, 'customer.company': 1, username: 1, createdAt: 1, adjustedCount: 1, gfQuoteNo: 1 } })
      .sort({ createdAt: -1 }).limit(limit).toArray();
    return res.json({ records: recs });
  } catch (err) {
    console.error('❌ /api/list-price-quotes GET error:', err);
    return res.status(500).json({ error: 'Server error while loading download records.' });
  }
});

// ✅ LPQUOTE: create (or return) the per-inquiry List-Price row snapshot.
// Called by the WH modal when it opens an inquiry that has a Service Subtype.
// Idempotent: an existing snapshot is returned untouched, so GM edits to the
// list_prices master NEVER shift rows of already-quoted inquiries.
app.post('/api/lp-quote-init', async (req, res) => {
  try {
    const role = String(req.cookies?.role || '').toLowerCase();
    if (!role) return res.status(401).json({ error: 'Session expired. Please log in again.' });
    if (!['sales', 'sourcing', 'manager'].includes(role)) return res.status(403).json({ error: 'Not authorized.' });
    if (!conn || conn.readyState !== 1 || !Inquiry) return res.status(503).json({ error: 'Database not ready.' });

    const q = String((req.body || {}).q || '').trim();
    if (!q) return res.status(400).json({ error: 'Missing quotation number.' });
    const doc = await Inquiry.findOne({ 'Quotation #': q }).lean();
    if (!doc) return res.status(404).json({ error: 'Quotation not found.' });

    if (!requireInquiryAccess(req, res, doc)) return;
    if (gfBusy(doc)) return conflict(res, 'GoFreight push is pending or needs reconciliation.');

    // Already snapshotted -> return as-is, unless the caller forces a rebuild (sub-option switched)
    const force = (req.body || {}).force === true;
    let unset = {};
    if (force && !['sales', 'manager'].includes(role)) return res.status(403).json({ error: 'Only Sales or Manager may rebuild the template.' });
    if (String(doc['LP Rows'] || '').trim()) {
      if (!force) {
        try {
          return res.json({ rows: JSON.parse(doc['LP Rows']), pageKey: doc['LP Page Key'] || '', existing: true, data: maskInquiryDocs([doc], role)[0] });
        } catch (e) { /* corrupted snapshot: fall through and rebuild */ }
      } else {
        // wipe the old dynamic rows completely before rebuilding
        let oldRows = [];
        try { oldRows = JSON.parse(doc['LP Rows']); } catch (e2) { oldRows = []; }
        unset = {};
        (Array.isArray(oldRows) ? oldRows : []).forEach(r => {
          ['Cost', 'Price', 'Qty', 'Desc', 'OnQuote'].forEach(sfx => { unset['LP ' + r.i + ' ' + sfx] = 1; });
          for (let s2 = 1; s2 <= WH_SUPPLIER_COUNT; s2++) unset['LP ' + r.i + ' Cost S' + s2] = 1;
        });
        // Apply the removal only after the replacement has been validated.
      }
    }

    if (String(doc['WH Locked By'] || '').trim() || isTruthy(doc.warehouseSalesConfirmed) || isTruthy(doc.warehouseManagerConfirmed)) return conflict(res, 'Unlock the warehouse quote before changing its template.');

    // ✅ LPQUOTE: the modal passes the just-selected sub-option directly — it wins over the
    // (possibly not-yet-autosaved) DB value, eliminating the debounce race.
    const sub = String((req.body || {}).sub || doc['Service Subtypes'] || '').split(/[;,]/)[0].trim();
    const pageKey = LP_SUBTYPE_PAGES[sub] || '';
    if (!pageKey) return res.status(400).json({ error: 'This inquiry has no recognized service sub-option.' });
    const page = await conn.collection('list_prices').findOne({ pageKey });
    if (!page) return res.status(404).json({ error: 'List price page not found. Run seed_list_prices.js first.' });

    const rows = [];
    (page.sections || []).forEach(sec => {
      (sec.rows || []).forEach(r => {
        rows.push({
          i: rows.length + 1,
          section: sec.heading || '',
          description: r.description || '',
          unit: r.unit || '',
          listPrice: r.price || '',
          minChg: r.minChg || '',
          notes: r.notes || '',
          custom: false
        });
      });
    });
    // Two blank custom lines for competitor-matching items
    rows.push({ i: rows.length + 1, section: 'Others', description: '', unit: '', listPrice: '', minChg: '', notes: '', custom: true });
    rows.push({ i: rows.length + 1, section: 'Others', description: '', unit: '', listPrice: '', minChg: '', notes: '', custom: true });

    // Persist snapshot + prefill Sales price with the numeric master price (empty stays empty)
    const set = { 'LP Rows': JSON.stringify(rows), 'LP Page Key': pageKey, 'Service Subtypes': sub };
    rows.forEach(r => {
      if (!r.custom && /^\d+(\.\d+)?$/.test(String(r.listPrice)) && (force || String(doc['LP ' + r.i + ' Price'] || '').trim() === '')) {
        set['LP ' + r.i + ' Price'] = String(r.listPrice);
      }
    });
    if (force) Object.assign(set, { warehouseCostSaved: 'false', warehouseCostSent: 'false', warehouseCostDraft: 'true' });
    const rebuilt = { ...doc };
    Object.keys(unset).forEach(k => delete rebuilt[k]);
    Object.assign(rebuilt, set);
    computeWarehouseTotals(rebuilt);
    set['WH Cost Total'] = rebuilt['WH Cost Total'];
    set['WH Price Total'] = rebuilt['WH Price Total'];
    Object.keys(set).forEach(k => { delete unset[k]; });
    const change = { $set: set, $inc: { __v: 1 } };
    if (Object.keys(unset).length) change.$unset = unset;
    const result = await Inquiry.updateOne(revisionFilter(doc), change);
    if (!(result.matchedCount ?? result.n)) return conflict(res);
    broadcastInquiry(q, doc);
    return res.json({ rows, pageKey, existing: false, data: maskInquiryDocs([{ ...rebuilt, ...set, __v: (doc.__v || 0) + 1 }], role)[0] });
  } catch (err) {
    console.error('❌ /api/lp-quote-init error:', err);
    return res.status(500).json({ error: 'Server error while preparing the quote template.' });
  }
});

app.post('/inquiries/update', async (req, res) => {
  const role = String(req.cookies?.role || '').toLowerCase();
  if (!['sales', 'sourcing', 'manager'].includes(role)) {
    return res.status(403).json({ success: false, message: role === 'ops_view' ? 'OPS view-only cannot modify data.' : 'Not authorized.' });
  }

  try {
    if (!USE_MOCK && !dbReady(res)) return;
    const incoming = req.body || {};
    console.log('[UPDATE] role=', role, 'quotation=', incoming['Quotation #'], 'keys=', Object.keys(incoming || {}));

    const quotationId = String(incoming['Quotation #'] || '').trim();

    function buildSafePatch(payload) {
  const patch = {};

  for (const [k, v] of Object.entries(payload || {})) {

    // ❌ 不允许改主键
    if (k === '_id' || k === 'Quotation #' || k === 'Quotation # ') continue;

    // ✅ boolean 一定允许
    if (typeof v === 'boolean') {
      patch[k] = v;
      continue;
    }

    // ✅ number 一定允许（包括 0）
    if (typeof v === 'number') {
      patch[k] = v;
      continue;
    }

    // ✅ string —— 允许空字符串写入
    if (typeof v === 'string') {
      patch[k] = v;
      continue;
    }

    // 其他类型也允许写入
    patch[k] = v;
  }

  return patch;
}

    if (!quotationId || String(quotationId).trim() === '') {
      return res.status(400).json({ success: false, message: 'Missing Quotation #' });
    }

    // ===== Field buckets (scope-aware) =====
    const TRUCK_COST_FIELDS = [
      'Base Rate', 'Chassis', 'Pre-Pull', 'Yard Storage', 'Driver Waiting',
      'Over Weight', 'Chassis Split', 'Toll', 'Reefer Fee', 'Bond Fee', 'Drop Fee', 'Carrier'
    ];
    const TRUCK_PRICE_FIELDS = [
      'Adjusted Price', 'Chassis Price', 'Pre-Pull Price', 'Yard Storage Price', 'Driver Waiting Price',
      'Over Weight Price', 'Chassis Split Price', 'Toll Price', 'Reefer Fee Price', 'Bond Fee Price', 'Drop Fee Price', 'Carrier',
      'Price', 'GP', 'Adjusted GP'
    ];
    const WH_COST_FIELDS = [
      'Order Processing', 'Inbound', 'Sorting', 'Palletizing', 'Pallet Fee',
      'Storage', 'Outbound', 'Vendor'
    ];
    const WH_PRICE_FIELDS = [
      'Order Processing Price', 'Inbound Price', 'Sorting Price', 'Palletizing Price', 'Pallet Fee Price',
      'Storage Price', 'Outbound Price', 'Vendor'
    ];

    const TRUCK_COST_FLAGS = ['truckingCostSaved', 'truckingCostSent', 'truckingCostDraft', 'Selected', 'Cost Sent'];
    const WH_COST_FLAGS = ['warehouseCostSaved', 'warehouseCostSent', 'warehouseCostDraft', 'Selected', 'Cost Sent'];

    const PRICE_SAVED_FLAGS = ['truckingPriceSaved', 'warehousePriceSaved'];

    const CONFIRM_FIELDS = [
      'truckingSalesConfirmed', 'truckingManagerConfirmed',
      'warehouseSalesConfirmed', 'warehouseManagerConfirmed'
    ];

    const INQUIRY_EDIT_FIELDS = [
      'Container Size', 'Commodity', 'Packages Per Container', 'Dry Van Type',
      'Legal or Over Weight', 'Gross Weight', 'Live or Drop', 'From', 'To',
      'To City', 'To State', 'To ZIP', 'QTY', 'Quotation #',
      'External Quotation #',
      'Submitted To Sourcing', 'Submitted To Sourcing At',
      // ▼ WH redesign: green common-info fields are filled by Sales/Manager (Sourcing reads only)
      'ETA', '# of Containers', 'Service Types'
    ];

    // ▼ WH redesign: make the new WH fields writable by the right roles (additive)
    WH_NEW_BUCKETS.forEach(b => {
      WH_COST_FIELDS.push(b[1]);
      WH_PRICE_FIELDS.push(b[1] + ' Price');
      if (b[3]) WH_COST_FIELDS.push(b[1] + ' Period');
    });
    WH_TEMPLATE_BUCKETS.forEach(b => {
      WH_COST_FIELDS.push(b + ' Qty');
      for (let s = 1; s <= WH_SUPPLIER_COUNT; s++) WH_COST_FIELDS.push(b + ' Cost S' + s);
    });
    for (let s = 1; s <= WH_SUPPLIER_COUNT; s++) WH_COST_FIELDS.push('Supplier ' + s + ' Name');
    WH_COST_FIELDS.push('Selected Supplier', 'Label', 'Cross Dock', 'ETA', '# of Containers', 'Service Types');
    WH_PRICE_FIELDS.push('Label Price', 'Cross Dock Price');
    INQUIRY_EDIT_FIELDS.push('ETA', '# of Containers', 'Service Types');
    // ✅ SUBTYPE: warehouse service sub-option field (additive; mirrors 'Service Types' registration
    //    so Sales/Manager can save it from the form and the WH modal autosave path also works)
    WH_COST_FIELDS.push('Service Subtypes');
    INQUIRY_EDIT_FIELDS.push('Service Subtypes');

    const META_DENY_ALWAYS = new Set(['_id', 'Quotation #']); // cannot change primary key in update

    function inList(v, arr) { return arr.includes(v); }

    function fieldScope(field) {
      if (field.startsWith('LP ')) return 'WH';   // ✅ LPQUOTE
      if (inList(field, TRUCK_COST_FIELDS) || inList(field, TRUCK_PRICE_FIELDS) || field.startsWith('trucking')) return 'TRUCK';
      if (inList(field, WH_COST_FIELDS) || inList(field, WH_PRICE_FIELDS) || field.startsWith('warehouse')) return 'WH';
      return 'BASIC';
    }

    function isTruckConfirmed(doc) {
      return isTruthy(doc['truckingSalesConfirmed']) || isTruthy(doc['truckingManagerConfirmed']);
    }
    function isWhConfirmed(doc) {
      return isTruthy(doc['warehouseSalesConfirmed']) || isTruthy(doc['warehouseManagerConfirmed']);
    }

    function scopeLockedForRole(doc, scope, role) {
      // Sourcing cannot touch a scope after Sales OR Manager confirmed that scope
      if (role === 'sourcing') {
        if (scope === 'TRUCK') return isTruckConfirmed(doc);
        if (scope === 'WH') return isWhConfirmed(doc);
      }

      // Sales cannot touch a scope after Manager confirmed that scope
      if (role === 'sales') {
        if (scope === 'TRUCK') return isTruthy(doc['truckingManagerConfirmed']);
        if (scope === 'WH') return isTruthy(doc['warehouseManagerConfirmed']);
      }

      // Manager can always override (including uncheck)
      return false;
    }

    function roleCanUpdateField(role, field) {
      // Everyone can update Note (used as communication field)
      if (field === 'Note') return true;

      // ✅ Truck Inquiry Note: editable by all roles (entered on the inquiry form, tweakable in-cell)
      if (field === 'Truck Inquiry Note') return true;

      // ✅ 允许 Sourcing 更新 Warehouse Note
      if (field === 'Warehouse Note') return true;

      // ✅ Vendor Note：只有 Sourcing 可以填写/修改，其他角色只能查看
      if (field === 'Vendor Note') return role === 'sourcing';
      if (field === 'WH Vendor Note') return role === 'sourcing';

      // Front-ends commonly include this as a generic "touch" flag.
      // Allow it for all roles so we don't hard-fail saves.
      if (field === 'Saved') return true;

      // ✅ GF Ref: GoFreight's internal quotation ref (the number in the GF page URL) —
      // required for pushing locked pricing to GF. Sales & Manager set it (they own the
      // push action). BASIC scope, so it stays writable after the row is confirmed/locked,
      // which is exactly when pushing happens.
      if (field === 'GF Ref') return role === 'sales' || role === 'manager';

      // Compatibility with older clients: display-flag resets do not erase the durable
      // route delivery ledger or permit another GF charge group. Clients cannot set true
      // through this general update endpoint.
      if (field === 'Pushed To GF') return role === 'sales' || role === 'manager';

      if (role === 'sourcing') {
        // Sourcing updates COST + cost flags only.
        // Supplier CHOICE belongs to Sales: Sourcing fills the 5 supplier costs + supplier names,
        // but cannot pick which supplier is selected.
        if (field === 'Selected Supplier') return false;
        return (
          /^LP \d+ (Cost S[1-5]|Desc)$/.test(field) ||   // ✅ LPQUOTE: sourcing fills dynamic-row costs / custom descriptions
          inList(field, TRUCK_COST_FIELDS) ||
          inList(field, WH_COST_FIELDS) ||
          inList(field, TRUCK_COST_FLAGS) ||
          inList(field, WH_COST_FLAGS)
        );
      }

      if (role === 'sales') {
        // Sales updates PRICE + saved flags + sales-confirm flags, and limited inquiry edits (before cost)
        return (
          /^LP \d+ (Price|Desc)$/.test(field) ||   // ✅ LPQUOTE: sales sets dynamic-row prices / custom descriptions ('LP n Qty' already matches the Qty rule)
          inList(field, TRUCK_PRICE_FIELDS) ||
          inList(field, WH_PRICE_FIELDS) ||
          inList(field, PRICE_SAVED_FLAGS) ||
          field === 'Selected Supplier' ||          // ✅ Sales picks which supplier to quote
          field.endsWith(' Qty') ||                 // ✅ Sales fills the per-service Qty / detail (green zone)
          field.endsWith(' OnQuote') ||             // ✅ Sales marks which rows go on the quote sheet
          field === 'truckingSalesConfirmed' ||
          field === 'warehouseSalesConfirmed' ||
          inList(field, INQUIRY_EDIT_FIELDS)
        );
      }

      if (role === 'manager') {
        return (
          /^LP \d+ (Price|Desc)$/.test(field) ||   // ✅ LPQUOTE
          inList(field, TRUCK_PRICE_FIELDS) ||
          inList(field, WH_PRICE_FIELDS) ||
          inList(field, PRICE_SAVED_FLAGS) ||
          field === 'Selected Supplier' ||          // ✅ Manager can override the supplier choice
          field.endsWith(' Qty') ||                 // ✅ Manager can fill the per-service Qty / detail
          field.endsWith(' OnQuote') ||             // ✅ Manager marks which rows go on the quote sheet
          field === 'truckingManagerConfirmed' ||
          field === 'warehouseManagerConfirmed' ||

          // ✅ 加这两条：允许 Manager 覆盖 Sales 勾选
          field === 'truckingSalesConfirmed' ||
          field === 'warehouseSalesConfirmed' ||

          inList(field, INQUIRY_EDIT_FIELDS)
        );
      }

      return false;
    }

    // ========= Load existing =========
    async function loadExisting() {
      if (USE_MOCK || !conn || conn.readyState !== 1 || !Inquiry) {
        const idx = mockInquiries.findIndex(x => x['Quotation #'] === quotationId);
        if (idx === -1) return { mode: 'mock', doc: null, idx: -1 };
        return { mode: 'mock', doc: mockInquiries[idx], idx };
      }
      const doc = await Inquiry.findOne({ 'Quotation #': quotationId });
      return { mode: 'mongo', doc, idx: -1 };
    }

    const loaded = await loadExisting();
    const existing = loaded.doc;

    if (!existing) {
      return res.status(404).json({ success: false, message: loaded.mode === 'mock' ? 'Quotation # not found (mock)' : 'Quotation # not found' });
    }

    if (!requireInquiryAccess(req, res, existing)) return;
    if (gfBusy(existing)) return conflict(res, 'GoFreight push is pending or needs reconciliation. Edits are temporarily blocked.');
    if (isTruthy(existing['Pushed To GF'])) await gfRouteState(gfRouteKey(quotationId));

    // Snapshot for "auto price keep manual override" logic
    const prevSnapshot = JSON.parse(JSON.stringify(existing));

    // ========= Build filtered update set =========
    const blocked = [];
    const filtered = {};

    // ✅ FIX (intentional clear): fields the user EXPLICITLY emptied this edit session.
    //    Front-ends compare each input against the cached original value and list ONLY
    //    fields that went non-empty -> empty. Only these may write '' through the
    //    empty-string guard below; all other empty strings are still dropped
    //    (the accidental-wipe protection stays fully intact for every other path).
    //    Note: role permission + scope-lock checks still run BEFORE the guard, so this
    //    cannot clear any field the role couldn't write in the first place.
    const clearSet = new Set(
      Array.isArray(incoming.__clearFields)
        ? incoming.__clearFields.map(x => String(x || '').trim()).filter(Boolean)
        : []
    );

    for (const [k, v] of Object.entries(incoming)) {
      if (META_DENY_ALWAYS.has(k)) continue;

      // ✅ FIX (intentional clear): transport-only key, never persisted as a field
      if (k === '__clearFields') continue;

      // ✅ Ignore display/meta fields that front-ends may send back accidentally
      if (k === 'Requested By' || k === 'username') {
        continue;
      }

      // Some front-ends send helper fields that Sourcing should not mutate.
      // Ignore them (do not hard-fail) to keep SAVE/CHECK flow working.
      if (role === 'sourcing' && (k === 'Inquiry Type')) {
        continue;
      }

      if (typeof v !== 'string' && typeof v !== 'boolean' && !(typeof v === 'number' && Number.isFinite(v))) {
        blocked.push({ field: k, reason: 'invalid-field-type' }); continue;
      }
      // Old clients include unchanged read-only display fields. They are not edits.
      if (k !== 'WH Locked By' && String(existing[k] ?? '') === String(v)) continue;

      // ── Issue 4: WH manual lock field. Validate the lock/unlock transition by role.
      //   set 'sales'   : sales or manager     set 'manager' : manager only
      //   unlock (''): a Manager lock clears only by manager; a Sales lock by sales or manager.
      if (k === 'WH Locked By') {
        const cur = String(existing['WH Locked By'] || '').toLowerCase().trim();
        const next = String(v || '').toLowerCase().trim();
        let allow = false;
        if (next === 'sales') allow = role === 'manager' || (role === 'sales' && cur !== 'manager');
        else if (next === 'manager') allow = (role === 'manager');
        else if (next === '') allow = (cur === 'manager') ? (role === 'manager') : (role === 'sales' || role === 'manager');
        if (!allow) { blocked.push({ field: k, reason: 'wh-lock-permission' }); continue; }
        filtered[k] = next; // bypass empty-string guard so unlock ('') persists
        continue;
      }

      if (!roleCanUpdateField(role, k)) {
        blocked.push({ field: k, reason: 'field-not-allowed-for-role' });
        continue;
      }

      const scope = fieldScope(k);

      // Scope lock rules
      if (scope === 'TRUCK' && scopeLockedForRole(existing, 'TRUCK', role)) {
        blocked.push({ field: k, reason: 'truck-scope-locked' });
        continue;
      }
      if (scope === 'WH' && scopeLockedForRole(existing, 'WH', role)) {
        blocked.push({ field: k, reason: 'wh-scope-locked' });
        continue;
      }

      // ── Issue 4: when WH is manually locked ('WH Locked By' set), freeze supplier choice +
      // Sourcing cost + Price for ALL roles. Green-zone common fields, qty/detail and OnQuote stay editable.
      {
        const whLockedBy = String(existing['WH Locked By'] || '').toLowerCase().trim();
        if (whLockedBy && (
              (/ Price$/.test(k) && fieldScope(k) === 'WH') ||
              / Cost S\d+$/.test(k) ||
              /^Supplier \d+ Name$/.test(k) ||
              k === 'Selected Supplier'
            )) {
          blocked.push({ field: k, reason: 'wh-manual-locked' });
          continue;
        }
      }

      // Extra: Sales cannot uncheck once Manager confirmed (already covered by scope lock),
      // but also prevent toggling confirm flags in wrong direction if you ever loosen scope lock.
      if (role === 'sales' && k === 'truckingSalesConfirmed' && isTruthy(existing['truckingManagerConfirmed'])) {
        blocked.push({ field: k, reason: 'manager-confirmed-sales-cannot-uncheck' });
        continue;
      }
      if (role === 'sales' && k === 'warehouseSalesConfirmed' && isTruthy(existing['warehouseManagerConfirmed'])) {
        blocked.push({ field: k, reason: 'manager-confirmed-sales-cannot-uncheck' });
        continue;
      }

      // ✅ #4: cannot lock/confirm a scope whose cost hasn't been "sent to Sales" yet.
      // Confirming while still draft would hide the locked price from Sales AND disable
      // Sourcing's "Send to Sales" (deadlock). Only blocks setting a confirm flag to true;
      // unchecking (value falsy) stays allowed so a stuck row can still be unlocked.
      if (/Confirmed$/.test(k) && isTruthy(v)) {
        const confScope = k.startsWith('warehouse') ? 'warehouse' : 'trucking';
        if (isTruthy(existing[confScope + 'CostDraft'])) {
          blocked.push({ field: k, reason: 'cannot-confirm-while-draft' });
          continue;
        }
      }

      // ✅ Pushed To GF value guard: through THIS endpoint the flag may only be RESET.
      // Marking a line as pushed stays exclusive to /api/push-to-gofreight (which sets it
      // only after GoFreight actually accepted the charge group).
      if (k === 'Pushed To GF' && String(v) !== 'false') {
        blocked.push({ field: k, reason: 'only-reset-to-false-allowed' });
        continue;
      }

      // ✅ 防止前端空字串把已有值覆盖成空（特别是 autosave / checkbox）
      // ✅ FIX (intentional clear): fields explicitly listed in __clearFields are allowed
      //    to write '' — the user deliberately emptied them (verified against the cached
      //    original by the front-end). Everything else keeps the original protection.
      if (v === '' && !clearSet.has(k) && k !== 'Note' && k !== 'Truck Inquiry Note' && k !== 'Vendor Note' && k !== 'WH Vendor Note' && k !== 'Warehouse Note') {
        continue;
      }
      filtered[k] = v;
    }

    console.log('[UPDATE BLOCKED]', blocked);

// Reject actual forbidden changes before any fields are applied.
    if (blocked.length) return res.status(409).json({
      success: false, blocked, message: 'Nothing was saved. These fields are locked or not permitted: ' + blocked.map(b => b.field).join(', ')
    });

    // ========= Apply updates =========
    const patch = buildSafePatch(filtered);
    // ✅ CRITICAL FIX: Use .set() for Mongoose persistence AND direct assignment for in-request readback
    const isMongoDoc = typeof existing.set === 'function' && typeof existing.markModified === 'function';
    Object.keys(patch).forEach(key => {
      existing[key] = patch[key];               // own property: readable via doc[field] in same request
      if (isMongoDoc) existing.set(key, patch[key]); // _doc: persists via .save()
    });

    // ✅ #3 invariant: a scope that is still a draft can never be marked "sent".
    // Saving cost sets CostDraft='true' but historically left CostSent untouched, so a
    // re-saved line could keep a stale CostSent='true'. Force them consistent here, BEFORE
    // the Selected / Cost Sent flags below are derived from CostSent.
    ['trucking', 'warehouse'].forEach(p => {
      if (isTruthy(existing[p + 'CostDraft'])) {
        existing[p + 'CostSent'] = 'false';
        if (isMongoDoc) existing.set(p + 'CostSent', 'false');
      }
    });


    // ✅ Backward-compatible flags so Sales/Manager pages (older logic) can "receive" Cost Sent
    if (role === 'sourcing') {
      const anyCostSent =
        isTruthy(existing['truckingCostSent']) || isTruthy(existing['warehouseCostSent']);
      existing['Cost Sent'] = anyCostSent ? 'true' : 'false';
      existing['Selected'] = anyCostSent ? 'true' : 'false';
      if (isMongoDoc) {
        existing.set('Cost Sent', anyCostSent ? 'true' : 'false');
        existing.set('Selected', anyCostSent ? 'true' : 'false');
      }
    }

    // Always apply units and auto rules
    applyTruckingUnits(existing);
    applyWarehouseUnits(existing);
    applyWarehouseDefaults(existing);
    syncSelectedSupplierCost(existing);

    // Auto for Base Rate + GP
    applyBaseRateAutoPriceAndGP(existing);

    // Auto for other items (preserve manual overrides based on prevSnapshot)
    applyTruckingAutoPrices(prevSnapshot, existing);
    applyWarehouseAutoPrices(prevSnapshot, existing);
    computeWarehouseTotals(existing);

    // ========= Save =========
    if (loaded.mode === 'mock') {
      mockInquiries[loaded.idx] = existing;
      broadcastInquiry(quotationId, existing);
      return res.json({ success: true, partial: blocked.length > 0, blocked, appliedFields: Object.keys(patch), data: maskInquiryDocs([JSON.parse(JSON.stringify(existing))], role)[0] });
    }

    await existing.save();
    // ✅ If Sourcing updated COST flags on a sub-line, propagate group-level COST status to parent (so Sales always "receives" it)
    if (role === 'sourcing') {
      try {
        const parentKey = String(existing['Parent Quotation #'] || existing['Quotation #'] || '').trim();
        if (parentKey) {
          const docs = await Inquiry.find({
            $or: [
              { 'Quotation #': parentKey },
              { 'Parent Quotation #': parentKey }
            ]
          });

          const anyTruckSent = docs.some(d => isTruthy(d['truckingCostSent']));
          const anyTruckSaved = docs.some(d => isTruthy(d['truckingCostSaved']));
          const anyWhSent = docs.some(d => isTruthy(d['warehouseCostSent']));
          const anyWhSaved = docs.some(d => isTruthy(d['warehouseCostSaved']));

          const anyCostSent = anyTruckSent || anyWhSent;

          // Update parent main row (if exists)
          const parentDoc = docs.find(d => String(d['Quotation #'] || '').trim() === parentKey);
          if (parentDoc) {
            const isParentMongo = typeof parentDoc.set === 'function' && typeof parentDoc.markModified === 'function';
            const pSet = (k, v) => { parentDoc[k] = v; if (isParentMongo) parentDoc.set(k, v); };

            pSet('truckingCostSent', anyTruckSent && !isTruthy(parentDoc['truckingCostDraft']) ? 'true' : 'false');
            pSet('truckingCostSaved', anyTruckSaved ? 'true' : 'false');
            pSet('warehouseCostSent', anyWhSent && !isTruthy(parentDoc['warehouseCostDraft']) ? 'true' : 'false');
            pSet('warehouseCostSaved', anyWhSaved ? 'true' : 'false');

            // Backward compatible flags for older sales logic
            pSet('Cost Sent', anyCostSent ? 'true' : 'false');
            pSet('Selected', anyCostSent ? 'true' : 'false');

            await parentDoc.save();
            broadcastInquiry(parentKey, parentDoc);
          }
        }
      } catch (e) {
        console.warn('[UPDATE] parent cost flag propagate skipped:', e?.message || e);
      }
    }


    broadcastInquiry(quotationId, existing);
    return res.json({ success: true, partial: blocked.length > 0, blocked, appliedFields: Object.keys(patch), data: maskInquiryDocs([JSON.parse(JSON.stringify(existing))], role)[0] });

  } catch (err) {
    if (err.name === 'VersionError' || err.name === 'DocumentNotFoundError') return conflict(res);
    console.error('[ERROR] Update failed:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Server error'
    });
  }
});


app.post('/api/push-to-gofreight', async (req, res) => {
  const role = String(req.cookies?.role || '').toLowerCase();
  if (!['sales', 'manager'].includes(role)) {
    return res.status(403).json({ success: false, message: role === 'ops_view' ? 'OPS view-only cannot modify data.' : 'Not authorized.' });
  }

  try {
  if (!dbReady(res)) return;
  const inquiry = req.body;
  const apiKey = process.env.GOFREIGHT_API_KEY;
  const baseUrl = process.env.GOFREIGHT_API_BASE || 'https://api.core.gofreight.co';

  if (!inquiry || !inquiry['Quotation #']) {
    return res.status(400).json({ error: 'Missing Quotation #' });
  }

  const incoming = inquiry;
  const quotationId = String(incoming['Quotation #'] || '').trim();
  const fullQuoteId = quotationId;
  const dashIdx = quotationId.indexOf('-');
  const letterMatch = quotationId.match(/^\d+([A-Za-z])$/);
  const subId = dashIdx >= 0 ? quotationId.slice(dashIdx + 1) : (letterMatch ? letterMatch[1] : '');

  // ✅ Fetch the authoritative document from OUR OWN database. Price amounts are read from
  // this saved doc (not from req.body) so we only ever push what's actually confirmed/locked
  // in the system, never an in-progress unsaved edit the frontend happened to send.
  const ownDoc = await Inquiry.findOne({ 'Quotation #': quotationId }).lean();
  if (!ownDoc) {
    return res.status(404).json({ error: 'Inquiry not found in database: ' + quotationId });
  }
  if (!requireInquiryAccess(req, res, ownDoc)) return;
  const routeKey = gfRouteKey(quotationId);
  if (!routeKey) return res.status(400).json({ error: 'Invalid quotation number.' });
  const previousPush = await gfRouteState(routeKey);
  if (previousPush?.state === 'succeeded') return res.status(200).send('Already pushed');
  if (['pending', 'uncertain'].includes(previousPush?.state)) return conflict(res, 'This route already has a pending or uncertain GoFreight push. Verify it before retrying.');
  if (gfBusy(ownDoc)) return conflict(res, 'A GoFreight push is in progress or its result is uncertain. Check GoFreight before retrying.');
  if (isTruthy(ownDoc.truckingCostDraft) || !(isTruthy(ownDoc.truckingSalesConfirmed) || isTruthy(ownDoc.truckingManagerConfirmed))) return conflict(res, 'Confirm the trucking price after cost has been sent before pushing to GoFreight.');
  if (!apiKey) return res.status(503).json({ error: 'GoFreight API key is not configured.' });
  if (!ownDoc['Customer ID']) {
    return res.status(400).json({ error: quotationId + ' has no Customer ID on file.' });
  }

  // ✅ GF push cutoff: quotations before 2026-08-24 were already entered into GoFreight
  // manually by Sales — never auto-push them (would create duplicate/conflicting charge
  // groups). Derived from the document's _id timestamp, not the 'Date' field, because
  // 'Date' is a locale-formatted string ("8/24/2026") that sorts wrong as text, and
  // createdAt is missing on historical docs (same reasoning as the WIN90 filter above).
  const GF_PUSH_CUTOFF = new Date('2026-08-24T00:00:00.000Z');
  const docCreatedAt = ownDoc._id && typeof ownDoc._id.getTimestamp === 'function'
    ? ownDoc._id.getTimestamp() : null;
  if (docCreatedAt && docCreatedAt < GF_PUSH_CUTOFF) {
    return res.status(400).json({
      error: quotationId + ' predates the GoFreight push cutoff (2026-08-24). This quotation was already entered into GoFreight manually — do not sync it.'
    });
  }

  // ✅ Confirmed against GF's live Billing Codes API (2026-08-24) — see chat log for lookup commands.
  // billing_code_ref values are GF's internal ref numbers, NOT the LTLRG-xxx display codes.
  // remark values are the FIXED customer-facing boilerplate matching how Sales builds these
  // blocks manually in GF (these print on the quotation) — NEVER map internal Note fields here.
  const freightMapping = {
    'Adjusted Price': {
      ref: '624',   // LTLRG-PUR
      desc: 'Drayage- Hauling Fee per Container',
      unit: 'CNT',   // GF unit enum uses 3-letter codes (CNT/DAY/HRS/SPL), NOT the UI labels
      remark: 'INCLUDING FSC'
    },
    'Chassis Price': {
      ref: '601',   // LTLRG-CHSS (generic — NOT LTLRG-BBICHSS, which is customer-specific)
      desc: 'FCL Drayage Surcharge- Chassis Fee Per Day',
      unit: 'DAY',
      remark: '(MIN. 2 DAYS)'
    },
    'Pre-Pull Price': {
      ref: '622',   // LTLRG-PP
      desc: 'Drayage Surcharge- Pre Pull',
      unit: 'CNT',
      remark: 'IF APPLICABLE'
    },
    'Yard Storage Price': {
      ref: '655',   // LTLRG-YD
      desc: 'Drayage Surcharge- Yard Storage',
      unit: 'DAY',
      remark: 'IF APPLICABLE'
    },
    'Driver Waiting Price': {
      ref: '653',   // LTLRG-WT
      desc: 'Drayage Surcharge- Driver Waiting Time at Warehouse/ Per Hour',
      unit: 'HRS',
      remark: 'IF APPLICABLE, BILLED IN 30 MINS INCREMENTS, MIN. 30 MINS'
    },
    'Over Weight Price': {
      ref: '618',   // LTLRG-OWFE (generic — location-specific variants exist, see chat log)
      desc: 'Drayage Surcharge- Overweight Fee',
      unit: 'CNT',
      remark: 'IF APPLICABLE'
    },
    'Chassis Split Price': {
      ref: '642',   // LTLRG-SPLIT
      desc: 'Drayage Surcharge- Chassis Split',
      unit: 'SPL',
      remark: 'IF APPLICABLE'
    }
    // ✅ Drop Fee (2026-08-27): code confirmed as LTLRG-DROP, but the numeric GF ref
    //    is NOT yet confirmed. DO NOT enable until the ref is verified in GF
    //    (same procedure as the 7 refs above). Uncomment and fill ref to enable:
    // ,'Drop Fee Price': {
    //   ref: 'TODO-CONFIRM',   // LTLRG-DROP — look up the numeric id in GF freight codes
    //   desc: 'Drayage Surcharge- Drop Fee',
    //   unit: 'CNT',
    //   remark: 'IF APPLICABLE'
    // }
  };

  const chargeItems = [];

  for (const [field, config] of Object.entries(freightMapping)) {
    const amount = parseFloat(ownDoc[field]);
    if (!isNaN(amount) && amount > 0) {
      chargeItems.push({
        billing_code_ref: config.ref,
        description: config.desc,
        // carrier_ref omitted on purpose — optional per spec; 'TP0001' was a bogus draft leftover
        unit: config.unit,
        currency_ref: '1',
        use_separate_rate: false,
        all_price_data: {
          quantity: '1.0',
          rate: String(amount.toFixed(2)),
        },
        remark: config.remark
      });
    }
  }

  if (chargeItems.length === 0) {
    return res.status(400).json({ error: 'No locked price fields found on ' + quotationId + ' — nothing to push.' });
  }

  // ✅ ORDER FIX: GoFreight renders charge lines newest-first (last item in the array ends up
  // at the TOP of the charge group). Sending in natural order (Hauling → Chassis → ... → Split)
  // therefore displayed reversed. Reverse before sending so GF shows Hauling Fee first.
  chargeItems.reverse();

  // ✅ Resolve the GF quotation ref from OUR OWN database — NOT from a GF lookup-by-quotation_no
  // call, because GoFreight's public API has no such endpoint (confirmed against the official
  // OpenAPI spec: only GET /quotations/{ref} exists, no list/search by quotation_no).
  //
  // Ref lookup order (family-wide): the sub-line naming has TWO conventions — "005369-1"
  // (dash) and "005370A" (trailing letter). The letter convention has NO bare parent record
  // at all (the family starts at "005370A"), so relying on a parent doc alone dead-ends.
  // Instead: check own doc → explicit/derived parent doc → then ANY family member
  // (base, base+letter, base+dash-suffix) that has a GF Ref saved.
  let quotationRef = null;
  let gfRefMissingOn = quotationId;
  try {
    function stripOneSuffix(id) {
      const dashIdx = id.indexOf('-');
      if (dashIdx >= 0) return id.slice(0, dashIdx);
      const m = id.match(/^(\d+)[A-Za-z]$/);
      return m ? m[1] : '';
    }

    quotationRef = String(ownDoc['GF Ref'] || '').trim();

    // Immediate parent: explicit field first, then one pattern strip
    // (covers "005369-1"→"005369", "005370A"→"005370", "005370A-1"→"005370A")
    let parentId = String(ownDoc['Parent Quotation #'] || '').trim();
    if (!parentId) parentId = stripOneSuffix(quotationId);
    if (parentId) gfRefMissingOn = parentId;

    if (!quotationRef && parentId) {
      const parentDoc = await Inquiry.findOne({ 'Quotation #': parentId }).lean();
      if (parentDoc && canAccessInquiry(req, parentDoc)) quotationRef = String(parentDoc['GF Ref'] || '').trim();
    }

    // Family-wide search on the ULTIMATE base (strip suffixes repeatedly:
    // "005370A-1" → "005370A" → "005370"), so a ref saved on ANY family member —
    // bare base, letter line, dash line, or letter+dash line — is found from any sibling.
    if (!quotationRef) {
      let ultimateBase = quotationId;
      for (let guard = 0; guard < 4; guard++) {
        const next = stripOneSuffix(ultimateBase);
        if (!next || next === ultimateBase) break;
        ultimateBase = next;
      }
      const safeBase = ultimateBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const familyDoc = await Inquiry.findOne({
        salesGroup: ownDoc.salesGroup || '',
        'Quotation #': { $regex: '^' + safeBase + '([A-Za-z]|-|$)' },
        'GF Ref': { $nin: ['', null] }
      }).lean();
      if (familyDoc && canAccessInquiry(req, familyDoc)) quotationRef = String(familyDoc['GF Ref'] || '').trim();
      if (!quotationRef) gfRefMissingOn = ultimateBase + ' (family)';
    }

    if (!quotationRef) {
      return res.status(400).json({
        gfRefMissing: true,
        error: 'GF Ref not set on ' + gfRefMissingOn + '. Enter the GoFreight quotation ref (from its GF page URL) before pushing.'
      });
    }
  } catch (err) {
    console.error('❌ Failed to resolve GF Ref from database:', err);
    return res.status(500).json({ error: 'Error resolving GF Ref from database' });
  }

  // ✅ Charge-group title: mirror how Sales titles these blocks manually in GF —
  // "From {origin} to {destination}". Destination prefers the free-text 'To' field,
  // falling back to City/State/ZIP parts. If neither side is usable, fall back to
  // the old Route-letter label so the block is still identifiable.
  const fromTxt = String(ownDoc['From'] || '').trim();
  let toTxt = String(ownDoc['To'] || '').trim();
  if (!toTxt) {
    toTxt = [
      String(ownDoc['To City'] || '').trim(),
      [String(ownDoc['To State'] || '').trim(), String(ownDoc['To ZIP'] || '').trim()].filter(Boolean).join(' ')
    ].filter(Boolean).join(', ');
  }
  const routeLabel = (fromTxt && toTxt)
    ? `From ${fromTxt} to ${toTxt}`
    : (subId ? `Route ${subId}` : 'Destination charges');

  const token = crypto.randomBytes(16).toString('hex');
  const startedAt = new Date().toISOString();
  // The collection's built-in unique _id protects different carrier rows and processes.
  try {
    await gfLedger().updateOne({ _id: routeKey, state: 'ready' }, { $set: {
      state: 'pending', token, startedAt, sourceQuotation: quotationId, quotationRef
    } }, { upsert: true });
  } catch (err) {
    if (err.code !== 11000) throw err;
    const active = await gfLedger().findOne({ _id: routeKey });
    if (active?.state === 'succeeded') return res.status(200).send('Already pushed');
    return conflict(res, 'Another carrier in this route is already being pushed or needs verification.');
  }
  const claimFilter = { _id: routeKey, token, state: 'pending' };
  const claim = await Inquiry.updateOne({ ...revisionFilter(ownDoc), 'Pushed To GF': { $nin: ['true', true] }, 'GF Push State': { $nin: ['pending', 'uncertain'] } }, {
    $set: { 'GF Push State': 'pending', 'GF Push Token': token, 'GF Push Started At': startedAt }, $inc: { __v: 1 }
  });
  if (!(claim.matchedCount ?? claim.n)) {
    await gfLedger().updateOne(claimFilter, { $set: { state: 'ready' } });
    return conflict(res, 'This quotation changed. Refresh before trying again.');
  }
  broadcastInquiry(quotationId, ownDoc);
  try {
    console.log('[DEBUG] quotationRef:', quotationRef);
    console.log('[DEBUG] routeLabel:', routeLabel);
    console.log('[DEBUG] chargeItems:\n', JSON.stringify(chargeItems, null, 2));

    const gfRes = await fetch(`${baseUrl}/api/v1/quotations/${quotationRef}/charge-groups`, {
      method: 'POST',
      timeout: 30000,
      headers: {
        'X-GATEWAY-TOKEN': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        description: routeLabel,
        // location_ref omitted on purpose — optional per spec; 'USLAX' was a bogus draft leftover
        charge_items: chargeItems
      })
    });

    const result = await gfRes.text();

    // A successful status is success even when the provider sends an empty/non-JSON body.
    // Non-success/timeout is uncertain: the provider may already have committed a charge group.
    let resultJson = {};
    try { resultJson = result ? JSON.parse(result) : {}; } catch (_) { resultJson = { message: result.slice(0, 1000) }; }
    if (!gfRes.ok) throw new Error('GoFreight returned HTTP ' + gfRes.status + '. Verify the quotation before retrying.');
    const savedPush = await gfLedger().updateOne(claimFilter, { $set: {
      state: 'succeeded', completedAt: new Date().toISOString(), by: req.cookies.username,
      response: result.slice(0, 4000)
    } });
    if (!(savedPush.matchedCount ?? savedPush.n)) throw new Error('GoFreight accepted the push but the route status could not be updated.');
    await syncGfRoute(routeKey, {
      'Pushed To GF': 'true', 'Pushed To GF At': new Date().toISOString(),
      'Pushed To GF By': req.cookies.username, 'GF Push State': 'succeeded',
      'GF Push Error': '', 'GF Push Source Quotation': quotationId
    });

    // ✅ Broadcast like every other save path does — without this, any socket-triggered
    // table re-render (including the GF Ref save moments earlier) redraws the rocket
    // from pre-push data and it shows colored again even though the push succeeded.
    broadcastInquiry(quotationId, ownDoc);

    res.status(200).json(resultJson);
  } catch (err) {
    try {
      await gfLedger().updateOne(claimFilter, { $set: { state: 'uncertain', error: String(err.message || err).slice(0, 1000) } });
      const durable = await gfLedger().findOne({ _id: routeKey });
      await syncGfRoute(routeKey, { 'GF Push State': durable?.state || 'uncertain', 'Pushed To GF': durable?.state === 'succeeded' ? 'true' : 'false', 'GF Push Error': String(err.message || err).slice(0, 1000) });
    } catch (recordErr) { console.error('GF status recording failed:', recordErr.message); }
    broadcastInquiry(quotationId, ownDoc);
    console.error('❌ Push to GoFreight failed:', err);
    res.status(502).json({ error: 'Push result needs verification in GoFreight. Do not repeat the push until reconciled.', detail: err.message });
  }
  } catch (err) { console.error('GF preflight failed:', err.message); return res.status(503).json({ error: 'Unable to prepare GoFreight push. Please retry later.' }); }
});


app.post('/api/reconcile-gf-push', async (req, res) => {
  if (req.cookies?.role !== 'manager') return res.status(403).json({ success: false, message: 'Manager only.' });
  try {
    if (!dbReady(res)) return;
    const q = String(req.body?.['Quotation #'] || '').trim();
    const resolution = req.body?.resolution;
    const note = String(req.body?.note || '').trim();
    if (!q || !['confirmed_sent', 'confirmed_not_sent'].includes(resolution) || note.length < 5) return res.status(400).json({ success: false, message: 'Quotation, resolution and verification note are required.' });
    const doc = await Inquiry.findOne({ 'Quotation #': q }).lean();
    if (!doc) return res.status(404).json({ success: false, message: 'Quotation not found.' });
    const key = gfRouteKey(q);
    const state = await gfRouteState(key);
    if (!state || !['pending', 'uncertain'].includes(state.state)) return conflict(res, 'This route does not need reconciliation.');
    if (state.state === 'pending' && (!state.startedAt || Date.now() - Date.parse(state.startedAt) < 120000)) return conflict(res, 'Push may still be running. Wait at least two minutes before checking.');
    const sent = resolution === 'confirmed_sent';
    const fields = { state: sent ? 'succeeded' : 'ready', reconciledAt: new Date().toISOString(), by: req.cookies.username, note };
    if (state.legacy) {
      try { await gfLedger().insertOne({ _id: key, ...fields }); }
      catch (err) { if (err.code === 11000) return conflict(res); throw err; }
    } else {
      const result = await gfLedger().updateOne({ _id: key, state: state.state, token: state.token }, { $set: fields });
      if (!(result.matchedCount ?? result.n)) return conflict(res);
    }
    await syncGfRoute(key, {
      'Pushed To GF': sent ? 'true' : 'false', 'GF Push State': sent ? 'succeeded' : 'ready',
      'GF Reconciled At': fields.reconciledAt, 'GF Reconciled By': req.cookies.username, 'GF Reconciliation Note': note
    });
    broadcastInquiry(q, doc);
    return res.json({ success: true });
  } catch (err) { return res.status(500).json({ success: false, message: 'Reconciliation failed.' }); }
});

app.post('/duplicate_inquiry', async (req, res) => {
  const role = String(req.cookies?.role || '').toLowerCase();
  if (!['sales', 'sourcing', 'manager'].includes(role)) {
    return res.status(403).json({ success: false, message: role === 'ops_view' ? 'OPS view-only cannot modify data.' : 'Not authorized.' });
  }

  const quoteId = String((req.body || {}).quoteId || '').trim();
  if (!quoteId) return res.status(400).json({ success: false, message: 'Missing quoteId' });

  try {
    if (!dbReady(res)) return;
    const original = await Inquiry.findOne({ 'Quotation #': quoteId }).lean();
    if (!original) return res.status(404).json({ success: false, message: 'Quotation # not found' });

    if (!requireInquiryAccess(req, res, original)) return;
    if (gfBusy(original)) return conflict(res, 'GoFreight push is pending or needs reconciliation.');
    const baseId = quoteId.split('-')[0];
    const escapeRegExp = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const siblings = await Inquiry.find({ 'Quotation #': { $regex: `^${escapeRegExp(baseId)}-` } });

    const suffixes = siblings.map(doc => {
      const parts = (doc['Quotation #'] || '').split('-');
      return parseInt(parts[1]) || 0;
    });

    const nextSuffix = (suffixes.length > 0 ? Math.max(...suffixes) : 0) + 1;
    const newQuote = `${baseId}-${nextSuffix}`;

    const duplicated = { ...original, 'Quotation #': newQuote };
    delete duplicated._id;
    delete duplicated.__v;
    duplicated['Parent Quotation #'] = baseId;
    ['GF Push State', 'GF Push Token', 'GF Push Started At', 'GF Push Error', 'GF Push Response', 'Pushed To GF By'].forEach(k => delete duplicated[k]);
    duplicated['WH Locked By'] = '';
    ['trucking', 'warehouse'].forEach(scope => {
      duplicated[scope + 'CostSaved'] = 'false'; duplicated[scope + 'CostSent'] = 'false';
      duplicated[scope + 'CostDraft'] = 'true'; duplicated[scope + 'PriceSaved'] = 'false';
    });
    duplicated['Cost Sent'] = 'false';
    duplicated['Base Rate'] = '';
    duplicated['Chassis'] = '';
    duplicated['Pre-Pull'] = '';
    duplicated['Yard Storage'] = '';
    duplicated['Driver Waiting'] = '';
    duplicated['Over Weight'] = '';
    duplicated['Chassis Split'] = '';
    duplicated['Toll'] = '';
    duplicated['Reefer Fee'] = '';
    duplicated['Bond Fee'] = '';
    duplicated['Drop Fee'] = '';

    duplicated['Price'] = '';
    duplicated['GP'] = '';
    duplicated['Adjusted Price'] = '';
    duplicated['Adjusted GP'] = '';
    duplicated['Selected'] = 'false';
    duplicated['Date'] = new Date().toLocaleDateString();

    duplicated['Chassis Price'] = '';
    duplicated['Pre-Pull Price'] = '';
    duplicated['Yard Storage Price'] = '';
    duplicated['Driver Waiting Price'] = '';
    duplicated['Over Weight Price'] = '';
    duplicated['Chassis Split Price'] = '';
    duplicated['Toll Price'] = '';
    duplicated['Reefer Fee Price'] = '';
    duplicated['Bond Fee Price'] = '';
    duplicated['Drop Fee Price'] = '';

    duplicated['Order Processing'] = duplicated['Order Processing'] || '';
    duplicated['Inbound'] = duplicated['Inbound'] || '';
    duplicated['Outbound'] = duplicated['Outbound'] || '';
    duplicated['Sorting'] = duplicated['Sorting'] || '';
    duplicated['Palletizing'] = duplicated['Palletizing'] || '';
    duplicated['Pallet Fee'] = duplicated['Pallet Fee'] || '';
    duplicated['Storage'] = duplicated['Storage'] || '';
    duplicated['Label'] = duplicated['Label'] || '';
    duplicated['Cross Dock'] = duplicated['Cross Dock'] || '';

    duplicated['Order Processing Price'] = duplicated['Order Processing Price'] || '';
    duplicated['Inbound Price'] = duplicated['Inbound Price'] || '';
    duplicated['Outbound Price'] = duplicated['Outbound Price'] || '';
    duplicated['Sorting Price'] = duplicated['Sorting Price'] || '';
    duplicated['Palletizing Price'] = duplicated['Palletizing Price'] || '';
    duplicated['Pallet Fee Price'] = duplicated['Pallet Fee Price'] || '';
    duplicated['Storage Price'] = duplicated['Storage Price'] || '';
    duplicated['Label Price'] = duplicated['Label Price'] || '';
    duplicated['Cross Dock Price'] = duplicated['Cross Dock Price'] || '';

    duplicated['truckingSalesConfirmed'] = 'false';
    duplicated['truckingManagerConfirmed'] = 'false';
    duplicated['warehouseSalesConfirmed'] = 'false';
    duplicated['warehouseManagerConfirmed'] = 'false';

    // ✅ GF FIX: never inherit the source inquiry's GoFreight linkage. Before this, a
    // new carrier starts with its own local fields. Route push status is inherited from
    // the durable ledger on read; GF Ref can still resolve through the route/family.
    duplicated['GF Ref'] = '';
    duplicated['Pushed To GF'] = 'false';
    duplicated['Pushed To GF At'] = '';

    applyTruckingUnits(duplicated);
    applyWarehouseUnits(duplicated);

    applyTruckingAutoPrices(null, duplicated);
    applyWarehouseAutoPrices(null, duplicated);   // ← 去掉注释


    const newInquiry = new Inquiry(duplicated);
    await newInquiry.save();

    broadcastInquiry(newQuote, duplicated);
    res.json({ success: true, data: maskInquiryDocs([JSON.parse(JSON.stringify(newInquiry))], role)[0] });
  } catch (err) {
    if (err.code === 11000) return conflict(res, 'Another user just added an option. Refresh and try again.');
    console.error('[ERROR] Failed to duplicate inquiry:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});


app.post('/delete_inquiry', async (req, res) => {
  const role = String(req.cookies?.role || '').toLowerCase();
  if (!['sales', 'sourcing', 'manager'].includes(role)) {
    return res.status(403).json({ success: false, message: role === 'ops_view' ? 'OPS view-only cannot modify data.' : 'Not authorized.' });
  }

  const quoteId = String((req.body || {}).quoteId || '').trim();
  console.log(`[DEBUG] /delete_inquiry called with quoteId: ${quoteId}`);

  if (!quoteId || String(quoteId).trim() === '') {
    return res.status(400).json({ success: false, message: 'Missing quoteId' });
  }

  
  // ✅ Safety: only allow deleting sub-lines (e.g., 000001-1 or 000001-A). Never delete main line.
  const qDel = String(quoteId).trim();
  const isTruckSub = /-\d+$/.test(qDel);
  const isWhSub = /-[A-Z]$/i.test(qDel);
  if (!isTruckSub && !isWhSub) {
    return res.status(403).json({ success: false, message: 'Cannot delete: main line cannot be deleted.' });
  }

try {
    if (!USE_MOCK && !dbReady(res)) return;
    // ✅ Mock mode branch (same pattern as /inquiries/update)
    if (USE_MOCK || !conn || conn.readyState !== 1 || !Inquiry) {
      const targetId = String(quoteId).trim();
      const target = mockInquiries.find(x => String(x['Quotation #'] || '').trim() === targetId);

      if (!target) {
        return res.status(404).json({ success: false, message: 'Quotation # not found (mock)' });
      }

      if (!requireInquiryAccess(req, res, target)) return;
      if (gfBusy(target)) return conflict(res);
      const locked =
        isTruthy(target['truckingCostSent']) || isTruthy(target['warehouseCostSent']) ||
        isTruthy(target['truckingSalesConfirmed']) || isTruthy(target['truckingManagerConfirmed']) ||
        isTruthy(target['warehouseSalesConfirmed']) || isTruthy(target['warehouseManagerConfirmed']);

      if (locked) {
        return res.status(403).json({ success: false, message: 'Cannot delete: row is locked (cost sent or price confirmed).' });
      }

      const before = mockInquiries.length;
      mockInquiries = mockInquiries.filter(x => String(x['Quotation #'] || '').trim() !== targetId);
      const after = mockInquiries.length;

      if (after === before) {
        return res.status(404).json({ success: false, message: 'Quotation # not found (mock)' });
      }

      console.log(`[DEBUG] Deleted inquiry (mock): ${quoteId}`);
      broadcastInquiry(quoteId, target);
      return res.json({ success: true });
    }

    // ✅ MongoDB branch
    const doc = await Inquiry.findOne({ 'Quotation #': quoteId });
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Quotation # not found' });
    }

    if (!requireInquiryAccess(req, res, doc)) return;
    if (gfBusy(doc)) return conflict(res);
    // ✅ Only block delete when Sourcing has sent (checked ✅) or Sales/Manager confirmed
    const locked =
      isTruthy(doc['truckingCostSent']) || isTruthy(doc['warehouseCostSent']) ||
      isTruthy(doc['truckingSalesConfirmed']) || isTruthy(doc['truckingManagerConfirmed']) ||
      isTruthy(doc['warehouseSalesConfirmed']) || isTruthy(doc['warehouseManagerConfirmed']);

    if (locked) {
      return res.status(403).json({ success: false, message: 'Cannot delete: row is locked (cost sent or price confirmed).' });
    }

    const result = await Inquiry.deleteOne(revisionFilter(doc));
    if (!result.deletedCount) return conflict(res);

    console.log(`[DEBUG] Deleted inquiry: ${quoteId}`);
    broadcastInquiry(quoteId, doc);
    return res.json({ success: true });

  } catch (error) {
    console.error('[ERROR] Failed to delete inquiry:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

app.post('/reset_excel', async (req, res) => {
  const { role } = req.cookies;
  if (role !== 'manager') {
    return res.status(403).json({ success: false, message: 'Permission denied' });
  }

  if (!USE_MOCK && (!conn || conn.readyState !== 1 || !Inquiry)) {
    return res.status(500).json({ success: false, message: 'Mongo not connected' });
  }

  try {
    await Inquiry.deleteMany({});
    console.log('[RESET] All inquiries have been cleared from MongoDB');
    res.json({ success: true, message: 'All inquiries have been cleared. MongoDB collection reset.' });
  } catch (error) {
    console.error('[ERROR] Failed to reset MongoDB:', error);
    res.status(500).json({ success: false, message: 'Failed to reset MongoDB' });
  }
});

app.get('/exit', async (req, res) => {
  console.log('[DEBUG] /exit called');
  res.redirect('/index.html');
});

app.get('/user', async (req, res) => {
  const { username, role, salesGroup } = req.cookies;
  if (!username || !role) return res.status(401).json({ error: 'Not logged in' });
  res.json({ username, role, salesGroup: salesGroup || '', email: emailFor(username, salesGroup) });   // ✅ EMAIL
});

app.get('/logout', (req, res) => {
  res.clearCookie('username');
  res.clearCookie('role');
  res.clearCookie('salesGroup'); // ✅ add
  return res.redirect('/index.html');
});

/* =========================================================
   PUBLIC CUSTOMER PORTAL (No login required)
   - Customer submits RFQ
   - System assigns Sales by Region
   - Sales reviews + fills External Quotation #, then "Submit to Sourcing"
   ========================================================= */

function genPortalRef() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `TTS-RFQ-${y}${m}${day}-${rand}`;
}

function regionAssignment(region) {
  const r = String(region || '').trim().toLowerCase();
  // Mapping (per Lina):
  // China Mainland -> Ellen (TEAM2)
  // Taiwan -> Adam (TEAM3)
  // USA/Others -> Nikki (TEAM1)
  if (r === 'china mainland') return { assignedSales: 'Ellen Lin', salesGroup: 'TEAM2' };
  if (r === 'taiwan') return { assignedSales: 'Adam Chen', salesGroup: 'TEAM3' };
  if (r === 'usa') return { assignedSales: 'Niurka Guzman', salesGroup: 'TEAM1' };
  return { assignedSales: 'Niurka Guzman', salesGroup: 'TEAM1' };
}

// Public endpoint (NO cookies required)
// ---- Customer portal anti-spam: simple in-memory per-IP rate limit ----
const portalSubmitLog = new Map(); // ip -> [timestamps within window]
const PORTAL_RL_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const PORTAL_RL_MAX = 5;                     // max submissions per IP per window
function portalClientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || req.socket?.remoteAddress || 'unknown';
}
function portalRateLimited(req) {
  const ip = portalClientIp(req);
  const now = Date.now();
  const arr = (portalSubmitLog.get(ip) || []).filter(t => now - t < PORTAL_RL_WINDOW_MS);
  if (arr.length >= PORTAL_RL_MAX) { portalSubmitLog.set(ip, arr); return true; }
  arr.push(now);
  portalSubmitLog.set(ip, arr);
  return false;
}

app.post('/public/inquiries', async (req, res) => {
  try {
    if (!USE_MOCK && !dbReady(res)) return;
    const raw = req.body || {};

    // ===== Anti-spam guard (this endpoint is public) =====
    // 1) Per-IP rate limit — caps floods from a single source.
    if (portalRateLimited(req)) {
      return res.status(429).json({ success: false, message: 'Too many requests. Please try again later.' });
    }
    // 2) Honeypot — a hidden field real users never see. If filled, it's a bot: drop
    //    silently (fake success so it stops retrying) and save nothing.
    if (String(raw.website || '').trim()) {
      return res.json({ success: true, portalRef: genPortalRef(), assignedSales: '—' });
    }
    // 3) Time-trap — a human can't complete this form in under 3s; a direct POST won't carry a valid value.
    const elapsedMs = Number(raw.elapsedMs);
    if (!Number.isFinite(elapsedMs) || elapsedMs < 3000) {
      return res.status(400).json({ success: false, message: 'Form submitted too quickly. Please try again.' });
    }
    // 3.5) Cloudflare Turnstile — verify the bot-challenge token. Only enforced when the
    //      TURNSTILE_SECRET_KEY env var is set, so deploying before you configure it won't break the form.
    const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET_KEY;
    if (TURNSTILE_SECRET) {
      const tsToken = String(raw['cf-turnstile-response'] || raw.turnstileToken || '').trim();
      if (!tsToken) {
        return res.status(400).json({ success: false, message: 'Please complete the verification and try again.' });
      }
      try {
        const tsRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ secret: TURNSTILE_SECRET, response: tsToken, remoteip: portalClientIp(req) })
        });
        const tsJson = await tsRes.json();
        if (!tsJson.success) {
          return res.status(400).json({ success: false, message: 'Verification failed. Please reload and try again.' });
        }
      } catch (e) {
        // Fail-open on a transient network error so a Cloudflare hiccup doesn't drop a real lead;
        // the honeypot / time-trap / rate-limit layers above still apply.
        console.warn('[PORTAL] Turnstile verify error (allowing through):', e?.message || e);
      }
    }
    // 4) Field sanity — strict email format, length caps, and reject links in free-text fields.
    const emailStr = String(raw.email || raw['Email'] || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailStr)) {
      return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
    }
    const tooLong = v => String(v || '').length > 1000;
    const hasLink = v => /(https?:\/\/|www\.|\[url)/i.test(String(v || ''));
    if ([raw.companyName, raw.contactName, raw.from, raw.note, raw.warehouseNote].some(tooLong) ||
        [raw.companyName, raw.contactName, raw.note, raw.warehouseNote].some(hasLink)) {
      return res.status(400).json({ success: false, message: 'Submission rejected. Please remove links and shorten long fields.' });
    }
    // ===== end anti-spam guard =====

    // basic validation
    const region = String(raw.region || raw['Region'] || '').trim();
    const company = String(raw.companyName || raw['Company Name'] || '').trim();
    const contact = String(raw.contactName || raw['Contact Name'] || '').trim();
    const email = String(raw.email || raw['Email'] || '').trim();
    const phone = String(raw.phone || raw['Phone'] || '').trim();

    if (!region || !company || !contact || !email) {
      return res.status(400).json({ success: false, message: 'Missing required fields (Region / Company / Contact / Email).' });
    }

    const { assignedSales, salesGroup } = regionAssignment(region);
    const portalRef = genPortalRef();

    // Internal unique key for this inquiry (keep your existing primary key behavior)
    // Use 6-digit numeric sequence based on timestamp slice (simple + unique-enough); Mongo _id will also be unique.
    const internalQuote = String(Date.now()).slice(-6);

    const data = {
      'Date': new Date().toLocaleDateString(),

      // Identify source
      'Source': 'customer_portal',
      'Portal Ref': portalRef,
      'Region': region,

      // Customer contact
      'Customer Company': company,
      'Customer Name': contact,
      'Customer Email': email,
      'Customer Phone': phone,

      // Assignment
      'Assigned Sales': assignedSales,
      salesGroup,

      // Workflow: must be reviewed by Sales first
      'Submitted To Sourcing': 'false',
      'Submitted To Sourcing At': '',

      // Legacy fields for UI compatibility
      'Customer ID': String(raw.customerId || raw['Customer ID'] || '').trim(),
      'Requested By': 'Customer Portal',
      username: 'Customer Portal',
      'Created By': 'Customer Portal',
      'Created Role': 'customer_portal',

      // Inquiry basics
      'Inquiry Type': String(raw.inquiryType || raw['Inquiry Type'] || '').trim(),
      'Container Size': String(raw.containerSize || raw['Container Size'] || '').trim(),
      'Dry Van Type': String(raw.dryVanType || raw['Dry Van Type'] || '').trim(),
      'Legal or Over Weight': String(raw.legalOverWeight || raw['Legal or Over Weight'] || '').trim(),
      'Gross Weight': String(raw.grossWeight || raw['Gross Weight'] || '').trim(),
      'Live or Drop': String(raw.liveOrDrop || raw['Live or Drop'] || '').trim(),
      'From': String(raw.from || raw['From'] || '').trim(),

      'To City': String(raw.toCity || raw['To City'] || '').trim(),
      'To State': String(raw.toState || raw['To State'] || '').trim(),
      'To ZIP': String(raw.toZip || raw['To ZIP'] || '').trim(),
      'To': String(raw.to || raw['To'] || '').trim(),

      'QTY': String(raw.qty || raw['QTY'] || '').trim(),
      'Quotation #': internalQuote,   // internal primary key
      'External Quotation #': '',     // Sales fills later

      // Cargo
      'Commodity': String(raw.commodity || raw['Commodity'] || '').trim(),
      'Package Type': String(raw.packageType || raw['Package Type'] || '').trim(),
      'Packages Per Container': String(raw.packagesPerContainer || raw['Packages Per Container'] || '').trim(),
      'Hazmat': String(raw.hazmat || raw['Hazmat'] || 'false'),
      'Reefer': String(raw.reefer || raw['Reefer'] || 'false'),
      'Bonded': String(raw.bonded || raw['Bonded'] || 'false'),

      // Common info filled by the customer (mirrors the quote modal green zone)
      'Service Types': String(raw.serviceTypes || raw['Service Types'] || ''),
      'Service Subtypes': String(raw.serviceSubtypes || raw['Service Subtypes'] || ''),   // ✅ SUBTYPE
      'ETA': String(raw.eta || raw['ETA'] || ''),
      '# of Containers': String(raw.numContainers || raw['# of Containers'] || ''),

      // Warehouse request
      'Need Warehouse Service': String(raw.needWarehouseService || raw['Need Warehouse Service'] || 'false'),
      'Warehouse Services': String(raw.warehouseServices || raw['Warehouse Services'] || ''),
      'Warehouse Service Detail': String(raw.warehouseServiceDetail || raw['Warehouse Service Detail'] || ''),
      'Estimated Pallets': String(raw.estimatedPallets || raw['Estimated Pallets'] || ''),
      'Estimated Boxes': String(raw.estimatedBoxes || raw['Estimated Boxes'] || ''),
      'Estimated SKU Count': String(raw.estimatedSkuCount || raw['Estimated SKU Count'] || ''),
      'Storage Duration': String(raw.storageDuration || raw['Storage Duration'] || ''),
      'Storage Duration Unit': String(raw.storageDurationUnit || raw['Storage Duration Unit'] || ''),
      'Warehouse Note': String(raw.warehouseNote || raw['Warehouse Note'] || ''),

      // Notes
      'Note': String(raw.note || raw['Note'] || '').trim(),
      'Truck Inquiry Note': String(raw.truckInquiryNote || raw['Truck Inquiry Note'] || '').trim(),

      // Default flags (align with your system)
      'Saved': 'false',
      'truckingCostSaved': 'false',
      'truckingCostSent': 'false',
      'warehouseCostSaved': 'false',
      'warehouseCostSent': 'false',
      'truckingPriceSaved': 'false',
      'warehousePriceSaved': 'false',
      'truckingSalesConfirmed': 'false',
      'truckingManagerConfirmed': 'false',
      'warehouseSalesConfirmed': 'false',
      'warehouseManagerConfirmed': 'false',
    };

    // Units defaults (safe)
    applyTruckingUnits(data);
    applyWarehouseUnits(data);
    applyWarehouseDefaults(data);

    // Save
    let saved;
    if (USE_MOCK || !conn || conn.readyState !== 1 || !Inquiry) {
      data['_id'] = Date.now().toString();
      mockInquiries.push(data);
      saved = data;
    } else {
      const inquiry = new Inquiry(data);
      saved = await inquiry.save();
    }

    return res.json({ success: true, portalRef, assignedSales, salesGroup, quotationId: saved['Quotation #'] });
  } catch (err) {
    console.error('[ERROR] /public/inquiries failed:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
});

// ===== Carrier Application form (carrier.html) — sends an email to sourcing@totalsolutionus.com =====
// Requires GMAIL_USER + GMAIL_APP_PASSWORD env vars (Gmail SMTP via a 16-char Google
// "App Password" — the Workspace account needs 2-Step Verification on to generate one).
let carrierMailTransporter = null;
function getCarrierMailTransporter() {
  if (carrierMailTransporter) return carrierMailTransporter;
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  carrierMailTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass }
  });
  return carrierMailTransporter;
}

// carrier.html is served from the main site (a different domain than this Render app),
// so this route needs CORS enabled for that origin.
const CARRIER_APPLY_ALLOWED_ORIGINS = new Set([
  'https://www.totalsolutionus.com',
  'https://totalsolutionus.com'
]);
function setCarrierApplyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && CARRIER_APPLY_ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
app.options('/public/carrier-apply', (req, res) => {
  setCarrierApplyCors(req, res);
  res.sendStatus(204);
});

app.post('/public/carrier-apply', async (req, res) => {
  setCarrierApplyCors(req, res);
  try {
    const raw = req.body || {};

    // ===== Anti-spam guard (same helpers/thresholds as /public/inquiries) =====
    if (portalRateLimited(req)) {
      return res.status(429).json({ success: false, message: 'Too many requests. Please try again later.' });
    }
    // Honeypot — hidden field real users never see/fill. If filled, it's a bot:
    // drop silently (fake success so it stops retrying), send nothing.
    if (String(raw.website || '').trim()) {
      return res.json({ success: true });
    }
    // Time-trap — a human can't complete this form in under 3s.
    const elapsedMs = Number(raw.elapsedMs);
    if (!Number.isFinite(elapsedMs) || elapsedMs < 3000) {
      return res.status(400).json({ success: false, message: 'Form submitted too quickly. Please try again.' });
    }

    // ===== Field validation =====
    const company = String(raw.company || '').trim();
    const contact = String(raw.contact || '').trim();
    const mc = String(raw.mc || '').trim();
    const dot = String(raw.dot || '').trim();
    const email = String(raw.email || '').trim();
    const phone = String(raw.phone || '').trim();
    let equipment = raw.equipment;
    if (!Array.isArray(equipment)) equipment = equipment ? [equipment] : [];
    const fleetSize = String(raw.fleet_size || '').trim();
    const serviceArea = String(raw.service_area || '').trim();
    const notes = String(raw.notes || '').trim();

    if (!company || !contact || !mc || !dot || !phone) {
      return res.status(400).json({ success: false, message: 'Please complete all required fields.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
    }
    if (!equipment.length) {
      return res.status(400).json({ success: false, message: 'Please select at least one equipment type.' });
    }
    // Length caps + reject links in free-text, same spirit as the RFQ form's field sanity check.
    if ([company, contact, notes].some(s => s.length > 500) || /https?:\/\//i.test(notes)) {
      return res.status(400).json({ success: false, message: 'Please shorten your input and remove any links.' });
    }

    const transporter = getCarrierMailTransporter();
    if (!transporter) {
      console.error('[CARRIER-APPLY] GMAIL_USER / GMAIL_APP_PASSWORD not configured — cannot send email.');
      return res.status(500).json({ success: false, message: 'Submission could not be sent. Please email sourcing@totalsolutionus.com directly.' });
    }

    const bodyLines = [
      `Company: ${company}`,
      `Contact: ${contact}`,
      `MC #: ${mc}`,
      `DOT #: ${dot}`,
      `Email: ${email}`,
      `Phone: ${phone}`,
      `Equipment: ${equipment.join(', ')}`,
      fleetSize ? `Fleet size: ${fleetSize}` : '',
      serviceArea ? `Service area: ${serviceArea}` : '',
      notes ? `Notes: ${notes}` : ''
    ].filter(Boolean).join('\n');

    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: 'sourcing@totalsolutionus.com',
      replyTo: email,
      subject: `New Carrier Application — ${company}`,
      text: bodyLines
    });

    return res.json({ success: true });
  } catch (err) {
    console.error('[CARRIER-APPLY] Error:', err?.message || err);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again or email sourcing@totalsolutionus.com directly.' });
  }
});

// ✅ 仅 fallback 非 API 路由，避免干扰 /api/*
app.use((req, res, next) => {
  const p = req.path || '';

  const isApiRoute =
    p.startsWith('/api/') ||
    p.startsWith('/inquiries') ||   // ✅ 覆盖 /inquiries/update /delete /duplicate 等
    p === '/user' ||
    p === '/logout' ||
    p.startsWith('/socket.io');

  if (req.method === 'GET' && !isApiRoute) {
    return res.sendFile(path.join(__dirname, 'public', 'sales_dashboard_v2.html'));
  }

  next();
});

// ═══════════════════════════════════════════════════════════════════════════
// ✅ QLIST: Quotation List page — read-only aggregate + GF-push flag (additive)
// Design doc: quotation_list_design.md (2026-07-24, approved by Lina)
// - GET  /api/quotation-list   read-only grouped overview (base → lines)
// - POST /api/mark-pushed-gf   writes ONLY: 'Pushed To GF' / 'Pushed To GF At' / 'Pushed To GF By'
// Rules locked in design review:
//   * GP source = 'Adjusted GP' (stored as "20.66%" string) → strip '%';
//     fallback = 'GP' (stored as 0.3078 decimal) → ×100; both normalized to percent number
//   * TRUCK supplier pick = candidates with truckingSalesConfirmed==='true'; take LOWEST Adj GP
//   * No confirmed supplier → gp null (price not quoted yet; never estimated)
//   * Route fields (From/To/etc.) read from the LINE MAIN doc only (options have empty From/To)
//   * Legacy 'Selected' flag participates in STATUS derivation only (mirrors /api/kpi),
//     NEVER in supplier picking
//   * Date window = _id timestamp (createdAt missing on 100% of docs, verified V3)
//   * sourcing role: 403 (per Lina). ops_view: read list, cannot write flag.
// ═══════════════════════════════════════════════════════════════════════════
(function registerQlistRoutes() {
  const QLIST_MAX_DOCS = 3000;

  const qlistTrue = v => String(v || '').toLowerCase().trim() === 'true';
  const qlistEsc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Same shape as parseQuoteId in the push handler (kept private to avoid scope coupling)
  function qlistParse(raw) {
    const s = String(raw || '').trim().toUpperCase().replace(/^TTSQT-?/, '');
    const m = s.match(/^(\d{1,6})([A-Z])?(?:-([A-Z]|\d+))?$/);
    if (!m) return null;
    const base = String(m[1]).padStart(6, '0').slice(-6);
    const line = base + (m[2] || '');
    return { base, line, option: m[3] || '' };
  }

  // Normalize both GP forms to a percent number (20.66) or null.
  function qlistGP(doc) {
    const adj = String(doc['Adjusted GP'] == null ? '' : doc['Adjusted GP']).trim();
    if (adj !== '') {
      const n = parseFloat(adj.replace(/%/g, ''));
      if (isFinite(n)) return { value: Math.round(n * 100) / 100, source: 'adjusted' };
    }
    const gp = parseFloat(doc['GP']);
    if (isFinite(gp) && gp > 0 && gp < 1) return { value: Math.round(gp * 10000) / 100, source: 'gp_fallback' };
    return null;
  }

  // Status model (Lina, 2026-07-24 v2):
  //   0 Await Sourcing — cost not filled or not sent
  //   1 Reviewing      — cost sent to Sales (legacy 'Selected' means exactly this, NOT confirmed),
  //                      but no VALID confirmation yet
  //   2 Confirmed      — at least one candidate has confirm-flag true AND non-empty 'Adjusted Price'
  //                      (both conditions required per Lina; flag alone stays Reviewing)
  //   3 Sent           — parent-level only: Confirmed AND 'Pushed To GF'==='true'
  // NOTE: deliberately stricter than /api/kpi (which counts legacy 'Selected' as confirmed);
  // the home-page KPI may show more "Confirmed" than this list — expected.
  function qlistValidConfirm(d) { return hasConfirmedQuotePrice(d); }
  function qlistDocRank(d) {
    if (qlistValidConfirm(d)) return 2;
    if (qlistTrue(d.truckingCostSent) || qlistTrue(d.warehouseCostSent) || qlistTrue(d['Selected'])) return 1;
    return 0;
  }
  const QLIST_STATUS = ['Await Sourcing', 'Reviewing', 'Confirmed', 'Sent'];

  const QLIST_PROJECTION = {
    'Quotation #': 1, 'Date': 1, 'Customer ID': 1, 'Requested By': 1,
    'Assigned Sales': 1, 'username': 1, 'salesGroup': 1,
    'Inquiry Type': 1, 'Container Size': 1, 'From': 1, 'To': 1,
    'Adjusted Price': 1, 'Adjusted GP': 1, 'GP': 1, 'Carrier': 1,
    'WH Cost Total': 1, 'WH Price Total': 1,
    truckingSalesConfirmed: 1, truckingManagerConfirmed: 1,
    warehouseSalesConfirmed: 1, warehouseManagerConfirmed: 1,
    truckingCostSent: 1, warehouseCostSent: 1,
    truckingCostSaved: 1, warehouseCostSaved: 1,
    'Selected': 1, 'Pushed To GF': 1, 'Pushed To GF At': 1, 'Pushed To GF By': 1,
    truckingCostDraft: 1, warehouseCostDraft: 1
  };

  app.get('/api/quotation-list', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    try {
      const role = String(req.cookies?.role || '').toLowerCase();
      const salesGroup = String(req.cookies?.salesGroup || '').trim();
      if (!role) return res.status(401).json({ error: 'Session expired. Please log in again.' });
      if (role !== 'manager' && role !== 'sales' && role !== 'ops_view') {
        return res.status(403).json({ error: 'Not authorized to view the quotation list.' });
      }
      if (!conn || conn.readyState !== 1 || !Inquiry) {
        return res.status(503).json({ error: 'Database not ready. Please retry.' });
      }

      const days = Math.min(Math.max(parseInt(req.query.days, 10) || 90, 1), 3650);
      const boundary = new mongoose.Types.ObjectId(
        Math.floor((Date.now() - days * 86400000) / 1000).toString(16).padStart(8, '0') + '0000000000000000'
      );

      const filter = { _id: { $gte: boundary } };
      if ((role === 'sales' || role === 'ops_view') && salesGroup) filter.salesGroup = { $in: groupList(salesGroup) };

      if ((role === 'sales' || role === 'ops_view') && !salesGroup) return res.json({ groups: [], total: 0, truncated: false, role });
      const qRaw = String(req.query.q || '').trim();
      if (qRaw) {
        delete filter._id;
        const parsed = qlistParse(qRaw);
        filter.$or = [
          { 'To ZIP': { $regex: '^' + qlistEsc(qRaw) } },
          { 'Customer ID': { $regex: '^' + qlistEsc(qRaw), $options: 'i' } }
        ];
        if (parsed) filter.$or.push({ 'Quotation #': { $regex: '^' + qlistEsc(parsed.base) } });
      }
      const customer = String(req.query.customer || '').trim();
      if (customer) filter['Customer ID'] = { $regex: '^' + qlistEsc(customer), $options: 'i' };
      const salesFilter = String(req.query.sales || '').trim();

      let docs = await Inquiry.find(filter, QLIST_PROJECTION)
        .sort({ _id: -1 }).limit(QLIST_MAX_DOCS + 1).lean();
      docs = await overlayGfRoutes(docs);
      console.log('[READ] /api/quotation-list rows=' + docs.length);   // ✅ MEMWATCH
      docs = maskInquiryDocs(docs, role);
      const truncated = docs.length > QLIST_MAX_DOCS;
      if (truncated) docs.length = QLIST_MAX_DOCS;

      // ── group: base → line → candidate docs ──
      const bases = new Map();
      for (const d of docs) {
        const p = qlistParse(d['Quotation #']);
        if (!p) continue;
        if (!bases.has(p.base)) bases.set(p.base, { main: null, lines: new Map(), newestId: String(d._id) });
        const b = bases.get(p.base);
        if (!b.lines.has(p.line)) b.lines.set(p.line, { main: null, candidates: [] });
        const L = b.lines.get(p.line);
        L.candidates.push(d);
        if (!p.option) {
          L.main = d;
          if (p.line === p.base) b.main = d;
        }
      }

      const groups = [];
      for (const [base, b] of bases) {
        const anchor = b.main || (b.lines.values().next().value || {}).main || null;
        if (salesFilter) {
          const s = anchor ? String(anchor['Assigned Sales'] || anchor.username || '') : '';
          if (s !== salesFilter) continue;
        }

        const lines = [];
        let parentRank = 3;
        let draftSaved = false;   // ✅ QLIST: cost saved by Sourcing but not yet sent (reminder tag)
        for (const [lineId, L] of b.lines) {
          const main = L.main || L.candidates[0];
          let lineRank = 0;
          for (const c of L.candidates) {
            lineRank = Math.max(lineRank, qlistDocRank(c));
            if ((qlistTrue(c.truckingCostDraft) || qlistTrue(c.warehouseCostDraft)) &&
                !qlistTrue(c.truckingCostSent) && !qlistTrue(c.warehouseCostSent)) draftSaved = true;
          }
          parentRank = Math.min(parentRank, lineRank);

          // GP picks only VALID confirmations (flag + non-empty Adjusted Price) — this also
          // neutralizes the auto-written "0.00%" Adjusted GP that appears when the price is empty.
          const confirmed = L.candidates.filter(c => hasConfirmedQuotePrice(c, 'TRUCK'));
          let gp = null, gpSource = 'none', adjPrice = null, suppliers = [];
          for (const c of confirmed) {
            const g = qlistGP(c);
            const carrier = String(c['Carrier'] || '').trim();
            if (carrier) suppliers.push(carrier);
            if (g && (gp === null || g.value < gp)) {
              gp = g.value; gpSource = g.source;
              adjPrice = String(c['Adjusted Price'] || '').trim() || null;
            }
          }
          if (adjPrice === null && main) adjPrice = String(main['Adjusted Price'] || '').trim() || null;

          let whGP = null;
          if (main) {
            const wc = parseFloat(main['WH Cost Total']);
            const wp = parseFloat(main['WH Price Total']);
            if (isFinite(wc) && isFinite(wp) && wp > 0) whGP = Math.round((wp - wc) / wp * 10000) / 100;
          }

          lines.push({
            line: lineId,
            from: main ? String(main['From'] || '') : '',
            to: main ? String(main['To'] || '') : '',
            inquiryType: main ? String(main['Inquiry Type'] || '') : '',
            containerSize: main ? String(main['Container Size'] || '') : '',
            status: QLIST_STATUS[lineRank],
            adjPrice, truckGP: gp, truckGPSource: gpSource,
            suppliers,
            confirmedSupplierCount: confirmed.length,
            candidateSupplierCount: L.candidates.length,
            whGP
          });
        }
        if (b.lines.size === 0) continue;

        const statusFilter = String(req.query.status || '').trim();
        const confirmedDocs = Array.from(b.lines.values()).flatMap(l => l.candidates).filter(qlistValidConfirm);
        const pushed = b.lines.size > 0 && Array.from(b.lines.values()).every(l => l.candidates.some(d => qlistTrue(d['Pushed To GF'])));
        let parentStatus = QLIST_STATUS[parentRank];
        if (parentStatus === 'Confirmed' && pushed) parentStatus = 'Sent';   // rank 3 is parent-level only
        if (statusFilter === 'unpushed') {
          if (parentStatus !== 'Confirmed') continue;   // Confirmed here already means "not yet Sent"
        } else if (statusFilter && statusFilter !== parentStatus) continue;

        groups.push({
          base,
          newestId: b.newestId,
          date: anchor ? String(anchor['Date'] || '') : '',
          customer: anchor ? String(anchor['Customer ID'] || '') : '',
          requestedBy: anchor ? String(anchor['Requested By'] || '') : '',
          assignedSales: anchor ? String(anchor['Assigned Sales'] || anchor.username || '') : '',
          status: parentStatus,
          pushedToGF: pushed,
          pushedToGFAt: anchor ? (anchor['Pushed To GF At'] || null) : null,
          pushedToGFBy: anchor ? (anchor['Pushed To GF By'] || null) : null,
          lineCount: b.lines.size,
          draftSaved: draftSaved && QLIST_STATUS[parentRank] === 'Await Sourcing',
          lines
        });
      }

      // Sort (Lina, final): section 1 = 'Await Sourcing', section 2 = 'Reviewing' — both by
      // Quotation # descending (newest number first); section 3 = Confirmed + Sent together,
      // by latest activity (newest _id anywhere in the group) first.
      const qlistSection = s => (s === 'Await Sourcing' ? 0 : s === 'Reviewing' ? 1 : 2);
      groups.sort((a, b2) => {
        const sa = qlistSection(a.status), sb = qlistSection(b2.status);
        if (sa !== sb) return sa - sb;
        if (sa < 2) return a.base < b2.base ? 1 : a.base > b2.base ? -1 : 0;
        return a.newestId < b2.newestId ? 1 : -1;
      });
      groups.forEach(g => { delete g.newestId; });

      return res.json({ groups, total: groups.length, truncated, role });
    } catch (err) {
      console.error('❌ QLIST list error:', err);
      return res.status(500).json({ error: 'Server error building quotation list.' });
    }
  });

  app.post('/api/mark-pushed-gf', async (req, res) => {
    try {
      const role = String(req.cookies?.role || '').toLowerCase();
      const username = String(req.cookies?.username || '').trim();
      const salesGroup = String(req.cookies?.salesGroup || '').trim();
      if (!role) return res.status(401).json({ error: 'Session expired. Please log in again.' });
      if (role !== 'manager' && role !== 'sales') {
        return res.status(403).json({ error: role === 'ops_view' ? 'OPS view-only cannot modify data.' : 'Not authorized.' });
      }
      if (!conn || conn.readyState !== 1 || !Inquiry) {
        return res.status(503).json({ error: 'Database not ready. Please retry.' });
      }

      const p = qlistParse(String((req.body || {}).base || ''));
      if (!p || p.line !== p.base || p.option) {
        return res.status(400).json({ error: 'Invalid base quotation number.' });
      }
      const value = (req.body || {}).value === true || String((req.body || {}).value) === 'true';

      const docs = (await Inquiry.find({ 'Quotation #': { $regex: '^' + qlistEsc(p.base) } }).lean()).filter(d => qlistParse(d['Quotation #'])?.base === p.base);
      if (!docs.length) return res.status(404).json({ error: 'Quotation family not found.' });
      if (!docs.every(d => canAccessInquiry(req, d))) return res.status(403).json({ error: 'This quotation belongs to another sales group.' });
      if (docs.some(gfBusy)) return conflict(res, 'Reconcile pending GoFreight pushes first.');
      const lineKeys = new Set(docs.map(d => qlistParse(d['Quotation #']).line));
      if (value && !Array.from(lineKeys).every(line => docs.some(d => qlistParse(d['Quotation #']).line === line && qlistValidConfirm(d)))) return conflict(res, 'Each route must have a confirmed price before marking the group sent.');
      const targets = docs;
      for (const key of lineKeys) {
        const state = await gfRouteState(key);
        if (['pending', 'uncertain'].includes(state?.state)) return conflict(res, 'Reconcile pending GoFreight pushes first.');
        if (!value && state?.state === 'succeeded') return conflict(res, 'This route is already sent. Clearing its flag could create duplicate charges and is not allowed.');
      }
      const session = await conn.startSession();
      try {
        await session.withTransaction(async () => {
          if (value) for (const key of lineKeys) {
            await gfLedger().updateOne({ _id: key, state: { $in: ['ready', 'succeeded'] } }, {
              $set: { state: 'succeeded', by: username, completedAt: new Date().toISOString(), source: 'manual' }
            }, { upsert: true, session });
          }
          for (const doc of targets) {
            const result = await Inquiry.updateOne(revisionFilter(doc), { $set: {
              'Pushed To GF': value ? 'true' : 'false', 'Pushed To GF At': new Date().toISOString(), 'Pushed To GF By': username
            }, $inc: { __v: 1 } }, { session });
            if (!(result.matchedCount ?? result.n)) throw new Error('Quotation changed during update. Refresh and retry.');
          }
        });
      } finally { await session.endSession(); }
      targets.forEach(doc => broadcastInquiry(doc['Quotation #'], doc));
      return res.json({ success: true, base: p.base, value });
    } catch (err) {
      console.error('❌ QLIST mark error:', err);
      return res.status(500).json({ error: 'Server error updating GF flag.' });
    }
  });

  // ═══════════════════════════════ ✅ DELGROUP ═══════════════════════════════
  // POST /api/delete-quotation-group — deletes an ENTIRE inquiry (main line + every
  // truck/WH sub-line under it), used to clean up spam/junk submissions coming from the
  // customer portal. Manager + Sales only (Sourcing keeps using /delete_inquiry for
  // single Carrier sub-rows — untouched). Every line in the group must have NO cost and
  // NO price entered anywhere, and must not already be locked (cost sent / confirmed) —
  // otherwise the whole group is refused and the person is told which line blocked it.
  app.post('/api/delete-quotation-group', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    try {
      const role = String(req.cookies?.role || '').toLowerCase();
      const username = String(req.cookies?.username || '').trim();
      const salesGroup = String(req.cookies?.salesGroup || '').trim();
      if (!role) return res.status(401).json({ success: false, message: 'Session expired. Please log in again.' });
      if (role !== 'manager' && role !== 'sales') {
        return res.status(403).json({ success: false, message: role === 'ops_view' ? 'OPS view-only cannot modify data.' : 'Not authorized to delete quotations.' });
      }
      if (!conn || conn.readyState !== 1 || !Inquiry) {
        return res.status(503).json({ success: false, message: 'Database not ready. Please retry.' });
      }

      const p = qlistParse(String((req.body || {}).base || ''));
      if (!p || p.line !== p.base || p.option) {
        return res.status(400).json({ success: false, message: 'Invalid base quotation number.' });
      }
      const base = p.base;

      // Prefilter by regex (index-friendly), then confirm membership with the same
      // qlistParse logic the list view uses, so "the group" means exactly the same
      // thing here as what's shown on screen. Also picks up sub-lines via Parent Quotation #
      // for docs that don't parse cleanly under the base+suffix scheme.
      const candidates = await Inquiry.find({
        $or: [
          { 'Quotation #': { $regex: '^' + qlistEsc(base) } },
          { 'Parent Quotation #': base }
        ]
      }).lean();

      const docs = candidates.filter(d => {
        const parsed = qlistParse(d['Quotation #']);
        return (parsed && parsed.base === base) || String(d['Parent Quotation #'] || '').trim() === base;
      });

      if (!docs.length) {
        return res.status(404).json({ success: false, message: 'Quotation ' + base + ' not found.' });
      }

      if (role === 'sales') {
        const myGroups = groupList(salesGroup);
        const owned = docs.every(d => {
          const g = String(d.salesGroup || '').trim();
          if (g) return myGroups.includes(g);
          return (d['Assigned Sales'] || d.username) === username;
        });
        if (!owned) {
          return res.status(403).json({ success: false, message: 'This quotation belongs to another sales group.' });
        }
      }

      const blocked = docs.filter(d => gfBusy(d) || delqLineLocked(d) || !delqLineEmpty(d));
      if (blocked.length) {
        const names = blocked.map(d => String(d['Quotation #'] || '').trim()).join(', ');
        return res.status(409).json({
          success: false,
          message: '无法删除：以下行已填写成本或价格，无法删除 / Cannot delete — cost or price already entered on: ' + names
        });
      }

      const ids = docs.map(d => d['Quotation #']);
      const session = await conn.startSession();
      let result;
      try {
        await session.withTransaction(async () => {
          result = await Inquiry.deleteMany({ $or: docs.map(revisionFilter) }, { session });
          if (result.deletedCount !== docs.length) throw new Error('Quotation changed during deletion. Refresh and try again.');
        });
      } finally { await session.endSession(); }

      console.log('[DELGROUP] base=' + base + ' lines=' + ids.length + ' deleted=' + result.deletedCount + ' by=' + username + '/' + role);
      docs.forEach(d => broadcastInquiry(d['Quotation #'], d));
      return res.json({ success: true, deleted: result.deletedCount });
    } catch (err) {
      console.error('❌ DELGROUP error:', err);
      return res.status(500).json({ success: false, message: 'Server error while deleting quotation.' });
    }
  });
  // ═══════════════════════════════ DELGROUP end ═══════════════════════════════
})();
// ═══════════════════════════════ ✅ QLIST end ═══════════════════════════════

server.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});



