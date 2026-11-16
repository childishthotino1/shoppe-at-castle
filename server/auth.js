'use strict';
const crypto = require('node:crypto');

const SESSION_DAYS = 30;
const COOKIE = 'shoppe_session';

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(pw, stored) {
  const [scheme, saltB64, hashB64] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(String(pw), Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function createSession(db, staffId) {
  const id = crypto.randomBytes(32).toString('base64url');
  const expires = Date.now() + SESSION_DAYS * 86400000;
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (id, staff_id, expires_at) VALUES (?, ?, ?)').run(id, staffId, expires);
  return { id, expires };
}

function sessionCookie(req, value, maxAgeSec) {
  const secure = req.secure || req.get('x-forwarded-proto') === 'https';
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
}

/** Express middleware: attaches req.staff when a valid session cookie is present. */
function loadSession(db) {
  const stmt = db.prepare(`SELECT s.* FROM sessions x JOIN staff s ON s.id = x.staff_id
    WHERE x.id = ? AND x.expires_at > ? AND s.active = 1`);
  return (req, _res, next) => {
    const sid = parseCookies(req.headers.cookie)[COOKIE];
    req.sessionId = sid || null;
    req.staff = sid ? stmt.get(sid, Date.now()) || null : null;
    next();
  };
}

function requireStaff(req, res, next) {
  if (!req.staff) return res.status(401).json({ error: 'Please sign in.' });
  next();
}

function requireOwner(req, res, next) {
  if (!req.staff) return res.status(401).json({ error: 'Please sign in.' });
  if (req.staff.role !== 'owner') return res.status(403).json({ error: 'Only owners can do that.' });
  next();
}

/** Tiny in-memory rate limiter (per IP + key). Good enough for one small shop server. */
function rateLimit({ windowMs, max, key = 'default' }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const k = `${key}:${req.ip}`;
    const entry = hits.get(k);
    if (!entry || entry.reset < now) {
      hits.set(k, { count: 1, reset: now + windowMs });
    } else if (++entry.count > max) {
      return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
    }
    if (hits.size > 5000) for (const [kk, v] of hits) if (v.reset < now) hits.delete(kk);
    next();
  };
}

module.exports = {
  COOKIE, SESSION_DAYS, hashPassword, verifyPassword, parseCookies, createSession,
  sessionCookie, loadSession, requireStaff, requireOwner, rateLimit,
};
