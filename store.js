'use strict';
/**
 * SMARTFUZE AQUA - plain file storage (no database engine to install).
 *
 * data/state.json                      configuration + registry + logs
 * data/readings/<POND_ID>/YYYY-MM-DD.ndjson   one JSON line per stored telemetry sample (UTC days)
 *
 * Schema 2 (v2.0.1) adds: shrimp RAS alert rules, water-quality log, production cycles,
 * pond profiles, notifications, watchdog and feeding interlock. v2.0.0 data upgrades automatically.
 */
const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 2;

function defaultLabLimits() {
  // Pacific white shrimp (L. vannamei), low-salinity RAS. Editable on the Water quality page.
  return {
    tanMgL:        { name: 'Total ammonia N', nameZh: '总氨氮', unit: 'mg/L', warnHigh: 1.0, critHigh: 2.0 },
    nh3nMgL:       { name: 'Un-ionised ammonia N', nameZh: '非离子氨氮', unit: 'mg/L', warnHigh: 0.05, critHigh: 0.1 },
    no2nMgL:       { name: 'Nitrite N', nameZh: '亚硝酸盐氮', unit: 'mg/L', warnHigh: 0.5, critHigh: 1.0 },
    no3nMgL:       { name: 'Nitrate N', nameZh: '硝酸盐氮', unit: 'mg/L', warnHigh: 50, critHigh: 100 },
    alkalinityMgL: { name: 'Alkalinity (CaCO3)', nameZh: '碱度（CaCO3）', unit: 'mg/L', warnLow: 120, critLow: 100, target: 150 },
    salinityPpt:   { name: 'Salinity', nameZh: '盐度', unit: 'ppt', warnLow: 5, critLow: 3, warnHigh: 25, critHigh: 35 }
  };
}

function emptyState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    site: { id: 'SITE-01', name: 'My farm' },   // default site: firmware SITE_ID
    sites: {},          // every site seen in MQTT topics aqua/site/<SITE_ID>/... (v3.0 multi-site)
    ponds: {},          // created ONLY by real telemetry
    pondProfiles: {},   // pondId -> { volumeM3, notes }
    devices: {},
    calibrations: [],
    integrations: [],
    feedSchedules: [],
    feedEvents: [],     // Command Sent / External App Opened / Confirmed / Failed / Skipped
    alertRules: [],
    alerts: [],
    labLimits: defaultLabLimits(),
    waterLogs: [],      // manual test-kit results
    cycles: [],         // production cycles (stocking -> harvest)
    notifications: { pushover: { enabled: false, appToken: '', userKey: '' }, watchdogUrl: '' },
    notifyLog: [],
    interlock: { blockWhenOffline: true, blockOnCritical: true, quietStart: '', quietEnd: '' },
    settings: { offlineAfterSec: 300, minStoreIntervalSec: 30, publicUrl: '' },
    auth: { users: [], sessions: [] },   // dashboard logins (cloud mode)
    deviceCreds: []                      // ESP32 MQTT logins (cloud mode)
  };
}

function seedCalibration() {
  return {
    id: 'cal-ph01-initial', probeId: 'PH-01', pondId: 'POND-A', deviceId: 'AQUA-POND-A-01',
    calibrationDate: 'Not recorded',
    points: [{ ph: 4.01, raw: 1725 }, { ph: 6.86, raw: 1500 }, { ph: 9.18, raw: 1340 }],
    calTempC: null, // buffer temperature during calibration; enter it to enable temperature compensation
    adcPin: 'GPIO34', dividerTopOhm: 20000, dividerBottomOhm: 10000, active: true,
    notes: 'Bench calibration supplied with v2.0.0 (real buffer readings). Add the real date and buffer temperature.',
    createdAt: new Date().toISOString()
  };
}

function defaultAlertRules() {
  const R = (id, name, nameZh, metric, op, threshold, severity, sustainSec, group) =>
    ({ id, name, nameZh, metric, op, threshold, severity, sustainSec, group, pondId: '*', enabled: true });
  return [
    R('temp-low-warn', 'Temperature low', '水温偏低', 'temperatureC', 'lt', 26, 'warning', 600, 'water'),
    R('temp-low-crit', 'Temperature critically low', '水温过低', 'temperatureC', 'lt', 24, 'critical', 300, 'water'),
    R('temp-high-warn', 'Temperature high', '水温偏高', 'temperatureC', 'gt', 32, 'warning', 600, 'water'),
    R('temp-high-crit', 'Temperature critically high', '水温过高', 'temperatureC', 'gt', 34, 'critical', 300, 'water'),
    R('ph-low-warn', 'pH low', 'pH 偏低', 'ph', 'lt', 7.5, 'warning', 600, 'water'),
    R('ph-low-crit', 'pH critically low', 'pH 过低', 'ph', 'lt', 7.0, 'critical', 300, 'water'),
    R('ph-high-warn', 'pH high', 'pH 偏高', 'ph', 'gt', 8.5, 'warning', 600, 'water'),
    R('ph-high-crit', 'pH critically high', 'pH 过高', 'ph', 'gt', 9.0, 'critical', 300, 'water'),
    R('ph-swing-warn', 'pH daily swing large', 'pH 日波动过大', 'phSwing24h', 'gt', 0.5, 'warning', 0, 'water'),
    R('ph-swing-crit', 'pH daily swing critical', 'pH 日波动严重', 'phSwing24h', 'gt', 0.8, 'critical', 0, 'water'),
    R('do-low-warn', 'Dissolved oxygen low', '溶氧偏低', 'doMgL', 'lt', 4, 'warning', 120, 'life'),
    R('do-low-crit', 'Dissolved oxygen critical', '溶氧危险', 'doMgL', 'lt', 3, 'critical', 60, 'life'),
    R('pump-stopped', 'Circulation pump stopped', '循环水泵停止', 'pumpRunning', 'eq', false, 'critical', 60, 'life'),
    R('air-stopped', 'Air pump stopped', '气泵停止', 'airPumpRunning', 'eq', false, 'critical', 60, 'life'),
    R('level-low', 'Sump water level low', '集水槽水位过低', 'waterLevel', 'eq', 'low', 'critical', 30, 'life'),
    R('level-high', 'Water level high (overflow risk)', '水位过高（溢出风险）', 'waterLevel', 'eq', 'high', 'warning', 30, 'life'),
    R('sensor-missing', 'Sensor stopped reporting', '传感器无数据', 'sensorMissing', 'eq', true, 'warning', 300, 'system'),
    R('offline', 'Device offline', '设备离线', 'offline', 'eq', true, 'critical', 0, 'system')
  ];
}

