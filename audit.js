'use strict';
/**
 * SMARTFUZE AQUA - append-only audit trail.
 *
 * data/audit/audit-YYYY-MM.ndjson, one JSON line per event. Every line carries the hash of the
 * previous line (a hash chain), so editing or deleting a past line is detected by verify().
 * This makes the log tamper-EVIDENT, not tamper-proof: someone with server access could rewrite
 * the whole chain. Off-site backups of these files are what make a rewrite detectable later.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SECRET_KEYS = /pass(word)?|token|secret|hash|salt|userkey|apptoken|cookie/i;
function redact(v, depth = 0) {
  if (v === null || v === undefined || depth > 6) return v;
  if (Array.isArray(v)) return v.slice(0, 200).map(x => redact(x, depth + 1));
  if (typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = SECRET_KEYS.test(k) ? '[redacted]' : redact(x, depth + 1);
    return o;
  }
  if (typeof v === 'string' && v.length > 2000) return v.slice(0, 2000) + '…';
  return v;
}
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

class AuditLog {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.seq = 0; this.lastHash = 'GENESIS';
    const files = this._files();
    if (files.length) {
      const lines = fs.readFileSync(path.join(dir, files.at(-1)), 'utf8').trim().split('\n').filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        try { const r = JSON.parse(lines[i]); this.seq = r.seq; this.lastHash = r.hash; break; } catch (_) {}
      }
    }
  }
  _files() { return fs.readdirSync(this.dir).filter(f => /^audit-\d{4}-\d{2}\.ndjson$/.test(f)).sort(); }

  append(ev) {
    const rec = {
      seq: this.seq + 1, ts: new Date().toISOString(),
      actor: ev.actor || 'system', role: ev.role || null, ip: ev.ip || null,
      action: ev.action, entity: ev.entity || null, entityId: ev.entityId || null,
      reason: ev.reason || null, detail: redact(ev.detail ?? null),
      before: redact(ev.before ?? null), after: redact(ev.after ?? null),
      prevHash: this.lastHash
    };
    rec.hash = sha(JSON.stringify(rec));
    fs.appendFileSync(path.join(this.dir, `audit-${rec.ts.slice(0, 7)}.ndjson`), JSON.stringify(rec) + '\n');
    this.seq = rec.seq; this.lastHash = rec.hash;
    return rec;
  }

  query({ entity, entityId, actor, action, from, to, limit = 200 } = {}) {
    const out = [];
    for (const f of this._files().reverse()) {
      const lines = fs.readFileSync(path.join(this.dir, f), 'utf8').trim().split('\n').filter(Boolean).reverse();
      for (const l of lines) {
        let r; try { r = JSON.parse(l); } catch (_) { continue; }
        if (entity && r.entity !== entity) continue;
        if (entityId && r.entityId !== entityId) continue;
        if (actor && r.actor !== actor) continue;
        if (action && !String(r.action).startsWith(action)) continue;
        if (from && r.ts < from) continue;
        if (to && r.ts > to) continue;
        out.push(r);
        if (out.length >= limit) return out;
      }
    }
    return out;
  }

  verify() {
    let prev = 'GENESIS', count = 0, expectSeq = 1;
    for (const f of this._files()) {
      const lines = fs.readFileSync(path.join(this.dir, f), 'utf8').split('\n').filter(Boolean);
      for (const l of lines) {
        let r;
        try { r = JSON.parse(l); } catch (_) { return { ok: false, count, problem: `unreadable line in ${f}` }; }
        const { hash, ...rest } = r;
        if (r.seq !== expectSeq) return { ok: false, count, problem: `sequence gap before #${r.seq} (expected #${expectSeq})` };
        if (r.prevHash !== prev) return { ok: false, count, problem: `chain broken at #${r.seq}` };
        if (sha(JSON.stringify(rest)) !== hash) return { ok: false, count, problem: `entry #${r.seq} was modified` };
        prev = hash; count++; expectSeq++;
      }
    }
    return { ok: true, count, lastHash: prev };
  }
}

module.exports = { AuditLog, redact };
