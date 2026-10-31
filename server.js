'use strict';
/**
 * SMARTFUZE AQUA v2.0.1 - server
 *
 *   ESP32 --MQTT:1883--> [Aedes broker] --> ingest --> data/ (state.json + readings/)
 *                                                  \-> WebSocket /ws --> dashboard (PWA)
 *                                                  \-> Pushover (critical alerts wake phones)
 *   AQUA --every 60 s--> external watchdog (healthchecks.io) - alerts you if AQUA itself goes silent
 *
 * Rules enforced here:
 *  - Ponds are created ONLY from real MQTT telemetry. Nothing is simulated.
 *  - Sensor fields that a device does not send are "not installed", never zero.
 *  - Feeding is never reported "Confirmed" without an acknowledgement from the feeder.
 *  - Feeding is paused by the safety interlock (device offline / critical alert / pause window).
 */
const http = require('http');
const tls = require('tls');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
const express = require('express');
const { WebSocketServer } = require('ws');
const aedesFactory = require('aedes');

const { Store } = require('./lib/store');
const ph = require('./lib/ph');
const { AlertEngine } = require('./lib/alerts');
const aq = require('./lib/aquaculture');
const notify = require('./lib/notify');
const auth = require('./lib/auth');
const { Bus } = require('./lib/bus');

const VERSION = '2.0.3';
const HTTP_PORT = Number(process.env.AQUA_HTTP_PORT || 3000);
const MQTT_PORT = Number(process.env.AQUA_MQTT_PORT || 1883);
const DATA_DIR = process.env.AQUA_DATA_DIR || path.join(__dirname, 'data');
// Cloud mode (set by cloud/install.sh): dashboard login, encrypted + authenticated MQTT on 8883,
// plain MQTT and HTTP only on 127.0.0.1 behind Caddy (HTTPS).
const CLOUD = process.env.AQUA_MODE === 'cloud';
const REQUIRE_LOGIN = CLOUD || process.env.AQUA_REQUIRE_LOGIN === '1';
const REQUIRE_DEVICE_AUTH = CLOUD || process.env.AQUA_REQUIRE_DEVICE_AUTH === '1';
const HTTP_HOST = process.env.AQUA_HTTP_HOST || '0.0.0.0';
const MQTT_HOST = process.env.AQUA_MQTT_HOST || '0.0.0.0';
const MQTTS_PORT = Number(process.env.AQUA_MQTTS_PORT || 8883);
const TLS_CERT = process.env.AQUA_TLS_CERT || '';
const TLS_KEY = process.env.AQUA_TLS_KEY || '';
const PUBLIC_HOST = process.env.AQUA_PUBLIC_HOST || '';

const store = new Store(DATA_DIR);
const S = () => store.state;
if (!S().settings.publicUrl && (process.env.AQUA_PUBLIC_URL || PUBLIC_HOST)) S().settings.publicUrl = process.env.AQUA_PUBLIC_URL || 'https://' + PUBLIC_HOST;

// ---------------------------------------------------------------- helpers
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const nowIso = () => new Date().toISOString();
const newId = (prefix) => prefix + '-' + crypto.randomBytes(5).toString('hex');
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const round = (v, d) => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d);
const numIn = (v, min, max, d) => { const n = num(v); return n !== null && n >= min && n <= max ? round(n, d) : null; };
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

