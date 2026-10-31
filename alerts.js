'use strict';
/**
 * SMARTFUZE AQUA - alert engine.
 *
 * Live rules raise an alert only when the condition holds CONTINUOUSLY for `sustainSec`.
 * One bad sample never alerts; one good sample resets the timer.
 * While a device is offline, only the offline / sensor rules run - stale values never raise new alerts.
 * Lab alerts come from manual test-kit entries and are raised immediately (a person measured it).
 * Every raise / resolve is published on the event bus ("alert.raised" / "alert.resolved");
 * the notifications and realtime modules subscribe to it.
 */
const { classify } = require('./aquaculture');

const MAX_ALERT_HISTORY = 1000;
const UNIT = { temperatureC: ' °C', doMgL: ' mg/L', phSwing24h: '', ph: '' };
const SENSORS = {
  temperatureC: ['Water temperature probe', '水温探头'],
  ph: ['pH probe', 'pH 探头'],
  doMgL: ['Dissolved oxygen sensor', '溶氧传感器'],
  flowLpm: ['Flow sensor', '流量传感器'],
  waterLevel: ['Level switches', '水位开关'],
  airPumpCurrentA: ['Air pump current sensor', '气泵电流传感器'],
  salinityPpt: ['Salinity sensor', '盐度传感器']
};
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const durEn = s => (s >= 60 ? Math.round(s / 60) + ' min' : s + ' s');
const durZh = s => (s >= 60 ? Math.round(s / 60) + ' 分钟' : s + ' 秒');

class AlertEngine {
  constructor(store, bus) {
    this.store = store;
    this.bus = bus;
    this.breach = new Map();
  }

  _rulesFor(pondId) {
    return this.store.state.alertRules.filter(r => r.enabled && (r.pondId === '*' || r.pondId === pondId));
  }

  _conditions(rule, pond) {
    if (rule.metric === 'offline') return [{ key: '', cond: !pond.online }];
    const seen = pond.sensorsSeen || [];
    const vals = { ...(pond.latest || {}), ...(pond.derived || {}) };
    if (rule.metric === 'sensorMissing') {
      return seen.map(f => ({ key: f, cond: pond.online ? (vals[f] === null || vals[f] === undefined) : false }));
    }
    if (!pond.online) return [{ key: '', cond: null }];
    const v = vals[rule.metric];
    if (v === undefined || v === null) return [{ key: '', cond: null }];
    if (rule.op === 'lt') return [{ key: '', cond: isNum(v) ? v < rule.threshold : null, value: v }];
    if (rule.op === 'gt') return [{ key: '', cond: isNum(v) ? v > rule.threshold : null, value: v }];
    if (rule.op === 'eq') return [{ key: '', cond: v === rule.threshold, value: v }];
    return [{ key: '', cond: null }];
  }

  _active(ruleId, pondId, key) {
    return this.store.state.alerts.find(a => a.ruleId === ruleId && a.pondId === pondId && (a.subKey || '') === key && !a.resolvedAt);
  }

  evaluate(pond, now = Date.now()) {
    if (!pond.hasTelemetry) return;
    for (const rule of this._rulesFor(pond.id)) {
      for (const c of this._conditions(rule, pond)) {
        const key = rule.id + '|' + pond.id + '|' + c.key;
        if (c.cond === null) { this.breach.delete(key); continue; }
        const active = this._active(rule.id, pond.id, c.key);
        if (c.cond) {
          if (!this.breach.has(key)) this.breach.set(key, now);
          if (!active && now - this.breach.get(key) >= (rule.sustainSec || 0) * 1000) this._raise(rule, pond, c, now);
        } else {
          this.breach.delete(key);
          if (active) this._resolve(active, now);
        }
      }
    }
  }

