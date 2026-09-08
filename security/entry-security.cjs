'use strict';

const crypto = require('crypto');
const SESSION_COOKIE = 'ttsSession';
const SESSION_MS = 8 * 60 * 60 * 1000;
const COOKIE_OPTIONS = { sameSite: 'Lax', httpOnly: true, secure: true, signed: true, path: '/' };

// Bound both stored keys and per-key timestamps; deny new keys at capacity.
function createLimiter({ limit, windowMs = 900000, maxKeys = 10000, now = Date.now }) {
  const entries = new Map();
  let lastSweep = 0;
  return key => {
    const time = now();
    if (time - lastSweep >= 60000 || entries.size >= maxKeys) {
      for (const [k, times] of entries) {
        if (!times.length || times[times.length - 1] <= time - windowMs) entries.delete(k);
      }
      lastSweep = time;
    }
    const times = (entries.get(key) || []).filter(t => t > time - windowMs);
    if (times.length >= limit || (!entries.has(key) && entries.size >= maxKeys)) return true;
    times.push(time);
    entries.set(key, times);
    return false;
  };
}

function configureProxy(app, env) {
  // No trust-by-default: never accept the leftmost XFF supplied by an arbitrary client.
  const cidrs = String(env.TRUSTED_PROXY_CIDRS || '').split(',').map(s => s.trim()).filter(Boolean);
  const hops = String(env.TRUST_PROXY_HOPS || '').trim();
  if (cidrs.length && hops) throw new Error('Configure either TRUSTED_PROXY_CIDRS or TRUST_PROXY_HOPS, not both.');
  if (hops && !/^[1-9][0-9]?$/.test(hops)) throw new Error('TRUST_PROXY_HOPS must be an integer from 1 to 99.');
  app.set('trust proxy', cidrs.length ? cidrs : hops ? Number(hops) : false);
}

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function createEntrySecurity({ env, fetch, getUsers, getCollection, mock = false, now = Date.now, verificationTimeoutMs = 8000 }) {
  const memorySessions = new Map();
  let indexReady;
  const publicLimit = createLimiter({ limit: 5, now });
  const loginIpLimit = createLimiter({ limit: 100, now });
  const loginAccountLimit = createLimiter({ limit: 20, now });
  const hash = value => crypto.createHash('sha256').update(value).digest('hex');
  const authVersion = user => hash(user.passwordHash || '');
  const tokenId = token => typeof token === 'string' && /^[a-f0-9]{64}$/.test(token) ? hash(token) : null;

  async function collection() {
    const db = getCollection();
    if (!db) throw new Error('Session storage unavailable');
    if (!indexReady) {
      indexReady = Promise.resolve().then(() => db.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }))
        .catch(err => { indexReady = undefined; throw err; });
    }
    await indexReady;
    return db;
  }
  async function createSession(user) {
    const token = crypto.randomBytes(32).toString('hex');
    const record = { _id: hash(token), username: user.username, authVersion: authVersion(user), expiresAt: new Date(now() + SESSION_MS) };
    if (mock) {
      for (const [id, value] of memorySessions) if (+value.expiresAt <= now()) memorySessions.delete(id);
      if (memorySessions.size >= 10000) throw new Error('Session capacity reached');
      memorySessions.set(record._id, record);
    } else await (await collection()).insertOne(record);
    return { token, record };
  }
  async function resolveSession(token) {
    const id = tokenId(token);
    if (!id) return null;
    const record = mock ? memorySessions.get(id) : await (await collection()).findOne({ _id: id });
    // TTL cleanup is asynchronous, so expiry must always be checked here too.
    if (!record || +record.expiresAt <= now()) return null;
    const user = getUsers().find(u => u.username === record.username);
    if (!user || record.authVersion !== authVersion(user)) return null;
    return { user, id, expiresAt: +record.expiresAt };
  }
  async function revokeSession(token) {
    const id = tokenId(token);
    if (!id) return;
    if (mock) memorySessions.delete(id);
    else await (await collection()).deleteOne({ _id: id });
  }

  async function verifyTurnstile(raw, req) {
    const secret = String(env.TURNSTILE_SECRET_KEY || '').trim();
    if (!secret) return { status: 503, message: 'Verification temporarily unavailable. Please try again later.' };
    const token = raw['cf-turnstile-response'] || raw.turnstileToken;
    if (typeof token !== 'string' || !token.trim() || token.length > 2048) {
      return { status: 400, message: 'Please complete the verification and try again.' };
    }
    const controller = new AbortController();
    let timer;
    try {
      const response = await Promise.race([
        (async () => {
          const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ secret, response: token.trim(), remoteip: clientIp(req) }),
            signal: controller.signal
          });
          if (!result.ok) throw new Error('Verification upstream error');
          return result.json();
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Verification timeout')); }, verificationTimeoutMs); })
      ]);
      const allowed = String(env.TURNSTILE_ALLOWED_HOSTNAMES || 'rates.totalsolutionus.com').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      if (response?.success !== true || typeof response.hostname !== 'string' || !allowed.includes(response.hostname.toLowerCase())) {
        return { status: 400, message: 'Verification failed. Please verify again and retry.' };
      }
      return null;
    } catch (_) {
      // Network, timeout and malformed response failures must never permit a write.
      return { status: 503, message: 'Verification temporarily unavailable. Please try again later.' };
    } finally { clearTimeout(timer); }
  }

  return {
    createSession, resolveSession, revokeSession, verifyTurnstile,
    portalRateLimited: req => publicLimit(clientIp(req)),
    loginRateLimited: (req, username) => loginIpLimit(clientIp(req)) || loginAccountLimit(clientIp(req) + ':' + String(username || '').slice(0, 128))
  };
}

// Resolve legacy aliases BEFORE applying the same validation to every accepted value.
function normalizeInquiry(input, aliases) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Please submit a valid form.');
  const raw = Object.create(null);
  for (const [canonical, legacy] of aliases) {
    for (const key of [canonical, legacy]) {
      const value = input[key];
      if (value != null && !['string', 'number', 'boolean'].includes(typeof value)) throw new Error('Invalid form field type.');
    }
    const value = String(input[canonical] || input[legacy] || '');
    const max = canonical === 'warehouseServiceDetail' ? 8000 : 1000;
    if (value.length > max) throw new Error('Please shorten long fields and try again.');
    raw[canonical] = value;
  }
  const hasLink = value => /(https?:\/\/|www\.|\[url)/i.test(value);
  if (['companyName', 'contactName', 'note', 'warehouseNote', 'truckInquiryNote'].some(key => hasLink(raw[key] || ''))) {
    throw new Error('Please remove links from contact names and notes.');
  }
  return raw;
}

module.exports = { createEntrySecurity, createLimiter, configureProxy, clientIp, normalizeInquiry, SESSION_COOKIE, SESSION_MS, COOKIE_OPTIONS };