function optNum(v, min, max, label) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw bad(`${label} must be between ${min} and ${max}`);
  return n;
}
function safeUrl(u, httpOnly = false) {
  const s = str(u, 500);
  if (!s) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) return null;
  if (/^(javascript|data|vbscript|file):/i.test(s)) return null;
  if (httpOnly && !/^https?:\/\//i.test(s)) return null;
  return s;
}
function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address });
  }
  return out;
}
function hhmm(d = new Date()) { return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
function localDay(d = new Date()) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

// ---------------------------------------------------------------- event bus
// Modules talk through events instead of calling each other (see lib/bus.js).
const bus = new Bus();
const changed = kind => bus.emit('config.changed', { kind });

// ---------------------------------------------------------------- realtime module (WebSocket fan-out)
let wss = null;
function broadcast(msg) {
  if (!wss) return;
  const data = JSON.stringify(msg);
  for (const c of wss.clients) if (c.readyState === 1) c.send(data);
}

// ---------------------------------------------------------------- notifications
function logNotify(entry) {
  const l = S().notifyLog;
  l.unshift(entry);
  if (l.length > 100) l.length = 100;
  store.save();
  changed('settings');
}
async function sendPush(msg, attempt = 1) {
  const cfg = S().notifications.pushover;
  if (!cfg.enabled) return { ok: false, skipped: true, error: 'Notifications are switched off' };
  const r = await notify.pushover(cfg, { url: S().settings.publicUrl || undefined, urlTitle: '打开 AQUA', ...msg });
  logNotify({ ts: nowIso(), title: msg.title, priority: msg.priority, ok: r.ok, error: r.error || null, attempt });
  // A 4G hiccup must not swallow a critical alert: retry after 1, 2 and 3 minutes.
  if (!r.ok && !r.skipped && attempt < 4 && !/invalid|token|user/i.test(r.error || '')) {
    setTimeout(() => sendPush(msg, attempt + 1), attempt * 60000);
  }
  return r;
}

const alerts = new AlertEngine(store, bus);

// ---------------------------------------------------------------- notifications module
function pushForAlert(kind, alert) {
  if (!S().notifications.pushover.enabled) return;
  const sev = alert.severity === 'critical' ? '严重报警' : '警告';
  if (kind === 'raised') {
    const priority = alert.kind === 'lab' ? 1 : alert.severity === 'critical' ? 2 : 1;
    sendPush({ title: `AQUA ${sev}：${alert.pondName}`, message: alert.messageZh || alert.message, priority });
  } else {
    sendPush({ title: `AQUA 已恢复：${alert.pondName}`, message: `${alert.ruleNameZh || alert.ruleName} 已恢复正常`, priority: 0 });
  }
}
bus.on('alert.raised', ({ alert }) => pushForAlert('raised', alert), 'notifications');
bus.on('alert.resolved', ({ alert }) => pushForAlert('resolved', alert), 'notifications');

// ---------------------------------------------------------------- external watchdog
const watchdog = { lastAt: null, ok: null, error: null };
async function pingWatchdog() {
  const url = S().notifications.watchdogUrl;
  if (!url) return;
  const r = await notify.ping(url);
  watchdog.lastAt = nowIso(); watchdog.ok = r.ok; watchdog.error = r.ok ? null : (r.error || 'HTTP ' + r.status);
}
setInterval(pingWatchdog, 60000);

// ---------------------------------------------------------------- telemetry
function validTemperature(v) {
  const t = num(v);
  if (t === null || t <= -55 || t >= 125 || t === 85) return null; // -127 = disconnected, 85 = power-on reset
  return round(t, 2);
}
const validPh = v => numIn(v, 0, 14, 2);
const validRaw = v => { const r = num(v); return r !== null && r >= 0 && r <= 4095 ? Math.round(r) : null; };

// Optional sensors. Absent field = not installed (never shown as 0). Present but invalid = null (fault).
const OPTIONAL = {
  doMgL: v => numIn(v, 0, 30, 2),
  flowLpm: v => numIn(v, 0, 20000, 1),
  airPumpCurrentA: v => numIn(v, 0, 100, 3),
  salinityPpt: v => numIn(v, 0, 60, 1),
  pumpRunning: v => (typeof v === 'boolean' ? v : null),
  airPumpRunning: v => (typeof v === 'boolean' ? v : null),
  waterLevel: v => (['low', 'ok', 'high'].includes(v) ? v : null)
};
const TRACKED = ['temperatureC', 'ph', 'doMgL', 'flowLpm', 'waterLevel', 'airPumpCurrentA', 'salinityPpt'];

function activeCalibration(pondId) {
  return S().calibrations.find(c => c.active && c.pondId === pondId) || null;
}

function ensurePond(pondId, pondName) {
  const st = S();
  let pond = st.ponds[pondId];
  if (!pond) {
    pond = st.ponds[pondId] = {
      id: pondId, name: str(pondName, 60) || pondId, nameLocked: false,
      siteId: st.site.id, deviceId: null, online: false, hasTelemetry: false,
      firstSeen: nowIso(), lastSeen: null, lastUpdate: null, lastStatus: null,
      latest: null, derived: {}, sensorsSeen: []
    };
    console.log(`[pond] new pond registered from real telemetry: ${pondId}`);
  } else if (!pond.nameLocked && str(pondName, 60)) {
    pond.name = str(pondName, 60);
  }
  if (!pond.sensorsSeen) pond.sensorsSeen = [];
  if (!pond.derived) pond.derived = {};
  return pond;
}

function setOnline(pond, online, reason) {
  const changed = pond.online !== online;
  pond.online = online;
  if (pond.deviceId && S().devices[pond.deviceId]) S().devices[pond.deviceId].online = online;
  if (changed) {
    console.log(`[status] ${pond.id} -> ${online ? 'Online' : 'Offline'} (${reason})`);
    bus.emit('pond.status', { pond, online, reason });
  }
}

// pH daily swing: 10-minute averages over the last 24 h (single spikes cannot fake a swing).
const phWin = new Map();
function addPh(pondId, t, v) {
  if (!isNum(v)) return;
  let a = phWin.get(pondId);
  if (!a) phWin.set(pondId, a = []);
  a.push({ t, v });
  while (a.length && a[0].t < t - 86400000) a.shift();
}
function phSwing(pondId, now = Date.now()) {
  const a = (phWin.get(pondId) || []).filter(x => x.t >= now - 86400000);
  if (!a.length) return { phSwing24h: null, phSwingCoverageH: 0 };
  const cover = (now - Math.min(...a.map(x => x.t))) / 3600000;
  const b = new Map();
  for (const x of a) { const k = Math.floor(x.t / 600000); const e = b.get(k) || { s: 0, n: 0 }; e.s += x.v; e.n++; b.set(k, e); }
  const avgs = [...b.values()].map(e => e.s / e.n);
  const ok = cover >= 12 && avgs.length >= 36; // at least 12 h and 6 h worth of 10-min blocks
  return { phSwing24h: ok ? round(Math.max(...avgs) - Math.min(...avgs), 2) : null, phSwingCoverageH: round(cover, 1) };
}

const lastStored = new Map();

function topicBase(pondId) {
  const p = S().ponds[pondId];
  return p?.topicBase || `aqua/site/${S().site.id}/pond/${pondId}`;
}

function handleTelemetry({ pondId, siteId, style, payload, client }) {
  let msg;
  try { msg = JSON.parse(payload.toString('utf8')); } catch (_) {
    console.warn(`[mqtt] ${pondId}: telemetry is not valid JSON - ignored`);
    return;
  }
  if (!msg || typeof msg !== 'object') return;

  const now = Date.now();
  // Device time (firmware 2.0.2 syncs NTP). Older than 90 s = a reading buffered during a 4G outage.
  let ts = now, backfill = false;
  const mts = num(msg.ts);
  if (mts !== null && mts > 1.6e9) {
    const t = mts * 1000;
    if (t >= now - 7 * 86400000 && t <= now + 120000 && t < now - 90000) { ts = t; backfill = true; }
  }
  // Pond IDs are unique across sites. A pond already reporting under one site cannot be
  // taken over by another site's device (that would mix two ponds' data).
  const existing = S().ponds[pondId];
  if (siteId && existing && existing.topicStyle === 'site' && existing.siteId !== siteId) {
    console.warn(`[mqtt] ${pondId} already belongs to site ${existing.siteId}; message from site ${siteId} ignored. Give the pond a unique POND_ID.`);
    return;
  }
  const pond = ensurePond(pondId, msg.pondName);
  if (siteId) {
    pond.siteId = siteId;
    if (!S().sites[siteId]) { S().sites[siteId] = { id: siteId, name: siteId, firstSeen: nowIso() }; changed('sites'); }
  }
  pond.topicStyle = style;
  pond.topicBase = style === 'site' ? `aqua/site/${siteId}/pond/${pondId}` : `aqua/pond/${pondId}`;
  const deviceId = ID_RE.test(String(msg.deviceId || '')) ? String(msg.deviceId) : (client?.id || 'unknown');

  const temperatureC = validTemperature(msg.temperatureC);
  const phRaw = validRaw(msg.phRaw);
  const phDevice = validPh(msg.ph);
  const cal = activeCalibration(pondId);
  let phValue = phDevice, phSource = 'device', phUncompensated = null;
  if (cal && phRaw !== null) {
    const p = ph.rawToPh(phRaw, cal.points);
    if (p !== null) {
      phValue = p; phSource = 'server:' + cal.probeId;
      if (isNum(cal.calTempC) && temperatureC !== null) {
        phUncompensated = p;
        phValue = aq.phTempCompensate(p, temperatureC, cal.calTempC);
        phSource += '+tc';
      }
    }
  }
  const phVoltage = num(msg.phVoltage) !== null ? round(msg.phVoltage, 3) : (phRaw !== null ? ph.rawToPinVoltage(phRaw) : null);

  const rec = {
    ts: new Date(ts).toISOString(), pondId, deviceId,
    temperatureC, ph: phValue, phDevice, phSource, phUncompensated, phRaw, phVoltage,
    rssi: num(msg.rssi), uptimeSec: num(msg.uptimeSec),
    firmwareVersion: str(msg.firmwareVersion, 20) || null
  };
  for (const [k, fn] of Object.entries(OPTIONAL)) if (Object.prototype.hasOwnProperty.call(msg, k)) rec[k] = fn(msg[k]);
  if (rec.pumpRunning === undefined && rec.flowLpm !== undefined) rec.pumpRunning = rec.flowLpm === null ? null : rec.flowLpm >= 1;
  if (msg.event) rec.event = str(String(msg.event), 40);

  const rejected = [];
  if (msg.temperatureC !== undefined && msg.temperatureC !== null && temperatureC === null) rejected.push('temperatureC=' + msg.temperatureC);
  if (msg.ph !== undefined && msg.ph !== null && phDevice === null) rejected.push('ph=' + msg.ph);
  if (rejected.length) console.warn(`[mqtt] ${pondId}: rejected invalid values: ${rejected.join(', ')}`);

  for (const f of TRACKED) if (rec[f] !== undefined && rec[f] !== null && !pond.sensorsSeen.includes(f)) pond.sensorsSeen.push(f);

  if (backfill) {
    // History only: a late reading never changes the live value, online state or alerts.
    rec.backfilled = true;
    addPh(pondId, ts, rec.ph);
    pond.derived = phSwing(pondId, now);
    bus.emit('reading.backfill', { pondId, rec });
    store.save();
    return;
  }

  const dev = S().devices[deviceId] = {
    ...(S().devices[deviceId] || { id: deviceId, firstSeen: rec.ts }),
    id: deviceId, pondId, online: true, lastSeen: rec.ts,
    firmwareVersion: rec.firmwareVersion, rssi: rec.rssi, uptimeSec: rec.uptimeSec,
    address: client?.conn?.remoteAddress ? String(client.conn.remoteAddress).replace('::ffff:', '') : null
  };

  pond.deviceId = deviceId;
  pond.hasTelemetry = true;
  pond.lastSeen = rec.ts;
  pond.lastUpdate = rec.ts;
  pond.latest = rec;

  const minGap = (S().settings.minStoreIntervalSec || 30) * 1000;
  const stored = !(lastStored.has(pondId) && now - lastStored.get(pondId) < minGap);
  if (stored) {
    lastStored.set(pondId, now);
    addPh(pondId, now, rec.ph);
  }
  pond.derived = phSwing(pondId, now);
  setOnline(pond, true, 'telemetry');
  store.save();
  bus.emit('reading', { pond, rec, device: dev, stored, now });
}

function handleStatus({ pondId, siteId, payload }) {
  const raw = payload.toString('utf8').trim();
  let status = raw.toLowerCase();
  try { const j = JSON.parse(raw); if (j && typeof j.status === 'string') status = j.status.toLowerCase(); } catch (_) {}
  const pond = S().ponds[pondId];
  if (!pond) return;
  if (siteId && pond.topicStyle === 'site' && pond.siteId !== siteId) return;
  pond.lastStatus = status;
  if (status === 'online') { pond.lastSeen = nowIso(); setOnline(pond, true, 'status online'); }
  else if (status === 'offline') setOnline(pond, false, 'last will / status offline');
  store.save();
}

function handleAck(pondId, payload) {
  let msg;
  try { msg = JSON.parse(payload.toString('utf8')); } catch (_) { return; }
  if (!msg || !msg.commandId) return;
  const ev = S().feedEvents.find(e => e.commandId === msg.commandId && e.pondId === pondId);
  if (!ev) return;
  const st = String(msg.status || '').toLowerCase();
  if (st === 'confirmed' || st === 'completed' || st === 'ok') ev.status = 'Confirmed';
  else if (st === 'failed' || st === 'error') ev.status = 'Failed';
  else return;
  ev.detail = str(msg.detail, 200) || (ev.status === 'Confirmed' ? 'Acknowledged by feeder' : 'Feeder reported failure');
  ev.updatedAt = nowIso();
  store.save();
  bus.emit('feed.event', { event: ev });
}

// ---------------------------------------------------------------- module wiring (who listens to what)
// ingest: raw MQTT -> validated readings / status / acknowledgements
bus.on('mqtt.telemetry', e => handleTelemetry(e), 'ingest');
bus.on('mqtt.status', e => handleStatus(e), 'ingest');
bus.on('mqtt.ack', e => handleAck(e.pondId, e.payload), 'feeding');
// storage: history files
bus.on('reading', ({ rec, stored }) => { if (stored) store.appendReading(rec); }, 'storage');
bus.on('reading.backfill', ({ rec }) => store.appendReading(rec), 'storage');
// realtime: push to every open dashboard
bus.on('reading', ({ pond, device, stored }) => broadcast({ type: 'telemetry', pond: publicPond(pond), device, stored }), 'realtime');
bus.on('reading.backfill', ({ pondId }) => broadcast({ type: 'backfill', pondId }), 'realtime');
bus.on('pond.status', ({ pond }) => broadcast({ type: 'pond', pond: publicPond(pond) }), 'realtime');
bus.on('pond.updated', ({ pond }) => broadcast({ type: 'pond', pond: publicPond(pond) }), 'realtime');
for (const ev of ['alert.raised', 'alert.resolved', 'alert.updated']) bus.on(ev, ({ alert }) => broadcast({ type: 'alert', alert }), 'realtime');
bus.on('feed.event', ({ event }) => broadcast({ type: 'feedEvent', event }), 'realtime');
bus.on('config.changed', ({ kind }) => broadcast({ type: kind }), 'realtime');
// alerts: evaluate rules on every live reading and every online/offline change
bus.on('reading', ({ pond, now }) => alerts.evaluate(pond, now), 'alerts');
bus.on('pond.status', ({ pond }) => alerts.evaluate(pond), 'alerts');

// ---------------------------------------------------------------- MQTT broker
const aedes = aedesFactory({ id: 'smartfuze-aqua' });
// Topics: aqua/site/<SITE_ID>/pond/<POND_ID>/<kind>   (v2.0.3+, multi-site ready)
//         aqua/pond/<POND_ID>/<kind>                    (firmware 2.0.0 - 2.0.2, still accepted)
const TOPIC_RE = /^aqua\/pond\/([^/]+)\/(telemetry|status|ack)$/;
const SITE_TOPIC_RE = /^aqua\/site\/([^/]+)\/pond\/([^/]+)\/(telemetry|status|ack)$/;
function parseTopic(topic) {
  let m = SITE_TOPIC_RE.exec(topic);
  if (m) return { siteId: m[1], pondId: m[2], kind: m[3], style: 'site' };
  m = TOPIC_RE.exec(topic);
  if (m) return { siteId: null, pondId: m[1], kind: m[2], style: 'legacy' };
  return null;
}

// Device authentication: each ESP32 has its own login and may only use its own pond's topics.
aedes.authenticate = (client, username, password, cb) => {
  if (!REQUIRE_DEVICE_AUTH) return cb(null, true);
  const cred = S().deviceCreds.find(d => d.username === username);
  if (cred && password && auth.verifySecret(password.toString(), cred)) {
    client.aquaPond = cred.pondId;
    client._aquaUser = cred.username;
    client.aquaSite = cred.siteId || null;
    cred.lastLoginAt = nowIso();
    store.save();
    return cb(null, true);
  }
  console.warn(`[mqtt] rejected login "${String(username || '').slice(0, 40)}" from ${client?.conn?.remoteAddress || '?'}`);
  const err = new Error('Bad username or password');
  err.returnCode = 4;
  cb(err, false);
};
function topicAllowed(client, topic) {
  if (!REQUIRE_DEVICE_AUTH) return true;
  const p = client.aquaPond, site = client.aquaSite;
  if (!p) return false;
  if (p === '*' || topic.startsWith(`aqua/pond/${p}/`)) return true;
  const m = /^aqua\/site\/([^/]+)\/pond\/([^/]+)\//.exec(topic);
  return !!m && m[2] === p && (!site || m[1] === site);
}
aedes.authorizePublish = (client, packet, cb) => {
  if (!client) return cb(null); // the server itself
  if (packet.topic.includes('/command/') || !topicAllowed(client, packet.topic)) return cb(new Error('Publish not allowed'));
  cb(null);
};
aedes.authorizeSubscribe = (client, sub, cb) => {
  if (!client || topicAllowed(client, sub.topic)) return cb(null, sub);
  cb(null, null); // refused: the device receives a negative SUBACK (128) and stays connected
};
aedes.on('publish', (packet, client) => {
  const t = parseTopic(packet.topic);
  if (!t) return;
  if (!ID_RE.test(t.pondId) || (t.siteId !== null && !ID_RE.test(t.siteId))) { console.warn('[mqtt] ignored invalid id in topic', packet.topic); return; }
  bus.emit('mqtt.' + t.kind, { ...t, payload: packet.payload, client });
});
aedes.on('client', c => console.log(`[mqtt] client connected: ${c.id}`));
aedes.on('clientDisconnect', c => console.log(`[mqtt] client disconnected: ${c.id}`));
function mqttPublish(topic, obj) {
  return new Promise((resolve, reject) => {
    aedes.publish({ cmd: 'publish', topic, payload: Buffer.from(JSON.stringify(obj)), qos: 1, retain: false },
      err => (err ? reject(err) : resolve()));
  });
}

// ---------------------------------------------------------------- offline sweep + periodic evaluation
setInterval(() => {
  const limit = (S().settings.offlineAfterSec || 300) * 1000;
  const now = Date.now(), up = process.uptime() * 1000;
  for (const pond of Object.values(S().ponds)) {
    if (pond.online && pond.lastSeen && now - Date.parse(pond.lastSeen) > limit) {
      setOnline(pond, false, `no telemetry for ${Math.round(limit / 60000)} min`);
      store.save();
    }
    // After a restart (e.g. power cut) a pond that never comes back must still raise "offline".
    if (pond.hasTelemetry && (pond.online || up > limit)) alerts.evaluate(pond, now);
  }
}, 10000);

// ---------------------------------------------------------------- integrations
const PROVIDERS = {
  esp32:   { label: 'ESP32', category: 'sensor', modes: ['mqtt', 'native'], defaultMode: 'mqtt' },
  tuya:    { label: 'Tuya / Smart Life', category: 'feeder', modes: ['external', 'mqtt', 'rest'], defaultMode: 'external' },
  tapo:    { label: 'Tapo', category: 'camera', modes: ['external', 'onvif'], defaultMode: 'external' },
  vson:    { label: 'VSON Smart', category: 'other', modes: ['external', 'rest', 'native'], defaultMode: 'external' },
  mqtt:    { label: 'MQTT Device', category: 'actuator', modes: ['mqtt'], defaultMode: 'mqtt' },
  onvif:   { label: 'ONVIF / RTSP Camera', category: 'camera', modes: ['onvif', 'external'], defaultMode: 'onvif' },
  rest:    { label: 'Custom REST API', category: 'other', modes: ['rest'], defaultMode: 'rest' },
  external:{ label: 'External App', category: 'other', modes: ['external'], defaultMode: 'external' },
  custom:  { label: 'Custom App', category: 'other', modes: ['external', 'mqtt', 'rest', 'onvif', 'native'], defaultMode: 'external' }
};
const CATEGORIES = ['sensor', 'feeder', 'camera', 'actuator', 'other'];
const MODES = ['external', 'mqtt', 'rest', 'onvif', 'native'];

function integrationStatus(it) {
  if (!it.enabled) return 'Disabled';
  if (it.provider === 'esp32' && it.pondId) {
    const p = S().ponds[it.pondId];
    if (!p || !p.hasTelemetry) return 'Waiting for real hardware';
    return p.online ? 'Online' : 'Offline';
  }
  switch (it.mode) {
    case 'external': return it.launchUrl ? 'External App' : 'Not configured';
    case 'mqtt': return it.mqttCommandTopic ? 'Configured' : 'Not configured';
    case 'rest': case 'onvif': return it.apiBaseUrl ? 'Configured' : 'Not configured';
    case 'native': return 'Not available in v2.0';
    default: return 'Not configured';
  }
}

function sanitizeIntegration(body, existing) {
  const b = body || {};
  const provider = b.provider ?? existing?.provider;
  if (!PROVIDERS[provider]) throw bad('Unknown provider');
  const mode = b.mode ?? existing?.mode ?? PROVIDERS[provider].defaultMode;
  if (!MODES.includes(mode)) throw bad('Unknown mode');
  if (!PROVIDERS[provider].modes.includes(mode)) throw bad(`${PROVIDERS[provider].label} does not support mode "${mode}"`);
  const category = b.category ?? existing?.category ?? PROVIDERS[provider].category;
  if (!CATEGORIES.includes(category)) throw bad('Unknown category');
  const pondId = str(b.pondId ?? existing?.pondId ?? '', 40);
  if (pondId && !ID_RE.test(pondId)) throw bad('Pond ID may only use letters, numbers, - and _');
  const launchUrl = safeUrl(b.launchUrl ?? existing?.launchUrl ?? '');
  if (launchUrl === null) throw bad('Launch URL must start with a scheme such as https:// and cannot be a script');
  const apiBaseUrl = safeUrl(b.apiBaseUrl ?? existing?.apiBaseUrl ?? '');
  if (apiBaseUrl === null) throw bad('API / stream address must start with a scheme such as http:// or rtsp://');
  const mqttCommandTopic = str(b.mqttCommandTopic ?? existing?.mqttCommandTopic ?? '', 200);
  if (/[+#]/.test(mqttCommandTopic)) throw bad('Command topic cannot contain MQTT wildcards (+ or #)');
  const name = str(b.name ?? existing?.name ?? '', 80);
  if (!name) throw bad('Name is required');
  const it = {
    id: existing?.id || newId('int'), name, provider, category, mode, pondId,
    launchUrl, apiBaseUrl, mqttCommandTopic,
    notes: str(b.notes ?? existing?.notes ?? '', 1000),
    enabled: b.enabled === undefined ? (existing ? existing.enabled : true) : !!b.enabled,
    createdAt: existing?.createdAt || nowIso(), updatedAt: nowIso()
  };
  it.status = integrationStatus(it);
  return it;
}

// ---------------------------------------------------------------- feeding + safety interlock
function inWindow(t, s, e) { return s <= e ? (t >= s && t < e) : (t >= s || t < e); }

/** Reasons feeding should not happen right now. Empty array = safe to feed. */
function interlockReasons(pondId) {
  const il = S().interlock, reasons = [];
  const pond = S().ponds[pondId];
  if (il.blockWhenOffline && (!pond || !pond.online)) {
    reasons.push({ code: 'offline', en: 'Pond monitor is offline: water condition unknown', zh: '池塘监测设备离线，水质情况未知' });
  }
  if (il.blockOnCritical) {
    const crit = S().alerts.filter(a => !a.resolvedAt && a.pondId === pondId && a.severity === 'critical');
    if (crit.length) reasons.push({ code: 'critical', en: 'Critical alert active: ' + crit.map(a => a.ruleName).join(', '), zh: '有严重报警未解除：' + crit.map(a => a.ruleNameZh || a.ruleName).join('、') });
  }
  if (il.quietStart && il.quietEnd && inWindow(hhmm(), il.quietStart, il.quietEnd)) {
    reasons.push({ code: 'pause', en: `Feeding pause window ${il.quietStart}-${il.quietEnd}`, zh: `当前在禁喂时段 ${il.quietStart}-${il.quietEnd}` });
  }
  return reasons;
}

function logFeedEvent(ev) {
  S().feedEvents.unshift(ev);
  if (S().feedEvents.length > 2000) S().feedEvents.length = 2000;
  store.save();
  bus.emit('feed.event', { event: ev });
  return ev;
}

async function sendFeed({ pondId, integration, durationSec, source, override }) {
  const base = {
    id: newId('feed'), pondId, integrationId: integration.id, integrationName: integration.name,
    mode: integration.mode, durationSec, source, createdAt: nowIso(), updatedAt: nowIso(),
    override: override && override.length ? override.map(r => r.en) : undefined
  };
  const ovNote = base.override ? ' Safety interlock overridden by user: ' + base.override.join('; ') + '.' : '';
  if (integration.mode === 'mqtt') {
    const topic = integration.mqttCommandTopic || `${topicBase(pondId)}/command/feed`;
    const commandId = newId('cmd');
    const ev = logFeedEvent({ ...base, commandId, topic, status: 'Command Sent', detail: 'Waiting for feeder acknowledgement. Not confirmed.' + ovNote });
    try {
      await mqttPublish(topic, { cmd: 'feed', commandId, pondId, durationSec, ackTopic: `${topicBase(pondId)}/ack`, issuedAt: base.createdAt });
    } catch (err) {
      ev.status = 'Failed'; ev.detail = 'MQTT publish failed: ' + err.message; ev.updatedAt = nowIso();
      store.save(); bus.emit('feed.event', { event: ev });
    }
    return ev;
  }
  if (integration.mode === 'external') {
    return logFeedEvent({ ...base, status: 'External App Opened', detail: 'Feeding must be done and verified in the manufacturer app.' + ovNote });
  }
  throw bad(`Mode "${integration.mode}" cannot send feed commands in v2.0`);
}

setInterval(async () => {
  const now = new Date();
  const time = hhmm(now), day = localDay(now);
  for (const sch of S().feedSchedules) {
    if (!sch.enabled || sch.time !== time) continue;
    const key = day + ' ' + time;
    if (sch.lastRunKey === key) continue;
    const integration = S().integrations.find(i => i.id === sch.integrationId);
    if (!integration || !integration.enabled || integration.mode !== 'mqtt') continue;
    sch.lastRunKey = key;
    store.save();
    const reasons = interlockReasons(sch.pondId);
    if (reasons.length) {
      logFeedEvent({
        id: newId('feed'), pondId: sch.pondId, integrationId: integration.id, integrationName: integration.name,
        mode: integration.mode, durationSec: sch.durationSec, source: 'schedule', status: 'Skipped',
        detail: 'Safety interlock: ' + reasons.map(r => r.en).join('; '), createdAt: nowIso(), updatedAt: nowIso()
      });
      const pname = S().ponds[sch.pondId]?.name || sch.pondId;
      sendPush({ title: `AQUA 定时投喂已跳过：${pname}`, message: `${sch.time} 的投喂没有发送。原因：${reasons.map(r => r.zh).join('；')}`, priority: 0 });
      continue;
    }
    try { await sendFeed({ pondId: sch.pondId, integration, durationSec: sch.durationSec, source: 'schedule' }); }
    catch (err) { console.error('[feed] schedule failed', err.message); }
  }
}, 15000);

// ---------------------------------------------------------------- public shapes
function publicPond(p) {
  const c = activeCalibration(p.id);
  return {
    id: p.id, name: p.name, siteId: p.siteId, deviceId: p.deviceId,
    online: p.online, hasTelemetry: p.hasTelemetry,
    firstSeen: p.firstSeen, lastSeen: p.lastSeen, lastUpdate: p.lastUpdate, lastStatus: p.lastStatus,
    latest: p.latest, derived: p.derived || {}, sensorsSeen: p.sensorsSeen || [],
    topicStyle: p.topicStyle || null, topicBase: p.topicBase || null,
    profile: S().pondProfiles[p.id] || null,
    calibration: c ? { id: c.id, probeId: c.probeId, calibrationDate: c.calibrationDate, calTempC: c.calTempC } : null
  };
}
function pondList() {
  return Object.values(S().ponds).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })).map(publicPond);
}

