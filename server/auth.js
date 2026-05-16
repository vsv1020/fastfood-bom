import crypto from 'node:crypto';
import { db, getSetting, setSetting } from './db.js';

const COOKIE_NAME = 'bom_auth';
const SETTINGS_KEY = 'access_codes_json';

function rand8() {
  // 8 位大写字母+数字,排除易混 0/O/1/I
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += chars[crypto.randomInt(0, chars.length)];
  return s;
}

let CODES = new Set();

export function initAccessCodes() {
  const existing = getSetting(SETTINGS_KEY);
  if (existing) {
    try {
      const arr = JSON.parse(existing);
      if (Array.isArray(arr) && arr.length > 0) {
        CODES = new Set(arr);
        console.log(`[auth] loaded ${CODES.size} access codes from settings`);
        return [...CODES];
      }
    } catch {}
  }
  const codes = Array.from({ length: 10 }, () => rand8());
  setSetting(SETTINGS_KEY, JSON.stringify(codes));
  CODES = new Set(codes);
  console.log('================================================================');
  console.log('[auth] generated 10 ACCESS CODES (save them, only these can login):');
  for (const c of codes) console.log('   ' + c);
  console.log('================================================================');
  return codes;
}

function parseCookies(raw) {
  const out = {};
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k] = decodeURIComponent(v.join('='));
  }
  return out;
}

export function authMiddleware(req, res, next) {
  // /api/auth/* + /api/health 放行
  if (req.path.startsWith('/auth') || req.path === '/health') return next();
  const cookies = parseCookies(req.headers.cookie);
  const c = cookies[COOKIE_NAME];
  if (c && CODES.has(c)) return next();
  // export 也可以接受 ?code= query (浏览器原生 download 已经能带 cookie,但保险)
  if (req.query && typeof req.query.code === 'string' && CODES.has(req.query.code)) return next();
  res.status(401).json({ error: 'unauthorized', need_login: true });
}

export function verifyCode(code) {
  return typeof code === 'string' && CODES.has(code);
}

export function makeAuthCookie(code) {
  // HttpOnly + SameSite=Lax,30 天
  return `${COOKIE_NAME}=${encodeURIComponent(code)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
}

export function clearAuthCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
