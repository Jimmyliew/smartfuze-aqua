'use strict';
/**
 * SMARTFUZE AQUA v2.1.0 - automated tests.
 *   npm install          (once, installs the test-only "mqtt" package)
 *   npm test
 * Starts real AQUA servers on temporary data folders and ports, then exercises the API,
 * MQTT and WebSocket. Nothing touches your real data folder.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const aq = require(path.join(ROOT, 'lib', 'aquaculture'));
const { toMinor, sniff } = require(path.join(ROOT, 'lib', 'business'));

let pass = 0, failN = 0; const fails = [];
function t(name, ok, info) {
  if (ok) { pass++; console.log('  \u2713 ' + name); }
  else { failN++; fails.push(name); console.log('  \u2717 ' + name + (info !== undefined ? '  -> ' + JSON.stringify(info).slice(0, 300) : '')); }
}
const section = s => console.log('\n' + s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tmp = name => fs.mkdtempSync(path.join(os.tmpdir(), 'aqua-test-' + name + '-'));
let portBase = 34000 + Math.floor(Math.random() * 2000);

async function startServer(dataDir, env = {}) {
  const http = ++portBase, mqtt = ++portBase;
  const p = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: { ...process.env, AQUA_DATA_DIR: dataDir, AQUA_HTTP_PORT: String(http), AQUA_MQTT_PORT: String(mqtt), AQUA_HTTP_HOST: '127.0.0.1', AQUA_MQTT_HOST: '127.0.0.1', ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = ''; p.stdout.on('data', d => (log += d)); p.stderr.on('data', d => (log += d));
  for (let i = 0; i < 60; i++) {
    await sleep(150);
    try { const r = await fetch(`http://127.0.0.1:${http}/api/auth/status`); if (r.ok) break; } catch (_) {}
  }
  return { proc: p, http, mqtt, base: `http://127.0.0.1:${http}`, log: () => log, stop: () => new Promise(r => { p.on('exit', r); p.kill('SIGTERM'); }) };
}
function client(base) {
  let cookie = '';
  const call = async (method, p, body, extra = {}) => {
    const headers = { 'X-AQUA': '1', ...(cookie ? { cookie } : {}), ...(extra.headers || {}) };
    let payload;
    if (Buffer.isBuffer(body)) { payload = body; headers['Content-Type'] = 'application/octet-stream'; }
    else if (body !== undefined) { payload = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
    if (extra.noCsrf) delete headers['X-AQUA'];
    const r = await fetch(base + '/api' + p, { method, headers, body: payload });
    const sc = r.headers.get('set-cookie'); if (sc && sc.startsWith('aqua_session=')) cookie = sc.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer());
    return { s: r.status, j: data, h: r.headers };
  };
  return {
    get: (p, e) => call('GET', p, undefined, e), post: (p, b, e) => call('POST', p, b, e), put: (p, b, e) => call('PUT', p, b, e), del: (p, e) => call('DELETE', p, undefined, e),
    login: async (u, pw) => (await call('POST', '/auth/login', { username: u, password: pw })).s,
    upload: (p, buf, meta) => call('POST', p, buf, { headers: { 'X-Evidence-Meta': Buffer.from(JSON.stringify(meta)).toString('base64') } }),
    cookie: () => cookie
  };
}
function adminTool(dataDir, args, env = {}) {
  return new Promise(res => {
    const p = spawn(process.execPath, [path.join(ROOT, 'tools', 'admin.js'), ...args], { env: { ...process.env, AQUA_DATA_DIR: dataDir, ...env } });
    let out = ''; p.stdout.on('data', d => (out += d)); p.on('exit', () => res(out.trim()));
  });
}
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), crypto.randomBytes(64)]);
const PDF = Buffer.from('%PDF-1.4\n% receipt\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF');

async function main() {
  // ------------------------------------------------------------ unit: calculations
  section('Crop cycle calculations');
  const base = { startDate: '2026-09-01', stockedCount: 10000, initialWeightG: 0.01, status: 'active' };
  let s = aq.cycleSummary({ ...base, records: [{ type: 'mortality', count: 300 }, { type: 'feed', kg: 50 }, { type: 'sample', date: '2026-10-01', avgWeightG: 8 }] }, 10, Date.parse('2026-10-02'));
  t('estimated survival from counted deaths only (97 %)', s.survivalEstPct === 97);
  t('verified survival not invented while cycle runs', s.survivalPct === null);
  t('estimated FCR = feed / (biomass - initial biomass)', s.fcrEst === aq.round(50 / (9700 * 8 / 1000 - 0.1), 2), s.fcrEst);
  s = aq.cycleSummary({ ...base, records: [{ type: 'mortality', count: 500 }, { type: 'feed', kg: 120 }, { type: 'sample', date: '2026-10-20', avgWeightG: 15 }, { type: 'harvest', date: '2026-10-21', kg: 60, count: 4000 }] }, 10);
  t('partial harvest removes harvested shrimp from tank estimate', s.aliveEst === 5500, s.aliveEst);
  t('partial harvest gives no final FCR / verified survival', s.fcr === null && s.survivalPct === null);
  s = aq.cycleSummary({ ...base, records: [{ type: 'harvest', date: '2026-10-21', kg: 60 }] }, 10);
  t('harvest without a count -> remaining shrimp unknown, no guess', s.aliveEst === null && s.remainingUnknown === true && s.fcrEst === null);
  s = aq.cycleSummary({ ...base, status: 'closed', endDate: '2026-11-30', records: [{ type: 'feed', kg: 200 }, { type: 'harvest', date: '2026-11-30', kg: 150, count: 7500 }] }, 10);
  t('closed + counted harvest -> verified survival 75 %', s.survivalPct === 75);
  t('final FCR subtracts initial biomass', s.fcr === aq.round(200 / (150 - 0.1), 2), s.fcr);
  s = aq.cycleSummary({ ...base, status: 'closed', endDate: '2026-11-30', records: [{ type: 'harvest', date: '2026-11-30', kg: 150 }] }, 10);
  t('closed harvest without count -> survival stays unknown', s.survivalPct === null);
  t('money in sen: 0.1 + 0.2 handled exactly', toMinor('0.1', 'a') + toMinor('0.2', 'b') === 30);
  t('NH3 fraction at pH 8, 28 °C about 6.5 %', Math.abs(aq.nh3Fraction(8, 28) - 0.065) < 0.003);

  section('File type detection (evidence uploads)');
  t('PNG accepted by content', sniff(PNG, 'png')?.mime === 'image/png');
  t('PDF accepted by content', sniff(PDF, 'pdf')?.mime === 'application/pdf');
  t('HTML renamed to .png refused', sniff(Buffer.from('<html><script>alert(1)</script></html>'), 'png') === null);
  t('SVG refused (can carry scripts)', sniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'), 'svg') === null);
  t('plain zip refused, xlsx zip accepted', sniff(Buffer.from([0x50, 0x4B, 3, 4, 0, 0]), 'zip') === null && !!sniff(Buffer.from([0x50, 0x4B, 3, 4, 0, 0]), 'xlsx'));
  t('CSV with embedded script refused', sniff(Buffer.from('a,b\n<script>x</script>'), 'csv') === null);

  // ------------------------------------------------------------ migration from v2.0.3
  section('Upgrade from v2.0.3 data');
  const cdir = tmp('cloud');
  await adminTool(cdir, ['set-password', 'admin'], { AQUA_NEW_PASSWORD: 'correct-horse-1' });
  const st = JSON.parse(fs.readFileSync(path.join(cdir, 'state.json'), 'utf8'));
  delete st.auth.users[0].role;
  st.auth.sessions.push({ hash: 'x'.repeat(64), username: 'admin', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 90 * 86400000).toISOString() });
  st.cycles.push({ id: 'cyc-old', pondId: 'POND-A', status: 'active', startDate: '2026-10-01', stockedCount: 4000, initialWeightG: 0.01, records: [{ id: 'r1', type: 'feed', date: '2026-10-05', kg: 5 }] });
  const calBefore = JSON.stringify(st.calibrations);
  fs.writeFileSync(path.join(cdir, 'state.json'), JSON.stringify(st, null, 2));
  const cloud = await startServer(cdir, { AQUA_MODE: 'cloud' });
  const st2 = JSON.parse(fs.readFileSync(path.join(cdir, 'state.json'), 'utf8'));
  t('state.json backed up before migration', fs.existsSync(path.join(cdir, 'state.json.pre-2.1.0-backup')));
  t('existing account became founder', st2.auth.users[0].role === 'founder');
  t('old 90-day session capped to 14 days', Date.parse(st2.auth.sessions.at(-1).expiresAt) <= Date.now() + 14 * 86400000 + 5000);
  t('crop cycles and calibration kept', st2.cycles.some(c => c.id === 'cyc-old') && JSON.stringify(st2.calibrations) === calBefore);
  t('business.json created with schema version', JSON.parse(fs.readFileSync(path.join(cdir, 'business.json'), 'utf8')).schemaVersion === 1);

  // ------------------------------------------------------------ RBAC
  section('Roles and access control (cloud mode)');
  const anon = client(cloud.base);
  t('no session -> 401 on finance', (await anon.get('/finance/expenses')).s === 401);
  t('no session -> 401 on monitoring', (await anon.get('/ponds')).s === 401);
  const F = client(cloud.base);
  t('founder signs in', (await F.login('admin', 'correct-horse-1')) === 200);
  t('state change without X-AQUA header refused (CSRF)', (await F.post('/poc', { name: 'x', pondId: 'POND-A' }, { noCsrf: true })).s === 403);
  const users = {};
  for (const role of ['admin', 'operator', 'advisor', 'auditor', 'investor']) {
    const r = await F.post('/users', { username: 'u-' + role, role });
    users[role] = client(cloud.base);
    t(`founder creates ${role} (temp password shown once)`, r.s === 201 && r.j.tempPassword?.length >= 14 && (await users[role].login('u-' + role, r.j.tempPassword)) === 200, r.j);
  }
  const expect = async (who, method, p, body, want) => { const r = await users[who][method](p, body); return want.includes(r.s) ? true : r.s; };
  const matrix = [
    ['investor', 'get', '/info', undefined, [403]], ['investor', 'get', '/finance/expenses', undefined, [403]], ['investor', 'get', '/evidence', undefined, [403]],
    ['investor', 'get', '/devices/credentials', undefined, [403]], ['investor', 'get', '/settings/full', undefined, [403]],
    ['advisor', 'get', '/finance/expenses', undefined, [403]], ['advisor', 'get', '/ponds', undefined, [200]], ['advisor', 'get', '/poc', undefined, [200]],
    ['advisor', 'post', '/water', { pondId: 'POND-A', tanMgL: 0.5 }, [201]],
    ['operator', 'get', '/devices/credentials', undefined, [403]], ['operator', 'get', '/backup', undefined, [403]], ['operator', 'get', '/audit', undefined, [403]],
    ['operator', 'put', '/settings', { siteName: 'x' }, [403]], ['operator', 'post', '/poc', { name: 'x', pondId: 'POND-A' }, [403]],
    ['auditor', 'get', '/finance/expenses', undefined, [200]], ['auditor', 'get', '/audit', undefined, [200]],
    ['auditor', 'post', '/finance/expenses', { vendor: 'x' }, [403]], ['auditor', 'post', '/water', { pondId: 'POND-A', tanMgL: 1 }, [403]],
    ['admin', 'get', '/users', undefined, [403]], ['admin', 'get', '/backup', undefined, [403]], ['admin', 'get', '/devices/credentials', undefined, [403]],
    ['admin', 'get', '/finance/expenses', undefined, [200]]
  ];
  for (const [who, m, p, b, want] of matrix) { const r = await expect(who, m, p, b, want); t(`${who} ${m.toUpperCase()} ${p} -> ${want.join('/')}`, r === true, r); }
  const WS = require(path.join(ROOT, 'node_modules', 'ws'));
  const wsTry = c => new Promise(res => { const w = new WS(cloud.base.replace('http', 'ws') + '/ws', { headers: c.cookie() ? { cookie: c.cookie() } : {} }); w.on('message', () => { res('open'); w.close(); }); w.on('unexpected-response', () => res('rejected')); w.on('error', () => res('rejected')); });
  t('investor cannot open the live data WebSocket', (await wsTry(users.investor)) === 'rejected');
  t('operator can open the live data WebSocket', (await wsTry(users.operator)) === 'open');
  const dis = await F.put('/users/u-operator', { disabled: true });
  t('disabled user is signed out immediately', dis.s === 200 && (await users.operator.get('/ponds')).s === 401);
  t('founder cannot remove own founder role', (await F.put('/users/admin', { role: 'admin' })).s === 400);
  t('weak password refused', (await F.post('/users', { username: 'weak', role: 'operator', password: 'short1' })).s === 400);

  // ------------------------------------------------------------ POC
  section('POC research');
  const cyc = await F.post('/cycles', { pondId: 'POND-A', startDate: '2026-11-01', stockedCount: 5000, initialWeightG: 0.005 });
  // cycles API refuses a second active cycle in the same pond; use the migrated one
  let p1 = await F.post('/poc', { name: 'Low-salinity RAS density test', pondId: 'POND-A', objectives: 'Prove 300 PL/m3 is viable' });
  t('POC-001 created as Draft', p1.s === 201 && p1.j.id === 'POC-001' && p1.j.status === 'Draft', p1.j);
  t('cannot skip from Draft to Running', (await F.post('/poc/POC-001/status', { status: 'Running' })).s === 409);
  await F.post('/poc/POC-001/status', { status: 'Preparing' });
  t('cannot start without success / failure criteria', (await F.post('/poc/POC-001/status', { status: 'Running' })).s === 409);
  await F.put('/poc/POC-001', { successCriteria: 'Verified survival >= 70 %, FCR <= 1.4', failureCriteria: 'Survival < 50 %', hypothesis: 'RAS keeps TAN < 1 mg/L' });
  const run = await F.post('/poc/POC-001/status', { status: 'Running' });
  t('POC starts and criteria are locked', run.s === 200 && !!run.j.criteriaLockedAt);
  t('changing locked criteria without a reason refused', (await F.put('/poc/POC-001', { successCriteria: 'Survival >= 60 %' })).s === 400);
  const ch = await F.put('/poc/POC-001', { successCriteria: 'Survival >= 60 %', reason: 'Advisor: first RAS cycle, lower target agreed' });
  t('change with reason kept in criteria history (old value preserved)', ch.s === 200 && ch.j.criteriaChanges.at(-1).old.includes('70 %'));
  t('link migrated crop cycle', (await F.post('/poc/POC-001/cycles', { cycleId: 'cyc-old' })).s === 200);
  await F.post('/poc', { name: 'Second trial', pondId: 'POND-A' });
  t('same cycle cannot be counted in a second POC', (await F.post('/poc/POC-002/cycles', { cycleId: 'cyc-old' })).s === 409);
  const sum = (await F.get('/poc/POC-001')).j.summary;
  t('POC summary: no harvest -> harvest, verified survival, final FCR, cost/kg all null', sum.harvestKg === null && sum.verifiedSurvivalPct === null && sum.finalFcr === null && sum.finance.costPerKgMYR === null, sum);
  t('POC completeness lists what is missing', sum.completeness.score < 100 && sum.completeness.missing.length > 0);
  t('failing a POC needs a reason', (await F.post('/poc/POC-002/status', { status: 'Cancelled' })).s === 400);
  await F.post('/poc/POC-002/status', { status: 'Cancelled', note: 'Merged into POC-001' });
  t('cancelled POC stays in the list', (await F.get('/poc')).j.some(p => p.id === 'POC-002' && p.status === 'Cancelled'));
  t('advisor can review a POC', (await users.advisor.post('/poc/POC-001/reviews', { decision: 'comment', note: 'Check alkalinity daily during week 1' })).s === 200);

  // ------------------------------------------------------------ finance
  section('Finance');
  const e1 = await F.post('/finance/expenses', { transactionDate: '2026-11-02', vendor: 'Agro Feed Sdn Bhd', description: 'Starter feed 25 kg', nature: 'OPEX', category: 'Feed', amount: '1234.56', pocId: 'POC-001', invoiceRef: 'INV-77' });
  t('expense recorded, MYR amount exact', e1.s === 201 && e1.j.amountMYR === 1234.56 && e1.j.status === 'pending', e1.j);
  t('foreign currency without the real rate refused', (await F.post('/finance/expenses', { transactionDate: '2026-11-02', vendor: 'Ali', description: 'Sensor', nature: 'CAPEX', category: 'Sensors', amount: '100', currency: 'USD' })).s === 400);
  const e2 = await F.post('/finance/expenses', { transactionDate: '2026-11-03', vendor: 'DFRobot', description: 'pH probe', nature: 'CAPEX', category: 'Sensors', amount: '100', currency: 'USD', exchangeRate: '4.4567', rateSource: 'Maybank card statement', usefulLifeMonths: 12, pocId: 'POC-001' });
  t('USD converted with the given rate (445.67 MYR)', e2.s === 201 && e2.j.amountMYR === 445.67, e2.j);
  const dup = await F.post('/finance/expenses', { transactionDate: '2026-11-03', vendor: 'agro feed sdn bhd', description: 'Feed again?', nature: 'OPEX', category: 'Feed', amount: '1234.56' });
  t('possible duplicate detected (same vendor + amount within 3 days)', dup.s === 409 && dup.j.duplicates?.[0]?.id === e1.j.id, dup.j);
  t('duplicate can be confirmed deliberately', (await F.post('/finance/expenses', { transactionDate: '2026-11-03', vendor: 'Agro Feed Sdn Bhd', description: 'Second bag, separate order', nature: 'OPEX', category: 'Feed', amount: '1234.56', confirmDuplicate: true })).s === 201);
  t('land deposit cannot be recorded as a cost', (await F.post('/finance/expenses', { transactionDate: '2026-11-01', vendor: 'Landlord', description: 'Deposit', nature: 'OPEX', category: 'Land Deposit', amount: '3000' })).s === 400);
  const dep = await F.post('/finance/expenses', { transactionDate: '2026-11-01', vendor: 'Landlord', description: 'Land deposit 2 months', nature: 'DEPOSIT', category: 'Land Deposit', amount: '3000', pocId: 'POC-001' });
  const adm = users.admin;
  const ae = await adm.post('/finance/expenses', { transactionDate: '2026-11-04', vendor: 'TNB', description: 'Electricity Oct', nature: 'OPEX', category: 'Electricity', amount: '210.40', pocId: 'POC-001' });
  t('finance admin cannot approve own expense', (await adm.post(`/finance/expenses/${ae.j.id}/approve`, {})).s === 403);
  for (const id of [e1.j.id, e2.j.id, dep.j.id, ae.j.id]) await F.post(`/finance/expenses/${id}/approve`, {});
  t('founder self-approval is flagged', (await F.get('/finance/expenses')).j.find(e => e.id === e1.j.id).selfApproved === true);
  t('editing an approved expense needs a reason', (await F.put(`/finance/expenses/${e1.j.id}`, { amount: '1200.00' })).s === 400);
  const ed = await F.put(`/finance/expenses/${e1.j.id}`, { amount: '1200.00', reason: 'Supplier credit note CN-12' });
  t('amount change withdraws approval', ed.s === 200 && ed.j.status === 'pending');
  await F.post(`/finance/expenses/${e1.j.id}/approve`, {});
  t('void needs a reason; voided records stay', (await F.post(`/finance/expenses/${ae.j.id}/void`, {})).s === 400 && (await F.post(`/finance/expenses/${ae.j.id}/void`, { reason: 'Entered twice' })).j.voided === true);
  const fsum = (await F.get('/finance/summary?pocId=POC-001')).j;
  t('operating cost = approved non-void OPEX only (1200.00)', fsum.operatingCostMYR === 1200, fsum);
  t('deposit kept out of operating cost (3000 shown separately)', fsum.depositsMYR === 3000);
  t('CAPEX not expensed at once (depreciation < CAPEX)', fsum.capexMYR === 445.67 && fsum.depreciationMYR < fsum.capexMYR, [fsum.capexMYR, fsum.depreciationMYR]);
  t('no sales -> revenue and profit not shown', fsum.revenueMYR === null && fsum.operatingProfitMYR === null);
  t('no closed harvest -> cost per kg not invented', fsum.costPerKgMYR === null);
  const csv = await F.get('/finance/expenses.csv');
  t('CSV export (UTF-8 BOM for Excel) includes all expenses incl. voided', csv.s === 200 && csv.j.toString('utf8').startsWith('\uFEFF') && csv.j.toString().includes(ae.j.id));
  const formula = await F.post('/finance/expenses', { transactionDate: '2026-11-05', vendor: '=HYPERLINK("x")', description: 'test', nature: 'OPEX', category: 'Miscellaneous', amount: '1' });
  t('CSV neutralises spreadsheet formulas', (await F.get('/finance/expenses.csv')).j.toString().includes("'=HYPERLINK") && formula.s === 201);

  // ------------------------------------------------------------ evidence
  section('Evidence vault');
  const up = await F.upload('/evidence', PDF, { type: 'receipt', title: 'Feed receipt INV-77', originalName: '../../etc/passwd.pdf', links: [{ type: 'expense', id: e1.j.id }, { type: 'poc', id: 'POC-001' }] });
  t('PDF receipt stored with SHA-256', up.s === 201 && up.j.current.sha256 === crypto.createHash('sha256').update(PDF).digest('hex'), up.j);
  t('original file name cannot escape the storage folder', !up.j.current.originalName.includes('/'));
  t('receipt is confidential by default', up.j.confidential === true);
  t('HTML disguised as PNG refused (415)', (await F.upload('/evidence', Buffer.from('<html><script>alert(1)</script>'), { type: 'pond_photo', title: 'x', originalName: 'x.png' })).s === 415);
  const photo = await users.advisor.upload('/evidence', PNG, { type: 'pond_photo', title: 'Tank 1 day 3', originalName: 'tank.png', links: [{ type: 'poc', id: 'POC-001' }] });
  t('advisor uploads a pond photo', photo.s === 201);
  t('expense now has evidence attached', (await F.get('/finance/expenses')).j.find(e => e.id === e1.j.id).evidenceIds.includes(up.j.id));
  t('download without session -> 401', (await anon.get(`/evidence/${up.j.id}/file`)).s === 401);
  t('advisor cannot see confidential receipt', (await users.advisor.get(`/evidence/${up.j.id}/file`)).s === 404);
  t('investor cannot list evidence', (await users.investor.get('/evidence')).s === 403);
  const dl = await F.get(`/evidence/${up.j.id}/file`);
  t('download is an attachment with nosniff + sandbox CSP', dl.s === 200 && /attachment/.test(dl.h.get('content-disposition')) && dl.h.get('x-content-type-options') === 'nosniff' && /sandbox/.test(dl.h.get('content-security-policy')));
  t('downloaded bytes identical', Buffer.compare(dl.j, PDF) === 0);
  t('uploader (advisor) cannot verify own evidence', (await users.advisor.post(`/evidence/${photo.j.id}/verify`, { status: 'verified' })).s === 403);
  t('founder verifies evidence', (await F.post(`/evidence/${photo.j.id}/verify`, { status: 'verified', note: 'Matches site visit' })).j.verification === 'verified');
  const v2 = await F.upload(`/evidence/${photo.j.id}/versions`, Buffer.concat([PNG, Buffer.from([1])]), { originalName: 'tank-v2.png', note: 'clearer photo' });
  t('new version keeps v1 and resets verification', v2.s === 201 && v2.j.versions.length === 2 && v2.j.verification === 'unverified');
  t('integrity check passes', (await F.get(`/evidence/${up.j.id}/check`)).j.every(x => x.ok));
  const bdb = JSON.parse(fs.readFileSync(path.join(cdir, 'business.json'), 'utf8'));
  const f1 = path.join(cdir, 'evidence', bdb.evidence.find(v => v.id === up.j.id).versions[0].file);
  const orig = fs.readFileSync(f1); fs.writeFileSync(f1, Buffer.concat([orig, Buffer.from('tampered')]));
  t('changed file on disk detected by SHA-256 check', (await F.get(`/evidence/${up.j.id}/check`)).j[0].ok === false);
  fs.writeFileSync(f1, orig);
  t('archive needs a reason; archived evidence hidden but kept', (await F.post(`/evidence/${photo.j.id}/archive`, {})).s === 400 && (await F.post(`/evidence/${photo.j.id}/archive`, { reason: 'Wrong tank' })).j.archived === true && (await F.get('/evidence?archived=1')).j.some(v => v.id === photo.j.id));
  t('evidence folder is not reachable as a static URL', (await fetch(cloud.base + '/evidence/' + bdb.evidence[0].versions[0].file)).headers.get('content-type')?.includes('text/html'));

  // ------------------------------------------------------------ audit
  section('Audit trail');
  const hist = (await F.get(`/audit?entity=expense&entityId=${e1.j.id}`)).j;
  const upd = hist.find(h => h.action === 'expense.update');
  t('expense edit kept old and new amount, who and why', upd && upd.before.amountMinor === 123456 && upd.after.amountMinor === 120000 && upd.actor === 'admin' && /credit note/.test(upd.reason), upd);
  t('failed login recorded', (await anon.post('/auth/login', { username: 'admin', password: 'nope' })).s === 401 && (await F.get('/audit?action=auth.login_failed')).j.length > 0);
  t('password hashes never written to the audit log', !fs.readdirSync(path.join(cdir, 'audit')).some(f => /"salt":"[0-9a-f]{16}/.test(fs.readFileSync(path.join(cdir, 'audit', f), 'utf8'))));
  t('audit chain verifies', (await F.get('/audit/verify')).j.ok === true);
  const af = path.join(cdir, 'audit', fs.readdirSync(path.join(cdir, 'audit'))[0]);
  const atext = fs.readFileSync(af, 'utf8'); fs.writeFileSync(af, atext.replace('"Entered twice"', '"Something else"'));
  const ver = (await F.get('/audit/verify')).j;
  t('edited audit line detected', ver.ok === false, ver);
  fs.writeFileSync(af, atext);

  // ------------------------------------------------------------ backup / restore
  section('Backup and restore');
  const bk = await F.get('/backup');
  t('backup (founder) contains monitoring + business records', bk.s === 200 && bk.j.state && bk.j.business?.expenses?.length >= 4);
  await cloud.stop();
  const rdir = tmp('restore');
  fs.cpSync(cdir, rdir, { recursive: true });
  const restored = await startServer(rdir, { AQUA_MODE: 'cloud' });
  const R = client(restored.base); await R.login('admin', 'correct-horse-1');
  const nExp = bk.j.business.expenses.length;
  t(`restored copy starts with the same ${nExp} expenses`, (await R.get('/finance/expenses')).j.length === nExp);
  t('restored evidence files pass integrity check', (await R.get(`/evidence/${up.j.id}/check`)).j.every(x => x.ok));
  t('restored audit chain verifies', (await R.get('/audit/verify')).j.ok === true);
  await restored.stop();

  // ------------------------------------------------------------ local mode + regression
  section('Local mode, MQTT, alerts and feeding interlock (regression)');
  const ldir = tmp('local');
  const local = await startServer(ldir);
  const L = client(local.base);
  t('local monitoring still open on the farm network', (await L.get('/ponds')).s === 200);
  t('local business data needs sign-in', (await L.get('/finance/expenses')).s === 401);
  t('local backup needs sign-in (contains business data)', (await L.get('/backup')).s === 401);
  const stt = (await L.get('/auth/status')).j;
  t('first founder can be created from the AQUA computer', stt.canSetup === true && (await L.post('/auth/setup', { username: 'jimmy', password: 'shrimp-farm-2026' })).s === 201);
  t('second setup refused', (await client(local.base).post('/auth/setup', { username: 'x', password: 'shrimp-farm-2026' })).s === 409);
  t('signed-in founder sees finance locally', (await L.get('/finance/expenses')).s === 200);
  const mqtt = require('mqtt');
  const dev = await new Promise(res => { const c = mqtt.connect(`mqtt://127.0.0.1:${local.mqtt}`, { clientId: 'AQUA-POND-A-01', reconnectPeriod: 0 }); c.on('connect', () => res(c)); });
  const telem = o => dev.publish('aqua/site/SITE-01/pond/POND-A/telemetry', JSON.stringify({ deviceId: 'AQUA-POND-A-01', pondName: 'Pond A', temperatureC: 28.5, phRaw: 1440, ph: 7.8, phVoltage: 1.16, rssi: -55, uptimeSec: 5, firmwareVersion: '2.0.3', ...o }));
  telem({}); await sleep(500);
  let ponds = (await L.get('/ponds')).j;
  t('ESP32 telemetry (2.0.3 topic) creates Pond A online', ponds[0]?.id === 'POND-A' && ponds[0].online === true, ponds);
  dev.publish('aqua/pond/POND-A/telemetry', JSON.stringify({ deviceId: 'AQUA-POND-A-01', temperatureC: 28.6, phRaw: 1440 })); await sleep(300);
  t('older firmware topic still accepted', (await L.get('/ponds')).j[0].latest.temperatureC === 28.6);
  telem({ temperatureC: -127 }); await sleep(300);
  t('-127 °C never stored as a temperature', (await L.get('/ponds')).j[0].latest.temperatureC === null);
  await L.put('/alerts/rules/pump-stopped', { sustainSec: 0 });
  telem({ flowLpm: 0, pumpRunning: false }); await sleep(500);
  const al = (await L.get('/alerts')).j.alerts.find(a => a.ruleId === 'pump-stopped' && !a.resolvedAt);
  t('pump stopped -> critical alert (life-support monitoring intact)', !!al);
  const fd = await L.post('/integrations', { provider: 'mqtt', name: 'Feeder', category: 'feeder', mode: 'mqtt', pondId: 'POND-A' });
  t('feeding blocked by interlock during critical alert', (await L.post('/feeding/feed', { pondId: 'POND-A', integrationId: fd.j.id, durationSec: 5 })).s === 409);
  t('monitoring change written to audit trail', (await L.get('/audit?entity=monitoring')).j.some(a => a.entityId === '/alerts/rules/pump-stopped'));
  const wsL = await new Promise(res => { const w = new WS(local.base.replace('http', 'ws') + '/ws'); w.on('message', m => { res(JSON.parse(m).type); w.close(); }); w.on('error', () => res('error')); });
  t('local WebSocket still works without sign-in', wsL === 'hello');
  dev.end(true);
  const page = await fetch(local.base + '/');
  t('dashboard page served with CSP header', page.status === 200 && /default-src 'self'/.test(page.headers.get('content-security-policy')));
  t('PWA files served', (await fetch(local.base + '/sw.js')).status === 200 && (await fetch(local.base + '/manifest.webmanifest')).status === 200);
  await local.stop();

  console.log(`\n${pass} passed, ${failN} failed`);
  if (failN) { console.log('FAILED: ' + fails.join(' | ')); process.exit(1); }
}
main().catch(e => { console.error(e); process.exit(1); });