// ---------------------------------------------------------------- history query
const RANGES = { '24h': { ms: 86400000, bucket: 0 }, '7d': { ms: 7 * 86400000, bucket: 600 }, '30d': { ms: 30 * 86400000, bucket: 3600 } };
const SERIES = ['temperatureC', 'ph', 'doMgL', 'flowLpm', 'airPumpCurrentA'];

function history(pondId, rangeKey) {
  const range = RANGES[rangeKey] || RANGES['24h'];
  const to = Date.now(), from = to - range.ms;
  const rows = store.readReadings(pondId, from, to);
  const stats = {};
  for (const k of SERIES) {
    const vals = rows.map(r => r[k]).filter(isNum);
    stats[k] = vals.length ? { min: Math.min(...vals), max: Math.max(...vals), avg: round(vals.reduce((a, b) => a + b, 0) / vals.length, 2), count: vals.length } : null;
  }
  let points;
  if (!range.bucket) {
    points = rows.map(r => { const o = { t: Date.parse(r.ts) }; for (const k of SERIES) o[k] = isNum(r[k]) ? r[k] : null; return o; });
  } else {
    const size = range.bucket * 1000, buckets = new Map();
    for (const r of rows) {
      const k = Math.floor(Date.parse(r.ts) / size) * size;
      const b = buckets.get(k) || { t: 0, n: 0, s: {}, c: {} };
      b.n++; b.t += Date.parse(r.ts);
      for (const key of SERIES) if (isNum(r[key])) { b.s[key] = (b.s[key] || 0) + r[key]; b.c[key] = (b.c[key] || 0) + 1; }
      buckets.set(k, b);
    }
    points = [...buckets.values()].map(b => {
      const o = { t: Math.round(b.t / b.n) };
      for (const key of SERIES) o[key] = b.c[key] ? round(b.s[key] / b.c[key], 2) : null;
      return o;
    }).sort((a, b) => a.t - b.t);
  }
  return { pondId, range: rangeKey in RANGES ? rangeKey : '24h', from, to, bucketSec: range.bucket || 60, sampleCount: rows.length, stats, points };
}

