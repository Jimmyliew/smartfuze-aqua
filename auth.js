'use strict';
/** SMARTFUZE AQUA - password hashing and session helpers (Node built-ins only). */
const crypto = require('crypto');

function hashSecret(secret, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(String(secret), salt, 64).toString('hex') };
}
function verifySecret(secret, rec) {
  if (!rec || !rec.salt || !rec.hash) return false;
  const h = crypto.scryptSync(String(secret), rec.salt, 64);
  const ref = Buffer.from(rec.hash, 'hex');
  return ref.length === h.length && crypto.timingSafeEqual(h, ref);
}
const sha = t => crypto.createHash('sha256').update(String(t)).digest('hex');
/** Random password without look-alike characters (no 0/O, 1/l/I). */
function randomPassword(n = 20) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let s = '';
  for (const x of crypto.randomBytes(n)) s += chars[x % chars.length];
  return s;
}
function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i > 0) { try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch (_) {} }
  }
  return out;
}
module.exports = { hashSecret, verifySecret, sha, randomPassword, parseCookies };
