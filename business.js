'use strict';
/**
 * SMARTFUZE AQUA v2.1.0 - business records: POC research, expense ledger, evidence vault.
 *
 * Stored separately from monitoring data:
 *   data/business.json            POCs, expenses, evidence metadata (atomic writes, schema version)
 *   data/evidence/YYYY/MM/<file>   uploaded files, never served as public static files
 *   data/audit/*.ndjson           every change, with before/after (see lib/audit.js)
 *
 * Principles: nothing is invented. A value that has not been measured, approved or verified is
 * returned as null with a reason, never estimated silently. Records are voided or archived, never
 * deleted. Money is computed in integer sen/cents to avoid rounding drift.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function req(name) { // works with lib/ layout and with a flattened GitHub upload
  try { return require('./' + name); } catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND' || !String(e.message).includes(name)) throw e;
    return require('./lib/' + name);
  }
}
const { cycleSummary, isNum, round } = req('aquaculture');

const SCHEMA_VERSION = 1;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86400000;
const nowIso = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);
const bad = (msg, status = 400, extra) => Object.assign(new Error(msg), { status, extra });
const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : (v === null || v === undefined ? '' : String(v).trim().slice(0, max)));
const optDate = (v, label) => { const s = str(v, 10); if (!s) return null; if (!DATE_RE.test(s) || Number.isNaN(Date.parse(s))) throw bad(`${label} must be a date (YYYY-MM-DD)`); return s; };
const dms = d => Date.parse(d + 'T00:00:00Z');

// ------------------------------------------------------------------ reference lists
const POC_STATUSES = ['Draft', 'Preparing', 'Running', 'Harvesting', 'Completed', 'Failed', 'Cancelled'];
const POC_FLOW = {
  Draft: ['Preparing', 'Cancelled'],
  Preparing: ['Draft', 'Running', 'Cancelled'],
  Running: ['Harvesting', 'Failed', 'Cancelled'],
  Harvesting: ['Completed', 'Failed'],
  Completed: [], Failed: [], Cancelled: []
};
const POC_TEXT = ['name', 'objectives', 'hypothesis', 'method', 'pondDimension', 'stockingDensity', 'species', 'plSupplier',
  'expectedResults', 'successCriteria', 'failureCriteria', 'risks', 'responsible'];
const LOCKED_AFTER_START = ['hypothesis', 'expectedResults', 'successCriteria', 'failureCriteria'];

const NATURES = {
  OPEX: 'Operating expense', CAPEX: 'Capital expenditure', DEPOSIT: 'Deposit (refundable, not a cost)',
  LOAN: 'Loan received (funding, not a cost)', EQUITY: 'Equity contribution (funding, not a cost)'
};
const CATEGORIES = ['Land Rental', 'Land Deposit', 'Pond Construction', 'Pond Liner', 'Electrical Installation', 'Water Supply',
  'Pumps', 'Blowers', 'RAS Filters', 'Sensors', 'ESP32 / IoT', 'Automatic Feeders', 'Shrimp PL', 'Feed', 'Probiotics', 'Minerals',
  'Water Treatment', 'Electricity', 'Staff Salary', 'Employer Contributions', 'Transport', 'Packaging', 'Maintenance', 'Insurance',
  'Professional Fees', 'Miscellaneous'];
const FUNDING = { founder_personal: 'Founder personal funds', company_funds: 'Company funds', shareholder_loan: 'Shareholder loan',
  equity_investment: 'Equity investment', revenue: 'Business revenue', other: 'Other' };
const PAY_METHODS = ['bank_transfer', 'cash', 'card', 'ewallet', 'cheque', 'other'];
const CURRENCIES = ['MYR', 'CNY', 'SGD', 'USD'];

const EVIDENCE_TYPES = {
  receipt: { label: 'Receipt', confidential: true }, invoice: { label: 'Invoice', confidential: true },
  quotation: { label: 'Quotation', confidential: true }, bank_payment: { label: 'Bank payment evidence', confidential: true },
  pond_photo: { label: 'Pond photo', confidential: false }, shrimp_photo: { label: 'Shrimp photo', confidential: false },
  sampling_photo: { label: 'Growth sampling photo', confidential: false }, harvest_video: { label: 'Harvest weighing video', confidential: false },
  water_test: { label: 'Water test result', confidential: false }, calibration: { label: 'Sensor calibration', confidential: false },
  technical_advice: { label: 'Technical advice record', confidential: false }, buyer_loi: { label: 'Buyer LOI', confidential: true },
  sales_invoice: { label: 'Sales invoice', confidential: true }, payment_confirmation: { label: 'Payment confirmation', confidential: true },
  agreement: { label: 'Signed agreement', confidential: true }, other: { label: 'Other', confidential: true }
};
const LINK_TYPES = ['poc', 'cycle', 'expense', 'pond'];
const MAX_FILE = 50 * 1024 * 1024;

/** Identify a file from its first bytes. The uploaded name and Content-Type are not trusted. */
function sniff(buf, ext) {
  const b = (i, n) => buf.slice(i, i + n).toString('latin1');
  if (buf.length < 4) return null;
  if (b(0, 5) === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  if (buf[0] === 0x89 && b(1, 3) === 'PNG') return { mime: 'image/png', ext: 'png' };
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return { mime: 'image/jpeg', ext: 'jpg' };
  if (b(0, 4) === 'RIFF' && b(8, 4) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (b(4, 4) === 'ftyp') {
    const brand = b(8, 4);
    if (/^(heic|heix|mif1|msf1)$/.test(brand)) return { mime: 'image/heic', ext: 'heic' };
    if (brand === 'qt  ') return { mime: 'video/quicktime', ext: 'mov' };
    return { mime: 'video/mp4', ext: 'mp4' };
  }
  if (buf[0] === 0x50 && buf[1] === 0x4B && buf[2] === 3 && buf[3] === 4) {
    if (ext === 'xlsx') return { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' };
    if (ext === 'docx') return { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' };
    return null; // arbitrary zip archives are not accepted
  }
  if (ext === 'csv' || ext === 'txt') {
    if (buf.includes(0)) return null;
    const t = buf.toString('utf8');
    if (t.includes('\uFFFD') || /<\s*(script|html|svg|iframe)/i.test(t)) return null;
    return { mime: ext === 'csv' ? 'text/csv' : 'text/plain', ext };
  }
  return null; // HTML, SVG, scripts, executables and unknown formats are refused
}

// ------------------------------------------------------------------ money
function toMinor(v, label) {
  const s = String(v ?? '').trim();
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(s)) throw bad(`${label} must be a positive amount with at most 2 decimals`);
  const n = Math.round(Number(s) * 100);
  if (n <= 0) throw bad(`${label} must be more than 0`);
  return n;
}
const fromMinor = n => (n === null || n === undefined ? null : Math.round(n) / 100);

class Business {
  constructor({ dataDir, audit, getState }) {
    this.dir = dataDir;
    this.file = path.join(dataDir, 'business.json');
    this.evDir = path.join(dataDir, 'evidence');
    this.audit = audit;
    this.getState = getState;
    fs.mkdirSync(this.evDir, { recursive: true });
    this.db = this._load();
  }

  _empty() { return { schemaVersion: SCHEMA_VERSION, createdAt: nowIso(), counters: { poc: 0, ev: 0, exp: {} }, pocs: [], expenses: [], evidence: [] }; }
  _load() {
    let db = null;
    if (fs.existsSync(this.file)) {
      try { db = JSON.parse(fs.readFileSync(this.file, 'utf8')); }
      catch (e) {
        const keep = this.file + '.corrupt-' + Date.now();
        fs.copyFileSync(this.file, keep);
        throw new Error(`business.json is unreadable (copy kept at ${keep}). Restore it from a backup; AQUA will not start with empty business records over real ones.`);
      }
    }
    if (!db) { db = this._empty(); this._write(db); return db; }
    const def = this._empty();
    for (const k of Object.keys(def)) if (db[k] === undefined) db[k] = def[k];
    if ((db.schemaVersion || 0) > SCHEMA_VERSION) throw new Error('business.json was written by a newer AQUA version. Update AQUA instead of downgrading.');
    db.schemaVersion = SCHEMA_VERSION;
    return db;
  }
  _write(db = this.db) {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, this.file);
  }
  save() { this._write(); }
  _log(ctx, action, entity, entityId, before, after, reason, detail) {
    this.audit.append({ actor: ctx.user, role: ctx.role, ip: ctx.ip, action, entity, entityId, before, after, reason, detail });
  }

  // ================================================================== POC
  listPoc() { return this.db.pocs.map(p => ({ ...p, summary: this.pocSummary(p.id, true) })); }
  _poc(id) { const p = this.db.pocs.find(x => x.id === id); if (!p) throw bad('POC not found', 404); return p; }
  getPoc(id) { const p = this._poc(id); return { ...p, summary: this.pocSummary(id) }; }

  _pocFields(b, existing) {
    const st = this.getState();
    const out = {};
    for (const k of POC_TEXT) if (b[k] !== undefined) out[k] = str(b[k], k === 'name' ? 120 : 4000);
    if (b.siteId !== undefined) { out.siteId = str(b.siteId, 40) || st.site.id; if (!ID_RE.test(out.siteId)) throw bad('Site ID may only use letters, numbers, - and _'); }
    if (b.pondId !== undefined) { out.pondId = str(b.pondId, 40); if (!ID_RE.test(out.pondId)) throw bad('Pond ID is required (letters, numbers, - and _)'); }
    if (b.startDate !== undefined) out.startDate = optDate(b.startDate, 'Start date');
    if (b.endDate !== undefined) out.endDate = optDate(b.endDate, 'End date');
    if (b.waterVolumeM3 !== undefined) {
      if (b.waterVolumeM3 === null || b.waterVolumeM3 === '') out.waterVolumeM3 = null;
      else { const v = Number(b.waterVolumeM3); if (!(v > 0 && v < 1e6)) throw bad('Water volume must be a positive number of m³'); out.waterVolumeM3 = v; }
    }
    const s = out.startDate ?? existing?.startDate, e = out.endDate ?? existing?.endDate;
    if (s && e && e < s) throw bad('End date cannot be before the start date');
    return out;
  }

  createPoc(b, ctx) {
    const f = this._pocFields(b || {});
    if (!f.name) throw bad('Project name is required');
    if (!f.pondId) throw bad('Pond ID is required');
    this.db.counters.poc++;
    const id = 'POC-' + String(this.db.counters.poc).padStart(3, '0');
    const p = {
      id, siteId: f.siteId || this.getState().site.id, status: 'Draft', cycleIds: [], reviews: [], statusHistory: [],
      criteriaLockedAt: null, criteriaChanges: [],
      ...Object.fromEntries(POC_TEXT.map(k => [k, ''])), startDate: null, endDate: null, waterVolumeM3: null,
      species: 'Pacific white shrimp (Litopenaeus vannamei)',
      ...f, createdAt: nowIso(), createdBy: ctx.user, updatedAt: nowIso(), updatedBy: ctx.user
    };
    this.db.pocs.push(p); this.save();
    this._log(ctx, 'poc.create', 'poc', id, null, p);
    return p;
  }

  updatePoc(id, b, ctx) {
    const p = this._poc(id);
    if (['Completed', 'Failed', 'Cancelled'].includes(p.status)) throw bad(`${p.status} POCs are closed records and cannot be edited`, 409);
    const f = this._pocFields(b || {}, p);
    const reason = str(b?.reason, 500);
    const changedLocked = LOCKED_AFTER_START.filter(k => f[k] !== undefined && f[k] !== p[k]);
    if (p.criteriaLockedAt && changedLocked.length) {
      if (reason.length < 5) throw bad('This POC has started. Changing the hypothesis, expected results or success / failure criteria needs a reason (kept in the history).', 400, { needsReason: true });
      for (const k of changedLocked) p.criteriaChanges.push({ field: k, old: p[k], new: f[k], at: nowIso(), by: ctx.user, reason });
    }
    const before = { ...p };
    Object.assign(p, f, { updatedAt: nowIso(), updatedBy: ctx.user });
    this.save();
    this._log(ctx, 'poc.update', 'poc', id, before, p, reason || null);
    return p;
  }

  setPocStatus(id, b, ctx) {
    const p = this._poc(id);
    const to = str(b?.status, 20), note = str(b?.note, 1000);
    if (!POC_STATUSES.includes(to)) throw bad('Unknown status');
    if (!POC_FLOW[p.status].includes(to)) throw bad(`A POC cannot move from ${p.status} to ${to}`, 409);
    if (to === 'Running') {
      if (!p.successCriteria || !p.failureCriteria) throw bad('Write the success and failure criteria before the POC starts. They are locked when it starts.', 409);
      if (!p.startDate) p.startDate = today();
      p.criteriaLockedAt = nowIso();
    }
    if (['Failed', 'Cancelled'].includes(to) && note.length < 5) throw bad(`Explain why the POC is ${to.toLowerCase()} (kept in the record)`);
    if (['Completed', 'Failed', 'Cancelled'].includes(to) && !p.endDate) p.endDate = today();
    const from = p.status;
    p.status = to;
    p.statusHistory.push({ from, to, at: nowIso(), by: ctx.user, note });
    p.updatedAt = nowIso(); p.updatedBy = ctx.user;
    this.save();
    this._log(ctx, 'poc.status', 'poc', id, { status: from }, { status: to }, note || null);
    return p;
  }

  addReview(id, b, ctx) {
    const p = this._poc(id);
    const decision = str(b?.decision, 30);
    if (!['approved', 'changes_requested', 'comment'].includes(decision)) throw bad('Decision must be approved, changes_requested or comment');
    const note = str(b?.note, 2000);
    if (decision !== 'approved' && note.length < 3) throw bad('Write the review comment');
    const r = { id: 'rev-' + crypto.randomBytes(4).toString('hex'), decision, note, by: ctx.user, role: ctx.role, at: nowIso(), statusAtReview: p.status };
    p.reviews.push(r); this.save();
    this._log(ctx, 'poc.review', 'poc', id, null, r);
    return p;
  }

  linkCycle(id, cycleId, ctx) {
    const p = this._poc(id);
    const c = this.getState().cycles.find(x => x.id === cycleId);
    if (!c) throw bad('Crop cycle not found', 404);
    if (c.pondId !== p.pondId) throw bad(`That cycle is in ${c.pondId}; this POC is for ${p.pondId}`);
    const other = this.db.pocs.find(x => x.id !== id && x.cycleIds.includes(cycleId));
    if (other) throw bad(`That cycle already belongs to ${other.id}. A cycle can count in one POC only, so harvest and costs are never counted twice.`, 409);
    if (p.cycleIds.includes(cycleId)) return p;
    p.cycleIds.push(cycleId); this.save();
    this._log(ctx, 'poc.link_cycle', 'poc', id, null, { cycleId });
    return p;
  }
  unlinkCycle(id, cycleId, ctx) {
    const p = this._poc(id);
    if (['Completed', 'Failed'].includes(p.status)) throw bad('Closed POC results cannot be changed', 409);
    p.cycleIds = p.cycleIds.filter(x => x !== cycleId); this.save();
    this._log(ctx, 'poc.unlink_cycle', 'poc', id, { cycleId }, null);
    return p;
  }

  pocSummary(id, brief = false) {
    const p = this._poc(id);
    const st = this.getState();
    const cycles = st.cycles.filter(c => p.cycleIds.includes(c.id));
    const vol = p.waterVolumeM3 || st.pondProfiles?.[p.pondId]?.volumeM3;
    const cs = cycles.map(c => ({ id: c.id, status: c.status, startDate: c.startDate, endDate: c.endDate, summary: cycleSummary(c, vol) }));
    const known = k => cs.length && cs.every(x => isNum(x.summary[k]));
    const total = k => cs.reduce((a, x) => a + (isNum(x.summary[k]) ? x.summary[k] : 0), 0);
    const allClosed = cs.length > 0 && cs.every(x => x.status === 'closed');
    const stocked = known('stocked') ? total('stocked') : null;
    const harvestKg = cs.some(x => isNum(x.summary.harvestKg)) ? round(total('harvestKg'), 2) : null;
    const verifiedCount = allClosed && known('harvestCount') ? total('harvestCount') : null;
    const feedKg = round(total('feedKg'), 2);
    const initialKg = cycles.reduce((a, c) => a + (isNum(c.stockedCount) ? c.stockedCount * (c.initialWeightG || 0) / 1000 : 0), 0);
    const out = {
      cycles: cs.length, allClosed, stocked, mortalityCounted: total('mortality'), feedKg, harvestKg,
      estimatedSurvivalPct: !allClosed && stocked && cs.every(x => x.summary.aliveEst !== null) ? round(cs.reduce((a, x) => a + x.summary.aliveEst + (x.summary.harvestCount || 0), 0) / stocked * 100, 1) : null,
      verifiedSurvivalPct: verifiedCount !== null && stocked ? round(verifiedCount / stocked * 100, 1) : null,
      finalFcr: allClosed && harvestKg && feedKg && harvestKg > initialKg ? round(feedKg / (harvestKg - initialKg), 2) : null,
      estimatedFcr: !allClosed && cs.length === 1 ? cs[0].summary.fcrEst : null
    };
    if (brief) return out;
    out.cycleDetails = cs;
    out.finance = this.financeSummary({ pocId: id });
    const ev = this.db.evidence.filter(e => !e.archived && e.links.some(l => (l.type === 'poc' && l.id === id) || (l.type === 'cycle' && p.cycleIds.includes(l.id))));
    out.evidenceCount = ev.length;
    out.completeness = this._completeness(p, cycles, ev, out.finance);
    return out;
  }

  _completeness(p, cycles, ev, fin) {
    const st = this.getState();
    const running = ['Running', 'Harvesting'].includes(p.status);
    const since = d => Date.now() - Date.parse(d) <= d2ms;
    let d2ms = 14 * DAY;
    const items = [];
    const add = (key, label, ok, applies = true) => { if (applies) items.push({ key, label, ok: !!ok }); };
    add('criteria', 'Success and failure criteria written', p.successCriteria && p.failureCriteria);
    add('cycle', 'Crop cycle linked', cycles.length > 0);
    add('stocking', 'Stocking count recorded', cycles.some(c => isNum(c.stockedCount)));
    add('stockingEvidence', 'PL purchase evidence (receipt / invoice) uploaded', ev.some(e => ['receipt', 'invoice'].includes(e.type)));
    const samples = cycles.flatMap(c => c.records.filter(r => r.type === 'sample'));
    add('samples', 'Weight sample in the last 14 days', samples.some(r => since(r.date)), running);
    d2ms = 7 * DAY;
    add('waterTests', 'Water test recorded in the last 7 days', st.waterLogs.some(w => w.pondId === p.pondId && since(w.ts)), running);
    const cal = st.calibrations.find(c => c.active && c.pondId === p.pondId);
    d2ms = 30 * DAY;
    add('calibration', 'pH probe calibrated in the last 30 days', cal && DATE_RE.test(cal.calibrationDate || '') && since(cal.calibrationDate), running);
    add('expenses', 'Approved expenses recorded', fin.approvedCount > 0);
    add('receipts', 'Every approved expense has a receipt or invoice', fin.approvedCount > 0 && fin.approvedWithoutEvidence === 0);
    const harvested = cycles.some(c => c.records.some(r => r.type === 'harvest'));
    add('harvestEvidence', 'Harvest weighing photo / video uploaded', ev.some(e => e.type === 'harvest_video' || e.type === 'shrimp_photo'), harvested);
    const ok = items.filter(i => i.ok).length;
    return { score: items.length ? Math.round(ok / items.length * 100) : null, items, missing: items.filter(i => !i.ok).map(i => i.label) };
  }

  // ================================================================== Finance
  _exp(id) { const e = this.db.expenses.find(x => x.id === id); if (!e) throw bad('Expense not found', 404); return e; }

  _expFields(b, existing) {
    const g = k => (b[k] !== undefined ? b[k] : existing?.[k]);
    const date = optDate(g('transactionDate'), 'Transaction date');
    if (!date) throw bad('Transaction date is required');
    const vendor = str(g('vendor'), 120); if (!vendor) throw bad('Vendor is required');
    const description = str(g('description'), 1000); if (!description) throw bad('Description is required');
    const nature = str(g('nature'), 10); if (!NATURES[nature]) throw bad('Choose OPEX, CAPEX, Deposit, Loan or Equity contribution');
    let category = str(g('category'), 60);
    if (['OPEX', 'CAPEX', 'DEPOSIT'].includes(nature)) { if (!CATEGORIES.includes(category)) throw bad('Choose a category'); } else category = category && CATEGORIES.includes(category) ? category : '';
    if (category === 'Land Deposit' && nature !== 'DEPOSIT') throw bad('A land deposit is refundable money held by the landlord: record it as Deposit, not as a cost.');
    const currency = str(g('currency'), 3) || 'MYR'; if (!CURRENCIES.includes(currency)) throw bad('Currency must be MYR, CNY, SGD or USD');
    const amountMinor = b.amount !== undefined ? toMinor(b.amount, 'Amount') : existing?.amountMinor;
    if (!amountMinor) throw bad('Amount is required');
    let exchangeRate = '1', rateSource = 'MYR (no conversion)';
    if (currency !== 'MYR') {
      exchangeRate = str(g('exchangeRate'), 20);
      if (!/^\d{1,6}(\.\d{1,6})?$/.test(exchangeRate) || Number(exchangeRate) <= 0) throw bad(`Enter the actual ${currency}→MYR rate used for this payment (from the bank statement or receipt). AQUA never assumes a rate.`);
      rateSource = str(g('rateSource'), 200);
      if (rateSource.length < 3) throw bad('Say where the exchange rate comes from (for example "Maybank statement 12 Nov")');
    }
    const fundingSource = str(g('fundingSource'), 30) || 'founder_personal'; if (!FUNDING[fundingSource]) throw bad('Unknown funding source');
    const paymentMethod = str(g('paymentMethod'), 20) || 'bank_transfer'; if (!PAY_METHODS.includes(paymentMethod)) throw bad('Unknown payment method');
    const id40 = (k, label) => { const v = str(g(k), 40); if (v && !ID_RE.test(v)) throw bad(`${label} has invalid characters`); return v || null; };
    const pocId = id40('pocId', 'POC ID'), cycleId = id40('cycleId', 'Cycle ID'), pondId = id40('pondId', 'Pond ID');
    const siteId = id40('siteId', 'Site ID') || this.getState().site.id;
    if (pocId && !this.db.pocs.some(p => p.id === pocId)) throw bad('That POC does not exist');
    if (cycleId && !this.getState().cycles.some(c => c.id === cycleId)) throw bad('That crop cycle does not exist');
    let usefulLifeMonths = g('usefulLifeMonths');
    usefulLifeMonths = usefulLifeMonths === '' || usefulLifeMonths === null || usefulLifeMonths === undefined ? null : Number(usefulLifeMonths);
    if (usefulLifeMonths !== null && !(Number.isInteger(usefulLifeMonths) && usefulLifeMonths >= 1 && usefulLifeMonths <= 600)) throw bad('Useful life must be 1 to 600 months');
    if (nature !== 'CAPEX') usefulLifeMonths = null;
    return {
      transactionDate: date, vendor, description, nature, category, currency, amountMinor, exchangeRate, rateSource,
      amountMYRMinor: Math.round(amountMinor * Number(exchangeRate)),
      fundingSource, paidBy: str(g('paidBy'), 80) || null, paymentMethod,
      siteId, pocId, cycleId, pondId, invoiceRef: str(g('invoiceRef'), 80) || null,
      usefulLifeMonths, inServiceDate: nature === 'CAPEX' ? (optDate(g('inServiceDate'), 'In-service date') || date) : null,
      notes: str(g('notes'), 2000)
    };
  }

  _duplicates(f, ignoreId) {
    const v = f.vendor.toLowerCase();
    return this.db.expenses.filter(e => e.id !== ignoreId && !e.voided && e.vendor.toLowerCase() === v && (
      (f.invoiceRef && e.invoiceRef && e.invoiceRef.toLowerCase() === f.invoiceRef.toLowerCase()) ||
      (e.amountMinor === f.amountMinor && e.currency === f.currency && Math.abs(dms(e.transactionDate) - dms(f.transactionDate)) <= 3 * DAY)
    )).map(e => ({ id: e.id, transactionDate: e.transactionDate, vendor: e.vendor, amount: fromMinor(e.amountMinor), currency: e.currency, invoiceRef: e.invoiceRef }));
  }

  createExpense(b, ctx) {
    const f = this._expFields(b || {});
    const dups = this._duplicates(f);
    if (dups.length && b.confirmDuplicate !== true) throw bad('This looks like an expense that is already recorded', 409, { duplicates: dups });
    const year = f.transactionDate.slice(0, 4);
    this.db.counters.exp[year] = (this.db.counters.exp[year] || 0) + 1;
    const id = `EXP-${year}-${String(this.db.counters.exp[year]).padStart(4, '0')}`;
    const e = {
      id, ...f, status: 'pending', paymentStatus: b.paid ? 'paid' : 'unpaid', paidDate: b.paid ? (optDate(b.paidDate, 'Paid date') || f.transactionDate) : null,
      voided: false, voidReason: null, duplicateConfirmed: dups.length > 0,
      createdAt: nowIso(), createdBy: ctx.user, updatedAt: nowIso(), updatedBy: ctx.user, approvedBy: null, approvedAt: null, selfApproved: false
    };
    this.db.expenses.push(e); this.save();
    this._log(ctx, 'expense.create', 'expense', id, null, e, dups.length ? 'confirmed possible duplicate of ' + dups.map(d => d.id).join(', ') : null);
    return this._expOut(e);
  }

  updateExpense(id, b, ctx) {
    const e = this._exp(id);
    if (e.voided) throw bad('A voided expense cannot be edited', 409);
    const reason = str(b?.reason, 500);
    if (e.status !== 'pending' && reason.length < 5) throw bad('This expense is already reviewed. Give a reason for the change (kept in the audit trail).', 400, { needsReason: true });
    const f = this._expFields(b || {}, e);
    const before = { ...e };
    const moneyChanged = f.amountMinor !== e.amountMinor || f.currency !== e.currency || f.exchangeRate !== e.exchangeRate;
    Object.assign(e, f, { updatedAt: nowIso(), updatedBy: ctx.user });
    if (moneyChanged && e.status === 'approved') { e.status = 'pending'; e.approvedBy = null; e.approvedAt = null; e.selfApproved = false; }
    this.save();
    this._log(ctx, 'expense.update', 'expense', id, before, e, reason || null, moneyChanged && before.status === 'approved' ? 'amount changed: approval withdrawn' : null);
    return this._expOut(e);
  }

  reviewExpense(id, decision, b, ctx) {
    const e = this._exp(id);
    if (e.voided) throw bad('Voided', 409);
    if (e.status !== 'pending') throw bad(`This expense is already ${e.status}`, 409);
    const self = e.createdBy === ctx.user;
    if (self && ctx.role !== 'founder') throw bad('You cannot approve an expense you entered yourself. Ask the founder or another finance user.', 403);
    const before = { status: e.status };
    e.status = decision === 'approve' ? 'approved' : 'rejected';
    e.approvedBy = ctx.user; e.approvedAt = nowIso(); e.selfApproved = self;
    e.reviewNote = str(b?.note, 500) || null;
    this.save();
    this._log(ctx, 'expense.' + (decision === 'approve' ? 'approve' : 'reject'), 'expense', id, before, { status: e.status, selfApproved: self }, e.reviewNote);
    return this._expOut(e);
  }

  markPaid(id, b, ctx) {
    const e = this._exp(id);
    if (e.voided) throw bad('Voided', 409);
    const before = { paymentStatus: e.paymentStatus, paidDate: e.paidDate };
    if (b?.paid === false) { e.paymentStatus = 'unpaid'; e.paidDate = null; }
    else { e.paymentStatus = 'paid'; e.paidDate = optDate(b?.paidDate, 'Paid date') || today(); }
    e.updatedAt = nowIso(); e.updatedBy = ctx.user; this.save();
    this._log(ctx, 'expense.payment', 'expense', id, before, { paymentStatus: e.paymentStatus, paidDate: e.paidDate });
    return this._expOut(e);
  }

  voidExpense(id, b, ctx) {
    const e = this._exp(id);
    const reason = str(b?.reason, 500);
    if (reason.length < 5) throw bad('Explain why this expense is voided');
    if (e.voided) return this._expOut(e);
    e.voided = true; e.voidReason = reason; e.voidedBy = ctx.user; e.voidedAt = nowIso(); this.save();
    this._log(ctx, 'expense.void', 'expense', id, { voided: false }, { voided: true }, reason);
    return this._expOut(e);
  }

  _expEvidence(id) { return this.db.evidence.filter(v => !v.archived && v.links.some(l => l.type === 'expense' && l.id === id)).map(v => v.id); }
  _expOut(e) { return { ...e, amount: fromMinor(e.amountMinor), amountMYR: fromMinor(e.amountMYRMinor), evidenceIds: this._expEvidence(e.id) }; }

  listExpenses(q = {}) {
    let list = this.db.expenses;
    if (q.pocId) { const p = this.db.pocs.find(x => x.id === q.pocId); list = list.filter(e => e.pocId === q.pocId || (p && e.cycleId && p.cycleIds.includes(e.cycleId))); }
    if (q.cycleId) list = list.filter(e => e.cycleId === q.cycleId);
    if (q.nature) list = list.filter(e => e.nature === q.nature);
    if (q.category) list = list.filter(e => e.category === q.category);
    if (q.status) list = list.filter(e => (q.status === 'void' ? e.voided : !e.voided && e.status === q.status));
    if (q.from) list = list.filter(e => e.transactionDate >= q.from);
    if (q.to) list = list.filter(e => e.transactionDate <= q.to);
    if (q.q) { const t = String(q.q).toLowerCase(); list = list.filter(e => (e.vendor + ' ' + e.description + ' ' + (e.invoiceRef || '') + ' ' + e.id).toLowerCase().includes(t)); }
    return [...list].sort((a, b) => b.transactionDate.localeCompare(a.transactionDate) || b.id.localeCompare(a.id)).map(e => this._expOut(e));
  }

  _period(scope) {
    const st = this.getState();
    if (scope.pocId) { const p = this._poc(scope.pocId); return [p.startDate, p.endDate]; }
    if (scope.cycleId) { const c = st.cycles.find(x => x.id === scope.cycleId); return c ? [c.startDate, c.endDate] : [null, null]; }
    return [scope.from || null, scope.to || null];
  }

  financeSummary(scope = {}) {
    const all = this.listExpenses({ pocId: scope.pocId, cycleId: scope.cycleId, from: scope.from, to: scope.to }).filter(e => !e.voided);
    const approved = all.filter(e => e.status === 'approved');
    const pending = all.filter(e => e.status === 'pending');
    const sum = (list, f = () => true) => list.filter(f).reduce((a, e) => a + e.amountMYRMinor, 0);
    const byNature = Object.fromEntries(Object.keys(NATURES).map(n => [n, fromMinor(sum(approved, e => e.nature === n))]));
    const byCategory = {};
    for (const e of approved.filter(x => x.nature === 'OPEX' || x.nature === 'CAPEX')) byCategory[e.category] = (byCategory[e.category] || 0) + e.amountMYRMinor;
    const byFunding = {};
    for (const e of approved.filter(x => ['OPEX', 'CAPEX', 'DEPOSIT'].includes(x.nature))) byFunding[e.fundingSource] = (byFunding[e.fundingSource] || 0) + e.amountMYRMinor;
    // straight-line depreciation of CAPEX inside the period, only for items with a useful life
    let [pStart, pEnd] = this._period(scope);
    pEnd = pEnd || today();
    let depMinor = 0;
    const capexNoLife = [];
    for (const e of approved.filter(x => x.nature === 'CAPEX')) {
      if (!e.usefulLifeMonths) { capexNoLife.push(e.id); continue; }
      const s = dms(e.inServiceDate || e.transactionDate), lifeDays = e.usefulLifeMonths * 30.4375;
      const from = Math.max(s, pStart ? dms(pStart) : s), to = Math.min(s + lifeDays * DAY, dms(pEnd) + DAY);
      if (to > from) depMinor += e.amountMYRMinor / lifeDays * ((to - from) / DAY);
    }
    depMinor = Math.round(depMinor);
    const opexMinor = sum(approved, e => e.nature === 'OPEX');
    // harvest weight: only closed, weighed cycles in scope count as verified production
    const st = this.getState();
    let cycles = [];
    if (scope.pocId) { const p = this._poc(scope.pocId); cycles = st.cycles.filter(c => p.cycleIds.includes(c.id)); }
    else if (scope.cycleId) cycles = st.cycles.filter(c => c.id === scope.cycleId);
    const closedHarvestKg = cycles.filter(c => c.status === 'closed').reduce((a, c) => a + c.records.filter(r => r.type === 'harvest' && isNum(r.kg)).reduce((x, r) => x + r.kg, 0), 0);
    const opCostMinor = opexMinor + depMinor;
    const costPerKg = closedHarvestKg > 0 ? round(opCostMinor / 100 / closedHarvestKg, 2) : null;
    return {
      scope, period: { from: pStart, to: pEnd }, currency: 'MYR',
      approvedCount: approved.length, pendingCount: pending.length,
      pendingMYR: fromMinor(sum(pending)),
      byNature, byCategory: Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, fromMinor(v)])),
      byFunding: Object.fromEntries(Object.entries(byFunding).map(([k, v]) => [k, fromMinor(v)])),
      operatingCostMYR: fromMinor(opexMinor), depreciationMYR: fromMinor(depMinor), capexMYR: byNature.CAPEX,
      depositsMYR: byNature.DEPOSIT, fundingReceivedMYR: fromMinor(sum(approved, e => e.nature === 'LOAN' || e.nature === 'EQUITY')),
      cashPaidMYR: fromMinor(sum(approved, e => e.paymentStatus === 'paid' && ['OPEX', 'CAPEX', 'DEPOSIT'].includes(e.nature))),
      unpaidMYR: fromMinor(sum(approved, e => e.paymentStatus !== 'paid' && ['OPEX', 'CAPEX', 'DEPOSIT'].includes(e.nature))),
      approvedWithoutEvidence: approved.filter(e => e.evidenceIds.length === 0).length,
      capexWithoutUsefulLife: capexNoLife,
      verifiedHarvestKg: closedHarvestKg > 0 ? round(closedHarvestKg, 2) : null,
      costPerKgMYR: costPerKg, breakEvenPriceMYR: costPerKg,
      revenueMYR: null, operatingProfitMYR: null, capitalRecoveryPct: null,
      notes: [
        'Only approved, non-voided expenses are counted. Pending entries are shown separately.',
        'Deposits, loans and equity contributions are not costs.',
        'CAPEX is not expensed at once: only straight-line depreciation inside the period counts toward operating cost, and only for items with a useful life.',
        costPerKg === null ? 'Cost per kg needs a closed crop cycle with a weighed harvest.' : 'Cost per kg = (operating expenses + depreciation) ÷ verified harvest kg.',
        'Revenue, profit and capital recovery need real sales records (Sales module, v2.1.1). They are not estimated.'
      ]
    };
  }

  expensesCsv(q) {
    const cols = ['id', 'transactionDate', 'vendor', 'description', 'nature', 'category', 'amount', 'currency', 'exchangeRate', 'rateSource', 'amountMYR',
      'fundingSource', 'paidBy', 'paymentMethod', 'paymentStatus', 'paidDate', 'status', 'approvedBy', 'selfApproved', 'voided', 'voidReason',
      'siteId', 'pocId', 'cycleId', 'pondId', 'invoiceRef', 'usefulLifeMonths', 'inServiceDate', 'evidenceIds', 'createdBy', 'createdAt', 'updatedBy', 'updatedAt'];
    const cell = v => { let s = Array.isArray(v) ? v.join(' ') : (v ?? '') + ''; if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return '\uFEFF' + [cols.join(',')].concat(this.listExpenses(q).map(e => cols.map(c => cell(e[c])).join(','))).join('\r\n');
  }

  // ================================================================== Evidence vault
  _ev(id) { const v = this.db.evidence.find(x => x.id === id); if (!v) throw bad('Evidence not found', 404); return v; }
  canSee(v, ctx, all) { return all || (!v.confidential) || v.uploadedBy === ctx.user; }

  _evMeta(m, existing) {
    const type = str(m.type ?? existing?.type, 30); if (!EVIDENCE_TYPES[type]) throw bad('Choose an evidence type');
    const title = str(m.title ?? existing?.title, 160); if (!title) throw bad('Give the evidence a short title');
    const links = [];
    for (const l of Array.isArray(m.links) ? m.links : existing?.links || []) {
      const t = str(l?.type, 10), id = str(l?.id, 40);
      if (!LINK_TYPES.includes(t) || !ID_RE.test(id)) throw bad('Invalid link');
      if (t === 'poc' && !this.db.pocs.some(p => p.id === id)) throw bad(`POC ${id} does not exist`);
      if (t === 'expense' && !this.db.expenses.some(p => p.id === id)) throw bad(`Expense ${id} does not exist`);
      if (t === 'cycle' && !this.getState().cycles.some(c => c.id === id)) throw bad(`Cycle ${id} does not exist`);
      links.push({ type: t, id });
    }
    const ot = str(m.originalTimestamp ?? existing?.originalTimestamp, 40);
    if (ot && Number.isNaN(Date.parse(ot))) throw bad('Original date / time is not valid');
    return {
      type, title, description: str(m.description ?? existing?.description, 2000), links,
      originalTimestamp: ot || null,
      confidential: m.confidential === undefined ? (existing ? existing.confidential : EVIDENCE_TYPES[type].confidential) : !!m.confidential
    };
  }

  _storeFile(buf, originalName) {
    if (!Buffer.isBuffer(buf) || !buf.length) throw bad('The file is empty');
    if (buf.length > MAX_FILE) throw bad('File is larger than 50 MB', 413);
    const name = str(originalName, 200).replace(/[\\/\x00-\x1f]/g, '_') || 'file';
    const ext = (name.match(/\.([A-Za-z0-9]{1,5})$/) || [])[1]?.toLowerCase() || '';
    const kind = sniff(buf, ext);
    if (!kind) throw bad('This file type is not accepted. Use PDF, JPG, PNG, WEBP, HEIC, MP4, MOV, CSV, TXT, XLSX or DOCX.', 415);
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    const now = new Date();
    const rel = path.join(String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0'), `${hash.slice(0, 16)}-${crypto.randomBytes(4).toString('hex')}.${kind.ext}`);
    const abs = path.join(this.evDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buf, { flag: 'wx' });
    return { file: rel, sha256: hash, size: buf.length, mime: kind.mime, ext: kind.ext, originalName: name };
  }

  createEvidence(buf, meta, ctx) {
    const m = this._evMeta(meta || {});
    const dup = this.db.evidence.find(v => v.versions.some(x => x.sha256 === crypto.createHash('sha256').update(buf || Buffer.alloc(0)).digest('hex')));
    const stored = this._storeFile(buf, meta?.originalName);
    this.db.counters.ev++;
    const id = 'EV-' + String(this.db.counters.ev).padStart(6, '0');
    const v = {
      id, ...m, archived: false, verification: 'unverified', reviewer: null, reviewedAt: null, reviewNote: null,
      versions: [{ v: 1, ...stored, uploadedAt: nowIso(), uploadedBy: ctx.user }],
      uploadedBy: ctx.user, uploadedAt: nowIso(), sameContentAs: dup ? dup.id : null
    };
    this.db.evidence.push(v); this.save();
    this._log(ctx, 'evidence.upload', 'evidence', id, null, { ...v, versions: v.versions.map(x => ({ v: x.v, sha256: x.sha256, size: x.size, mime: x.mime })) });
    return this._evOut(v);
  }

  addVersion(id, buf, meta, ctx) {
    const v = this._ev(id);
    if (v.archived) throw bad('Restore the evidence before adding a version', 409);
    const stored = this._storeFile(buf, meta?.originalName);
    const n = v.versions.length + 1;
    v.versions.push({ v: n, ...stored, uploadedAt: nowIso(), uploadedBy: ctx.user, note: str(meta?.note, 500) || null });
    const prevVerification = v.verification;
    v.verification = 'unverified'; v.reviewer = null; v.reviewedAt = null; this.save();
    this._log(ctx, 'evidence.version', 'evidence', id, { version: n - 1, verification: prevVerification }, { version: n, sha256: stored.sha256 }, str(meta?.note, 500) || null);
    return this._evOut(v);
  }

  updateEvidence(id, meta, ctx) {
    const v = this._ev(id);
    const before = { type: v.type, title: v.title, description: v.description, links: v.links, confidential: v.confidential, originalTimestamp: v.originalTimestamp };
    Object.assign(v, this._evMeta(meta || {}, v)); this.save();
    this._log(ctx, 'evidence.update', 'evidence', id, before, { type: v.type, title: v.title, description: v.description, links: v.links, confidential: v.confidential, originalTimestamp: v.originalTimestamp });
    return this._evOut(v);
  }

  verifyEvidence(id, b, ctx) {
    const v = this._ev(id);
    const status = str(b?.status, 20);
    if (!['verified', 'rejected', 'unverified'].includes(status)) throw bad('Status must be verified, rejected or unverified');
    if (status === 'verified' && v.uploadedBy === ctx.user && ctx.role !== 'founder') throw bad('Evidence must be verified by someone other than the uploader', 403);
    const before = { verification: v.verification };
    v.verification = status; v.reviewer = ctx.user; v.reviewedAt = nowIso(); v.reviewNote = str(b?.note, 1000) || null; this.save();
    this._log(ctx, 'evidence.verify', 'evidence', id, before, { verification: status, version: v.versions.length }, v.reviewNote);
    return this._evOut(v);
  }

  setArchived(id, archived, b, ctx) {
    const v = this._ev(id);
    const reason = str(b?.reason, 500);
    if (archived && reason.length < 5) throw bad('Explain why this evidence is archived');
    v.archived = archived; v.archiveReason = archived ? reason : null; this.save();
    this._log(ctx, archived ? 'evidence.archive' : 'evidence.restore', 'evidence', id, { archived: !archived }, { archived }, reason || null);
    return this._evOut(v);
  }

  _evOut(v) { const cur = v.versions.at(-1); return { ...v, versions: v.versions.map(({ file, ...x }) => x), current: (({ file, ...x }) => x)(cur) }; }

  listEvidence(q, ctx, all) {
    let list = this.db.evidence.filter(v => this.canSee(v, ctx, all));
    if (!q.archived) list = list.filter(v => !v.archived);
    if (q.type) list = list.filter(v => v.type === q.type);
    if (q.verification) list = list.filter(v => v.verification === q.verification);
    if (q.linkType && q.linkId) list = list.filter(v => v.links.some(l => l.type === q.linkType && l.id === q.linkId));
    if (q.q) { const t = String(q.q).toLowerCase(); list = list.filter(v => (v.id + ' ' + v.title + ' ' + v.description + ' ' + v.versions.at(-1).originalName).toLowerCase().includes(t)); }
    return [...list].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)).map(v => this._evOut(v));
  }

  evidenceFile(id, version, ctx, all) {
    const v = this._ev(id);
    if (!this.canSee(v, ctx, all)) throw bad('Evidence not found', 404);
    const ver = version ? v.versions.find(x => x.v === Number(version)) : v.versions.at(-1);
    if (!ver) throw bad('Version not found', 404);
    const abs = path.join(this.evDir, ver.file);
    if (!abs.startsWith(this.evDir + path.sep) || !fs.existsSync(abs)) throw bad('The stored file is missing. Restore it from a backup.', 410);
    return { abs, ver, ev: v };
  }

  checkIntegrity(id, ctx, all) {
    const v = this._ev(id);
    if (!this.canSee(v, ctx, all)) throw bad('Evidence not found', 404);
    return v.versions.map(ver => {
      const abs = path.join(this.evDir, ver.file);
      if (!fs.existsSync(abs)) return { v: ver.v, ok: false, problem: 'file missing' };
      const h = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
      return { v: ver.v, ok: h === ver.sha256, sha256: ver.sha256, now: h };
    });
  }

  evidenceIndexCsv(ctx, all) {
    const cols = ['id', 'type', 'title', 'version', 'originalName', 'sha256', 'size', 'mime', 'originalTimestamp', 'uploadedAt', 'uploadedBy', 'verification', 'reviewer', 'reviewedAt', 'confidential', 'archived', 'links'];
    const cell = v => { let s = (v ?? '') + ''; if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const rows = this.listEvidence({ archived: true }, ctx, all).map(v => {
      const c = v.current;
      return cols.map(k => cell(k === 'version' ? c.v : k === 'links' ? v.links.map(l => l.type + ':' + l.id).join(' ') :
        ['originalName', 'sha256', 'size', 'mime'].includes(k) ? c[k] : v[k])).join(',');
    });
    return '\uFEFF' + [cols.join(',')].concat(rows).join('\r\n');
  }

  meta() {
    return { pocStatuses: POC_STATUSES, pocFlow: POC_FLOW, natures: NATURES, categories: CATEGORIES, funding: FUNDING, paymentMethods: PAY_METHODS,
      currencies: CURRENCIES, evidenceTypes: EVIDENCE_TYPES, linkTypes: LINK_TYPES, maxFileMB: MAX_FILE / 1048576 };
  }
}

module.exports = { Business, sniff, toMinor, fromMinor, SCHEMA_VERSION };
