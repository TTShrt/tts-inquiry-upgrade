const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const fetch = require('node-fetch');
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

app.use(cookieParser());

// ==============================
// ✅ Auth helpers (FIX requireRole)
// ==============================

app.use(bodyParser.json());

// ✅✅✅ 把 debug 路由加在這裡！（bodyParser 之後，static 之前）
app.get('/__debug/db', async (req, res) => {
  try {
    const mongoReady = !!conn && conn.readyState === 1 && !!Inquiry;
    const count = mongoReady ? await Inquiry.countDocuments({}) : null;
    res.json({
      USE_MOCK,
      mongoReady,
      dbName: conn?.name || conn?.db?.databaseName || null,
      collection: 'inquiries',
      count,
      MONGO_URI: process.env.MONGODB_URI ? '設有值（隱藏細節）' : '未設定',
      connReadyState: conn ? conn.readyState : 'null'
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});


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


app.use(express.static(path.join(__dirname, 'public')));

const MONGO_URI =
  process.env.MONGO_URI_NEW ||
  process.env.MONGODB_URI ||
  process.env.MONGO_URI;

console.log('[BOOT] USE_MOCK=', USE_MOCK);
console.log('[BOOT] MONGO_URI FULL =', MONGO_URI);

let conn = null;
if (!USE_MOCK && MONGO_URI) {
  conn = mongoose.createConnection(MONGO_URI);
  conn.on('connected', () => console.log('✅ MongoDB connected (NEW ONLY)'));
  conn.on('error', (err) => console.error('❌ MongoDB error:', err));
} else {
  console.log('⚠️ MongoDB skipped (USE_MOCK or missing MONGO_URI)');
}

const inquirySchema = new mongoose.Schema({}, { strict: false });
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
    password: 'ttshrt@11121',
    role: 'manager'
  },

  // ==============================
  // 🔵 TEAM3 (Adam Team)
  // ==============================
  {
    username: 'Adam Chen',
    password: 'salestwn2025',
    role: 'sales',
    salesGroup: 'TEAM3'
  },
  {
    username: 'OPM TEAM3',
    password: 'opm3#2025',
    role: 'sales',
    salesGroup: 'TEAM3'
  },
  {
    username: 'OPS TEAM3',
    password: 'ops3#2025',
    role: 'ops_view',
    salesGroup: 'TEAM3'
  },

  // ==============================
  // 🟢 TEAM1 (Niurka Team)
  // ==============================
  {
    username: 'Niurka Guzman',
    password: 'pass5561hou',
    role: 'sales',
    salesGroup: 'TEAM1'
  },
  {
    username: 'OPM TEAM1',
    password: 'opm1#2025',
    role: 'sales',
    salesGroup: 'TEAM1'
  },
  {
    username: 'OPS TEAM1',
    password: 'ops1#2025',
    role: 'ops_view',
    salesGroup: 'TEAM1'
  },

  // ==============================
  // 🟡 TEAM2 (Ellen Team)
  // ==============================
  {
    username: 'Ellen Lin',
    password: 'xmnpass2808',
    role: 'sales',
    salesGroup: 'TEAM2'
  },
  {
    username: 'OPM TEAM2',
    password: 'opm2#2025',
    role: 'sales',
    salesGroup: 'TEAM2'
  },
  {
    username: 'OPS TEAM2',
    password: 'ops2#2025',
    role: 'ops_view',
    salesGroup: 'TEAM2'
  },

  // ==============================
  // 🟠 Sourcing
  // ==============================
  {
    username: 'Matthew Maultsby',
    password: 'sourcing5544',
    role: 'sourcing'
  }

];


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
    const endings = [96, 95, 90, 88, 85];
    const thousandPart = Math.floor(price / 1000) * 1000;
    const hundredPart = Math.floor(price / 100) * 100;
    const deltaToThousand = price - thousandPart;
    const deltaToHundred = price - hundredPart;

    const allowBeautify = (
      (price >= 1000 && deltaToThousand <= 150) ||
      (price < 1000 && price >= 490 && price <= 510) ||
      (deltaToHundred <= 10)
    );

    if (!allowBeautify) return price;

    for (let end of endings) {
      const candidate = (Math.floor(price / 100) - 1) * 100 + end;
      const gp = (candidate - baseRate) / candidate;
      if (candidate < price && gp >= minGP) {
        result.beautified = true;
        result.comments.push(`美化报价：${price} → ${candidate}`);
        return candidate;
      }
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

  // removed final enforceMinGP and enforceMaxGP to preserve beautified results
  result.initialPrice = Math.ceil(price);
  let beautified = beautify(result.initialPrice);
  let finalGP = (beautified - baseRate) / beautified;

  if ((type === 'dryvan' || type === 'flatbed') && finalGP < minGP) {
    result.comments.push(`美化被取消：GP ${Math.round(finalGP * 100)}% < ${minGP * 100}%`);
    beautified = result.initialPrice; // 回退美化
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
  if (empty) doc[key] = value;
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

  if (shouldUpdate) {
    doc[priceField] = String(newAuto);
  } else {
    doc[priceField] = curPriceStr; // keep manual
  }
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
  if (!Number.isFinite(n) || n <= 0) {
    doc[priceField] = '';
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

  if (shouldUpdate) {
    doc[priceField] = newAuto;
  } else {
    // 用户手动改过，就保留手动值
    doc[priceField] = curPriceStr;
  }
}

function applyTruckingAutoPrices(prevDoc, doc) {
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

    if (shouldUpdate) doc[f.priceField] = oldFixed;
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

  // Price
  doc['Price'] = simulated.finalPrice ? Math.round(Number(simulated.finalPrice)) : '';

  // GP —— 強制存成數字（0.1603），不再存字串
  const finalPrice = Number(simulated.finalPrice) || 0;
  const baseRateNum = Number(baseRate) || 0;
  // GP - 存成純數字（0.1603），不存字串
  let gpNumber = 0;
  if (finalPrice > 0) {
    gpNumber = (finalPrice - baseRate) / finalPrice;
  }
  doc['GP'] = isNaN(gpNumber) ? 0 : gpNumber;  // 存 0.1603 這種數字

  console.log('[GP FINAL FIX] 寫入的 GP 數字 =', doc['GP']);

  // Adjusted GP（保持原樣，已正常）
  const adjPrice = Number(doc['Adjusted Price']) || 0;
  let adjGPNumber = 0;
  if (adjPrice > 0) {
    adjGPNumber = (adjPrice - baseRateNum) / adjPrice;
  }
  doc['Adjusted GP'] = isNaN(adjGPNumber) || !isFinite(adjGPNumber) ? '—' : (adjGPNumber * 100).toFixed(2) + '%';

  console.log('[GP FIX] 寫入結果：', {
    Price: doc['Price'],
    GP: doc['GP'],
    'Adjusted Price': doc['Adjusted Price'],
    'Adjusted GP': doc['Adjusted GP']
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

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  console.log('[DEBUG] /login called with username:', username);

  const user = users.find(u => u.username === username && u.password === password);
  if (!user) return res.json({ success: false, message: 'Invalid credentials' });

  // ✅ cookies
  res.cookie('username', user.username);
  res.cookie('role', user.role);
  res.cookie('salesGroup', user.salesGroup || ''); // ✅ NEW

  const role = String(user.role || '').toLowerCase();

  let redirect = '/index.html';
  if (role === 'manager') redirect = '/manager_dashboard.html';
  else if (role === 'sourcing') redirect = '/sourcing_dashboard.html';
  else if (role === 'sales' || role === 'ops_view') redirect = '/sales_dashboard_v2.html';

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

app.post('/inquiries', async (req, res) => {
  // ✅ New permission model: ops_view is strictly read-only
  const role = String(req.cookies?.role || '').toLowerCase();
  if (role === 'ops_view') {
    return res.status(403).send('OPS view-only cannot create inquiry.');
  }

  try {
    const raw = req.body || {};

    // ✅ Inherit salesGroup from parent (for Sourcing adding sub-lines)
    let inheritedGroup = ''
    let inheritedSubmitted = '';
    const parentQ = String(raw['Parent Quotation #'] || raw.parentQuotation || '').trim();
    if (parentQ) {
      const parentDoc = await findInquiryByQuote(parentQ);
      inheritedGroup = String(parentDoc?.salesGroup || '').trim();
      inheritedSubmitted = String(parentDoc?.['Submitted To Sourcing'] || '').trim();
    }

    // ✅ final salesGroup priority:
    // cookie (sales/opm submit) > body (if provided) > inherited(parent) > ''
    const finalSalesGroup =
      String(req.cookies?.salesGroup || '').trim() ||
      String(raw.salesGroup || raw['salesGroup'] || '').trim() ||
      inheritedGroup ||
      '';

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
      'Quotation #': raw['Quotation #'],

      'Parent Quotation #': raw['Parent Quotation #'] || raw.parentQuotation || '',
      'Type': raw['Type'] || raw.type || '',
      'Commodity': raw['Commodity'] || raw.commodity || '',
      'Package Type': raw['Package Type'] || raw.packageType || '',
      'Packages Per Container': raw['Packages Per Container'] || raw.packagesPerContainer || '',
      'Hazmat': raw['Hazmat'] || raw.hazmat || 'false',
      'Reefer': raw['Reefer'] || raw.reefer || 'false',
      'Bonded': raw['Bonded'] || raw.bonded || 'false',
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
      'Reefer Fee': raw['Reefer Fee'] || '',
      'Bond Fee': raw['Bond Fee'] || '',

      'Chassis Price': raw['Chassis Price'] || '',
      'Pre-Pull Price': raw['Pre-Pull Price'] || '',
      'Yard Storage Price': raw['Yard Storage Price'] || '',
      'Driver Waiting Price': raw['Driver Waiting Price'] || '',
      'Over Weight Price': raw['Over Weight Price'] || '',
      'Chassis Split Price': raw['Chassis Split Price'] || '',
      'Toll Price': raw['Toll Price'] || '',
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

      // ===== Sourcing cost send/save flags (scope-specific) =====
      'truckingCostSaved': raw['truckingCostSaved'] || 'false',
      'truckingCostSent': raw['truckingCostSent'] || 'false',
      'warehouseCostSaved': raw['warehouseCostSaved'] || 'false',
      'warehouseCostSent': raw['warehouseCostSent'] || 'false',

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
    applyBaseRateAutoPriceAndGP(data);
    applyTruckingAutoPrices(null, data);
    applyWarehouseAutoPrices(null, data);

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

    io.emit('inquiryUpdated', { quotationId: saved['Quotation #'] });

    return res.json({ success: true, data: saved });

  } catch (err) {
    console.error('[ERROR] Create inquiry failed:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
});

// Manager only
app.get('/manager_dashboard.html', requireRole('manager'), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'manager_dashboard.html'));
});

function requireAnyRole(roles) {
  return (req, res, next) => {
    const r = String(req.cookies.role || '').toLowerCase();
    if (!roles.includes(r)) return res.status(403).send('Forbidden');
    next();
  };
}

// Sales + OPS Teams
app.get(
  '/sales_dashboard_v2.html',
  requireAnyRole(['sales', 'ops_view']),
  (req, res) => res.sendFile(path.join(__dirname, 'public', 'sales_dashboard_v2.html'))
);

// Sourcing only
app.get('/sourcing_dashboard.html', requireRole('sourcing'), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sourcing_dashboard.html'));
});



app.get('/inquiries', async (req, res) => {
  try {
    const mongoReady = !!conn && conn.readyState === 1 && !!Inquiry;

    const role = String(req.cookies?.role || '').toLowerCase();
    const salesGroup = String(req.cookies?.salesGroup || '').trim();

    // ✅ read source
    // ✅ read source
    if (!mongoReady) return res.json([]);   // 关键：Mongo不通就不要用mock
    const inquiries = await Inquiry.find({}).lean();

    // ✅ manager sees all
    if (role === 'manager') {
      return res.json(inquiries);
    }

    // ✅ sourcing sees only "Submitted To Sourcing" inquiries
    if (role === 'sourcing') {
      return res.json(inquiries.filter(it => String(it['Submitted To Sourcing'] || '').toLowerCase().trim() === 'true'));
    }

    // ✅ sales/ops_view: filter by salesGroup
    if ((role === 'sales' || role === 'ops_view') && salesGroup) {
      return res.json(inquiries.filter(it => String(it.salesGroup || '').trim() === salesGroup));
    }

    // fallback: no group = nothing
    return res.json([]);
  } catch (err) {
    console.error('❌ /inquiries error:', err);
    return res.status(500).json({ success: false, message: 'Server error while loading inquiries' });
  }
});

app.post('/inquiries/update', async (req, res) => {
  const role = String(req.cookies?.role || '').toLowerCase();
  if (role === 'ops_view') {
    return res.status(403).json({ success: false, message: 'OPS view-only cannot modify data.' });
  }

  try {
    const incoming = req.body || {};
    console.log('[UPDATE] role=', role, 'quotation=', incoming['Quotation #'], 'keys=', Object.keys(incoming || {}));

    const quotationId = incoming['Quotation #'];

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
      'Over Weight', 'Chassis Split', 'Toll', 'Reefer Fee', 'Bond Fee', 'Carrier'
    ];
    const TRUCK_PRICE_FIELDS = [
      'Adjusted Price', 'Chassis Price', 'Pre-Pull Price', 'Yard Storage Price', 'Driver Waiting Price',
      'Over Weight Price', 'Chassis Split Price', 'Toll Price', 'Reefer Fee Price', 'Bond Fee Price', 'Carrier',
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

    const TRUCK_COST_FLAGS = ['truckingCostSaved', 'truckingCostSent', 'Selected', 'Cost Sent'];
    const WH_COST_FLAGS = ['warehouseCostSaved', 'warehouseCostSent', 'Selected', 'Cost Sent'];

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
      'Submitted To Sourcing', 'Submitted To Sourcing At'

    ];

    const META_DENY_ALWAYS = new Set(['_id', 'Quotation #']); // cannot change primary key in update

    function inList(v, arr) { return arr.includes(v); }

    function fieldScope(field) {
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

      // ✅ 允许 Sourcing 更新 Warehouse Note
      if (field === 'Warehouse Note') return true;

      // ✅ Vendor Note：只有 Sourcing 可以填写/修改，其他角色只能查看
      if (field === 'Vendor Note') return role === 'sourcing';

      // Front-ends commonly include this as a generic "touch" flag.
      // Allow it for all roles so we don't hard-fail saves.
      if (field === 'Saved') return true;

      if (role === 'sourcing') {
        // Sourcing updates COST + cost flags only
        return (
          inList(field, TRUCK_COST_FIELDS) ||
          inList(field, WH_COST_FIELDS) ||
          inList(field, TRUCK_COST_FLAGS) ||
          inList(field, WH_COST_FLAGS)
        );
      }

      if (role === 'sales') {
        // Sales updates PRICE + saved flags + sales-confirm flags, and limited inquiry edits (before cost)
        return (
          inList(field, TRUCK_PRICE_FIELDS) ||
          inList(field, WH_PRICE_FIELDS) ||
          inList(field, PRICE_SAVED_FLAGS) ||
          field === 'truckingSalesConfirmed' ||
          field === 'warehouseSalesConfirmed' ||
          inList(field, INQUIRY_EDIT_FIELDS)
        );
      }

      if (role === 'manager') {
        return (
          inList(field, TRUCK_PRICE_FIELDS) ||
          inList(field, WH_PRICE_FIELDS) ||
          inList(field, PRICE_SAVED_FLAGS) ||
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

    // Snapshot for "auto price keep manual override" logic
    const prevSnapshot = JSON.parse(JSON.stringify(existing));

    // ========= Build filtered update set =========
    const blocked = [];
    const filtered = {};

    for (const [k, v] of Object.entries(incoming)) {
      if (META_DENY_ALWAYS.has(k)) continue;

      // ✅ Ignore display/meta fields that front-ends may send back accidentally
      if (k === 'Requested By' || k === 'username') {
        continue;
      }

      // Some front-ends send helper fields that Sourcing should not mutate.
      // Ignore them (do not hard-fail) to keep SAVE/CHECK flow working.
      if (role === 'sourcing' && (k === 'Inquiry Type')) {
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

      // ✅ 防止前端空字串把已有值覆盖成空（特别是 autosave / checkbox）
      if (v === '' && k !== 'Note' && k !== 'Vendor Note' && k !== 'Warehouse Note') {
        continue;
      }
      filtered[k] = v;
    }

    console.log('[UPDATE BLOCKED]', blocked);

// ✅ Sourcing: ignore blocked keys and continue saving allowed fields (prevents "save then reload clears")
if (blocked.length && role === 'sourcing') {
  console.warn('[UPDATE] sourcing ignored blocked fields:', blocked.map(b => b.field));
  // continue (do NOT 403)
} else if (blocked.length) {
  // Keep behavior strict for other roles to avoid silent data drift
  return res.status(403).json({
    success: false,
    message: 'Update blocked by permission/lock rules',
    blocked
  });
}

    // ========= Apply updates =========
    const patch = buildSafePatch(filtered);
    Object.keys(patch).forEach(key => {
      existing[key] = patch[key];
    });


    // ✅ Backward-compatible flags so Sales/Manager pages (older logic) can "receive" Cost Sent
    if (role === 'sourcing') {
      const anyCostSent =
        isTruthy(existing['truckingCostSent']) || isTruthy(existing['warehouseCostSent']);
      existing['Cost Sent'] = anyCostSent ? 'true' : 'false';
      existing['Selected'] = anyCostSent ? 'true' : 'false';
    }

    // Always apply units and auto rules
    applyTruckingUnits(existing);
    applyWarehouseUnits(existing);

    // Auto for Base Rate + GP
    applyBaseRateAutoPriceAndGP(existing);

    // Auto for other items (preserve manual overrides based on prevSnapshot)
    applyTruckingAutoPrices(prevSnapshot, existing);
    applyWarehouseAutoPrices(prevSnapshot, existing);

    // ========= Save =========
    if (loaded.mode === 'mock') {
      mockInquiries[loaded.idx] = existing;
      io.emit('inquiryUpdated', { quotationId });
      return res.json({ success: true, data: existing });
    }

    await existing.save();
    io.emit('inquiryUpdated', { quotationId });
    return res.json({ success: true, data: existing });

  } catch (err) {
    console.error('[ERROR] Update failed:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Server error'
    });
  }
});


app.post('/api/push-to-gofreight', async (req, res) => {
  const role = String(req.cookies?.role || '').toLowerCase();
  if (role === 'ops_view') {
    return res.status(403).json({ success: false, message: 'OPS view-only cannot modify data.' });
  }

  const inquiry = req.body;
  const apiKey = process.env.GOFREIGHT_API_KEY;
  const baseUrl = process.env.GOFREIGHT_API_BASE || 'https://api.core.gofreight.co';

  if (!inquiry || !inquiry['Quotation #'] || !inquiry['Customer ID']) {
    return res.status(400).json({ error: 'Missing Quotation # or Customer ID' });
  }

  const freightMapping = {
    'Adjusted Price': {
      code: '40601',
      desc: 'Drayage - Hauling Fee per Container',
      unit: 'CNTR'
    },
    'Chassis Price': {
      code: '40601',
      desc: 'FCL Drayage Surcharge - Chassis Fee Per Day',
      unit: 'DAYS'
    },
    'Pre-Pull Price': {
      code: '40601',
      desc: 'Drayage Surcharge - Pre Pull',
      unit: 'CNTR'
    },
    'Yard Storage Price': {
      code: '40601',
      desc: 'Drayage Surcharge - Yard Storage',
      unit: 'DAYS'
    },
    'Driver Waiting Price': {
      code: '40601',
      desc: 'Drayage Surcharge - Driver Waiting Time at Warehouse/ Per Hour',
      unit: 'HRS'
    },
    'Over Weight Price': {
      code: '40601',
      desc: 'Drayage Surcharge - Overweight Fee',
      unit: 'CNTR'
    },
    'Chassis Split Price': {
      code: '40601',
      desc: 'Drayage Surcharge - Chassis Split',
      unit: 'SPLIT'
    }
  };


  const chargeItems = [];

  for (const [field, config] of Object.entries(freightMapping)) {
    const amount = parseFloat(inquiry[field]);
    if (!isNaN(amount) && amount > 0) {
      chargeItems.push({
        billing_code_ref: config.code,
        description: config.desc,
        carrier_ref: 'TP0001',
        unit: config.unit,
        currency_ref: '1',
        use_separate_rate: false,
        all_price_data: {
          quantity: '1.0',
          rate: String(amount.toFixed(2)),
        },
        remark: `Auto from TTS: ${field}`
      });
    }
  }

  // ✅ Normalize Quotation # input:
  // - Users enter only 6 digits like "000001"
  // - Allow accidental inputs like "1", "000001-1", "000001-A", "TTSQT-000001"
  // - GoFreight query always uses "TTSQT-000001"
  function normalizeMainId(raw) {
    const s = String(raw || '').trim().toUpperCase();

    // remove optional prefix
    let t = s.replace(/^TTSQT-?/, '');

    // remove sub part: /1 or -1 or -A
    t = t.split('/')[0];
    t = t.split('-')[0];

    // keep digits only
    t = t.replace(/\D/g, '');

    if (!t) return '';
    return t.padStart(6, '0').slice(-6);
  }

  const { base } = parseQuoteId(inquiry['Quotation #']);
  const quotationNo = base ? `TTSQT-${base}` : null;

  function parseQuoteId(raw) {
    const s0 = String(raw || '').trim().toUpperCase();
    if (!s0) return { base: '', line: '', option: '' };

    // allow accidental "TTSQT-"
    const s = s0.replace(/^TTSQT-?/, '');

    // Match:
    // 000001
    // 000001A
    // 000001A-1
    // 000001A-A
    const m = s.match(/^(\d{1,6})([A-Z])?(?:-([A-Z]|\d+))?$/);
    if (!m) {
      // fallback: extract digits as base
      const digits = (s.match(/\d+/g) || []).join('');
      const base = digits ? digits.padStart(6, '0').slice(-6) : '';
      return { base, line: base, option: '' };
    }

    const base = String(m[1] || '').padStart(6, '0').slice(-6);
    const lineSuffix = m[2] || '';                 // A/B/C
    const optionSuffix = m[3] || '';               // 1/2 or A/B

    const line = base + lineSuffix;                // 000001A (or 000001)
    const option = optionSuffix ? `${line}-${optionSuffix}` : ''; // 000001A-1 / 000001A-A

    return { base, line, option };
  }

  let quotationRef = null;
  try {
    const url = `${baseUrl}/api/v1/quotations?quotation_no=${quotationNo}`;
    const refRes = await fetch(url, {
      method: 'GET',
      headers: { 'x-api-key': apiKey }
    });

    const rawText = await refRes.text();
    console.log('[DEBUG] refRes.status =', refRes.status);
    console.log('[DEBUG] Raw text from GF:', rawText);

    let refJson;
    try {
      refJson = JSON.parse(rawText);
    } catch (err) {
      console.error('❌ JSON parse error:', err);
      return res.status(500).json({
        error: 'Invalid JSON returned from GoFreight',
        raw: rawText.slice(0, 1000)
      });
    }

    quotationRef = Array.isArray(refJson) && refJson.length > 0 ? refJson[0].ref : null;

    if (!quotationRef) {
      console.error('❌ Cannot find quotation ref for:', quotationNo);
      return res.status(400).json({ error: 'Quotation not found on GoFreight', raw: rawText });
    }

    console.log('[DEBUG] GoFreight quotation ref =', quotationRef);
  } catch (err) {
    console.error('❌ Failed to get quotation ref from GoFreight:', err);
    return res.status(500).json({ error: 'Error fetching quotation ref' });
  }

  const alreadyPushed = await Inquiry.findOne({
    'Quotation #': fullQuoteId,
    'Pushed To GF': 'true'
  });
  if (alreadyPushed) {
    return res.status(200).send('Already pushed');
  }

  if (!quotationNo) {
    return res.status(400).json({ error: 'Invalid Quotation #' });
  }

  const routeLabel = subId ? `Route ${subId}` : 'Destination charges';
  const payload = {
    description: routeLabel,
    location_ref: 'USLAX',
    charge_items: chargeItems
  };


  try {
    console.log('[DEBUG] quotationRef:', quotationRef);
    console.log('[DEBUG] routeLabel:', routeLabel);
    console.log('[DEBUG] chargeItems:\n', JSON.stringify(chargeItems, null, 2));

    const gfRes = await fetch(`${baseUrl}/api/v1/quotations/${quotationRef}/charge-groups`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        description: routeLabel,
        location_ref: 'USLAX',
        charge_items: chargeItems
      })
    });


    const result = await gfRes.text();

    if (!result || result.trim() === '') {
      console.error('❌ Empty response from GoFreight');
      return res.status(gfRes.status).json({
        error: 'Empty response from GoFreight',
        raw: result
      });
    }

    let resultJson;
    try {
      resultJson = JSON.parse(result);
    } catch (err) {
      console.error('❌ JSON parse error:', err);
      return res.status(500).json({
        error: 'Invalid JSON returned from GoFreight',
        raw: result
      });
    }

    const patch = buildSafePatch(incoming);
    await Inquiry.updateOne({ 'Quotation #': quotationId }, { $set: patch });

    res.status(gfRes.status).json(resultJson);
  } catch (err) {
    console.error('❌ Push to GoFreight failed:', err);
    res.status(500).json({ error: 'Server error during push', detail: err.message });
  }
});

app.post('/duplicate_inquiry', async (req, res) => {
  const role = String(req.cookies?.role || '').toLowerCase();
  if (role === 'ops_view') {
    return res.status(403).json({ success: false, message: 'OPS view-only cannot modify data.' });
  }

  const { quoteId } = req.body;
  if (!quoteId) return res.status(400).json({ success: false, message: 'Missing quoteId' });

  try {
    const original = await Inquiry.findOne({ 'Quotation #': quoteId }).lean();
    if (!original) return res.status(404).json({ success: false, message: 'Quotation # not found' });

    const baseId = quoteId.split('-')[0];
    const siblings = await Inquiry.find({ 'Quotation #': { $regex: `^${baseId}-` } });

    const suffixes = siblings.map(doc => {
      const parts = (doc['Quotation #'] || '').split('-');
      return parseInt(parts[1]) || 0;
    });

    const nextSuffix = (suffixes.length > 0 ? Math.max(...suffixes) : 0) + 1;
    const newQuote = `${baseId}-${nextSuffix}`;

    const duplicated = { ...original, 'Quotation #': newQuote };
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

    applyTruckingUnits(duplicated);
    applyWarehouseUnits(duplicated);

    applyTruckingAutoPrices(null, duplicated);
    applyWarehouseAutoPrices(null, duplicated);   // ← 去掉注释


    const newInquiry = new Inquiry(duplicated);
    await newInquiry.save();

    io.emit('inquiryUpdated', { quotationId: newQuote });
    res.json({ success: true, data: newInquiry });
  } catch (err) {
    console.error('[ERROR] Failed to duplicate inquiry:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});


app.post('/delete_inquiry', async (req, res) => {
  const role = String(req.cookies?.role || '').toLowerCase();
  if (role === 'ops_view') {
    return res.status(403).json({ success: false, message: 'OPS view-only cannot modify data.' });
  }

  const { quoteId } = req.body;
  console.log(`[DEBUG] /delete_inquiry called with quoteId: ${quoteId}`);

  if (!quoteId || String(quoteId).trim() === '') {
    return res.status(400).json({ success: false, message: 'Missing quoteId' });
  }

  try {
    // ✅ Mock mode branch (same pattern as /inquiries/update)
    if (USE_MOCK || !conn || conn.readyState !== 1 || !Inquiry) {
      const targetId = String(quoteId).trim();
      const target = mockInquiries.find(x => String(x['Quotation #'] || '').trim() === targetId);

      if (!target) {
        return res.status(404).json({ success: false, message: 'Quotation # not found (mock)' });
      }

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
      io.emit('inquiryUpdated', { quotationId: quoteId });
      return res.json({ success: true });
    }

    // ✅ MongoDB branch
    const doc = await Inquiry.findOne({ 'Quotation #': quoteId });
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Quotation # not found' });
    }

    const locked =
      isTruthy(doc['truckingCostSent']) || isTruthy(doc['warehouseCostSent']) ||
      isTruthy(doc['truckingSalesConfirmed']) || isTruthy(doc['truckingManagerConfirmed']) ||
      isTruthy(doc['warehouseSalesConfirmed']) || isTruthy(doc['warehouseManagerConfirmed']);

    if (locked) {
      return res.status(403).json({ success: false, message: 'Cannot delete: row is locked (cost sent or price confirmed).' });
    }

    const result = await Inquiry.deleteOne({ 'Quotation #': quoteId });

    console.log(`[DEBUG] Deleted inquiry: ${quoteId}`);
    io.emit('inquiryUpdated', { quotationId: quoteId });
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
  res.json({ username, role, salesGroup: salesGroup || '' });
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
app.post('/public/inquiries', async (req, res) => {
  try {
    const raw = req.body || {};

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

app.get('/__debug/db', async (req, res) => {
  try {
    const mongoReady = !!conn && conn.readyState === 1 && !!Inquiry;
    const count = mongoReady ? await Inquiry.countDocuments({}) : null;
    res.json({
      USE_MOCK,
      mongoReady,
      dbName: conn?.name || conn?.db?.databaseName || null,
      collection: 'inquiries',
      count,
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

server.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});



