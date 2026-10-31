'use strict';
/**
 * SMARTFUZE AQUA - in-process event bus.
 *
 * Modules publish events and subscribe to them instead of calling each other directly:
 *
 *   mqtt.telemetry ─> ingest ─> reading ─┬─> storage        (history files)
 *                                        ├─> realtime       (WebSocket to dashboards)
 *                                        └─> alerts ─> alert.raised ─┬─> notifications (Pushover)
 *                                                                    └─> realtime
 *
 * A subscriber that throws is isolated: the error is logged and counted, and every other
 * subscriber still runs. Event names are the ones a future external broker would carry,
 * so modules can later move to separate services without being rewritten.
 */
class Bus {
  constructor() {
    this.subs = new Map();   // event -> [{ handler, module }]
    this.stats = new Map();  // event -> { count, errors, last }
    this.errors = [];
  }

  on(event, handler, module = 'core') {
    if (!this.subs.has(event)) this.subs.set(event, []);
    const entry = { handler, module };
    this.subs.get(event).push(entry);
    return () => { const l = this.subs.get(event) || []; const i = l.indexOf(entry); if (i >= 0) l.splice(i, 1); };
  }

  emit(event, payload) {
    const st = this.stats.get(event) || { count: 0, errors: 0, last: null };
    st.count++; st.last = new Date().toISOString();
    this.stats.set(event, st);
    for (const s of [...(this.subs.get(event) || [])]) {
      try {
        const r = s.handler(payload);
        if (r && typeof r.catch === 'function') r.catch(e => this._fail(event, s, e));
      } catch (e) { this._fail(event, s, e); }
    }
  }

  _fail(event, s, e) {
    const st = this.stats.get(event);
    if (st) st.errors++;
    const rec = { at: new Date().toISOString(), event, module: s.module, error: String((e && e.message) || e) };
    this.errors.unshift(rec);
    if (this.errors.length > 50) this.errors.length = 50;
    console.error(`[bus] module "${s.module}" failed on "${event}": ${rec.error}`);
  }

  describe() {
    const names = new Set([...this.subs.keys(), ...this.stats.keys()]);
    return {
      events: [...names].sort().map(name => ({
        name, ...(this.stats.get(name) || { count: 0, errors: 0, last: null }),
        subscribers: (this.subs.get(name) || []).map(x => x.module)
      })),
      recentErrors: this.errors.slice(0, 10)
    };
  }
}

module.exports = { Bus };