class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.readingsDir = path.join(dataDir, 'readings');
    this.statePath = path.join(dataDir, 'state.json');
    fs.mkdirSync(this.readingsDir, { recursive: true });
    this.state = this._load();
    this._saveTimer = null;
  }

  _load() {
    let state = null;
    if (fs.existsSync(this.statePath)) {
      try {
        const txt = fs.readFileSync(this.statePath, 'utf8').trim();
        if (txt) state = JSON.parse(txt);
      } catch (err) {
        const bad = this.statePath + '.corrupt-' + Date.now();
        fs.copyFileSync(this.statePath, bad);
        console.error('[store] state.json was unreadable; a copy was kept at', bad);
      }
    }
    const fresh = !state;
    if (!state) state = emptyState();
    const def = emptyState();
    for (const k of Object.keys(def)) if (state[k] === undefined) state[k] = def[k];
    state.settings = { ...def.settings, ...state.settings };
    state.interlock = { ...def.interlock, ...state.interlock };
    state.notifications = { ...def.notifications, ...state.notifications, pushover: { ...def.notifications.pushover, ...(state.notifications || {}).pushover } };
    for (const [k, v] of Object.entries(def.labLimits)) state.labLimits[k] = { ...v, ...(state.labLimits[k] || {}) };

    const ver = state.schemaVersion || 1;
    if (!fresh && ver < 2) {
      fs.copyFileSync(this.statePath, this.statePath + '.v2.0.0-backup');
      state.alertRules = defaultAlertRules();
      console.log('[store] data upgraded to v2.0.1 (schema 2). Old file kept as state.json.v2.0.0-backup');
      console.log('[store] alert rules replaced with Pacific white shrimp / low-salinity RAS defaults');
    }
    state.schemaVersion = SCHEMA_VERSION;
    if (!state._seeded) {
      if (!state.calibrations.length) state.calibrations.push(seedCalibration());
      state._seeded = true;
    }
    if (!state.alertRules.length) state.alertRules = defaultAlertRules();
    for (const r of defaultAlertRules()) if (!state.alertRules.some(x => x.id === r.id)) state.alertRules.push(r);
    for (const c of state.calibrations) if (c.calTempC === undefined) c.calTempC = null;

    for (const p of Object.values(state.ponds)) p.online = false;
    for (const d of Object.values(state.devices)) d.online = false;
    this._writeNow(state);
    return state;
  }

  _writeNow(state = this.state) {
    const tmp = this.statePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, this.statePath);
  }

  save() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      try { this._writeNow(); } catch (e) { console.error('[store] save failed', e.message); }
    }, 400);
  }

  flush() {
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    this._writeNow();
  }

  static dayKey(ts) { return new Date(ts).toISOString().slice(0, 10); }

  appendReading(rec) {
    const dir = path.join(this.readingsDir, rec.pondId);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, Store.dayKey(rec.ts) + '.ndjson'), JSON.stringify(rec) + '\n');
  }

  readReadings(pondId, fromTs, toTs) {
    const dir = path.join(this.readingsDir, pondId);
    if (!fs.existsSync(dir)) return [];
    const out = [];
    for (let t = Date.parse(Store.dayKey(fromTs)); t <= toTs; t += 86400000) {
      const f = path.join(dir, Store.dayKey(t) + '.ndjson');
      if (!fs.existsSync(f)) continue;
      for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
        if (!line) continue;
        try {
          const r = JSON.parse(line);
          const ts = Date.parse(r.ts);
          if (ts >= fromTs && ts <= toTs) out.push(r);
        } catch (_) { /* half-written line after power loss */ }
      }
    }
    // Buffered readings uploaded after a 4G outage arrive late: keep history in time order.
    out.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    return out;
  }

  readingStats() {
    let files = 0, bytes = 0;
    const ponds = {};
    if (!fs.existsSync(this.readingsDir)) return { files, bytes, ponds };
    for (const p of fs.readdirSync(this.readingsDir)) {
      const dir = path.join(this.readingsDir, p);
      if (!fs.statSync(dir).isDirectory()) continue;
      const days = fs.readdirSync(dir).filter(f => f.endsWith('.ndjson')).sort();
      ponds[p] = { days: days.length, first: days[0]?.slice(0, 10) || null, last: days.at(-1)?.slice(0, 10) || null };
      for (const f of days) { files++; bytes += fs.statSync(path.join(dir, f)).size; }
    }
    return { files, bytes, ponds };
  }
}

module.exports = { Store, SCHEMA_VERSION, defaultAlertRules, defaultLabLimits };
