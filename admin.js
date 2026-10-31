'use strict';
/**
 * SMARTFUZE AQUA admin tool (used by the cloud installer and helper commands).
 * Stop the aqua service first: it edits data/state.json directly.
 *
 *   AQUA_NEW_PASSWORD=... node tools/admin.js set-password [username]
 *   node tools/admin.js add-device <POND_ID> [username]     -> CREATED <user> <password> | EXISTS <user>
 *   node tools/admin.js list-devices
 */
const path = require('path');
const { Store } = require('../lib/store');
const auth = require('../lib/auth');

const DATA = process.env.AQUA_DATA_DIR || path.join(__dirname, '..', 'data');
const [cmd, a1, a2] = process.argv.slice(2);
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const die = m => { console.error('ERROR: ' + m); process.exit(1); };

const store = new Store(DATA);
const S = store.state;

if (cmd === 'set-password') {
  const username = a1 || 'admin';
  const pw = process.env.AQUA_NEW_PASSWORD || '';
  if (pw.length < 10) die('password must be at least 10 characters');
  const rec = { username, ...auth.hashSecret(pw), updatedAt: new Date().toISOString() };
  const i = S.auth.users.findIndex(u => u.username === username);
  if (i >= 0) S.auth.users[i] = rec; else S.auth.users.push(rec);
  S.auth.sessions = []; // every phone must sign in again
  store.flush();
  console.log('OK password set for ' + username);
} else if (cmd === 'add-device') {
  const pondId = a1;
  if (!ID_RE.test(pondId || '')) die('usage: add-device <POND_ID> [username]');
  const username = a2 || 'dev-' + pondId.toLowerCase();
  if (S.deviceCreds.some(d => d.username === username)) { console.log('EXISTS ' + username); process.exit(0); }
  const password = auth.randomPassword(20);
  S.deviceCreds.push({ username, pondId, ...auth.hashSecret(password), createdAt: new Date().toISOString(), lastLoginAt: null });
  store.flush();
  console.log(`CREATED ${username} ${password}`);
} else if (cmd === 'list-devices') {
  for (const d of S.deviceCreds) console.log(`${d.username}\t${d.pondId}\tlast login: ${d.lastLoginAt || 'never'}`);
} else {
  console.log('usage: set-password [user] | add-device <POND_ID> [user] | list-devices');
  process.exit(1);
}