  _texts(rule, pond, c) {
    const u = UNIT[rule.metric] || '';
    const s = rule.sustainSec || 0;
    if (rule.metric === 'offline') {
      const m = Math.round((this.store.state.settings.offlineAfterSec || 300) / 60);
      return [`${pond.name}: no telemetry for ${m} min`, `${pond.name}：设备离线，${m} 分钟没有数据`];
    }
    if (rule.metric === 'sensorMissing') {
      const [en, zh] = SENSORS[c.key] || [c.key, c.key];
      return [`${pond.name}: ${en} is not sending a valid value`, `${pond.name}：${zh}没有有效数据，请检查接线或探头`];
    }
    if (rule.op === 'eq') {
      return [`${pond.name}: ${rule.name}${s ? ' for ' + durEn(s) : ''}`, `${pond.name}：${rule.nameZh}${s ? '，已持续 ' + durZh(s) : ''}`];
    }
    const v = c.value, dirEn = rule.op === 'lt' ? 'below' : 'above', dirZh = rule.op === 'lt' ? '低于' : '高于';
    const forEn = s ? ` for ${durEn(s)}` : '', forZh = s ? `，已持续 ${durZh(s)}` : '';
    return [`${pond.name}: ${rule.name} ${v}${u}, ${dirEn} ${rule.threshold}${u}${forEn}`,
            `${pond.name}：${rule.nameZh} ${v}${u}（${dirZh} ${rule.threshold}${u}）${forZh}`];
  }

  _raise(rule, pond, c, now) {
    const [message, messageZh] = this._texts(rule, pond, c);
    this._push({
      ruleId: rule.id, subKey: c.key || '', ruleName: rule.name, ruleNameZh: rule.nameZh,
      metric: rule.metric, severity: rule.severity, kind: rule.group === 'system' ? 'system' : 'live',
      pondId: pond.id, pondName: pond.name, value: c.value ?? null, threshold: rule.threshold, op: rule.op,
      message, messageZh,
      startedAt: new Date(this.breach.get(rule.id + '|' + pond.id + '|' + c.key) || now).toISOString()
    }, now);
  }

  _push(fields, now) {
    const alert = {
      id: 'al-' + now.toString(36) + '-' + Math.random().toString(36).slice(2, 6),
      ...fields, raisedAt: new Date(now).toISOString(), resolvedAt: null, acknowledged: false
    };
    const list = this.store.state.alerts;
    list.unshift(alert);
    if (list.length > MAX_ALERT_HISTORY) list.length = MAX_ALERT_HISTORY;
    this.store.save();
    this.bus.emit('alert.raised', { alert });
  }

  _resolve(alert, now) {
    alert.resolvedAt = new Date(now).toISOString();
    this.store.save();
    this.bus.emit('alert.resolved', { alert });
  }

  /** Manual test-kit result. Raised immediately; resolved by the next normal result for that parameter. */
  lab(pond, entry, limits, now = Date.now()) {
    for (const [param, lim] of Object.entries(limits)) {
      const v = entry[param];
      if (!isNum(v)) continue;
      const level = classify(v, lim);
      const sev = level === 'crit' ? 'critical' : level === 'warn' ? 'warning' : null;
      const ruleId = 'lab-' + param;
      const active = this._active(ruleId, pond.id, '');
      if (active && active.severity !== sev) this._resolve(active, now);
      if (sev && (!active || active.severity !== sev)) {
        const lvlEn = sev === 'critical' ? 'critical' : 'warning', lvlZh = sev === 'critical' ? '严重超标' : '超出建议范围';
        this._push({
          ruleId, subKey: '', ruleName: lim.name, ruleNameZh: lim.nameZh, metric: param, severity: sev, kind: 'lab',
          pondId: pond.id, pondName: pond.name, value: v, threshold: null, op: null,
          message: `${pond.name}: ${lim.name} ${v} ${lim.unit} (${lvlEn}, test result)`,
          messageZh: `${pond.name}：${lim.nameZh} ${v} ${lim.unit}，${lvlZh}（检测记录）`,
          startedAt: entry.ts
        }, now);
      }
    }
  }

  clearRule(ruleId) {
    for (const k of [...this.breach.keys()]) if (k.startsWith(ruleId + '|')) this.breach.delete(k);
  }
}

module.exports = { AlertEngine, SENSORS };