// ---------------------------------------------------------------- HTTP API
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback'); // Caddy runs on the same server in cloud mode
app.use(express.json({ limit: '200kb' }));
const api = express.Router();
const wrap = fn => (req, res) => { try { const out = fn(req, res); if (out instanceof Promise) out.catch(e => fail(res, e)); } catch (e) { fail(res, e); } };
function fail(res, e) { res.status(e.status || 400).json({ error: e.message || String(e), ...(e.extra || {}) }); }

// ---------------- dashboard login (cloud mode)
const SESSION_DAYS = 90;
const loginAttempts = new Map();
function sessionFrom(req) {
  const tok = auth.parseCookies(req.headers.cookie || '').aqua_session;
  if (!tok) return null;
  const h = auth.sha(tok);
  const sess = S().auth.sessions.find(x => x.hash === h);
  return sess && Date.parse(sess.expiresAt) > Date.now() ? sess : null;
}
api.get('/auth/status', wrap((req, res) => {
  const sess = REQUIRE_LOGIN ? sessionFrom(req) : null;
  res.json({ required: REQUIRE_LOGIN, loggedIn: !REQUIRE_LOGIN || !!sess, username: sess?.username || null, mode: CLOUD ? 'cloud' : 'local' });
}));
api.post('/auth/login', wrap((req, res) => {
  const ip = req.ip || 'unknown';
  const a = loginAttempts.get(ip) || { n: 0, first: Date.now() };
  if (Date.now() - a.first > 15 * 60000) { a.n = 0; a.first = Date.now(); }
  if (a.n >= 10) throw bad('Too many attempts. Wait 15 minutes and try again.', 429);
  const u = S().auth.users.find(x => x.username === str(req.body?.username, 40));
  if (!u || !auth.verifySecret(String(req.body?.password || ''), u)) {
    a.n++; loginAttempts.set(ip, a);
    throw bad('Wrong username or password', 401);
  }
  loginAttempts.delete(ip);
  const token = crypto.randomBytes(32).toString('hex');
  const sessions = S().auth.sessions.filter(x => Date.parse(x.expiresAt) > Date.now());
  sessions.push({ hash: auth.sha(token), username: u.username, createdAt: nowIso(), expiresAt: new Date(Date.now() + SESSION_DAYS * 86400000).toISOString(), ua: str(req.headers['user-agent'], 120) });
  S().auth.sessions = sessions.slice(-50);
  store.save();
  res.setHeader('Set-Cookie', `aqua_session=${token}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; SameSite=Lax${req.secure ? '; Secure' : ''}`);
  res.json({ ok: true, username: u.username });
}));
api.post('/auth/logout', wrap((req, res) => {
  const tok = auth.parseCookies(req.headers.cookie || '').aqua_session;
  if (tok) { const h = auth.sha(tok); S().auth.sessions = S().auth.sessions.filter(x => x.hash !== h); store.save(); }
  res.setHeader('Set-Cookie', 'aqua_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
  res.json({ ok: true });
}));
// Everything below needs a session in cloud mode. State changes also need the X-AQUA header,
// which a foreign website cannot add (blocks cross-site request forgery).
api.use((req, res, next) => {
  if (!REQUIRE_LOGIN) return next();
  const sess = sessionFrom(req);
  if (!sess) return res.status(401).json({ error: 'Login required' });
  if (req.method !== 'GET' && req.get('X-AQUA') !== '1') return res.status(403).json({ error: 'Missing request header' });
  req.session = sess;
  next();
});
api.post('/auth/password', wrap((req, res) => {
  const u = S().auth.users.find(x => x.username === req.session?.username);
  if (!u) throw bad('Password change needs login mode');
  if (!auth.verifySecret(String(req.body?.current || ''), u)) throw bad('Current password is wrong', 401);
  const pw = String(req.body?.password || '');
  if (pw.length < 10) throw bad('New password must be at least 10 characters');
  Object.assign(u, auth.hashSecret(pw), { updatedAt: nowIso() });
  S().auth.sessions = S().auth.sessions.filter(x => x.hash === req.session.hash); // sign out other phones
  store.save();
  res.json({ ok: true });
}));

// ---------------- ESP32 device logins
api.get('/devices/credentials', wrap((req, res) => res.json(S().deviceCreds.map(d => ({ username: d.username, pondId: d.pondId, siteId: d.siteId || null, createdAt: d.createdAt, lastLoginAt: d.lastLoginAt || null })))));
api.post('/devices/credentials', wrap((req, res) => {
  const pondId = str(req.body?.pondId, 40);
  if (!ID_RE.test(pondId)) throw bad('Pond ID may only use letters, numbers, - and _');
  const username = str(req.body?.username, 40) || 'dev-' + pondId.toLowerCase();
  if (!ID_RE.test(username)) throw bad('Username may only use letters, numbers, - and _');
  if (S().deviceCreds.some(d => d.username === username)) throw bad('That device login already exists. Delete it first to make a new password.');
  const password = auth.randomPassword(20);
  const siteId = str(req.body?.siteId, 40) || S().site.id;
  if (!ID_RE.test(siteId)) throw bad('Site ID may only use letters, numbers, - and _');
  S().deviceCreds.push({ username, pondId, siteId, ...auth.hashSecret(password), createdAt: nowIso(), lastLoginAt: null });
  store.save();
  res.status(201).json({ username, password, pondId, siteId });
}));
api.delete('/devices/credentials/:username', wrap((req, res) => {
  const before = S().deviceCreds.length;
  S().deviceCreds = S().deviceCreds.filter(d => d.username !== req.params.username);
  if (S().deviceCreds.length === before) return res.status(404).json({ error: 'Device login not found' });
  for (const c of Object.values(aedes.clients || {})) if (c._aquaUser === req.params.username) { try { c.close(); } catch (_) {} }
  store.save();
  res.json({ ok: true });
}));

function maskedNotifications() {
  const p = S().notifications.pushover, w = S().notifications.watchdogUrl;
  let host = '';
  try { host = w ? new URL(w).host : ''; } catch (_) {}
  return {
    pushover: { enabled: p.enabled, appTokenSet: !!p.appToken, appTokenHint: p.appToken ? '…' + p.appToken.slice(-4) : '', userKeySet: !!p.userKey, userKeyHint: p.userKey ? '…' + p.userKey.slice(-4) : '' },
    watchdogSet: !!w, watchdogHost: host
  };
}

api.get('/info', wrap((req, res) => res.json({
  name: 'SMARTFUZE AQUA', version: VERSION, serverTime: nowIso(),
  httpPort: HTTP_PORT, mqttPort: MQTT_PORT, lan: lanAddresses(), hostname: os.hostname(),
  site: S().site, settings: S().settings, storage: store.readingStats(),
  mqttClients: Object.keys(aedes.clients || {}).length,
  notifications: maskedNotifications(), watchdog,
  mode: CLOUD ? 'cloud' : 'local', loginRequired: REQUIRE_LOGIN, deviceAuth: REQUIRE_DEVICE_AUTH,
  publicHost: PUBLIC_HOST, mqttsPort: MQTTS_PORT, tls: tlsStatus,
  sites: [{ ...S().site, default: true }, ...Object.values(S().sites).filter(x => x.id !== S().site.id)]
})));
api.get('/system/events', wrap((req, res) => res.json(bus.describe())));

// Ponds
api.get('/ponds', wrap((req, res) => res.json(pondList())));
api.get('/ponds/:id', wrap((req, res) => {
  const p = S().ponds[req.params.id];
  if (!p) return res.status(404).json({ error: 'Pond not found' });
  res.json(publicPond(p));
}));
api.patch('/ponds/:id', wrap((req, res) => {
  const p = S().ponds[req.params.id];
  if (!p) return res.status(404).json({ error: 'Pond not found' });
  const name = str(req.body?.name, 60);
  if (!name) throw bad('Name is required');
  p.name = name; p.nameLocked = true;
  store.save(); bus.emit('pond.updated', { pond: p });
  res.json(publicPond(p));
}));
api.put('/ponds/:id/profile', wrap((req, res) => {
  if (!ID_RE.test(req.params.id)) throw bad('Invalid pond id');
  const volumeM3 = optNum(req.body?.volumeM3, 0.01, 100000, 'Culture tank volume (m³)');
  const systemVolumeM3 = optNum(req.body?.systemVolumeM3, 0.01, 100000, 'System volume (m³)');
  S().pondProfiles[req.params.id] = { volumeM3, systemVolumeM3, notes: str(req.body?.notes, 500), updatedAt: nowIso() };
  store.save(); changed('settings');
  res.json(S().pondProfiles[req.params.id]);
}));
api.get('/ponds/:id/readings', wrap((req, res) => {
  if (!ID_RE.test(req.params.id)) throw bad('Invalid pond id');
  res.json(history(req.params.id, String(req.query.range || '24h')));
}));
api.get('/ponds/:id/export.csv', wrap((req, res) => {
  if (!ID_RE.test(req.params.id)) throw bad('Invalid pond id');
  const range = RANGES[String(req.query.range || '30d')] || RANGES['30d'];
  const rows = store.readReadings(req.params.id, Date.now() - range.ms, Date.now());
  const cols = ['ts', 'pondId', 'deviceId', 'temperatureC', 'ph', 'phDevice', 'phUncompensated', 'phSource', 'phRaw', 'phVoltage', 'doMgL', 'flowLpm', 'pumpRunning', 'airPumpCurrentA', 'airPumpRunning', 'waterLevel', 'salinityPpt', 'rssi', 'uptimeSec', 'firmwareVersion'];
  const lines = [cols.join(',')].concat(rows.map(r => cols.map(c => (r[c] ?? '')).join(',')));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="aqua-${req.params.id}-${localDay()}.csv"`);
  res.send(lines.join('\r\n'));
}));
api.get('/devices', wrap((req, res) => res.json(Object.values(S().devices))));

// Calibration
function sanitizeCalibration(b, existing) {
  const probeId = str(b.probeId ?? existing?.probeId, 40);
  if (!probeId) throw bad('Probe ID is required');
  const pondId = str(b.pondId ?? existing?.pondId, 40);
  if (!ID_RE.test(pondId)) throw bad('Pond ID is required (letters, numbers, - and _)');
  const pts = (b.points ?? existing?.points ?? []).map(p => ({ ph: Number(p.ph), raw: Number(p.raw) })).filter(p => Number.isFinite(p.ph) && Number.isFinite(p.raw));
  if (ph.validPoints(pts).length < 2) throw bad('At least two buffer points (pH + RAW between 1 and 4094) are required');
  const raws = pts.map(p => p.raw);
  if (new Set(raws).size !== raws.length) throw bad('Two buffer points have the same RAW value');
  const calTempC = b.calTempC !== undefined ? optNum(b.calTempC, 0, 50, 'Buffer temperature (°C)') : (existing?.calTempC ?? null);
  return {
    id: existing?.id || newId('cal'), probeId, pondId,
    deviceId: str(b.deviceId ?? existing?.deviceId ?? '', 40),
    calibrationDate: str(b.calibrationDate ?? existing?.calibrationDate ?? localDay(), 20),
    points: pts.sort((x, y) => x.ph - y.ph), calTempC,
    adcPin: str(b.adcPin ?? existing?.adcPin ?? 'GPIO34', 20),
    dividerTopOhm: Number(b.dividerTopOhm ?? existing?.dividerTopOhm ?? 20000),
    dividerBottomOhm: Number(b.dividerBottomOhm ?? existing?.dividerBottomOhm ?? 10000),
    active: existing ? existing.active : false,
    notes: str(b.notes ?? existing?.notes ?? '', 1000),
    createdAt: existing?.createdAt || nowIso(), updatedAt: nowIso()
  };
}
function activate(cal) { for (const c of S().calibrations) if (c.pondId === cal.pondId) c.active = false; cal.active = true; }
api.get('/calibrations', wrap((req, res) => res.json(S().calibrations.map(c => ({ ...c, analysis: ph.describe(c.points) })))));
api.post('/calibrations', wrap((req, res) => {
  const cal = sanitizeCalibration(req.body || {});
  S().calibrations.push(cal);
  if (req.body?.activate || !activeCalibration(cal.pondId)) activate(cal);
  store.save(); changed('calibrations');
  res.status(201).json(cal);
}));
api.put('/calibrations/:id', wrap((req, res) => {
  const i = S().calibrations.findIndex(c => c.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Calibration not found' });
  S().calibrations[i] = sanitizeCalibration(req.body || {}, S().calibrations[i]);
  store.save(); changed('calibrations');
  res.json(S().calibrations[i]);
}));
api.post('/calibrations/:id/activate', wrap((req, res) => {
  const cal = S().calibrations.find(c => c.id === req.params.id);
  if (!cal) return res.status(404).json({ error: 'Calibration not found' });
  activate(cal); store.save(); changed('calibrations');
  res.json(cal);
}));
api.delete('/calibrations/:id', wrap((req, res) => {
  const cal = S().calibrations.find(c => c.id === req.params.id);
  if (!cal) return res.status(404).json({ error: 'Calibration not found' });
  if (cal.active) throw bad('Activate another calibration for this pond before deleting the active one');
  S().calibrations = S().calibrations.filter(c => c.id !== cal.id);
  store.save(); changed('calibrations');
  res.json({ ok: true });
}));

// Integrations
api.get('/integrations/catalog', wrap((req, res) => res.json({ providers: PROVIDERS, categories: CATEGORIES, modes: MODES })));
api.get('/integrations', wrap((req, res) => res.json(S().integrations.map(it => ({ ...it, status: integrationStatus(it) })))));
api.post('/integrations', wrap((req, res) => {
  const it = sanitizeIntegration(req.body);
  S().integrations.push(it); store.save(); changed('integrations');
  res.status(201).json(it);
}));
api.put('/integrations/:id', wrap((req, res) => {
  const i = S().integrations.findIndex(x => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Integration not found' });
  S().integrations[i] = sanitizeIntegration(req.body, S().integrations[i]);
  store.save(); changed('integrations');
  res.json(S().integrations[i]);
}));
api.delete('/integrations/:id', wrap((req, res) => {
  if (S().feedSchedules.some(s => s.integrationId === req.params.id)) throw bad('This integration is used by a feeding schedule. Remove the schedule first.');
  const before = S().integrations.length;
  S().integrations = S().integrations.filter(x => x.id !== req.params.id);
  if (S().integrations.length === before) return res.status(404).json({ error: 'Integration not found' });
  store.save(); changed('integrations');
  res.json({ ok: true });
}));
api.post('/integrations/:id/opened', wrap((req, res) => {
  const it = S().integrations.find(x => x.id === req.params.id);
  if (!it) return res.status(404).json({ error: 'Integration not found' });
  it.lastOpenedAt = nowIso(); store.save();
  res.json({ ok: true });
}));

// Feeding
function sanitizeSchedule(b, existing) {
  const pondId = str(b.pondId ?? existing?.pondId, 40);
  if (!ID_RE.test(pondId)) throw bad('Choose a pond');
  const integrationId = str(b.integrationId ?? existing?.integrationId, 40);
  if (!S().integrations.some(i => i.id === integrationId)) throw bad('Choose a feeder integration');
  const time = str(b.time ?? existing?.time, 5);
  if (!TIME_RE.test(time)) throw bad('Time must be HH:MM (24-hour)');
  const durationSec = Number(b.durationSec ?? existing?.durationSec);
  if (!Number.isInteger(durationSec) || durationSec < 1 || durationSec > 300) throw bad('Duration must be 1 to 300 seconds');
  return {
    id: existing?.id || newId('sch'), pondId, integrationId, time, durationSec,
    enabled: b.enabled === undefined ? (existing ? existing.enabled : true) : !!b.enabled,
    lastRunKey: existing?.lastRunKey || null,
    createdAt: existing?.createdAt || nowIso(), updatedAt: nowIso()
  };
}
api.get('/feeding', wrap((req, res) => res.json({
  schedules: [...S().feedSchedules].sort((a, b) => a.time.localeCompare(b.time)),
  events: S().feedEvents.slice(0, Math.min(Number(req.query.limit) || 100, 500))
})));
api.get('/feeding/interlock', wrap((req, res) => {
  const pondId = String(req.query.pondId || '');
  if (!ID_RE.test(pondId)) throw bad('Choose a pond');
  res.json({ pondId, reasons: interlockReasons(pondId), interlock: S().interlock });
}));
api.post('/feeding/schedules', wrap((req, res) => {
  const s = sanitizeSchedule(req.body || {});
  S().feedSchedules.push(s); store.save(); changed('feeding');
  res.status(201).json(s);
}));
api.put('/feeding/schedules/:id', wrap((req, res) => {
  const i = S().feedSchedules.findIndex(s => s.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Schedule not found' });
  S().feedSchedules[i] = sanitizeSchedule(req.body || {}, S().feedSchedules[i]);
  store.save(); changed('feeding');
  res.json(S().feedSchedules[i]);
}));
api.delete('/feeding/schedules/:id', wrap((req, res) => {
  S().feedSchedules = S().feedSchedules.filter(s => s.id !== req.params.id);
  store.save(); changed('feeding');
  res.json({ ok: true });
}));
api.post('/feeding/feed', wrap(async (req, res) => {
  const b = req.body || {};
  if (!ID_RE.test(String(b.pondId || ''))) throw bad('Choose a pond');
  const integration = S().integrations.find(i => i.id === b.integrationId);
  if (!integration) throw bad('Choose a feeder integration');
  if (!integration.enabled) throw bad('This integration is disabled');
  const durationSec = Number(b.durationSec);
  if (!Number.isInteger(durationSec) || durationSec < 1 || durationSec > 300) throw bad('Duration must be 1 to 300 seconds');
  const reasons = interlockReasons(b.pondId);
  if (reasons.length && b.override !== true) {
    throw Object.assign(bad('Feeding is paused by the safety interlock', 409), { extra: { reasons } });
  }
  const ev = await sendFeed({ pondId: b.pondId, integration, durationSec, source: 'manual', override: reasons });
  res.status(201).json(ev);
}));

// Controls (reserved for v2.2.0)
api.get('/controls', wrap((req, res) => res.json({
  available: false,
  message: 'Relay control arrives in v2.2.0. No channel can be switched in v2.0.x.',
  channels: [
    { channel: 1, name: 'Aerator', configured: false },
    { channel: 2, name: 'Water pump', configured: false },
    { channel: 3, name: 'Feeder', configured: false },
    { channel: 4, name: 'Spare', configured: false }
  ]
})));

// Alerts
api.get('/alerts', wrap((req, res) => res.json({ rules: S().alertRules, alerts: S().alerts.slice(0, 300) })));
api.put('/alerts/rules/:id', wrap((req, res) => {
  const r = S().alertRules.find(x => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: 'Rule not found' });
  const b = req.body || {};
  if (b.threshold !== undefined && (r.op === 'lt' || r.op === 'gt')) {
    const t = Number(b.threshold);
    if (!Number.isFinite(t)) throw bad('Threshold must be a number');
    r.threshold = t;
  }
  if (b.sustainSec !== undefined && r.metric !== 'offline') {
    const s = Number(b.sustainSec);
    if (!Number.isInteger(s) || s < 0 || s > 3600) throw bad('Sustained duration must be 0 to 60 minutes');
    r.sustainSec = s;
  }
  if (b.enabled !== undefined) r.enabled = !!b.enabled;
  alerts.clearRule(r.id);
  store.save(); changed('alerts');
  res.json(r);
}));
api.post('/alerts/:id/ack', wrap((req, res) => {
  const a = S().alerts.find(x => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: 'Alert not found' });
  a.acknowledged = true; a.acknowledgedAt = nowIso();
  store.save(); bus.emit('alert.updated', { alert: a });
  res.json(a);
}));

// Water quality (manual test-kit log)
const WATER_FIELDS = { tanMgL: [0, 100], no2nMgL: [0, 100], no3nMgL: [0, 1000], alkalinityMgL: [0, 1000], salinityPpt: [0, 60] };
api.get('/water', wrap((req, res) => {
  const pondId = String(req.query.pondId || '');
  const list = S().waterLogs.filter(w => !pondId || w.pondId === pondId).sort((a, b) => b.ts.localeCompare(a.ts));
  res.json({ entries: list.slice(0, 300), limits: S().labLimits });
}));
api.post('/water', wrap((req, res) => {
  const b = req.body || {};
  const pondId = str(b.pondId, 40);
  if (!ID_RE.test(pondId)) throw bad('Choose a pond');
  const ts = b.ts && !Number.isNaN(Date.parse(b.ts)) ? new Date(b.ts).toISOString() : nowIso();
  const e = { id: newId('wq'), pondId, ts, by: str(b.by, 40), notes: str(b.notes, 500) };
  let any = false;
  for (const [k, [min, max]] of Object.entries(WATER_FIELDS)) { e[k] = optNum(b[k], min, max, k); if (e[k] !== null) any = true; }
  if (!any) throw bad('Enter at least one test result');
  // pH / temperature for the NH3 calculation: what the person entered, else the live reading if fresh.
  const live = S().ponds[pondId]?.latest;
  const fresh = live && Date.now() - Date.parse(live.ts) < 30 * 60000;
  e.phAtTest = optNum(b.phAtTest, 0, 14, 'pH at test');
  e.tempAtTest = optNum(b.tempAtTest, 0, 45, 'Temperature at test');
  e.phTempSource = 'entered';
  if (e.phAtTest === null && e.tempAtTest === null && fresh && isNum(live.ph) && isNum(live.temperatureC)) {
    e.phAtTest = live.ph; e.tempAtTest = live.temperatureC; e.phTempSource = 'live sensor';
  }
  e.nh3nMgL = e.tanMgL !== null ? aq.nh3n(e.tanMgL, e.phAtTest, e.tempAtTest) : null;
  const L = S().labLimits;
  e.flags = {};
  for (const k of Object.keys(L)) { const f = aq.classify(e[k], L[k]); if (f) e.flags[k] = f; }
  const prof = S().pondProfiles[pondId] || {};
  const vol = prof.systemVolumeM3 ?? prof.volumeM3;
  e.bicarbDoseG = e.alkalinityMgL !== null ? aq.bicarbDoseG(e.alkalinityMgL, L.alkalinityMgL.target, vol) : null;
  S().waterLogs.push(e);
  if (S().waterLogs.length > 5000) S().waterLogs.shift();
  alerts.lab({ id: pondId, name: S().ponds[pondId]?.name || pondId }, e, L);
  store.save(); changed('water');
  res.status(201).json(e);
}));
api.delete('/water/:id', wrap((req, res) => {
  S().waterLogs = S().waterLogs.filter(w => w.id !== req.params.id);
  store.save(); changed('water');
  res.json({ ok: true });
}));
api.put('/water/limits', wrap((req, res) => {
  const b = req.body || {};
  for (const [k, lim] of Object.entries(S().labLimits)) {
    if (!b[k]) continue;
    for (const f of ['warnLow', 'critLow', 'warnHigh', 'critHigh', 'target']) {
      if (b[k][f] !== undefined) lim[f] = optNum(b[k][f], 0, 1000, `${lim.name} ${f}`);
    }
  }
  store.save(); changed('water');
  res.json(S().labLimits);
}));

// Production cycles
function withSummary(c) { return { ...c, summary: aq.cycleSummary(c, S().pondProfiles[c.pondId]?.volumeM3) }; }
api.get('/cycles', wrap((req, res) => {
  const pondId = String(req.query.pondId || '');
  res.json(S().cycles.filter(c => !pondId || c.pondId === pondId).sort((a, b) => b.startDate.localeCompare(a.startDate)).map(withSummary));
}));
api.post('/cycles', wrap((req, res) => {
  const b = req.body || {};
  const pondId = str(b.pondId, 40);
  if (!ID_RE.test(pondId)) throw bad('Choose a pond');
  if (S().cycles.some(c => c.pondId === pondId && c.status === 'active')) throw bad('This pond already has an active cycle. Close it first.');
  const startDate = str(b.startDate, 10);
  if (!DATE_RE.test(startDate)) throw bad('Stocking date is required');
  const stockedCount = Number(b.stockedCount);
  if (!Number.isInteger(stockedCount) || stockedCount < 1 || stockedCount > 50000000) throw bad('Number of post-larvae stocked is required');
  const c = {
    id: newId('cyc'), pondId, status: 'active', startDate, endDate: null, stockedCount,
    initialWeightG: optNum(b.initialWeightG, 0, 50, 'Initial weight (g)') ?? 0,
    plSource: str(b.plSource, 100), notes: str(b.notes, 1000), records: [], createdAt: nowIso()
  };
  S().cycles.push(c); store.save(); changed('cycles');
  res.status(201).json(withSummary(c));
}));
api.put('/cycles/:id', wrap((req, res) => {
  const c = S().cycles.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Cycle not found' });
  const b = req.body || {};
  if (b.close) {
    const endDate = str(b.endDate, 10) || localDay();
    if (!DATE_RE.test(endDate)) throw bad('Invalid end date');
    c.status = 'closed'; c.endDate = endDate;
  }
  if (b.notes !== undefined) c.notes = str(b.notes, 1000);
  if (b.plSource !== undefined) c.plSource = str(b.plSource, 100);
  store.save(); changed('cycles');
  res.json(withSummary(c));
}));
api.post('/cycles/:id/records', wrap((req, res) => {
  const c = S().cycles.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Cycle not found' });
  const b = req.body || {};
  const date = str(b.date, 10);
  if (!DATE_RE.test(date)) throw bad('Date is required');
  const r = { id: newId('rec'), type: b.type, date, notes: str(b.notes, 300), createdAt: nowIso() };
  if (b.type === 'sample') {
    r.avgWeightG = optNum(b.avgWeightG, 0.001, 200, 'Average weight (g)');
    if (r.avgWeightG === null) throw bad('Average weight is required');
    r.sampleCount = optNum(b.sampleCount, 1, 100000, 'Shrimp weighed');
  } else if (b.type === 'mortality') {
    r.count = optNum(b.count, 0, 50000000, 'Dead shrimp');
    if (r.count === null) throw bad('Number of dead shrimp is required');
  } else if (b.type === 'feed') {
    r.kg = optNum(b.kg, 0.001, 10000, 'Feed (kg)');
    if (r.kg === null) throw bad('Feed amount in kg is required');
  } else if (b.type === 'harvest') {
    r.kg = optNum(b.kg, 0.001, 1000000, 'Harvest (kg)');
    if (r.kg === null) throw bad('Harvest weight in kg is required');
    r.count = optNum(b.count, 0, 50000000, 'Harvest count');
  } else throw bad('Unknown record type');
  c.records.push(r);
  store.save(); changed('cycles');
  res.status(201).json(withSummary(c));
}));
api.delete('/cycles/:id/records/:rid', wrap((req, res) => {
  const c = S().cycles.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Cycle not found' });
  c.records = c.records.filter(r => r.id !== req.params.rid);
  store.save(); changed('cycles');
  res.json(withSummary(c));
}));

// Settings
api.get('/settings/full', wrap((req, res) => res.json({
  site: S().site, settings: S().settings, interlock: S().interlock,
  notifications: maskedNotifications(), watchdog, notifyLog: S().notifyLog.slice(0, 20),
  pondProfiles: S().pondProfiles
})));
api.put('/settings', wrap((req, res) => {
  const b = req.body || {};
  if (b.siteName !== undefined) { const n = str(b.siteName, 60); if (n) S().site.name = n; }
  if (b.offlineAfterSec !== undefined) {
    const v = Number(b.offlineAfterSec);
    if (!Number.isInteger(v) || v < 120 || v > 3600) throw bad('Offline timeout must be 2 to 60 minutes');
    S().settings.offlineAfterSec = v;
  }
  if (b.publicUrl !== undefined) {
    const u = safeUrl(b.publicUrl, true);
    if (u === null) throw bad('Dashboard link must start with http:// or https://');
    S().settings.publicUrl = u;
  }
  if (b.interlock) {
    const il = S().interlock, x = b.interlock;
    if (x.blockWhenOffline !== undefined) il.blockWhenOffline = !!x.blockWhenOffline;
    if (x.blockOnCritical !== undefined) il.blockOnCritical = !!x.blockOnCritical;
    for (const k of ['quietStart', 'quietEnd']) if (x[k] !== undefined) {
      const t = str(x[k], 5);
      if (t && !TIME_RE.test(t)) throw bad('Pause window times must be HH:MM');
      il[k] = t;
    }
  }
  if (b.pushover) {
    const p = S().notifications.pushover, x = b.pushover;
    for (const k of ['appToken', 'userKey']) if (typeof x[k] === 'string' && x[k].trim()) {
      const v = x[k].trim();
      if (!/^[A-Za-z0-9]{30}$/.test(v)) throw bad(`Pushover ${k === 'appToken' ? 'API token' : 'user / group key'} must be 30 letters and numbers`);
      p[k] = v;
    }
    if (x.clear) { p.appToken = ''; p.userKey = ''; p.enabled = false; }
    if (x.enabled !== undefined) {
      if (x.enabled && (!p.appToken || !p.userKey)) throw bad('Enter the Pushover API token and user / group key first');
      p.enabled = !!x.enabled;
    }
  }
  if (b.watchdogUrl !== undefined) {
    const u = safeUrl(b.watchdogUrl, true);
    if (u === null) throw bad('Watchdog URL must start with https://');
    S().notifications.watchdogUrl = u;
    if (u) pingWatchdog();
  }
  store.save(); changed('settings');
  res.json({ ok: true });
}));
api.post('/notify/test', wrap(async (req, res) => {
  const emergency = !!req.body?.emergency;
  const r = await sendPush({
    title: emergency ? 'AQUA 紧急报警测试' : 'AQUA 推送测试',
    message: emergency ? '这是紧急级别测试：手机会每 30 秒响一次，请在 Pushover 里按“确认”停止。1 分钟后自动停止。' : '推送正常。严重报警会以紧急级别发送，直到有人确认。',
    priority: emergency ? 2 : 0, retry: 30, expire: 60
  });
  if (!r.ok) throw bad('Push failed: ' + (r.error || 'unknown error'));
  res.json(r);
}));
api.get('/backup', wrap((req, res) => {
  res.setHeader('Content-Disposition', `attachment; filename="aqua-config-backup-${localDay()}.json"`);
  res.json({ exportedAt: nowIso(), version: VERSION, note: 'Contains notification keys. Keep this file private.', state: S() });
}));

api.use((req, res) => res.status(404).json({ error: 'Unknown API route' }));
app.use('/api', api);

const pub = path.join(__dirname, 'public');
app.use(express.static(pub, {
  setHeaders(res, file) {
    if (/sw\.js$|\.webmanifest$|index\.html$|app\.js$|styles\.css$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
    if (file.endsWith('.webmanifest')) res.setHeader('Content-Type', 'application/manifest+json');
  }
}));
app.get('*', (req, res) => res.sendFile(path.join(pub, 'index.html')));

// ---------------------------------------------------------------- start
// Rebuild the pH-swing window from stored history so a restart does not reset it.
for (const p of Object.values(S().ponds)) {
  const now = Date.now();
  for (const r of store.readReadings(p.id, now - 86400000, now)) addPh(p.id, Date.parse(r.ts), r.ph);
  p.derived = phSwing(p.id, now);
  if (!p.sensorsSeen) p.sensorsSeen = [];
}

const httpServer = http.createServer(app);
wss = new WebSocketServer({
  server: httpServer, path: '/ws',
  verifyClient: (info, cb) => (REQUIRE_LOGIN ? cb(!!sessionFrom(info.req), 401) : cb(true))
});
wss.on('connection', ws => ws.send(JSON.stringify({ type: 'hello', version: VERSION, serverTime: nowIso(), ponds: pondList() })));
setInterval(() => { for (const c of wss.clients) { try { c.ping(); } catch (_) {} } }, 30000);

const mqttServer = net.createServer(aedes.handle);

// Encrypted MQTT for devices on the internet. The certificate comes from Caddy (Let's Encrypt),
// copied by aqua-cert-sync; renewals are picked up automatically without a restart.
let tlsServer = null, tlsMtime = 0;
const tlsStatus = { enabled: false, error: TLS_CERT ? 'waiting for certificate' : null, expires: null };
function ensureTls() {
  let cert, key, mtime;
  try {
    mtime = fs.statSync(TLS_CERT).mtimeMs;
    cert = fs.readFileSync(TLS_CERT); key = fs.readFileSync(TLS_KEY);
    tlsStatus.expires = new Date(new crypto.X509Certificate(cert).validTo).toISOString();
  } catch (e) {
    tlsStatus.error = e.code === 'ENOENT' ? 'certificate not issued yet (check DuckDNS and ports 80/443)' : e.message;
    return;
  }
  if (!tlsServer) {
    tlsServer = tls.createServer({ cert, key, minVersion: 'TLSv1.2' }, aedes.handle);
    tlsServer.on('error', e => { tlsStatus.enabled = false; tlsStatus.error = e.message; console.error('[mqtts]', e.message); });
    tlsServer.listen(MQTTS_PORT, '0.0.0.0', () => { tlsStatus.enabled = true; tlsStatus.error = null; console.log(`  MQTT TLS:   ${MQTTS_PORT} ready (devices connect here)`); });
  } else if (mtime !== tlsMtime) {
    tlsServer.setSecureContext({ cert, key, minVersion: 'TLSv1.2' });
    console.log('[mqtts] certificate reloaded');
  }
  tlsMtime = mtime;
}
if (TLS_CERT && TLS_KEY) { ensureTls(); setInterval(ensureTls, 60000); }
function portError(name, port) {
  return err => {
    if (err.code === 'EADDRINUSE') console.error(`\n[error] ${name} port ${port} is already in use. Is SMARTFUZE AQUA (or another MQTT broker such as Mosquitto) already running?\n`);
    else console.error(`[error] ${name}:`, err.message);
    process.exit(1);
  };
}
mqttServer.on('error', portError('MQTT', MQTT_PORT));
httpServer.on('error', portError('Dashboard', HTTP_PORT));

mqttServer.listen(MQTT_PORT, MQTT_HOST, () => {
  httpServer.listen(HTTP_PORT, HTTP_HOST, () => {
    const lan = lanAddresses();
    console.log('');
    console.log('  SMARTFUZE AQUA v' + VERSION);
    console.log('  ------------------------------------------------');
    console.log('  Mode:       ' + (CLOUD ? 'CLOUD (login + encrypted device connections)' : 'local network'));
    if (PUBLIC_HOST) console.log('  Dashboard:  https://' + PUBLIC_HOST);
    console.log('  Dashboard:  http://localhost:' + HTTP_PORT);
    if (!CLOUD) for (const a of lan) console.log('  Phone/LAN:  http://' + a.address + ':' + HTTP_PORT + '   (' + a.name + ')');
    console.log('  MQTT:       ' + MQTT_PORT + (lan[0] ? '   (ESP32 MQTT_HOST = ' + lan[0].address + ')' : ''));
    console.log('  Data:       ' + DATA_DIR);
    console.log('  Site ID:    ' + S().site.id + '   (firmware SITE_ID; topics aqua/site/' + S().site.id + '/pond/<POND_ID>/...)');
    console.log('  Push alerts: ' + (S().notifications.pushover.enabled ? 'ON (Pushover)' : 'OFF - set up in Settings'));
    console.log('  Watchdog:    ' + (S().notifications.watchdogUrl ? 'ON' : 'OFF - set up in Settings'));
    console.log('  Ponds known: ' + Object.keys(S().ponds).length + '   Waiting for real ESP32 telemetry...');
    console.log('  ------------------------------------------------');
    console.log('  Keep this window open. Close it (or press Ctrl+C) to stop AQUA.\n');
    pingWatchdog();
    if (process.env.AQUA_OPEN_BROWSER === '1') {
      const url = 'http://localhost:' + HTTP_PORT;
      const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
      exec(cmd, () => {});
    }
  });
});

function shutdown() {
  console.log('\nStopping SMARTFUZE AQUA - saving data...');
  try { store.flush(); } catch (_) {}
  aedes.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
