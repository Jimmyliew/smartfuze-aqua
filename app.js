/* SMARTFUZE AQUA v2.0.0 - dashboard
 * Displays only what the server has received from real hardware.
 * When there is nothing real to show, it says so ("—", "Waiting for real hardware").
 */
'use strict';
(() => {
  // ------------------------------------------------------------ utilities
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isNum = v => typeof v === 'number' && Number.isFinite(v);
  const fmt = (v, d = 2) => (isNum(v) ? v.toFixed(d) : '—');
  const DASH = '—';

  function rel(ts) {
    if (!ts) return DASH;
    const s = Math.max(0, Math.round((Date.now() - Date.parse(ts)) / 1000));
    if (s < 10) return 'just now';
    if (s < 60) return s + ' s ago';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ' + Math.floor((s % 3600) / 60) + ' min ago';
    return Math.floor(s / 86400) + ' d ago';
  }
  const clock = ts => (ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : DASH);
  const dateTime = ts => (ts ? new Date(ts).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : DASH);
  function uptime(sec) {
    if (!isNum(sec)) return DASH;
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    return (d ? d + 'd ' : '') + (d || h ? h + 'h ' : '') + m + 'm';
  }
  function rssiLabel(r) {
    if (!isNum(r)) return DASH;
    const q = r > -60 ? 'strong' : r > -72 ? 'good' : r > -82 ? 'weak' : 'poor';
    return r + ' dBm, ' + q;
  }

  const I = (name, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  const ICONS = {
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>',
    ponds: '<path d="M2 8c2.5 2 5 2 7.5 0s5-2 7.5 0 3.5 2 5 1"/><path d="M2 13c2.5 2 5 2 7.5 0s5-2 7.5 0 3.5 2 5 1"/><path d="M2 18c2.5 2 5 2 7.5 0s5-2 7.5 0 3.5 2 5 1"/>',
    trends: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    feed: '<path d="M4 11h16a8 8 0 0 1-16 0z"/><circle cx="9" cy="6" r="1.2"/><circle cx="13" cy="4.5" r="1.2"/><circle cx="15.5" cy="7.5" r="1.2"/>',
    controls: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    apps: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><path d="M17.5 14v7M14 17.5h7"/>',
    alerts: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
    calibration: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3"/><path d="M7.5 15h9"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
    more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
    thermo: '<path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z"/><path d="M12 9v7"/>',
    drop: '<path d="M12 3c-4 5-7 8.5-7 12a7 7 0 0 0 14 0c0-3.5-3-7-7-12z"/><path d="M9 15.5a3 3 0 0 0 3 2.5"/>',
    chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    aerator: '<circle cx="12" cy="12" r="2"/><path d="M12 10c0-4 1-7 4-7 2 0 2 3 0 5M14 12c4 0 7 1 7 4 0 2-3 2-5 0M12 14c0 4-1 7-4 7-2 0-2-3 0-5M10 12c-4 0-7-1-7-4 0-2 3-2 5 0"/>',
    pump: '<circle cx="9" cy="13" r="5"/><path d="M14 13h7M18 10v6M9 8V4h4"/><path d="M7 13h4"/>',
    camera: '<rect x="3" y="7" width="13" height="10" rx="2"/><path d="M16 11l5-3v8l-5-3"/>',
    plug: '<path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0z"/><path d="M12 16v5"/>',
    wifi: '<path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19" r="1"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    code: '<path d="M8 8l-5 4 5 4M16 8l5 4-5 4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    mqtt: '<circle cx="12" cy="12" r="2"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
    box: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
    water: '<path d="M9 3h6M10 3v14a2 2 0 0 0 4 0V3"/><path d="M10 11h4"/>',
    cycle: '<path d="M4 12a8 8 0 0 1 14-5.3L20 9"/><path d="M20 4v5h-5"/><path d="M20 12a8 8 0 0 1-14 5.3L4 15"/><path d="M4 20v-5h5"/>',
    level: '<path d="M3 17c3 2 6 2 9 0s6-2 9 0"/><path d="M3 12h18" stroke-dasharray="2 3"/><path d="M12 3v6M9 6l3 3 3-3"/>',
    o2: '<circle cx="9" cy="14" r="5"/><circle cx="17" cy="7" r="3"/>'
  };

  // ------------------------------------------------------------ state
  const state = {
    ponds: {}, selected: null, info: null,
    integrations: [], catalog: null,
    feeding: { schedules: [], events: [] },
    alerts: { rules: [], alerts: [] },
    calibrations: [], controls: null,
    water: { entries: [], limits: {} }, cycles: [], full: null, auth: null, creds: null,
    history: {}, trendsRange: '24h',
    ws: null, wsOk: false, loaded: false
  };
  try { state.selected = localStorage.getItem('aqua.pond') || null; } catch (_) {}

  const ROUTES = [
    { id: 'overview', title: 'Overview', icon: 'home' },
    { id: 'ponds', title: 'Ponds', icon: 'ponds' },
    { id: 'trends', title: 'Trends', icon: 'trends' },
    { id: 'water', title: 'Water quality', icon: 'water' },
    { id: 'cycle', title: 'Crop cycle', icon: 'cycle' },
    { id: 'feeding', title: 'Feeding', icon: 'feed' },
    { id: 'controls', title: 'Controls', icon: 'controls' },
    { id: 'apps', title: 'Apps & Integrations', icon: 'apps' },
    { id: 'alerts', title: 'Alerts', icon: 'alerts' },
    { id: 'calibration', title: 'Calibration', icon: 'calibration' },
    { id: 'settings', title: 'Settings', icon: 'settings' }
  ];
  const MOBILE = [
    { id: 'overview', label: 'Home', icon: 'home' },
    { id: 'ponds', label: 'Ponds', icon: 'ponds' },
    { id: 'feeding', label: 'Feed', icon: 'feed' },
    { id: 'apps', label: 'Apps', icon: 'apps' },
    { id: 'more', label: 'More', icon: 'more' }
  ];
  const MORE_IDS = ['trends', 'water', 'cycle', 'controls', 'alerts', 'calibration', 'settings'];

  const PROVIDER_UI = {
    esp32: { icon: 'chip', desc: 'Sensor node on AQUA MQTT' },
    tuya: { icon: 'plug', desc: 'Tuya / Smart Life devices' },
    tapo: { icon: 'camera', desc: 'Tapo cameras and plugs' },
    vson: { icon: 'box', desc: 'VSON Smart devices' },
    mqtt: { icon: 'mqtt', desc: 'Any device speaking MQTT' },
    onvif: { icon: 'camera', desc: 'ONVIF / RTSP camera' },
    rest: { icon: 'code', desc: 'HTTP API you control' },
    external: { icon: 'external', desc: 'Open a manufacturer app' },
    custom: { icon: 'apps', desc: 'Anything else' }
  };
  const MODE_TEXT = {
    external: 'External app: AQUA opens the manufacturer app. Control and confirmation happen there.',
    mqtt: 'MQTT: AQUA publishes commands to a topic on its own broker. Confirmed only if the device acknowledges.',
    rest: 'REST: an HTTP API address is stored now; AQUA will call it in a later version.',
    onvif: 'ONVIF / RTSP: the stream address is stored now; live preview arrives in v2.3.0.',
    native: 'Native: a built-in AQUA driver. Not available for this provider in v2.0.0.'
  };

  const route = () => {
    const id = (location.hash.replace(/^#\/?/, '') || 'overview').split('?')[0];
    return ROUTES.some(r => r.id === id) ? id : 'overview';
  };
  const pondList = () => Object.values(state.ponds).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  function selectedPond() {
    const list = pondList();
    if (!list.length) return null;
    return state.ponds[state.selected] || list[0];
  }
  function setSelected(id) {
    state.selected = id;
    try { localStorage.setItem('aqua.pond', id); } catch (_) {}
  }
  const rule = id => state.alerts.rules.find(r => r.id === id);
  const activeAlerts = () => state.alerts.alerts.filter(a => !a.resolvedAt);

  // ------------------------------------------------------------ API
  async function api(path, opts = {}) {
    const res = await fetch('/api' + path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json', 'X-AQUA': '1' } : { 'X-AQUA': '1' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store'
    });
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (res.status === 401 && state.auth?.required && !path.startsWith('/auth/')) showLogin('Please sign in again.');
    if (!res.ok) { const err = new Error((data && data.error) || 'Request failed (' + res.status + ')'); err.status = res.status; err.data = data; throw err; }
    return data;
  }
  const load = {
    async ponds() { const list = await api('/ponds'); state.ponds = {}; for (const p of list) state.ponds[p.id] = p; },
    async info() { state.info = await api('/info'); },
    async integrations() { state.integrations = await api('/integrations'); if (!state.catalog) state.catalog = await api('/integrations/catalog'); },
    async feeding() { state.feeding = await api('/feeding'); },
    async alerts() { state.alerts = await api('/alerts'); },
    async calibrations() { state.calibrations = await api('/calibrations'); },
    async controls() { state.controls = await api('/controls'); },
    async water() { state.water = await api('/water'); },
    async cycles() { state.cycles = await api('/cycles'); },
    async full() { state.full = await api('/settings/full'); },
    async history(pondId, range) {
      const h = await api(`/ponds/${encodeURIComponent(pondId)}/readings?range=${range}`);
      state.history[pondId + '|' + range] = h;
      return h;
    }
  };
  async function loadAll() {
    await Promise.allSettled([load.ponds(), load.info(), load.integrations(), load.feeding(), load.alerts(), load.calibrations(), load.controls(), load.water(), load.cycles(), load.full()]);
    state.loaded = true;
  }

  // ------------------------------------------------------------ toasts & modal
  function toast(msg, kind = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), kind === 'err' ? 6500 : 4200);
  }
  let modalOnClose = null;
  function openModal(html, { wide = false, onClose = null } = {}) {
    closeModal();
    modalOnClose = onClose;
    const root = $('#modalRoot');
    root.innerHTML = `<div class="modal-wrap" data-close><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</div></div>`;
    root.querySelector('.modal-wrap').addEventListener('click', e => { if (e.target.hasAttribute('data-close')) closeModal(); });
    const first = root.querySelector('input, select, textarea, button.primary, button');
    if (first) setTimeout(() => first.focus(), 30);
    return root.querySelector('.modal');
  }
  function closeModal() {
    const root = $('#modalRoot');
    if (!root.innerHTML) return;
    root.innerHTML = '';
    const fn = modalOnClose; modalOnClose = null;
    if (fn) fn();
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
  function confirmDialog(title, text, okLabel = 'Delete', danger = true) {
    return new Promise(resolve => {
      let done = false;
      const m = openModal(`<h3>${esc(title)}</h3><p class="muted">${esc(text)}</p>
        <div class="modal-actions"><button class="btn" data-a="no">Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-a="yes">${esc(okLabel)}</button></div>`,
        { onClose: () => { if (!done) resolve(false); } });
      m.addEventListener('click', e => {
        const a = e.target.closest('[data-a]')?.dataset.a;
        if (!a) return;
        done = true; closeModal(); resolve(a === 'yes');
      });
    });
  }

  // ------------------------------------------------------------ chips
  function onlineChip(p) {
    if (!p) return `<span class="chip off"><span class="dot"></span>Waiting for real hardware</span>`;
    return p.online
      ? `<span class="chip ok"><span class="dot"></span>Online</span>`
      : `<span class="chip crit"><span class="dot"></span>Offline</span>`;
  }
  function feedChip(status) {
    const k = { 'Confirmed': 'ok', 'Failed': 'crit', 'Command Sent': 'info', 'External App Opened': 'warn', 'Skipped': 'warn' }[status] || 'off';
    return `<span class="chip ${k}">${esc(status)}</span>`;
  }
  function intChip(status) {
    const k = { 'Online': 'ok', 'Offline': 'crit', 'External App': 'info', 'Configured': 'info', 'Disabled': 'off' }[status] || 'off';
    return `<span class="chip ${k}">${esc(status)}</span>`;
  }
  const sevChip = s => `<span class="chip ${s === 'critical' ? 'crit' : 'warn'}">${s === 'critical' ? 'Critical' : 'Warning'}</span>`;

  // ------------------------------------------------------------ charts (dependency-free SVG)
  const charts = new Map();
  let chartSeq = 0;
  const RANGE_MS = { '24h': 86400000, '7d': 7 * 86400000, '30d': 30 * 86400000 };

  function chartSlot(spec) {
    const id = 'c' + (++chartSeq);
    charts.set(id, spec);
    return `<div class="chart" data-chart="${id}"></div>`;
  }
  function mountCharts() {
    for (const el of $$('[data-chart]')) {
      const spec = charts.get(el.dataset.chart);
      if (spec) drawChart(el, spec);
    }
  }
  function drawChart(el, spec) {
    const pts = (spec.points || []).filter(p => isNum(p[spec.key]));
    const H = spec.fill && el.clientHeight > 60 ? Math.floor(el.clientHeight) : (spec.height || 180);
    if (!pts.length) {
      el.innerHTML = `<div class="chart-empty" style="height:${H}px">${esc(spec.empty || 'No real history yet')}</div>`;
      return;
    }
    const W = Math.max(260, el.clientWidth || 600);
    const pad = { l: 40, r: 12, t: 12, b: 24 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const to = spec.to || Date.now(), from = spec.from || to - RANGE_MS['24h'];
    let lo = Math.min(...pts.map(p => p[spec.key])), hi = Math.max(...pts.map(p => p[spec.key]));
    const minSpan = spec.minSpan || 1;
    if (hi - lo < minSpan) { const mid = (hi + lo) / 2; lo = mid - minSpan / 2; hi = mid + minSpan / 2; }
    const padV = (hi - lo) * 0.12; lo -= padV; hi += padV;
    const x = t => pad.l + ((t - from) / (to - from)) * iw;
    const y = v => pad.t + (1 - (v - lo) / (hi - lo)) * ih;
    const gapMs = Math.max((spec.bucketSec || 60) * 3000, 5 * 60000);

    let d = '', area = '', segStart = null, prev = null;
    const closeArea = () => { if (segStart !== null && prev) area += `L${x(prev.t).toFixed(1)},${(pad.t + ih).toFixed(1)}L${x(segStart).toFixed(1)},${(pad.t + ih).toFixed(1)}Z`; };
    for (const p of pts) {
      const px = x(p.t).toFixed(1), py = y(p[spec.key]).toFixed(1);
      if (!prev || p.t - prev.t > gapMs) { closeArea(); d += `M${px},${py}`; area += `M${px},${py}`; segStart = p.t; }
      else { d += `L${px},${py}`; area += `L${px},${py}`; }
      prev = p;
    }
    closeArea();

    const gid = 'g' + el.dataset.chart;
    let grid = '';
    for (let i = 0; i <= 3; i++) {
      const v = lo + ((hi - lo) * i) / 3, yy = y(v).toFixed(1);
      grid += `<line class="grid-line" x1="${pad.l}" x2="${W - pad.r}" y1="${yy}" y2="${yy}"/><text class="axis" x="${pad.l - 6}" y="${(+yy + 3).toFixed(1)}" text-anchor="end">${v.toFixed(spec.decimals ?? 1)}</text>`;
    }
    const span = to - from, xt = [];
    const narrow = W < 560;
    const step = span <= RANGE_MS['24h'] ? (narrow ? 8 : 4) * 3600000 : span <= RANGE_MS['7d'] ? (narrow ? 2 : 1) * 86400000 : (narrow ? 10 : 5) * 86400000;
    const first = Math.ceil(from / step) * step;
    for (let t = first; t <= to; t += step) xt.push(t);
    for (const t of xt) {
      const label = span <= RANGE_MS['24h']
        ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : new Date(t).toLocaleDateString([], { day: '2-digit', month: 'short' });
      grid += `<text class="axis" x="${x(t).toFixed(1)}" y="${H - 6}" text-anchor="middle">${label}</text>`;
    }
    let band = '';
    if (spec.band && isNum(spec.band[0]) && isNum(spec.band[1])) {
      const b0 = Math.max(lo, spec.band[0]), b1 = Math.min(hi, spec.band[1]);
      if (b1 > b0) band = `<rect x="${pad.l}" width="${iw}" y="${y(b1).toFixed(1)}" height="${(y(b0) - y(b1)).toFixed(1)}" fill="${spec.color}" opacity="0.05"/>`;
    }
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(spec.label || spec.key)} chart">
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${spec.color}" stop-opacity="0.28"/><stop offset="1" stop-color="${spec.color}" stop-opacity="0"/></linearGradient></defs>
      ${band}${grid}
      <path d="${area}" fill="url(#${gid})"/>
      <path d="${d}" fill="none" stroke="${spec.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" style="filter:drop-shadow(0 0 6px ${spec.color}66)"/>
      <line class="hover-line" x1="0" x2="0" y1="${pad.t}" y2="${pad.t + ih}" stroke="rgba(228,242,247,.35)" stroke-dasharray="3 3" opacity="0"/>
      <circle class="hover-dot" r="4.5" fill="${spec.color}" stroke="#050B11" stroke-width="2" opacity="0"/>
      <rect class="hit" x="${pad.l}" y="${pad.t}" width="${iw}" height="${ih}" fill="transparent"/>
    </svg><div class="tip"></div>`;

    const svg = el.querySelector('svg'), tip = el.querySelector('.tip');
    const hl = el.querySelector('.hover-line'), dot = el.querySelector('.hover-dot');
    const move = ev => {
      const r = svg.getBoundingClientRect();
      const cx = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left) * (W / r.width);
      const t = from + ((cx - pad.l) / iw) * (to - from);
      let best = pts[0];
      for (const p of pts) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
      const px = x(best.t), py = y(best[spec.key]);
      hl.setAttribute('x1', px); hl.setAttribute('x2', px); hl.setAttribute('opacity', 1);
      dot.setAttribute('cx', px); dot.setAttribute('cy', py); dot.setAttribute('opacity', 1);
      tip.style.left = (px / W * 100) + '%'; tip.style.top = (py / H * r.height) + 'px'; tip.style.opacity = 1;
      tip.innerHTML = `<b>${fmt(best[spec.key], spec.decimals ?? 2)}${esc(spec.unit || '')}</b> <span class="muted">${dateTime(best.t)}</span>`;
    };
    const leave = () => { tip.style.opacity = 0; hl.setAttribute('opacity', 0); dot.setAttribute('opacity', 0); };
    const hit = el.querySelector('.hit');
    hit.addEventListener('mousemove', move); hit.addEventListener('touchmove', move, { passive: true });
    hit.addEventListener('mouseleave', leave); hit.addEventListener('touchend', leave);
  }
  let resizeT;
  window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(mountCharts, 150); });

  // ------------------------------------------------------------ scales
  function scale(value, min, max, band, ticks, cls = '') {
    const pos = v => Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100));
    const safe = band && isNum(band[0]) && isNum(band[1])
      ? `<div class="safe" style="left:${pos(band[0])}%;width:${pos(band[1]) - pos(band[0])}%" title="Alert thresholds"></div>` : '';
    const needle = isNum(value) ? `<div class="needle" style="left:${pos(value)}%"></div>` : '';
    return `<div class="ph-scale ${cls}" aria-hidden="true"><div class="bar"></div>${safe}${needle}<div class="ticks">${ticks.map(t => `<span>${t}</span>`).join('')}</div></div>`;
  }
  const phBand = () => [rule('rule-ph-low')?.threshold, rule('rule-ph-high')?.threshold];
  const tempBand = () => [rule('rule-temp-low')?.threshold, rule('rule-temp-high')?.threshold];
  function levelOf(v, band) {
    if (!isNum(v) || !isNum(band[0]) || !isNum(band[1])) return '';
    return v < band[0] || v > band[1] ? 'out' : '';
  }

  // ------------------------------------------------------------ shell
  function renderNav() {
    const r = route(), n = activeAlerts().length;
    $('#sideNav').innerHTML = ROUTES.map(x => `<a href="#/${x.id}" class="${x.id === r ? 'active' : ''}" ${x.id === r ? 'aria-current="page"' : ''}>${I(x.icon)}<span>${esc(x.title)}</span>${x.id === 'alerts' && n ? `<span class="badge">${n}</span>` : ''}</a>`).join('');
    $('#bottomNav').innerHTML = MOBILE.map(x => {
      const active = x.id === r || (x.id === 'more' && MORE_IDS.includes(r));
      const href = x.id === 'more' ? '#more' : '#/' + x.id;
      return `<a href="${href}" data-id="${x.id}" class="${active ? 'active' : ''}">${I(x.icon)}<span>${x.label}</span>${x.id === 'more' && n ? `<span class="badge">${n}</span>` : ''}</a>`;
    }).join('');
    $('#sideConn').innerHTML = state.wsOk
      ? `<span class="chip ok"><span class="dot"></span>Server connected</span>`
      : `<span class="chip warn"><span class="dot"></span>Reconnecting</span>`;
    $('#connBanner').classList.toggle('show', state.loaded && !state.wsOk);
  }
  $('#bottomNav').addEventListener('click', e => {
    const a = e.target.closest('a[data-id="more"]');
    if (!a) return;
    e.preventDefault();
    const n = activeAlerts().length;
    const m = openModal(`<h3>More</h3><div class="list more-sheet">${MORE_IDS.map(id => {
      const r = ROUTES.find(x => x.id === id);
      return `<a class="list-item" href="#/${id}">${I(r.icon)}<span class="grow">${esc(r.title)}</span>${id === 'alerts' && n ? `<span class="badge">${n}</span>` : ''}</a>`;
    }).join('')}</div>`);
    m.addEventListener('click', ev => { if (ev.target.closest('a')) closeModal(); });
  });

  function renderPondPicker() {
    const list = pondList(), r = route();
    const show = list.length > 1 && ['overview', 'trends', 'calibration', 'water', 'cycle'].includes(r);
    $('#pondPicker').innerHTML = show
      ? `<select id="pondSelect" aria-label="Pond">${list.map(p => `<option value="${esc(p.id)}" ${p.id === selectedPond()?.id ? 'selected' : ''}>${esc(p.name)} (${esc(p.id)})</option>`).join('')}</select>`
      : '';
    const sel = $('#pondSelect');
    if (sel) sel.addEventListener('change', () => { setSelected(sel.value); render(); });
  }

  // ------------------------------------------------------------ views
  const VIEWS = {};

  // ===== Overview
  VIEWS.overview = () => {
    const p = selectedPond();
    const L = p?.latest || null;
    const offline = p && !p.online;
    const tb = tempBand(), pb = phBand();
    const hist = p ? state.history[p.id + '|24h'] : null;
    const tStat = hist?.stats?.temperatureC, pStat = hist?.stats?.ph;
    const tLevel = levelOf(L?.temperatureC, tb), pLevel = levelOf(L?.ph, pb);
    const lastKnown = offline ? `<span class="chip crit">Last known value</span>` : '';

    const hero = `<section class="hero">
      <div>
        <div class="pond-id">${p ? esc(p.id) + (p.deviceId ? ' / ' + esc(p.deviceId) : '') : 'No pond registered yet'}</div>
        <h2 class="pond-title">${p ? esc(p.name) : 'Waiting for your first pond'}</h2>
      </div>
      ${onlineChip(p)}
      <div class="spacer"></div>
      <div class="muted small">${p ? 'Last update <b style="color:var(--text)" data-rel="' + esc(p.lastUpdate) + '">' + rel(p.lastUpdate) + '</b>' : ''}</div>
    </section>`;

    const waiting = !p ? `<div class="waiting"><div class="radar"></div><div><b>Waiting for real ESP32 telemetry</b><br>
      <span class="small">${state.info?.mode === 'cloud'
        ? `Flash the ESP32 with <code>MQTT_HOST</code> = <code>${esc(state.info.publicHost || location.hostname)}</code>, port <code>8883</code>, <code>USE_TLS 1</code> and its device login (Settings).`
        : `Flash the ESP32 with <code>MQTT_HOST</code> set to this computer's LAN IP (${esc(state.info?.lan?.[0]?.address || 'see Settings')}) and port ${esc(state.info?.mqttPort || 1883)}.`} The pond appears here on its first message to <code>aqua/site/${esc(state.info?.site?.id || 'SITE-01')}/pond/POND-A/telemetry</code>.</span></div></div>` : '';

    const metrics = `<section class="metrics">
      <article class="panel metric ${L && isNum(L.temperatureC) && !offline ? 'live' : ''} ${tLevel ? 'state-warn' : ''}">
        <div class="label">${I('thermo')}Water temperature ${lastKnown}</div>
        <div class="value ${L && isNum(L.temperatureC) ? '' : 'dash'}" id="vTemp">${L && isNum(L.temperatureC) ? fmt(L.temperatureC) + '<span class="unit">°C</span>' : DASH}</div>
        ${scale(L?.temperatureC, 20, 36, tb, [20, 24, 28, 32, 36], 'temp-scale')}
        <div class="foot">${L && !isNum(L.temperatureC) ? '<span>Probe not reporting a valid value</span>' : tStat ? `<span>24 h low ${fmt(tStat.min)}</span><span>high ${fmt(tStat.max)} °C</span>` : '<span>No real history yet</span>'}</div>
      </article>
      <article class="panel metric ${L && isNum(L.ph) && !offline ? 'live' : ''} ${pLevel ? 'state-crit' : ''}">
        <div class="label">${I('drop')}pH ${lastKnown}</div>
        <div class="value ${L && isNum(L.ph) ? '' : 'dash'}" id="vPh">${L && isNum(L.ph) ? fmt(L.ph) : DASH}</div>
        ${scale(L?.ph, 0, 14, pb, [0, 2, 4, 6, 7, 8, 10, 12, 14].filter(v => v !== 7))}
        <div class="foot">${L ? `<span>24 h swing ${isNum(p.derived?.phSwing24h) ? fmt(p.derived.phSwing24h) : 'needs 12 h of data'}</span><span>RAW ${esc(L.phRaw ?? DASH)}</span><span>${p.calibration ? 'Probe ' + esc(p.calibration.probeId) : 'Device calibration'}</span>` : '<span>No real reading yet</span>'}</div>
      </article>
      <article class="panel metric secondary">
        <div class="label">${I('chip')}Device</div>
        <div class="small-value">${p ? (p.online ? 'Online' : 'Offline') : DASH}</div>
        <dl class="kv">
          <dt>Device</dt><dd>${esc(p?.deviceId || DASH)}</dd>
          <dt>Wi-Fi</dt><dd>${rssiLabel(L?.rssi)}</dd>
          <dt>Firmware</dt><dd>${esc(L?.firmwareVersion || DASH)}</dd>
          <dt>Uptime</dt><dd>${uptime(L?.uptimeSec)}</dd>
        </dl>
      </article>
      <article class="panel metric secondary">
        <div class="label">${I('clock')}Last update</div>
        <div class="small-value" data-rel="${esc(p?.lastUpdate || '')}">${p ? rel(p.lastUpdate) : DASH}</div>
        <dl class="kv">
          <dt>Telemetry</dt><dd>${clock(p?.lastUpdate)}</dd>
          <dt>Last seen</dt><dd>${clock(p?.lastSeen)}</dd>
          <dt>Interval</dt><dd>${p ? '60 s' : DASH}</dd>
          <dt>Offline after</dt><dd>${Math.round((state.info?.settings?.offlineAfterSec || 300) / 60)} min silence</dd>
        </dl>
      </article>
    </section>`;

    // quick actions
    const feeders = feedersFor(p?.id);
    const cams = state.integrations.filter(i => i.enabled && i.category === 'camera' && (!i.pondId || i.pondId === p?.id));
    const cam = cams.find(c => c.mode === 'external' && c.launchUrl);
    const qa = `<section class="panel o-qa">
      <div class="panel-head"><h2>Quick actions</h2></div>
      <div class="qa">
        <button class="qa-btn ${p && feeders.length ? '' : 'disabled'}" data-act="feed" ${p && feeders.length ? '' : 'disabled aria-disabled="true"'}>${I('feed')}Feed<small>${p && feeders.length ? (feeders[0].mode === 'external' ? 'External app' : 'MQTT') : 'Not set up'}</small></button>
        <button class="qa-btn disabled" disabled aria-disabled="true">${I('aerator')}Aerator<small>v2.2.0</small></button>
        <button class="qa-btn disabled" disabled aria-disabled="true">${I('pump')}<span class="hide-mobile">Water pump</span><span class="show-mobile">Pump</span><small>v2.2.0</small></button>
        ${cam ? `<a class="qa-btn" href="${esc(cam.launchUrl)}" target="_blank" rel="noopener" data-opened="${esc(cam.id)}">${I('camera')}Camera<small>Open app</small></a>`
              : `<button class="qa-btn disabled" disabled aria-disabled="true">${I('camera')}Camera<small>Not set up</small></button>`}
      </div>
    </section>`;

    const chart = `<section class="panel o-chart">
      <div class="panel-head"><h2>Last 24 hours</h2><span class="hint">${hist ? hist.sampleCount + ' real samples' : ''}</span><div class="spacer"></div><a class="btn sm ghost" href="#/trends">Open trends</a></div>
      <div class="chart-label"><span class="sw" style="background:var(--sky)"></span>Temperature °C</div>
      ${chartSlot({ points: hist?.points, key: 'temperatureC', color: '#34B8FF', unit: ' °C', from: hist?.from, to: hist?.to, bucketSec: hist?.bucketSec, height: 150, fill: true, minSpan: 1, decimals: 1, band: tb, label: 'Temperature', empty: p ? 'No real history yet' : 'Waiting for real ESP32 telemetry' })}
      <div class="chart-label"><span class="sw" style="background:var(--aqua)"></span>pH</div>
      ${chartSlot({ points: hist?.points, key: 'ph', color: '#35E1C1', unit: '', from: hist?.from, to: hist?.to, bucketSec: hist?.bucketSec, height: 150, fill: true, minSpan: 0.4, decimals: 2, band: pb, label: 'pH', empty: p ? 'No real history yet' : 'Waiting for real ESP32 telemetry' })}
    </section>`;

    const act = activeAlerts().filter(a => !p || a.pondId === p.id);
    const alertsPanel = `<section class="panel o-alerts">
      <div class="panel-head"><h2>Alerts</h2><div class="spacer"></div><a class="btn sm ghost" href="#/alerts">All alerts</a></div>
      ${act.length ? `<div class="list">${act.slice(0, 4).map(a => `<div class="list-item">${sevChip(a.severity)}<div class="grow"><div class="title">${esc(a.message)}</div><div class="meta">since ${dateTime(a.startedAt)}</div></div></div>`).join('')}</div>`
        : `<div class="empty">${p ? 'No active alerts. Rules need a condition to hold for several minutes before alerting.' : 'Alerts start once real telemetry arrives.'}</div>`}
    </section>`;

    const lastFeed = state.feeding.events.find(e => !p || e.pondId === p.id);
    const nextSch = nextSchedule(p?.id);
    const feedPanel = `<section class="panel o-feed">
      <div class="panel-head"><h2>Feeding</h2><div class="spacer"></div><a class="btn sm ghost" href="#/feeding">Feeding</a></div>
      <div class="list">
        <div class="list-item"><div class="grow"><div class="meta">Last feeding command</div><div class="title">${lastFeed ? dateTime(lastFeed.createdAt) + ', ' + lastFeed.durationSec + ' s' : DASH}</div></div>${lastFeed ? feedChip(lastFeed.status) : ''}</div>
        <div class="list-item"><div class="grow"><div class="meta">Next schedule</div><div class="title">${nextSch ? esc(nextSch.time) + ', ' + nextSch.durationSec + ' s' : 'No schedule'}</div></div></div>
      </div>
    </section>`;

    const equip = `<section class="panel o-equip">
      <div class="panel-head"><h2>Equipment</h2><div class="spacer"></div><a class="btn sm ghost" href="#/controls">Controls</a></div>
      <div class="list">
        ${['Aerator', 'Water pump', 'Feeder relay'].map(n => `<div class="list-item"><div class="grow title">${n}</div><span class="chip off">Not configured</span></div>`).join('')}
        <div class="list-item"><div class="grow title">Integrations</div><span class="chip ${state.integrations.length ? 'info' : 'off'}">${state.integrations.length || 'None'}</span></div>
      </div>
    </section>`;

    const pushOff = p && state.info?.notifications && !state.info.notifications.pushover.enabled
      ? '<a class="notice warn" href="#/settings" style="display:block;text-decoration:none">Phone alerts are off. Nobody will be woken if a pump stops at night. Set up Pushover in Settings.</a>' : '';
    return `<div class="ov">
      <div class="ov-head">${hero}${waiting}${pushOff}</div>
      ${metrics}
      <div class="ov-body">
        <div class="ov-main">${chart}</div>
        <div class="ov-side">${lifeSupport(p)}${qa}${alertsPanel}${feedPanel}${equip}</div>
      </div>
    </div>`;
  };
  VIEWS.overview.after = async () => {
    const p = selectedPond();
    $$('[data-act="feed"]').forEach(b => b.addEventListener('click', () => openFeedModal(p?.id)));
    $$('[data-opened]').forEach(a => a.addEventListener('click', () => api(`/integrations/${a.dataset.opened}/opened`, { method: 'POST' }).catch(() => {})));
    if (p && !state.history[p.id + '|24h']) {
      try { await load.history(p.id, '24h'); if (route() === 'overview') render(); } catch (_) {}
    }
  };

  function lifeSupport(p) {
    const seen = new Set(p?.sensorsSeen || []);
    const L = p?.latest || {};
    const off = p && !p.online;
    const tile = (icon, title, field, r) => {
      if (!seen.has(field)) return `<div class="ls-tile"><div class="ls-top">${I(icon)}${title}</div><div class="ls-val off">Not installed</div><div class="ls-sub">No sensor has reported</div></div>`;
      const v = r();
      return `<div class="ls-tile ${off ? '' : v.cls}"><div class="ls-top">${I(icon)}${title}</div><div class="ls-val">${v.text}</div><div class="ls-sub">${off ? 'Last known, device offline' : v.sub || ''}</div></div>`;
    };
    const tiles = [
      tile('pump', 'Circulation pump', 'flowLpm', () => L.pumpRunning === true ? { cls: 'ok', text: 'Running', sub: fmt(L.flowLpm, 1) + ' L/min' } : L.pumpRunning === false ? { cls: 'crit', text: 'Stopped', sub: fmt(L.flowLpm, 1) + ' L/min' } : { cls: 'warn', text: 'No reading', sub: 'Check the flow sensor' }),
      tile('aerator', 'Air pump', 'airPumpCurrentA', () => L.airPumpRunning === true ? { cls: 'ok', text: 'Running', sub: fmt(L.airPumpCurrentA, 2) + ' A' } : L.airPumpRunning === false ? { cls: 'crit', text: 'Stopped', sub: fmt(L.airPumpCurrentA, 2) + ' A' } : { cls: 'warn', text: 'No reading', sub: 'Check the current clamp' }),
      tile('level', 'Sump water level', 'waterLevel', () => L.waterLevel === 'ok' ? { cls: 'ok', text: 'Normal' } : L.waterLevel === 'low' ? { cls: 'crit', text: 'Low', sub: 'Pump may run dry' } : L.waterLevel === 'high' ? { cls: 'warn', text: 'High', sub: 'Overflow risk' } : { cls: 'warn', text: 'No reading' }),
      tile('o2', 'Dissolved oxygen', 'doMgL', () => isNum(L.doMgL) ? { cls: L.doMgL < 3 ? 'crit' : L.doMgL < 4 ? 'warn' : 'ok', text: fmt(L.doMgL, 1) + ' mg/L' } : { cls: 'warn', text: 'No reading', sub: 'Check the DO sensor' })
    ].join('');
    const none = !['flowLpm', 'airPumpCurrentA', 'waterLevel', 'doMgL'].some(f => seen.has(f));
    return `<section class="panel o-ls"><div class="panel-head"><h2>Life support</h2><span class="hint">Pumps, aeration, water level, oxygen</span></div><div class="ls-grid">${tiles}</div>
      ${none ? '<p class="muted small ls-note" style="margin-bottom:0">No life-support sensors installed yet. In a RAS a stopped pump is the fastest way to lose a tank. See docs/HARDWARE_ZH.md for the flow sensor, float switches and air pump clamp.</p>' : ''}</section>`;
  }

  function feedersFor(pondId) {
    return state.integrations.filter(i => i.enabled && i.category === 'feeder' && ['mqtt', 'external'].includes(i.mode) && (!i.pondId || i.pondId === pondId));
  }
  function nextSchedule(pondId) {
    const list = state.feeding.schedules.filter(s => s.enabled && (!pondId || s.pondId === pondId));
    if (!list.length) return null;
    const now = new Date(), cur = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    return list.find(s => s.time > cur) || list[0];
  }

  // ===== Ponds
  VIEWS.ponds = () => {
    const list = pondList();
    if (!list.length) {
      return `<section class="panel"><div class="empty big"><b>No ponds yet</b>
        A pond appears automatically when a real ESP32 publishes to <code>aqua/site/${esc(state.info?.site?.id || 'SITE-01')}/pond/&lt;POND_ID&gt;/telemetry</code>.<br>
        Ponds are never created from sample data.</div></section>`;
    }
    return `<section class="cards">${list.map(p => {
      const L = p.latest || {};
      return `<article class="panel pond-card">
        <div class="row"><div><div class="muted small">${esc(p.siteId || '')} / ${esc(p.id)}${p.topicStyle === 'legacy' ? ' <span class="chip warn" title="Firmware older than 2.0.3">old topic format</span>' : ''}</div><h3 style="margin:2px 0 0;font-size:20px;font-weight:600">${esc(p.name)}</h3></div><div class="spacer" style="flex:1"></div>${onlineChip(p)}</div>
        <div class="vals">
          <div><span>Water temperature</span><b>${fmt(L.temperatureC)}</b> <span style="display:inline">°C</span></div>
          <div><span>pH</span><b>${fmt(L.ph)}</b></div>
        </div>
        <div class="muted small">Last seen <span data-rel="${esc(p.lastSeen || '')}">${rel(p.lastSeen)}</span>${p.deviceId ? ', device ' + esc(p.deviceId) : ''}</div>
        <div class="row" style="margin-top:12px">
          <button class="btn sm" data-open="${esc(p.id)}">Open overview</button>
          <button class="btn sm ghost" data-trend="${esc(p.id)}">Trends</button>
          <button class="btn sm ghost" data-rename="${esc(p.id)}">${I('edit')}Rename</button>
        </div>
      </article>`;
    }).join('')}</section>
    <p class="muted small">New ponds register themselves from real telemetry. Pond history is kept when a device goes offline.</p>`;
  };
  VIEWS.ponds.after = () => {
    $$('[data-open]').forEach(b => b.addEventListener('click', () => { setSelected(b.dataset.open); location.hash = '#/overview'; }));
    $$('[data-trend]').forEach(b => b.addEventListener('click', () => { setSelected(b.dataset.trend); location.hash = '#/trends'; }));
    $$('[data-rename]').forEach(b => b.addEventListener('click', () => {
      const p = state.ponds[b.dataset.rename];
      const m = openModal(`<h3>Rename pond</h3><p class="muted small">${esc(p.id)} keeps its ID; only the display name changes.</p>
        <label class="field">Pond name<input type="text" id="pName" maxlength="60" value="${esc(p.name)}"></label>
        <div class="modal-actions"><button class="btn" data-close-btn>Cancel</button><button class="btn primary" id="pSave">Save name</button></div>`);
      m.querySelector('[data-close-btn]').onclick = closeModal;
      m.querySelector('#pSave').onclick = async () => {
        try { const up = await api('/ponds/' + encodeURIComponent(p.id), { method: 'PATCH', body: { name: $('#pName').value } }); state.ponds[up.id] = up; closeModal(); toast('Pond renamed', 'ok'); render(); }
        catch (e) { toast(e.message, 'err'); }
      };
    }));
  };

  // ===== Trends
  VIEWS.trends = () => {
    const p = selectedPond();
    if (!p) return `<section class="panel"><div class="empty big"><b>No real history yet</b>Trends appear after a real ESP32 starts sending telemetry.</div></section>`;
    const r = state.trendsRange, h = state.history[p.id + '|' + r];
    const statRow = (s, unit, d) => s ? `<div class="stats"><span>Low<b>${fmt(s.min, d)}${unit}</b></span><span>Average<b>${fmt(s.avg, d)}${unit}</b></span><span>High<b>${fmt(s.max, d)}${unit}</b></span><span>Samples<b>${s.count}</b></span></div>` : '';
    return `<section class="row">
        <div class="seg" role="tablist">${['24h', '7d', '30d'].map(k => `<button role="tab" data-range="${k}" class="${k === r ? 'on' : ''}" aria-selected="${k === r}">${{ '24h': '24 hours', '7d': '7 days', '30d': '30 days' }[k]}</button>`).join('')}</div>
        <span class="muted small">${esc(p.name)}${h ? ', ' + (h.bucketSec > 60 ? 'averaged per ' + (h.bucketSec >= 3600 ? 'hour' : h.bucketSec / 60 + ' min') : 'every stored sample') : ''}</span>
        <div style="flex:1"></div>
        <a class="btn sm" href="/api/ponds/${encodeURIComponent(p.id)}/export.csv?range=${r}">${I('download')}Export CSV</a>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Water temperature</h2><span class="hint">°C</span></div>
        ${h ? statRow(h.stats.temperatureC, ' °C', 2) : ''}
        ${h ? chartSlot({ points: h.points, key: 'temperatureC', color: '#34B8FF', unit: ' °C', from: h.from, to: h.to, bucketSec: h.bucketSec, height: 240, minSpan: 1, decimals: 1, band: tempBand(), label: 'Temperature' }) : '<div class="chart-empty" style="height:240px">Loading real history…</div>'}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>pH</h2></div>
        ${h ? statRow(h.stats.ph, '', 2) : ''}
        ${h ? chartSlot({ points: h.points, key: 'ph', color: '#35E1C1', unit: '', from: h.from, to: h.to, bucketSec: h.bucketSec, height: 240, minSpan: 0.4, decimals: 2, band: phBand(), label: 'pH' }) : '<div class="chart-empty" style="height:240px">Loading real history…</div>'}
      </section>${extraTrend(h)}`;
  };
  function extraTrend(h) {
    if (!h) return '';
    const defs = [['doMgL', 'Dissolved oxygen', ' mg/L', '#8FA8FF', 1], ['flowLpm', 'Circulation flow', ' L/min', '#F4C34F', 5], ['airPumpCurrentA', 'Air pump current', ' A', '#C58BFF', 0.1]];
    return defs.filter(([k]) => h.stats[k]).map(([k, label, unit, color, span]) => `<section class="panel"><div class="panel-head"><h2>${label}</h2><span class="hint">${unit.trim()}</span></div>
      <div class="stats"><span>Low<b>${fmt(h.stats[k].min, 2)}</b></span><span>Average<b>${fmt(h.stats[k].avg, 2)}</b></span><span>High<b>${fmt(h.stats[k].max, 2)}</b></span></div>
      ${chartSlot({ points: h.points, key: k, color, unit, from: h.from, to: h.to, bucketSec: h.bucketSec, height: 200, minSpan: span, decimals: 1, label })}</section>`).join('');
  }
  VIEWS.trends.after = async () => {
    $$('[data-range]').forEach(b => b.addEventListener('click', () => { state.trendsRange = b.dataset.range; render(); }));
    const p = selectedPond();
    if (p && !state.history[p.id + '|' + state.trendsRange]) {
      try { await load.history(p.id, state.trendsRange); if (route() === 'trends') render(); } catch (e) { toast(e.message, 'err'); }
    }
  };

  // ===== Feeding
  VIEWS.feeding = () => {
    const feeders = state.integrations.filter(i => i.category === 'feeder');
    const ev = state.feeding.events;
    const intName = id => state.integrations.find(i => i.id === id)?.name || 'Removed integration';
    const intMode = id => state.integrations.find(i => i.id === id)?.mode;
    return `<div class="notice">AQUA only shows <b>Confirmed</b> when a feeder acknowledges the command. Without an acknowledgement a feeding stays <b>Command Sent</b>, and feeders controlled in their own app show <b>External App Opened</b>.</div>
    <div class="split">
      <section class="panel">
        <div class="panel-head"><h2>Feeder integration</h2><div class="spacer"></div><button class="btn sm" id="addFeeder">${I('plus')}Add feeder</button></div>
        ${feeders.length ? `<div class="list">${feeders.map(f => `<div class="list-item"><div class="int-icon">${I('feed')}</div><div class="grow"><div class="title">${esc(f.name)}</div><div class="meta">${esc(state.catalog?.providers?.[f.provider]?.label || f.provider)}, ${esc(f.mode)}${f.pondId ? ', ' + esc(f.pondId) : ''}</div></div>${intChip(f.status)}
          <button class="btn sm primary" data-feed="${esc(f.id)}" ${f.enabled && ['mqtt', 'external'].includes(f.mode) ? '' : 'disabled'}>Feed now</button></div>`).join('')}</div>`
          : `<div class="empty">No feeder connected. Add your Wi-Fi feeder under Apps &amp; Integrations. If its protocol is unknown, add it as an external app.</div>`}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Last feeding</h2></div>
        ${ev[0] ? `<div class="row" style="align-items:flex-end"><div><div class="muted small">${esc(state.ponds[ev[0].pondId]?.name || ev[0].pondId)}, ${esc(ev[0].integrationName)}</div><div style="font-size:30px;font-weight:500">${dateTime(ev[0].createdAt)}</div><div class="muted small">${ev[0].durationSec} s, ${ev[0].source === 'schedule' ? 'scheduled' : 'manual'}</div></div><div style="flex:1"></div>${feedChip(ev[0].status)}</div>
          <p class="muted small" style="margin-bottom:0">${esc(ev[0].detail || '')}</p>` : `<div class="empty">No feeding has been sent from AQUA yet.</div>`}
      </section>
    </div>
    <section class="panel">
      <div class="panel-head"><h2>Schedules</h2><span class="hint">Server local time</span><div class="spacer"></div><button class="btn sm" id="addSch" ${feeders.length ? '' : 'disabled'}>${I('plus')}Add schedule</button></div>
      ${state.feeding.schedules.length ? `<div class="scroll-x"><table class="tbl"><thead><tr><th>Time</th><th>Pond</th><th>Feeder</th><th>Duration</th><th>Runs</th><th>Enabled</th><th></th></tr></thead><tbody>
        ${state.feeding.schedules.map(s => `<tr><td style="font-size:18px">${esc(s.time)}</td><td>${esc(s.pondId)}</td><td>${esc(intName(s.integrationId))}</td><td>${s.durationSec} s</td>
          <td class="small wrap">${intMode(s.integrationId) === 'mqtt' ? 'Sent by AQUA' : '<span class="muted">Reference only, set it in the feeder app</span>'}</td>
          <td><label class="switch"><input type="checkbox" data-sch-toggle="${esc(s.id)}" ${s.enabled ? 'checked' : ''} aria-label="Enable schedule ${esc(s.time)}"><span></span></label></td>
          <td><button class="btn sm ghost" data-sch-del="${esc(s.id)}" aria-label="Delete schedule">${I('trash')}</button></td></tr>`).join('')}
      </tbody></table></div>` : `<div class="empty">No schedules. Typical plan: 08:00, 13:00, 18:00 and 22:00.</div>`}
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Feed history</h2></div>
      ${ev.length ? `<div class="scroll-x"><table class="tbl"><thead><tr><th>Time</th><th>Pond</th><th>Feeder</th><th>Duration</th><th>Source</th><th>Status</th><th>Detail</th></tr></thead><tbody>
        ${ev.slice(0, 50).map(e => `<tr><td>${dateTime(e.createdAt)}</td><td>${esc(e.pondId)}</td><td>${esc(e.integrationName)}</td><td>${e.durationSec} s</td><td>${e.source === 'schedule' ? 'Schedule' : 'Manual'}</td><td>${feedChip(e.status)}</td><td class="muted small wrap">${esc(e.detail || '')}</td></tr>`).join('')}
      </tbody></table></div>` : `<div class="empty">No feed history yet.</div>`}
    </section>`;
  };
  VIEWS.feeding.after = () => {
    $('#addFeeder')?.addEventListener('click', () => openIntegrationModal(null, { category: 'feeder' }));
    $('#addSch')?.addEventListener('click', openScheduleModal);
    $$('[data-feed]').forEach(b => b.addEventListener('click', () => {
      const f = state.integrations.find(i => i.id === b.dataset.feed);
      openFeedModal(f.pondId || selectedPond()?.id, f.id);
    }));
    $$('[data-sch-toggle]').forEach(c => c.addEventListener('change', async () => {
      const s = state.feeding.schedules.find(x => x.id === c.dataset.schToggle);
      try { await api('/feeding/schedules/' + s.id, { method: 'PUT', body: { ...s, enabled: c.checked } }); await load.feeding(); render(); }
      catch (e) { toast(e.message, 'err'); c.checked = !c.checked; }
    }));
    $$('[data-sch-del]').forEach(b => b.addEventListener('click', async () => {
      if (!await confirmDialog('Delete schedule?', 'The schedule is removed. Feed history is kept.')) return;
      try { await api('/feeding/schedules/' + b.dataset.schDel, { method: 'DELETE' }); await load.feeding(); render(); toast('Schedule deleted'); }
      catch (e) { toast(e.message, 'err'); }
    }));
  };

  function pondOptions(selected, allowFree = true) {
    const ids = new Set(pondList().map(p => p.id));
    for (const i of state.integrations) if (i.pondId) ids.add(i.pondId);
    for (const c of state.calibrations) if (c.pondId) ids.add(c.pondId);
    if (selected) ids.add(selected);
    const list = [...ids].sort();
    return `<input type="text" list="pondIds" value="${esc(selected || '')}" placeholder="POND-A" maxlength="40" ${allowFree ? '' : 'readonly'}><datalist id="pondIds">${list.map(id => `<option value="${esc(id)}">${esc(state.ponds[id]?.name || '')}</option>`).join('')}</datalist>`;
  }

  function openScheduleModal() {
    const feeders = state.integrations.filter(i => i.category === 'feeder');
    const p = selectedPond();
    const m = openModal(`<h3>Add feeding schedule</h3>
      <p class="muted small">Schedules on an MQTT feeder are sent by AQUA. For external-app feeders, set the same times inside the feeder app; AQUA keeps them as reference.</p>
      <div class="form-grid" style="margin-top:14px">
        <label class="field">Time<input type="time" id="sTime" value="08:00" required></label>
        <label class="field">Feed duration (seconds)<input type="number" id="sDur" min="1" max="300" value="10"></label>
        <label class="field">Pond<span id="sPondWrap">${pondOptions(p?.id || '')}</span></label>
        <label class="field">Feeder<select id="sInt">${feeders.map(f => `<option value="${esc(f.id)}">${esc(f.name)} (${esc(f.mode)})</option>`).join('')}</select></label>
      </div>
      <div class="modal-actions"><button class="btn" data-x>Cancel</button><button class="btn primary" id="sSave">Save schedule</button></div>`);
    m.querySelector('[data-x]').onclick = closeModal;
    m.querySelector('#sSave').onclick = async () => {
      try {
        await api('/feeding/schedules', { method: 'POST', body: {
          time: $('#sTime').value, durationSec: Number($('#sDur').value),
          pondId: $('#sPondWrap input').value.trim(), integrationId: $('#sInt').value, enabled: true } });
        closeModal(); await load.feeding(); render(); toast('Schedule saved', 'ok');
      } catch (e) { toast(e.message, 'err'); }
    };
  }

  async function openFeedModal(pondId, integrationId) {
    const pond = state.ponds[pondId];
    const feeders = feedersFor(pondId);
    if (!pondId || !feeders.length) { toast('No enabled feeder is configured for this pond', 'err'); return; }
    let reasons = null, override = false;
    const draw = () => {
      const f = feeders.find(x => x.id === ($('#fInt')?.value || integrationId)) || feeders[0];
      const dur = Number($('#fDur')?.value || 10);
      $('#fSummary').innerHTML = `<div class="muted small">Pond</div><div class="big">${esc(pond?.name || pondId)}</div>
        <div class="muted small">Feed duration</div><div class="big">${isNum(dur) && dur > 0 ? dur : DASH} seconds</div>
        <div class="muted small">${f.mode === 'external'
          ? 'This feeder is controlled in its own app. AQUA opens the app and records "External App Opened". Feed and check the result in the app.'
          : 'AQUA sends an MQTT command. It shows "Confirmed" only if the feeder acknowledges; otherwise it stays "Command Sent".'}</div>`;
      const lock = $('#fLock');
      if (reasons === null) lock.innerHTML = '<div class="muted small">Checking feeding safety…</div>';
      else if (!reasons.length) lock.innerHTML = '<span class="chip ok">Safety check passed</span>';
      else lock.innerHTML = `<div class="notice warn"><b>Feeding is paused for safety</b><ul class="reasons">${reasons.map(r => `<li>${esc(r.en)}<br><span class="muted small">${esc(r.zh)}</span></li>`).join('')}</ul>
        <label class="row" style="margin-top:10px;flex-wrap:nowrap;align-items:flex-start"><input type="checkbox" id="fOverride" ${override ? 'checked' : ''} style="margin-top:3px"><span>I have checked the pond in person and want to feed anyway</span></label></div>`;
      const go = $('#fGo');
      go.textContent = f.mode === 'external' ? 'Open feeder app' : 'Send Feed Command';
      go.disabled = reasons === null || (reasons.length > 0 && !override);
      return f;
    };
    const m = openModal(`<h3>Feed now</h3>
      <div class="form-grid" style="margin-top:12px">
        <label class="field ${feeders.length > 1 ? '' : 'full'}">Feeder<select id="fInt">${feeders.map(f => `<option value="${esc(f.id)}" ${f.id === integrationId ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label>
        <label class="field">Feed duration (seconds)<input type="number" id="fDur" min="1" max="300" value="10"></label>
      </div>
      <div class="confirm-box" id="fSummary"></div>
      <div id="fLock" style="margin-top:12px"></div>
      <p style="margin:14px 0 0;font-size:16px">Confirm feeding?</p>
      <div class="modal-actions"><button class="btn" data-x>Cancel</button><button class="btn primary" id="fGo" disabled>Send Feed Command</button></div>`);
    draw();
    m.querySelector('#fInt').onchange = draw;
    m.querySelector('#fDur').oninput = draw;
    m.addEventListener('change', e => { if (e.target.id === 'fOverride') { override = e.target.checked; draw(); } });
    m.querySelector('[data-x]').onclick = closeModal;
    m.querySelector('#fGo').onclick = async () => {
      const f = draw();
      const dur = Number($('#fDur').value);
      if (!Number.isInteger(dur) || dur < 1 || dur > 300) { toast('Duration must be 1 to 300 seconds', 'err'); return; }
      if (f.mode === 'external') {
        if (!f.launchUrl) { toast('Add a launch URL to this integration first', 'err'); return; }
        window.open(f.launchUrl, '_blank', 'noopener');
      }
      try {
        const ev = await api('/feeding/feed', { method: 'POST', body: { pondId, integrationId: f.id, durationSec: dur, override: reasons.length > 0 && override } });
        closeModal();
        toast(ev.status === 'Command Sent' ? 'Command Sent. Not confirmed until the feeder acknowledges.' : ev.status === 'Failed' ? 'Failed: ' + ev.detail : ev.status, ev.status === 'Failed' ? 'err' : '');
        await load.feeding(); render();
      } catch (e) {
        if (e.status === 409 && e.data?.reasons) { reasons = e.data.reasons; override = false; draw(); toast('Feeding paused by the safety interlock', 'err'); }
        else toast(e.message, 'err');
      }
    };
    try { reasons = (await api('/feeding/interlock?pondId=' + encodeURIComponent(pondId))).reasons; }
    catch (e) { reasons = [{ en: 'Could not check feeding safety: ' + e.message, zh: '无法检查投喂安全状态' }]; }
    if ($('#fLock')) draw();
  }

  // ===== Controls
  VIEWS.controls = () => {
    const c = state.controls?.channels || [];
    return `<div class="notice warn">Relay control arrives in v2.2.0. In v2.0.0 no channel can switch equipment, so every control below is disabled. Mains-voltage wiring must be done by a licensed electrician.</div>
    <section class="cards" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr))">${c.map(ch => `<article class="panel channel">
        <div class="ch">CH${ch.channel}</div>
        <div class="row">${I(['aerator', 'pump', 'feed', 'plug'][ch.channel - 1], '')}<h3>${esc(ch.name)}</h3></div>
        <span class="chip off" style="align-self:flex-start">Not configured</span>
        <div class="toggle-mock" aria-disabled="true">Control disabled</div>
      </article>`).join('')}</section>
    <section class="panel"><div class="panel-head"><h2>Planned path</h2></div>
      <p class="muted" style="margin:0">ESP32 relay output, then a contactor, then the aerator, pump or feeder. Each channel will report its real state back before AQUA shows it as on.</p></section>`;
  };

  // ===== Apps & Integrations
  VIEWS.apps = () => {
    const list = state.integrations;
    const P = state.catalog?.providers || {};
    return `<section class="row"><p class="muted" style="margin:0;max-width:70ch">Connect any brand. Devices without an open protocol work as an external app now and can be upgraded to MQTT, REST or native control later without changing the rest of AQUA.</p><div style="flex:1"></div><button class="btn primary" id="addInt">${I('plus')}Add integration</button></section>
    ${list.length ? `<section class="cards">${list.map(it => `<article class="panel int-card">
        <div class="top"><div class="int-icon">${I(PROVIDER_UI[it.provider]?.icon || 'apps')}</div>
          <div style="flex:1;min-width:0"><h3>${esc(it.name)}</h3><div class="meta">${esc(P[it.provider]?.label || it.provider)}, ${esc(it.category)}</div></div>
          ${intChip(it.status)}</div>
        <div class="meta small">Mode <b style="color:var(--text-2)">${esc(it.mode)}</b>${it.pondId ? ', pond ' + esc(it.pondId) : ', all ponds'}${it.mqttCommandTopic ? '<br>Topic <code>' + esc(it.mqttCommandTopic) + '</code>' : ''}</div>
        ${it.notes ? `<div class="muted small">${esc(it.notes)}</div>` : ''}
        <div class="actions">
          ${it.mode === 'external' && it.launchUrl && it.enabled ? `<a class="btn sm primary" href="${esc(it.launchUrl)}" target="_blank" rel="noopener" data-opened="${esc(it.id)}">${I('external')}Open app</a>` : ''}
          <button class="btn sm" data-edit="${esc(it.id)}">${I('edit')}Edit</button>
          <button class="btn sm ghost danger" data-del="${esc(it.id)}">${I('trash')}Delete</button>
        </div>
      </article>`).join('')}</section>`
      : `<section class="panel"><div class="empty big"><b>No integrations yet</b>Add your ESP32, a Wi-Fi feeder, a Tapo camera, VSON Smart or any other app. Nothing is pre-filled or simulated.</div></section>`}`;
  };
  VIEWS.apps.after = () => {
    $('#addInt')?.addEventListener('click', () => openIntegrationModal(null));
    $$('[data-edit]').forEach(b => b.addEventListener('click', () => openIntegrationModal(state.integrations.find(i => i.id === b.dataset.edit))));
    $$('[data-opened]').forEach(a => a.addEventListener('click', () => api(`/integrations/${a.dataset.opened}/opened`, { method: 'POST' }).catch(() => {})));
    $$('[data-del]').forEach(b => b.addEventListener('click', async () => {
      const it = state.integrations.find(i => i.id === b.dataset.del);
      if (!await confirmDialog(`Delete ${it.name}?`, 'The integration is removed from AQUA. The device itself is not changed.')) return;
      try { await api('/integrations/' + it.id, { method: 'DELETE' }); await load.integrations(); render(); toast('Integration deleted'); }
      catch (e) { toast(e.message, 'err'); }
    }));
  };

  function openIntegrationModal(existing, preset = {}) {
    const P = state.catalog?.providers || {};
    if (!existing && !preset.provider) {
      const m = openModal(`<h3>Add integration</h3><p class="muted small">Choose what you are connecting.</p>
        <div class="provider-grid" style="margin-top:14px">${Object.entries(P).map(([k, v]) => `<button data-prov="${k}">${I(PROVIDER_UI[k]?.icon || 'apps')}<b>${esc(v.label)}</b><span>${esc(PROVIDER_UI[k]?.desc || '')}</span></button>`).join('')}</div>
        <div class="modal-actions"><button class="btn" data-x>Cancel</button></div>`, { wide: true });
      m.querySelector('[data-x]').onclick = closeModal;
      m.querySelectorAll('[data-prov]').forEach(b => b.onclick = () => openIntegrationModal(null, { ...preset, provider: b.dataset.prov }));
      return;
    }
    const it = existing || {
      provider: preset.provider, name: P[preset.provider]?.label || '', category: preset.category || P[preset.provider]?.category,
      mode: P[preset.provider]?.defaultMode, pondId: selectedPond()?.id || '', launchUrl: '', apiBaseUrl: '', mqttCommandTopic: '', notes: '', enabled: true
    };
    const prov = P[it.provider];
    const m = openModal(`<h3>${existing ? 'Edit' : 'Add'} ${esc(prov.label)} integration</h3>
      <div class="form-grid" style="margin-top:14px">
        <label class="field full">Name<input type="text" id="iName" maxlength="80" value="${esc(it.name)}"></label>
        <label class="field">Category<select id="iCat">${state.catalog.categories.map(c => `<option ${c === it.category ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
        <label class="field">Mode<select id="iMode">${prov.modes.map(md => `<option ${md === it.mode ? 'selected' : ''}>${md}</option>`).join('')}</select></label>
        <p class="full muted small" id="iModeText" style="margin:-4px 0 0"></p>
        <label class="field">Pond<small>Leave empty to use it for all ponds</small><span id="iPondWrap">${pondOptions(it.pondId)}</span></label>
        <label class="field" data-show="external">Launch URL<small>Web or app link, e.g. https://… or an app link from the maker</small><input type="url" id="iLaunch" value="${esc(it.launchUrl)}" placeholder="https://"></label>
        <label class="field" data-show="rest onvif">API base URL / stream address<small>http://… or rtsp://…</small><input type="url" id="iApi" value="${esc(it.apiBaseUrl)}" placeholder="rtsp:// or http://"></label>
        <label class="field" data-show="mqtt">MQTT command topic<small>Leave empty to use the pond's own topic. Acknowledgements go to …/pond/&lt;POND_ID&gt;/ack</small><input type="text" id="iTopic" value="${esc(it.mqttCommandTopic)}" placeholder="aqua/site/SITE-01/pond/POND-A/command/feed"></label>
        <label class="field full">Notes<textarea id="iNotes" maxlength="1000">${esc(it.notes)}</textarea></label>
        <div class="row full"><label class="switch"><input type="checkbox" id="iEnabled" ${it.enabled ? 'checked' : ''}><span></span></label><span>Enabled</span></div>
      </div>
      <div class="modal-actions"><button class="btn" data-x>Cancel</button><button class="btn primary" id="iSave">${existing ? 'Save changes' : 'Add integration'}</button></div>`, { wide: true });
    const sync = () => {
      const md = $('#iMode').value;
      $('#iModeText').textContent = MODE_TEXT[md] || '';
      m.querySelectorAll('[data-show]').forEach(el => { el.style.display = el.dataset.show.split(' ').includes(md) ? '' : 'none'; });
    };
    sync();
    $('#iMode').onchange = sync;
    m.querySelector('[data-x]').onclick = closeModal;
    $('#iSave').onclick = async () => {
      const body = {
        provider: it.provider, name: $('#iName').value, category: $('#iCat').value, mode: $('#iMode').value,
        pondId: $('#iPondWrap input').value.trim(), launchUrl: $('#iLaunch').value.trim(), apiBaseUrl: $('#iApi').value.trim(),
        mqttCommandTopic: $('#iTopic').value.trim(), notes: $('#iNotes').value, enabled: $('#iEnabled').checked
      };
      try {
        await api(existing ? '/integrations/' + existing.id : '/integrations', { method: existing ? 'PUT' : 'POST', body });
        closeModal(); await load.integrations(); render(); toast(existing ? 'Integration saved' : 'Integration added', 'ok');
      } catch (e) { toast(e.message, 'err'); }
    };
  }

  // ===== Alerts
  const COND_EQ = { pumpRunning: 'Flow below running level (pump stopped)', airPumpRunning: 'Current below running level (air pump stopped)', sensorMissing: 'An installed sensor sends no valid value' };
  function condCell(r) {
    const unit = { temperatureC: ' °C', doMgL: ' mg/L' }[r.metric] || '';
    if (r.metric === 'offline') return `No telemetry for ${Math.round((state.info?.settings?.offlineAfterSec || 300) / 60)} min`;
    if (r.metric === 'waterLevel') return r.threshold === 'low' ? 'Low float switch triggered' : 'High float switch triggered';
    if (r.op === 'eq') return COND_EQ[r.metric] || DASH;
    const label = r.metric === 'phSwing24h' ? '24 h swing above' : r.op === 'lt' ? 'Below' : 'Above';
    return `<div class="row" style="flex-wrap:nowrap">${label} <input type="number" step="0.1" style="width:90px" data-rule-th="${esc(r.id)}" value="${esc(r.threshold)}">${unit}</div>`;
  }
  VIEWS.alerts = () => {
    const act = activeAlerts();
    const unit = m => (m === 'temperatureC' ? ' °C' : '');
    return `<section class="panel">
      <div class="panel-head"><h2>Active alerts</h2></div>
      ${act.length ? `<div class="list">${act.map(a => `<div class="list-item">${sevChip(a.severity)}<div class="grow"><div class="title">${esc(a.message)}</div><div class="meta">${esc(a.pondName)}, condition since ${dateTime(a.startedAt)}</div></div>
        ${a.acknowledged ? '<span class="chip off">Acknowledged</span>' : `<button class="btn sm" data-ack="${esc(a.id)}">Acknowledge</button>`}</div>`).join('')}</div>`
        : `<div class="empty">No active alerts.</div>`}
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Rules</h2><span class="hint">A condition must hold continuously for the whole duration. One bad sample never alerts.</span></div>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>Rule</th><th>Condition</th><th>Sustained for</th><th>Severity</th><th>Enabled</th></tr></thead><tbody>
      ${state.alerts.rules.map(r => `<tr>
        <td>${esc(r.name)}<div class="muted small">${esc(r.nameZh || '')}</div></td>
        <td>${condCell(r)}</td>
        <td>${r.metric === 'offline' ? DASH : `<div class="row" style="flex-wrap:nowrap"><input type="number" min="0" max="60" step="0.5" style="width:76px" data-rule-sus="${esc(r.id)}" value="${r.sustainSec / 60}"> min</div>`}</td>
        <td>${sevChip(r.severity)}</td>
        <td><label class="switch"><input type="checkbox" data-rule-en="${esc(r.id)}" ${r.enabled ? 'checked' : ''} aria-label="Enable ${esc(r.name)}"><span></span></label></td>
      </tr>`).join('')}</tbody></table></div>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Notification channels</h2></div>
      <div class="row"><span class="chip ok">In-app: active</span>${state.info?.notifications?.pushover?.enabled ? '<span class="chip ok">Phone push (Pushover): active</span>' : '<a class="chip warn" href="#/settings">Phone push: not set up</a>'}<span class="chip off">WhatsApp: planned</span><span class="chip off">Email: planned</span></div>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>History</h2></div>
      ${state.alerts.alerts.length ? `<div class="scroll-x"><table class="tbl"><thead><tr><th>Started</th><th>Pond</th><th>Alert</th><th>Severity</th><th>Resolved</th></tr></thead><tbody>
        ${state.alerts.alerts.slice(0, 60).map(a => `<tr><td>${dateTime(a.startedAt)}</td><td>${esc(a.pondName)}</td><td class="wrap">${esc(a.message)}</td><td>${sevChip(a.severity)}</td><td>${a.resolvedAt ? dateTime(a.resolvedAt) : '<span class="chip crit">Active</span>'}</td></tr>`).join('')}
      </tbody></table></div>` : `<div class="empty">No alerts have been raised.</div>`}
    </section>`;
  };
  VIEWS.alerts.after = () => {
    const save = async (id, body) => {
      try { await api('/alerts/rules/' + id, { method: 'PUT', body }); await load.alerts(); toast('Rule saved', 'ok'); render(); }
      catch (e) { toast(e.message, 'err'); render(); }
    };
    $$('[data-rule-th]').forEach(i => i.addEventListener('change', () => save(i.dataset.ruleTh, { threshold: Number(i.value) })));
    $$('[data-rule-sus]').forEach(i => i.addEventListener('change', () => save(i.dataset.ruleSus, { sustainSec: Math.round(Number(i.value) * 60) })));
    $$('[data-rule-en]').forEach(i => i.addEventListener('change', () => save(i.dataset.ruleEn, { enabled: i.checked })));
    $$('[data-ack]').forEach(b => b.addEventListener('click', async () => {
      try { await api('/alerts/' + b.dataset.ack + '/ack', { method: 'POST' }); await load.alerts(); render(); } catch (e) { toast(e.message, 'err'); }
    }));
  };

  // ===== Calibration
  function phFromRaw(raw, points) {
    const pts = (points || []).map(p => ({ ph: Number(p.ph), raw: Number(p.raw) })).filter(p => isNum(p.ph) && isNum(p.raw) && p.raw > 0 && p.raw < 4095).sort((a, b) => b.raw - a.raw);
    if (!isNum(raw) || raw <= 10 || raw >= 4090 || pts.length < 2) return null;
    let a, b;
    if (raw >= pts[0].raw) { a = pts[0]; b = pts[1]; }
    else if (raw <= pts[pts.length - 1].raw) { a = pts[pts.length - 2]; b = pts[pts.length - 1]; }
    else for (let i = 0; i < pts.length - 1; i++) if (raw <= pts[i].raw && raw >= pts[i + 1].raw) { a = pts[i]; b = pts[i + 1]; break; }
    if (!a || a.raw === b.raw) return null;
    return Math.min(14, Math.max(0, a.ph + (raw - a.raw) * (b.ph - a.ph) / (b.raw - a.raw)));
  }
  const rawAt = (c, phv) => c.points.find(p => Math.abs(p.ph - phv) < 0.05)?.raw ?? DASH;

  VIEWS.calibration = () => {
    const p = selectedPond();
    const L = p?.latest;
    const active = state.calibrations.find(c => c.active && c.pondId === p?.id) || state.calibrations.find(c => c.active);
    const vPin = L?.phVoltage;
    const vMod = isNum(vPin) && active ? vPin * (active.dividerTopOhm + active.dividerBottomOhm) / active.dividerBottomOhm : null;
    return `<div class="split">
      <section class="panel">
        <div class="panel-head"><h2>Active probe ${active ? esc(active.probeId) : ''}</h2><div class="spacer"></div>${active ? `<span class="chip ok">Active for ${esc(active.pondId)}</span>` : ''}</div>
        ${active ? `<div class="metric" style="min-height:0;padding:0;gap:14px">
          <dl class="kv" style="grid-template-columns:auto 1fr;font-size:14px">
            <dt>Probe ID</dt><dd>${esc(active.probeId)}</dd>
            <dt>Pond / device</dt><dd>${esc(active.pondId)}${active.deviceId ? ' / ' + esc(active.deviceId) : ''}</dd>
            <dt>Calibration date</dt><dd>${esc(active.calibrationDate)}</dd>
            <dt>ADC pin</dt><dd>${esc(active.adcPin)}</dd>
            <dt>Voltage divider</dt><dd>${active.dividerTopOhm / 1000}k top, ${active.dividerBottomOhm / 1000}k bottom</dd>
            <dt>Temperature compensation</dt><dd>${isNum(active.calTempC) ? 'On, buffers at ' + active.calTempC + ' °C' : 'Off: add the buffer temperature'}</dd>
          </dl>
          <table class="tbl"><thead><tr><th>Buffer</th><th>RAW</th><th>Pin voltage</th></tr></thead><tbody>
            ${active.points.map(pt => `<tr><td>pH ${fmt(pt.ph)}</td><td>${pt.raw}</td><td>${fmt(pt.raw / 4095 * 3.3, 3)} V</td></tr>`).join('')}
          </tbody></table>
          <div class="muted small">Piecewise linear between buffers. Slopes: ${(active.analysis?.segments || []).map(s => `pH ${s.from}–${s.to}: ${s.phPer100Raw} pH per 100 RAW`).join('; ') || DASH}</div>
        </div>` : `<div class="empty">No calibration stored.</div>`}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Live probe reading</h2><span class="hint">${p ? esc(p.name) : ''}</span></div>
        ${L ? `<div class="metric" style="min-height:0;padding:0">
          <div class="value" style="font-size:46px" id="calLivePh">${fmt(L.ph)}</div>
          <dl class="kv" style="font-size:14px">
            <dt>RAW (averaged)</dt><dd id="calLiveRaw">${esc(L.phRaw ?? DASH)}</dd>
            <dt>Voltage at GPIO34</dt><dd>${fmt(vPin, 3)} V</dd>
            <dt>Module PO voltage</dt><dd>${fmt(vMod, 3)} V</dd>
            <dt>Computed by</dt><dd>${L.phSource?.startsWith('server') ? 'AQUA, probe ' + esc(L.phSource.split(':')[1]) : 'ESP32 firmware'}</dd>
            <dt>Reading time</dt><dd>${clock(L.ts)}</dd>
          </dl></div>
          <p class="muted small">To calibrate: rinse the probe, put it in a buffer, wait for RAW to settle over 2 to 3 readings, then record it in a new calibration.</p>`
          : `<div class="empty">Waiting for real ESP32 telemetry. Live RAW appears here for calibrating.</div>`}
      </section>
    </div>
    <section class="panel">
      <div class="panel-head"><h2>Calibration records</h2><span class="hint">Each record is tied to a physical probe and pond</span><div class="spacer"></div><button class="btn sm primary" id="newCal">${I('plus')}New calibration</button></div>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>Probe</th><th>Pond</th><th>Date</th><th>pH 4.01 RAW</th><th>pH 6.86 RAW</th><th>pH 9.18 RAW</th><th>Status</th><th></th></tr></thead><tbody>
        ${state.calibrations.map(c => `<tr><td>${esc(c.probeId)}</td><td>${esc(c.pondId)}</td><td>${esc(c.calibrationDate)}</td><td>${rawAt(c, 4.01)}</td><td>${rawAt(c, 6.86)}</td><td>${rawAt(c, 9.18)}</td>
          <td>${c.active ? '<span class="chip ok">Active</span>' : `<button class="btn sm" data-act-cal="${esc(c.id)}">Make active</button>`}</td>
          <td class="row" style="flex-wrap:nowrap"><button class="btn sm ghost" data-edit-cal="${esc(c.id)}" aria-label="Edit">${I('edit')}</button>${c.active ? '' : `<button class="btn sm ghost" data-del-cal="${esc(c.id)}" aria-label="Delete">${I('trash')}</button>`}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="muted small" style="margin-bottom:0">AQUA recalculates pH from the ESP32's RAW value using the active record for that pond, so a replacement probe only needs a new record, not new firmware.</p>
    </section>`;
  };
  VIEWS.calibration.after = () => {
    $('#newCal')?.addEventListener('click', () => openCalModal(null));
    $$('[data-edit-cal]').forEach(b => b.addEventListener('click', () => openCalModal(state.calibrations.find(c => c.id === b.dataset.editCal))));
    $$('[data-act-cal]').forEach(b => b.addEventListener('click', async () => {
      try { await api('/calibrations/' + b.dataset.actCal + '/activate', { method: 'POST' }); await load.calibrations(); await load.ponds(); render(); toast('Calibration activated', 'ok'); } catch (e) { toast(e.message, 'err'); }
    }));
    $$('[data-del-cal]').forEach(b => b.addEventListener('click', async () => {
      if (!await confirmDialog('Delete calibration?', 'This calibration record will be removed.')) return;
      try { await api('/calibrations/' + b.dataset.delCal, { method: 'DELETE' }); await load.calibrations(); render(); } catch (e) { toast(e.message, 'err'); }
    }));
  };

  function openCalModal(existing) {
    const p = selectedPond();
    const c = existing || { probeId: '', pondId: p?.id || '', deviceId: p?.deviceId || '', calibrationDate: new Date().toISOString().slice(0, 10),
      points: [{ ph: 4.01, raw: '' }, { ph: 6.86, raw: '' }, { ph: 9.18, raw: '' }], adcPin: 'GPIO34', dividerTopOhm: 20000, dividerBottomOhm: 10000, notes: '' };
    const pts = [0, 1, 2].map(i => c.points[i] || { ph: '', raw: '' });
    const m = openModal(`<h3>${existing ? 'Edit calibration' : 'New calibration'}</h3>
      <div class="form-grid" style="margin-top:14px">
        <label class="field">Probe ID<input type="text" id="cProbe" maxlength="40" value="${esc(c.probeId)}" placeholder="PH-02"></label>
        <label class="field">Calibration date<input type="date" id="cDate" value="${esc(c.calibrationDate)}"></label>
        <label class="field">Buffer temperature (°C)<small>Turns on temperature compensation</small><input type="number" step="0.1" id="cTemp" value="${esc(c.calTempC ?? '')}"></label>
        <label class="field">Pond<span id="cPondWrap">${pondOptions(c.pondId)}</span></label>
        <label class="field">Device ID<input type="text" id="cDev" maxlength="40" value="${esc(c.deviceId)}"></label>
      </div>
      <div class="panel" style="margin-top:14px;padding:12px 14px;background:rgba(3,9,14,.4)">
        <div class="row" style="justify-content:space-between"><b>Buffer points</b><span class="muted small">Live RAW: <b id="cLive" style="color:var(--aqua)">${esc(p?.latest?.phRaw ?? DASH)}</b></span></div>
        ${pts.map((pt, i) => `<div class="row" style="margin-top:10px;flex-wrap:nowrap">
          <label class="field" style="flex:1">Buffer pH<input type="number" step="0.01" data-cph="${i}" value="${esc(pt.ph)}"></label>
          <label class="field" style="flex:1">RAW<input type="number" step="1" data-craw="${i}" value="${esc(pt.raw)}"></label>
          <button class="btn sm" data-uselive="${i}" style="align-self:flex-end;height:40px" ${isNum(p?.latest?.phRaw) ? '' : 'disabled'}>Use live</button></div>`).join('')}
        <div class="muted small" id="cPreview" style="margin-top:10px"></div>
      </div>
      <div class="form-grid" style="margin-top:14px">
        <label class="field">ADC pin<input type="text" id="cPin" value="${esc(c.adcPin)}"></label>
        <div class="row" style="gap:10px;flex-wrap:nowrap"><label class="field" style="flex:1">Divider top Ω<input type="number" id="cTop" value="${esc(c.dividerTopOhm)}"></label><label class="field" style="flex:1">Divider bottom Ω<input type="number" id="cBot" value="${esc(c.dividerBottomOhm)}"></label></div>
        <label class="field full">Notes<textarea id="cNotes" maxlength="1000">${esc(c.notes)}</textarea></label>
        ${existing ? '' : '<div class="row full"><label class="switch"><input type="checkbox" id="cActivate" checked><span></span></label><span>Make this the active calibration for the pond</span></div>'}
      </div>
      <div class="modal-actions"><button class="btn" data-x>Cancel</button><button class="btn primary" id="cSave">Save calibration</button></div>`, { wide: true });
    const readPts = () => [0, 1, 2].map(i => ({ ph: Number(m.querySelector(`[data-cph="${i}"]`).value), raw: Number(m.querySelector(`[data-craw="${i}"]`).value) })).filter(x => m && x.raw > 0 && x.ph > 0);
    const preview = () => {
      const live = selectedPond()?.latest?.phRaw;
      const v = phFromRaw(live, readPts());
      $('#cPreview').textContent = isNum(v) ? `With these points, the live RAW ${live} reads pH ${v.toFixed(2)}.` : 'Enter at least two buffer points to preview.';
    };
    m.addEventListener('input', preview);
    m.querySelectorAll('[data-uselive]').forEach(b => b.onclick = () => {
      const raw = selectedPond()?.latest?.phRaw;
      if (isNum(raw)) { m.querySelector(`[data-craw="${b.dataset.uselive}"]`).value = raw; preview(); }
    });
    preview();
    m.querySelector('[data-x]').onclick = closeModal;
    $('#cSave').onclick = async () => {
      const body = { probeId: $('#cProbe').value, calibrationDate: $('#cDate').value, calTempC: $('#cTemp').value === '' ? null : Number($('#cTemp').value), pondId: $('#cPondWrap input').value.trim(), deviceId: $('#cDev').value,
        points: readPts(), adcPin: $('#cPin').value, dividerTopOhm: Number($('#cTop').value), dividerBottomOhm: Number($('#cBot').value), notes: $('#cNotes').value,
        activate: existing ? undefined : $('#cActivate').checked };
      try {
        await api(existing ? '/calibrations/' + existing.id : '/calibrations', { method: existing ? 'PUT' : 'POST', body });
        closeModal(); await load.calibrations(); await load.ponds(); render(); toast('Calibration saved', 'ok');
      } catch (e) { toast(e.message, 'err'); }
    };
  }

  // ===== Water quality (manual test-kit log)
  const WQ = [
    ['tanMgL', 'Total ammonia N', 'mg/L', 2],
    ['nh3nMgL', 'Un-ionised NH₃-N', 'mg/L', 3],
    ['no2nMgL', 'Nitrite N', 'mg/L', 2],
    ['no3nMgL', 'Nitrate N', 'mg/L', 1],
    ['alkalinityMgL', 'Alkalinity', 'mg/L', 0],
    ['salinityPpt', 'Salinity', 'ppt', 1]
  ];
  const flagChip = (f, text) => `<span class="chip ${f === 'crit' ? 'crit' : f === 'warn' ? 'warn' : f === 'ok' ? 'ok' : 'off'}">${text}</span>`;
  const pondIdForLogs = () => selectedPond()?.id || state.water.entries[0]?.pondId || state.cycles[0]?.pondId || null;
  const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const profileOf = id => state.full?.pondProfiles?.[id] || {};

  VIEWS.water = () => {
    const pid = pondIdForLogs();
    const list = state.water.entries.filter(w => !pid || w.pondId === pid);
    const lim = state.water.limits || {};
    const prof = profileOf(pid);
    const vol = prof.systemVolumeM3 ?? prof.volumeM3;
    const latestOf = k => list.find(w => isNum(w[k]));
    const cards = WQ.map(([k, label, unit, d]) => {
      const e = latestOf(k), l = lim[k] || {};
      const range = [isNum(l.warnLow) ? 'at least ' + l.warnLow : '', isNum(l.warnHigh) ? 'at most ' + l.warnHigh : ''].filter(Boolean).join(', ');
      return `<article class="panel wq-card ${e ? 'wq-' + (e.flags?.[k] || 'ok') : ''}"><div class="muted small">${label}${k === 'nh3nMgL' ? ' (calculated)' : ''}</div>
        <div class="wq-val">${e ? fmt(e[k], d) : DASH}<span class="unit"> ${unit}</span></div>
        <div class="muted small">${e ? dateTime(e.ts) : 'No test yet'}${range ? '<br>Target ' + range : ''}</div></article>`;
    }).join('');
    const lastAlk = latestOf('alkalinityMgL');
    const target = lim.alkalinityMgL?.target;
    let dose = '';
    if (lastAlk && isNum(target) && lastAlk.alkalinityMgL < target) {
      dose = isNum(lastAlk.bicarbDoseG)
        ? `<div class="notice warn"><b>Alkalinity ${fmt(lastAlk.alkalinityMgL, 0)} mg/L is below the ${target} mg/L target.</b> For the ${vol} m³ system that is about <b>${lastAlk.bicarbDoseG} g of sodium bicarbonate</b> (baking soda). Dissolve it in system water, add it in 2 to 3 portions a few hours apart, then test again.</div>`
        : `<div class="notice">Alkalinity is below target. Enter this pond's system water volume in Settings to get a sodium bicarbonate dose.</div>`;
    }
    return `<section class="row"><p class="muted" style="margin:0;max-width:72ch">Results from your test kits${pid ? ' for ' + esc(state.ponds[pid]?.name || pid) : ''}. AQUA works out the toxic un-ionised ammonia from total ammonia using the pH and temperature at the time of the test.</p><div style="flex:1"></div>
        <button class="btn" id="wqLimits">Limits</button><button class="btn primary" id="wqAdd">${I('plus')}Add test result</button></section>
      ${dose}
      <section class="wq-grid">${cards}</section>
      <section class="panel"><div class="panel-head"><h2>Test history</h2></div>
      ${list.length ? `<div class="scroll-x"><table class="tbl"><thead><tr><th>Time</th>${WQ.map(([, l]) => `<th>${l}</th>`).join('')}<th>pH / °C used</th><th>By</th><th></th></tr></thead><tbody>
        ${list.slice(0, 60).map(e => `<tr><td>${dateTime(e.ts)}</td>${WQ.map(([k, , , d]) => `<td>${isNum(e[k]) ? flagChip(e.flags?.[k], fmt(e[k], d)) : '<span class="muted">—</span>'}</td>`).join('')}
          <td class="small muted">${isNum(e.phAtTest) && isNum(e.tempAtTest) ? fmt(e.phAtTest) + ' / ' + fmt(e.tempAtTest, 1) + (e.phTempSource === 'live sensor' ? ' (live)' : '') : DASH}</td><td>${esc(e.by || '')}</td>
          <td><button class="btn sm ghost" data-wq-del="${esc(e.id)}" aria-label="Delete">${I('trash')}</button></td></tr>`).join('')}
      </tbody></table></div>` : `<div class="empty">No test results yet. While the biofilter is new, test ammonia and nitrite every day; once it is stable, 2 to 3 times a week.</div>`}
      </section>`;
  };
  VIEWS.water.after = () => {
    $('#wqAdd')?.addEventListener('click', openWaterModal);
    $('#wqLimits')?.addEventListener('click', openLimitsModal);
    $$('[data-wq-del]').forEach(b => b.addEventListener('click', async () => {
      if (!await confirmDialog('Delete test result?', 'This result will be removed from the log.')) return;
      try { await api('/water/' + b.dataset.wqDel, { method: 'DELETE' }); await load.water(); render(); } catch (e) { toast(e.message, 'err'); }
    }));
  };
  function openWaterModal() {
    const pid = pondIdForLogs() || '';
    const live = state.ponds[pid]?.latest;
    const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    const m = openModal(`<h3>Add test result</h3><p class="muted small">Leave a box empty if you did not test it.</p>
      <div class="form-grid" style="margin-top:12px">
        <label class="field">Pond<span id="wPond">${pondOptions(pid)}</span></label>
        <label class="field">Tested at<input type="datetime-local" id="wTs" value="${now.toISOString().slice(0, 16)}"></label>
        <label class="field">Total ammonia N (TAN), mg/L<input type="number" step="0.01" min="0" data-w="tanMgL"></label>
        <label class="field">Nitrite N (NO₂-N), mg/L<input type="number" step="0.01" min="0" data-w="no2nMgL"></label>
        <label class="field">Nitrate N (NO₃-N), mg/L<input type="number" step="0.1" min="0" data-w="no3nMgL"></label>
        <label class="field">Alkalinity, mg/L as CaCO₃<input type="number" step="1" min="0" data-w="alkalinityMgL"></label>
        <label class="field">Salinity, ppt<input type="number" step="0.1" min="0" data-w="salinityPpt"></label>
        <label class="field">Tested by<input type="text" id="wBy" maxlength="40"></label>
        <label class="field">pH at test<small>Empty = live sensor${live && isNum(live.ph) ? ' (' + fmt(live.ph) + ')' : ''}</small><input type="number" step="0.01" id="wPh"></label>
        <label class="field">Water temperature at test, °C<small>Empty = live sensor${live && isNum(live.temperatureC) ? ' (' + fmt(live.temperatureC, 1) + ')' : ''}</small><input type="number" step="0.1" id="wT"></label>
        <label class="field full">Notes<textarea id="wNotes" maxlength="500"></textarea></label>
      </div>
      <p class="muted small">Kit shows the ion instead of nitrogen? Divide NH₄⁺ by 1.29, NO₂⁻ by 3.29 and NO₃⁻ by 4.43 to get the N value.</p>
      <div class="modal-actions"><button class="btn" data-x>Cancel</button><button class="btn primary" id="wSave">Save result</button></div>`, { wide: true });
    m.querySelector('[data-x]').onclick = closeModal;
    $('#wSave').onclick = async () => {
      const body = {
        pondId: $('#wPond input').value.trim(), ts: $('#wTs').value ? new Date($('#wTs').value).toISOString() : undefined,
        by: $('#wBy').value, notes: $('#wNotes').value,
        phAtTest: $('#wPh').value === '' ? null : Number($('#wPh').value), tempAtTest: $('#wT').value === '' ? null : Number($('#wT').value)
      };
      m.querySelectorAll('[data-w]').forEach(i => { body[i.dataset.w] = i.value === '' ? null : Number(i.value); });
      try {
        const e = await api('/water', { method: 'POST', body });
        closeModal(); await Promise.all([load.water(), load.alerts()]); render();
        const bad = Object.entries(e.flags || {}).filter(([, f]) => f !== 'ok');
        toast(bad.length ? 'Saved. Out of range: ' + bad.map(([k]) => (WQ.find(w => w[0] === k) || [k, k])[1]).join(', ') : 'Saved. All results within limits.', bad.length ? 'err' : 'ok');
      } catch (err) { toast(err.message, 'err'); }
    };
  }
  function openLimitsModal() {
    const lim = state.water.limits || {};
    const F = ['critLow', 'warnLow', 'warnHigh', 'critHigh'];
    const m = openModal(`<h3>Water quality limits</h3><p class="muted small">Defaults are for Pacific white shrimp in low-salinity RAS. Leave a box empty for no limit.</p>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>Parameter</th><th>Critical below</th><th>Warning below</th><th>Warning above</th><th>Critical above</th></tr></thead><tbody>
      ${Object.entries(lim).map(([k, l]) => `<tr><td>${esc(l.name)}<div class="muted small">${esc(l.nameZh)}, ${esc(l.unit)}</div></td>${F.map(f => `<td><input type="number" step="0.01" style="width:90px" data-lim="${k}" data-f="${f}" value="${isNum(l[f]) ? l[f] : ''}"></td>`).join('')}</tr>`).join('')}
      </tbody></table></div>
      <label class="field" style="margin-top:12px;max-width:280px">Alkalinity target for dosing, mg/L<input type="number" id="limTarget" value="${lim.alkalinityMgL?.target ?? ''}"></label>
      <div class="modal-actions"><button class="btn" data-x>Cancel</button><button class="btn primary" id="limSave">Save limits</button></div>`, { wide: true });
    m.querySelector('[data-x]').onclick = closeModal;
    $('#limSave').onclick = async () => {
      const body = {};
      m.querySelectorAll('[data-lim]').forEach(i => { (body[i.dataset.lim] ||= {})[i.dataset.f] = i.value === '' ? null : Number(i.value); });
      (body.alkalinityMgL ||= {}).target = $('#limTarget').value === '' ? null : Number($('#limTarget').value);
      try { await api('/water/limits', { method: 'PUT', body }); closeModal(); await load.water(); render(); toast('Limits saved', 'ok'); } catch (e) { toast(e.message, 'err'); }
    };
  }

  // ===== Crop cycle
  const REC_LABEL = { sample: 'Weight sample', mortality: 'Dead shrimp', feed: 'Feed', harvest: 'Harvest' };
  function recValue(r) {
    if (r.type === 'sample') return fmt(r.avgWeightG) + ' g average' + (isNum(r.sampleCount) ? ` (${r.sampleCount} weighed)` : '');
    if (r.type === 'mortality') return r.count.toLocaleString() + ' dead';
    if (r.type === 'feed') return fmt(r.kg, 2) + ' kg';
    if (r.type === 'harvest') return fmt(r.kg, 1) + ' kg' + (isNum(r.count) ? ', ' + r.count.toLocaleString() + ' shrimp' : '');
    return DASH;
  }
  VIEWS.cycle = () => {
    const pid = pondIdForLogs();
    const mine = state.cycles.filter(c => !pid || c.pondId === pid);
    const active = mine.find(c => c.status === 'active');
    const closed = mine.filter(c => c.status !== 'active');
    const prof = profileOf(pid);
    let body;
    if (!active) {
      body = `<section class="panel"><div class="empty big"><b>No active production cycle${pid ? ' for ' + esc(state.ponds[pid]?.name || pid) : ''}</b>Start a cycle on stocking day. Record weekly weight samples, feed in kg and any dead shrimp found. AQUA then estimates survival, biomass, growth and FCR: the numbers that show whether the POC worked.
        <div style="margin-top:16px"><button class="btn primary" id="cyStart">${I('plus')}Start cycle</button></div></div></section>`;
    } else {
      const s = active.summary;
      const st = (label, v, sub = '') => `<div class="stat"><div class="muted small">${label}</div><div class="stat-v">${v}</div>${sub ? `<div class="muted small">${sub}</div>` : ''}</div>`;
      body = `<section class="panel"><div class="panel-head"><h2>Cycle started ${esc(active.startDate)}</h2><span class="hint">${esc(active.plSource || '')}</span><div class="spacer"></div><button class="btn sm primary" id="cyRec">${I('plus')}Add record</button><button class="btn sm ghost" id="cyClose">Close cycle</button></div>
        <div class="stat-grid">
          ${st('Day of culture', s.doc)}
          ${st('Stocked', s.stocked?.toLocaleString() ?? DASH, active.initialWeightG ? active.initialWeightG + ' g each' : '')}
          ${st('Estimated alive', s.aliveEst?.toLocaleString() ?? DASH, s.mortality ? s.mortality.toLocaleString() + ' counted dead' : 'no deaths recorded')}
          ${st('Estimated survival', isNum(s.survivalEstPct) ? s.survivalEstPct + ' %' : DASH, 'from counted deaths only')}
          ${st('Average weight', isNum(s.abwG) ? fmt(s.abwG) + ' g' : DASH, s.lastSampleDate ? 'sampled ' + s.lastSampleDate : 'no sample yet')}
          ${st('Growth', isNum(s.weeklyGainG) ? fmt(s.weeklyGainG) + ' g/week' : isNum(s.adgG) ? fmt(s.adgG, 3) + ' g/day' : DASH, isNum(s.weeklyGainG) ? 'between the last two samples' : 'since stocking')}
          ${st('Estimated biomass', isNum(s.biomassEstKg) ? fmt(s.biomassEstKg, 1) + ' kg' : DASH, isNum(s.biomassKgPerM3) ? fmt(s.biomassKgPerM3) + ' kg/m³' : (prof.volumeM3 ? '' : 'set tank volume in Settings'))}
          ${st('Feed used', fmt(s.feedKg, 1) + ' kg')}
          ${st('Estimated FCR', isNum(s.fcrEst) ? fmt(s.fcrEst) : DASH, 'feed ÷ weight gained')}
          ${st('Density', isNum(s.densityPerM3) ? s.densityPerM3.toLocaleString() + ' /m³' : DASH)}
        </div>
        <p class="muted small" style="margin-bottom:0">Before harvest these are estimates. Dead shrimp are often eaten or never found, so real survival is usually lower and real FCR higher than shown. The harvest record gives the true numbers.</p></section>
        <section class="panel"><div class="panel-head"><h2>Records</h2></div>
        ${active.records.length ? `<div class="scroll-x"><table class="tbl"><thead><tr><th>Date</th><th>Type</th><th>Value</th><th>Notes</th><th></th></tr></thead><tbody>
          ${[...active.records].sort((a, b) => b.date.localeCompare(a.date)).map(r => `<tr><td>${esc(r.date)}</td><td>${REC_LABEL[r.type] || esc(r.type)}</td><td>${recValue(r)}</td><td class="muted small wrap">${esc(r.notes || '')}</td><td><button class="btn sm ghost" data-rec-del="${esc(r.id)}" aria-label="Delete">${I('trash')}</button></td></tr>`).join('')}
        </tbody></table></div>` : '<div class="empty">No records yet.</div>'}</section>`;
    }
    const hist = closed.length ? `<section class="panel"><div class="panel-head"><h2>Finished cycles</h2></div><div class="scroll-x"><table class="tbl"><thead><tr><th>Pond</th><th>Stocked</th><th>Closed</th><th>Days</th><th>Survival</th><th>FCR</th><th>Harvest</th></tr></thead><tbody>
      ${closed.map(c => `<tr><td>${esc(c.pondId)}</td><td>${esc(c.startDate)}</td><td>${esc(c.endDate || '')}</td><td>${c.summary.doc}</td><td>${isNum(c.summary.survivalPct) ? c.summary.survivalPct + ' %' : DASH}</td><td>${isNum(c.summary.fcr) ? fmt(c.summary.fcr) : DASH}</td><td>${isNum(c.summary.harvestKg) ? fmt(c.summary.harvestKg, 1) + ' kg' : DASH}</td></tr>`).join('')}</tbody></table></div></section>` : '';
    return body + hist;
  };
  VIEWS.cycle.after = () => {
    const pid = pondIdForLogs();
    const active = state.cycles.find(c => c.status === 'active' && (!pid || c.pondId === pid));
    $('#cyStart')?.addEventListener('click', () => openCycleStart(pid));
    $('#cyRec')?.addEventListener('click', () => openRecordModal(active));
    $('#cyClose')?.addEventListener('click', async () => {
      if (!await confirmDialog('Close this cycle?', 'Do this after harvest. Add the harvest record first so survival and FCR are real numbers.', 'Close cycle', false)) return;
      try { await api('/cycles/' + active.id, { method: 'PUT', body: { close: true } }); await load.cycles(); render(); } catch (e) { toast(e.message, 'err'); }
    });
    $$('[data-rec-del]').forEach(b => b.addEventListener('click', async () => {
      if (!await confirmDialog('Delete record?', 'This record will be removed from the cycle.')) return;
      try { await api(`/cycles/${active.id}/records/${b.dataset.recDel}`, { method: 'DELETE' }); await load.cycles(); render(); } catch (e) { toast(e.message, 'err'); }
    }));
  };
  function openCycleStart(pid) {
    const m = openModal(`<h3>Start production cycle</h3><div class="form-grid" style="margin-top:12px">
      <label class="field">Pond<span id="cyPond">${pondOptions(pid || '')}</span></label>
      <label class="field">Stocking date<input type="date" id="cyDate" value="${today()}"></label>
      <label class="field">Post-larvae stocked<input type="number" id="cyCount" min="1" step="1"></label>
      <label class="field">Average weight at stocking, g<small>Optional</small><input type="number" id="cyW0" step="0.001" min="0"></label>
      <label class="field full">Hatchery / PL source<input type="text" id="cySrc" maxlength="100"></label>
      <label class="field full">Notes<textarea id="cyNotes" maxlength="1000"></textarea></label></div>
      <div class="modal-actions"><button class="btn" data-x>Cancel</button><button class="btn primary" id="cySave">Start cycle</button></div>`);
    m.querySelector('[data-x]').onclick = closeModal;
    $('#cySave').onclick = async () => {
      try {
        await api('/cycles', { method: 'POST', body: { pondId: $('#cyPond input').value.trim(), startDate: $('#cyDate').value, stockedCount: Number($('#cyCount').value),
          initialWeightG: $('#cyW0').value === '' ? null : Number($('#cyW0').value), plSource: $('#cySrc').value, notes: $('#cyNotes').value } });
        closeModal(); await load.cycles(); render(); toast('Cycle started', 'ok');
      } catch (e) { toast(e.message, 'err'); }
    };
  }
  function openRecordModal(c) {
    const m = openModal(`<h3>Add record</h3><div class="form-grid" style="margin-top:12px">
      <label class="field">Type<select id="rType"><option value="sample">Weight sample</option><option value="feed">Feed (kg)</option><option value="mortality">Dead shrimp</option><option value="harvest">Harvest</option></select></label>
      <label class="field">Date<input type="date" id="rDate" value="${today()}"></label>
      <label class="field" data-rt="sample">Average weight, g<input type="number" step="0.01" min="0" id="rW"></label>
      <label class="field" data-rt="sample">Shrimp weighed<small>Weigh at least 30 from different spots</small><input type="number" step="1" min="1" id="rN"></label>
      <label class="field" data-rt="feed harvest">Weight, kg<input type="number" step="0.01" min="0" id="rKg"></label>
      <label class="field" data-rt="mortality harvest">Number of shrimp<input type="number" step="1" min="0" id="rC"></label>
      <label class="field full">Notes<input type="text" id="rNotes" maxlength="300"></label></div>
      <div class="modal-actions"><button class="btn" data-x>Cancel</button><button class="btn primary" id="rSave">Save record</button></div>`);
    const sync = () => { const t = $('#rType').value; m.querySelectorAll('[data-rt]').forEach(el => { el.style.display = el.dataset.rt.split(' ').includes(t) ? '' : 'none'; }); };
    sync(); $('#rType').onchange = sync;
    m.querySelector('[data-x]').onclick = closeModal;
    $('#rSave').onclick = async () => {
      const v = id => ($(id).value === '' ? null : Number($(id).value));
      try {
        await api(`/cycles/${c.id}/records`, { method: 'POST', body: { type: $('#rType').value, date: $('#rDate').value, avgWeightG: v('#rW'), sampleCount: v('#rN'), kg: v('#rKg'), count: v('#rC'), notes: $('#rNotes').value } });
        closeModal(); await load.cycles(); render(); toast('Record saved', 'ok');
      } catch (e) { toast(e.message, 'err'); }
    };
  }

  // ===== Settings
  VIEWS.settings = () => {
    const i = state.info || {}, f = state.full || {};
    const lan = i.lan || [], st = i.storage || {};
    const n = f.notifications || { pushover: {} }, po = n.pushover || {}, wd = f.watchdog || {}, il = f.interlock || {};
    const mb = b => (b / 1048576).toFixed(2) + ' MB';
    const pondIds = [...new Set([...pondList().map(p => p.id), ...Object.keys(f.pondProfiles || {})])].sort();
    return `${accountPanels()}<section class="panel ${po.enabled ? '' : 'attention'}">
      <div class="panel-head"><h2>Phone alerts (Pushover)</h2><div class="spacer"></div>${po.enabled ? '<span class="chip ok">On</span>' : '<span class="chip crit">Off: nobody is woken at night</span>'}</div>
      <div class="help small" style="display:grid;gap:6px;margin-bottom:14px">
        <div>1. Install <b>Pushover</b> on every phone that should ring (iPhone and Android) and sign in.</div>
        <div>2. At pushover.net create an <b>Application</b> (gives the API token) and a <b>Delivery group</b> containing everyone (gives the group key).</div>
        <div>3. Paste both below, switch on, then press <b>Test emergency</b>. iPhone: allow Critical Alerts for Pushover. Android: allow Pushover to override Do Not Disturb.</div>
      </div>
      <div class="form-grid">
        <label class="field">API token<small>${po.appTokenSet ? 'Saved (' + esc(po.appTokenHint) + '). Leave empty to keep it.' : 'Not set'}</small><input type="password" id="poToken" autocomplete="off" placeholder="30 letters and numbers"></label>
        <label class="field">User or delivery-group key<small>${po.userKeySet ? 'Saved (' + esc(po.userKeyHint) + '). Leave empty to keep it.' : 'Not set'}</small><input type="password" id="poUser" autocomplete="off" placeholder="30 letters and numbers"></label>
        <label class="field full">Dashboard link in alerts<small>Optional: the https address from Tailscale or Cloudflare, so tapping an alert opens AQUA.</small><input type="url" id="pubUrl" value="${esc(i.settings?.publicUrl || '')}" placeholder="https://"></label>
        <div class="row full"><label class="switch"><input type="checkbox" id="poOn" ${po.enabled ? 'checked' : ''}><span></span></label><span>Send phone alerts</span></div>
      </div>
      <div class="modal-actions" style="justify-content:flex-start"><button class="btn primary" id="poSave">Save phone alerts</button><button class="btn" id="poTest">Test normal</button><button class="btn" id="poTestE">Test emergency</button></div>
      <p class="muted small">Critical alerts ring every 30 seconds until someone taps Acknowledge in Pushover (up to 30 minutes). Warnings arrive as high-priority notifications. Alert text is in Chinese. A failed send is retried after 1, 2 and 3 minutes.</p>
      ${(f.notifyLog || []).length ? `<div class="scroll-x"><table class="tbl"><thead><tr><th>Sent</th><th>Message</th><th>Result</th></tr></thead><tbody>${f.notifyLog.slice(0, 8).map(l => `<tr><td>${dateTime(l.ts)}</td><td class="wrap">${esc(l.title)}${l.priority === 2 ? ' <span class="chip crit">emergency</span>' : ''}</td><td class="wrap">${l.ok ? '<span class="chip ok">Delivered to Pushover</span>' : `<span class="chip crit">Failed</span> <span class="muted small">${esc(l.error || '')}${l.attempt > 1 ? ', attempt ' + l.attempt : ''}</span>`}</td></tr>`).join('')}</tbody></table></div>` : ''}
    </section>
    <div class="split">
      <section class="panel">
        <div class="panel-head"><h2>Watchdog</h2><div class="spacer"></div>${n.watchdogSet ? (wd.ok ? '<span class="chip ok">Reporting</span>' : wd.ok === false ? '<span class="chip crit">Ping failing</span>' : '<span class="chip warn">Waiting</span>') : '<span class="chip warn">Not set</span>'}</div>
        <p class="muted small" style="margin-top:0">If this PC loses power or internet, AQUA cannot send alerts itself. A free check at healthchecks.io notices when AQUA stops reporting and alerts you through its own Pushover integration. Use period 1 minute, grace 5 minutes.</p>
        <label class="field">Ping URL<small>${n.watchdogSet ? 'Saved: ' + esc(n.watchdogHost) + (wd.lastAt ? ', last ping ' + rel(wd.lastAt) + (wd.error ? ' (' + esc(wd.error) + ')' : '') : '') : 'Not set'}</small><input type="url" id="wdUrl" placeholder="https://hc-ping.com/…"></label>
        <div class="modal-actions" style="justify-content:flex-start"><button class="btn primary" id="wdSave">Save watchdog</button>${n.watchdogSet ? '<button class="btn ghost danger" id="wdClear">Remove</button>' : ''}</div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Feeding safety</h2></div>
        <div style="display:grid;gap:12px">
          <div class="row" style="flex-wrap:nowrap"><label class="switch"><input type="checkbox" id="ilOff" ${il.blockWhenOffline ? 'checked' : ''}><span></span></label><span>Pause feeding when the pond monitor is offline</span></div>
          <div class="row" style="flex-wrap:nowrap"><label class="switch"><input type="checkbox" id="ilCrit" ${il.blockOnCritical ? 'checked' : ''}><span></span></label><span>Pause feeding while a critical alert is active (pump stopped, low oxygen, high nitrite)</span></div>
          <div class="form-grid"><label class="field">Pause window start<small>Optional</small><input type="time" id="ilQs" value="${esc(il.quietStart || '')}"></label><label class="field">Pause window end<small>Optional</small><input type="time" id="ilQe" value="${esc(il.quietEnd || '')}"></label></div>
          <p class="muted small" style="margin:0">Scheduled feeds are skipped and logged as Skipped. Feed now asks for an in-person check before overriding.</p>
        </div>
        <div class="modal-actions" style="justify-content:flex-start"><button class="btn primary" id="ilSave">Save feeding safety</button></div>
      </section>
    </div>
    <section class="panel">
      <div class="panel-head"><h2>Water volume</h2><span class="hint">Tank volume is used for stocking density; system volume (tanks + sump + filters) for chemical dosing</span></div>
      ${pondIds.length ? `<div class="scroll-x"><table class="tbl"><thead><tr><th>Pond</th><th>Culture tank, m³</th><th>Whole system, m³</th><th></th></tr></thead><tbody>${pondIds.map(id => `<tr><td>${esc(state.ponds[id]?.name || id)} <span class="muted small">${esc(id)}</span></td>
        <td><input type="number" step="0.1" min="0" style="width:120px" data-vol="${esc(id)}" value="${esc(f.pondProfiles?.[id]?.volumeM3 ?? '')}"></td>
        <td><input type="number" step="0.1" min="0" style="width:120px" data-svol="${esc(id)}" value="${esc(f.pondProfiles?.[id]?.systemVolumeM3 ?? '')}"></td>
        <td><button class="btn sm" data-vol-save="${esc(id)}">Save</button></td></tr>`).join('')}</tbody></table></div>`
        : '<div class="empty">Ponds appear here after their ESP32 reports.</div>'}
    </section>
    ${i.mode === 'cloud' ? '' : `    <div class="split">
      <section class="panel">
        <div class="panel-head"><h2>Connect an ESP32</h2></div>
        <div class="help small" style="display:grid;gap:8px">
          <div>In the firmware set <code>MQTT_HOST</code> to ${lan.length ? lan.map(a => `<code>${esc(a.address)}</code>`).join(' or ') : 'this computer\'s LAN IP'} and <code>MQTT_PORT</code> to <code>${esc(i.mqttPort || 1883)}</code>.</div>
          <div>Firmware <code>SITE_ID "${esc(i.site?.id || 'SITE-01')}"</code>. Topics: <code>aqua/site/${esc(i.site?.id || 'SITE-01')}/pond/&lt;POND_ID&gt;/telemetry</code> and <code>/status</code>. Firmware older than 2.0.3 (topics <code>aqua/pond/…</code>) still works.</div>
          <div class="muted">MQTT stays on your local network. Never forward port 1883 on the router.</div>
          <div>MQTT clients connected now: <b>${esc(i.mqttClients ?? DASH)}</b></div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Open on your phone</h2></div>
        <div class="help small" style="display:grid;gap:8px">
          <div>Same Wi-Fi as this computer: ${lan.length ? lan.map(a => `<code>http://${esc(a.address)}:${esc(i.httpPort)}</code>`).join(' ') : DASH}</div>
          <div>Add to Home Screen: Safari share menu on iPhone, or the browser menu on Android.</div>
          <div class="muted">Away from the shop, use Tailscale or Cloudflare Tunnel (see README).</div>
        </div>
      </section>
    </div>`}
    <section class="panel">
      <div class="panel-head"><h2>General</h2></div>
      <div class="form-grid">
        <label class="field">Farm / site name<input type="text" id="setSite" maxlength="60" value="${esc(i.site?.name || '')}"></label>
        <label class="field">Mark device offline after (minutes)<input type="number" id="setOff" min="2" max="60" value="${Math.round((i.settings?.offlineAfterSec || 300) / 60)}"></label>
      </div>
      <div class="modal-actions" style="justify-content:flex-start"><button class="btn primary" id="setSave">Save settings</button></div>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Data and backup</h2></div>
      <div class="stats" style="margin-bottom:14px"><span>History files<b>${esc(st.files ?? DASH)}</b></span><span>History size<b>${st.bytes != null ? mb(st.bytes) : DASH}</b></span><span>Ponds with history<b>${Object.keys(st.ponds || {}).length}</b></span></div>
      <div class="row">
        <a class="btn" href="/api/backup">${I('download')}Download configuration backup</a>
        ${pondList().map(p => `<a class="btn" href="/api/ponds/${encodeURIComponent(p.id)}/export.csv?range=30d">${I('download')}${esc(p.name)} 30-day CSV</a>`).join('')}
      </div>
      <p class="muted small" style="margin-bottom:0">The configuration backup contains your Pushover keys: keep it private. Full backup: run <code>BACKUP_DATA.bat</code> or copy the <code>data</code> folder.</p>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>About</h2></div>
      <div class="small muted">SMARTFUZE AQUA ${esc(i.version || '')}, server ${esc(i.hostname || '')}, dashboard port ${esc(i.httpPort || '')}, MQTT port ${esc(i.mqttPort || '')}. Site ID <code>${esc(i.site?.id || '')}</code>${(i.sites || []).length > 1 ? ', other sites seen: ' + i.sites.filter(x => !x.default).map(x => '<code>' + esc(x.id) + '</code>').join(' ') : ''}. This system shows real hardware data only.</div>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>System modules</h2><span class="hint">How the parts of AQUA pass events to each other</span></div>
      <div id="busInfo"><div class="empty">Loading…</div></div>
    </section>`;
  };
  function accountPanels() {
    const i = state.info || {};
    if (i.mode !== 'cloud') return '';
    const creds = state.creds || [];
    const host = i.publicHost || location.hostname;
    return `<div class="split">
      <section class="panel"><div class="panel-head"><h2>Account</h2><div class="spacer"></div><span class="chip ok">Signed in as ${esc(state.auth?.username || 'admin')}</span></div>
        <div class="form-grid"><label class="field">Current password<input type="password" id="pwCur" autocomplete="current-password"></label>
        <label class="field">New password<small>At least 10 characters</small><input type="password" id="pwNew" autocomplete="new-password"></label></div>
        <div class="modal-actions" style="justify-content:flex-start"><button class="btn primary" id="pwSave">Change password</button><button class="btn ghost" id="logout">Sign out</button></div>
        <p class="muted small" style="margin-bottom:0">Changing the password signs out every other phone. Forgot it? Run <code>sudo aqua-reset-password</code> in the server console.</p></section>
      <section class="panel"><div class="panel-head"><h2>Device logins</h2><div class="spacer"></div><button class="btn sm" id="credAdd">${I('plus')}New device login</button></div>
        <div class="help small" style="display:grid;gap:6px;margin-bottom:10px">
          <div>ESP32 firmware: <code>USE_TLS 1</code>, <code>MQTT_HOST "${esc(host)}"</code>, <code>MQTT_PORT 8883</code>, <code>SITE_ID "${esc(i.site?.id || 'SITE-01')}"</code>, plus the login below. Each ESP32 gets its own login and can only report for its own pond.</div>
          <div>Encrypted device connection: ${i.tls?.enabled ? `<span class="chip ok">ready</span>${i.tls.expires ? ' <span class="muted">certificate renews automatically, current one valid to ' + esc(i.tls.expires.slice(0, 10)) + '</span>' : ''}` : `<span class="chip warn">${esc(i.tls?.error || 'not ready')}</span>`}</div>
        </div>
        ${creds.length ? `<div class="scroll-x"><table class="tbl"><thead><tr><th>Username</th><th>Site / pond</th><th>Last connected</th><th></th></tr></thead><tbody>${creds.map(c => `<tr><td><code>${esc(c.username)}</code></td><td>${esc(c.siteId || 'any site')} / ${esc(c.pondId)}</td><td>${c.lastLoginAt ? rel(c.lastLoginAt) : 'never'}</td><td><button class="btn sm ghost" data-cred-del="${esc(c.username)}" aria-label="Delete">${I('trash')}</button></td></tr>`).join('')}</tbody></table></div>`
          : '<div class="empty">No device logins yet.</div>'}
      </section></div>`;
  }

  VIEWS.settings.after = () => {
    if (state.info?.mode === 'cloud') {
      if (state.creds === null) { api('/devices/credentials').then(c => { state.creds = c; if (route() === 'settings') render(); }).catch(() => {}); }
      $('#pwSave')?.addEventListener('click', async () => {
        try { await api('/auth/password', { method: 'POST', body: { current: $('#pwCur').value, password: $('#pwNew').value } }); toast('Password changed. Other phones are signed out.', 'ok'); $('#pwCur').value = ''; $('#pwNew').value = ''; }
        catch (e) { toast(e.message, 'err'); }
      });
      $('#logout')?.addEventListener('click', async () => { try { await api('/auth/logout', { method: 'POST' }); } catch (_) {} state.auth.loggedIn = false; showLogin('Signed out.'); });
      $('#credAdd')?.addEventListener('click', () => {
        const m = openModal(`<h3>New device login</h3><p class="muted small">One login per ESP32. It can only send data for this pond.</p>
          <div class="form-grid" style="margin-top:12px"><label class="field">Pond ID<small>Must match POND_ID in the firmware</small><span id="cdPond">${pondOptions(selectedPond()?.id || '')}</span></label>
          <label class="field">Username<small>Optional</small><input type="text" id="cdUser" maxlength="40" placeholder="dev-pond-b"></label></div>
          <div class="modal-actions"><button class="btn" data-x>Cancel</button><button class="btn primary" id="cdSave">Create login</button></div>`);
        m.querySelector('[data-x]').onclick = closeModal;
        $('#cdSave').onclick = async () => {
          try {
            const r = await api('/devices/credentials', { method: 'POST', body: { pondId: $('#cdPond input').value.trim(), username: $('#cdUser').value.trim() } });
            state.creds = null;
            const host = state.info.publicHost || location.hostname;
            const code = `#define USE_TLS 1\nconst char* MQTT_HOST = "${host}";\nconst uint16_t MQTT_PORT = 8883;\nconst char* MQTT_USER = "${r.username}";\nconst char* MQTT_PASS = "${r.password}";\nconst char* SITE_ID = "${r.siteId}";\nconst char* POND_ID = "${r.pondId}";`;
            const mm = openModal(`<h3>Device login created</h3><p class="notice warn" style="margin:12px 0">Copy this now. The password is shown only once.</p>
              <pre class="code-box">${esc(code)}</pre>
              <div class="modal-actions"><button class="btn" id="cdCopy">Copy</button><button class="btn primary" data-x>Done</button></div>`, { onClose: () => render() });
            mm.querySelector('[data-x]').onclick = closeModal;
            $('#cdCopy').onclick = async () => { try { await navigator.clipboard.writeText(code); toast('Copied', 'ok'); } catch (_) { toast('Select the text and copy it by hand', 'err'); } };
          } catch (e) { toast(e.message, 'err'); }
        };
      });
      $$('[data-cred-del]').forEach(b => b.addEventListener('click', async () => {
        if (!await confirmDialog('Delete device login?', `The ESP32 using "${b.dataset.credDel}" will be disconnected and can no longer send data.`)) return;
        try { await api('/devices/credentials/' + encodeURIComponent(b.dataset.credDel), { method: 'DELETE' }); state.creds = null; render(); } catch (e) { toast(e.message, 'err'); }
      }));
    }
    const put = async (body, msg) => {
      try { await api('/settings', { method: 'PUT', body }); await Promise.all([load.info(), load.full()]); toast(msg, 'ok'); render(); }
      catch (e) { toast(e.message, 'err'); }
    };
    $('#poSave')?.addEventListener('click', () => put({ pushover: { appToken: $('#poToken').value, userKey: $('#poUser').value, enabled: $('#poOn').checked }, publicUrl: $('#pubUrl').value.trim() }, 'Phone alert settings saved'));
    const test = async emergency => {
      try { await api('/notify/test', { method: 'POST', body: { emergency } }); toast(emergency ? 'Emergency test sent. Phones ring every 30 s for 1 minute or until acknowledged.' : 'Test sent. Check your phones.', 'ok'); }
      catch (e) { toast(e.message, 'err'); }
      await load.full(); render();
    };
    $('#poTest')?.addEventListener('click', () => test(false));
    $('#poTestE')?.addEventListener('click', () => test(true));
    $('#wdSave')?.addEventListener('click', () => { const u = $('#wdUrl').value.trim(); if (!u) { toast('Paste the ping URL from healthchecks.io first', 'err'); return; } put({ watchdogUrl: u }, 'Watchdog saved'); });
    $('#wdClear')?.addEventListener('click', () => put({ watchdogUrl: '' }, 'Watchdog removed'));
    $('#ilSave')?.addEventListener('click', () => put({ interlock: { blockWhenOffline: $('#ilOff').checked, blockOnCritical: $('#ilCrit').checked, quietStart: $('#ilQs').value, quietEnd: $('#ilQe').value } }, 'Feeding safety saved'));
    $$('[data-vol-save]').forEach(b => b.addEventListener('click', async () => {
      const id = b.dataset.volSave;
      const v = sel => { const el = $(`[${sel}="${id}"]`); return el.value === '' ? null : Number(el.value); };
      try { await api('/ponds/' + encodeURIComponent(id) + '/profile', { method: 'PUT', body: { volumeM3: v('data-vol'), systemVolumeM3: v('data-svol') } }); await load.full(); toast('Water volume saved', 'ok'); render(); }
      catch (e) { toast(e.message, 'err'); }
    }));
    api('/system/events').then(d => {
      const el = $('#busInfo'); if (!el) return;
      const errs = d.events.reduce((a, e) => a + e.errors, 0);
      el.innerHTML = `<div class="row" style="margin-bottom:10px">${errs ? `<span class="chip crit">${errs} module errors since start</span>` : '<span class="chip ok">All modules healthy</span>'}</div>
        <div class="scroll-x"><table class="tbl"><thead><tr><th>Event</th><th>Handled by</th><th>Count</th><th>Errors</th><th>Last</th></tr></thead><tbody>
        ${d.events.filter(e => e.subscribers.length).map(e => `<tr><td><code>${esc(e.name)}</code></td><td class="wrap">${esc(e.subscribers.join(', '))}</td><td>${e.count}</td><td>${e.errors ? `<span class="chip crit">${e.errors}</span>` : '0'}</td><td>${e.last ? rel(e.last) : DASH}</td></tr>`).join('')}
        </tbody></table></div>
        ${d.recentErrors.length ? `<p class="muted small">Latest error: ${esc(d.recentErrors[0].module)} on ${esc(d.recentErrors[0].event)}: ${esc(d.recentErrors[0].error)}</p>` : ''}`;
    }).catch(() => {});
    $('#setSave')?.addEventListener('click', async () => put({ siteName: $('#setSite').value, offlineAfterSec: Math.round(Number($('#setOff').value) * 60) }, 'Settings saved'));
  };

  // ------------------------------------------------------------ render
  const SUBS = {
    overview: () => state.info?.site?.name || '',
    ponds: () => pondList().length + ' registered from real telemetry',
    trends: () => 'Real stored history only',
    feeding: () => 'Schedules, commands and honest status',
    controls: () => 'Reserved for v2.2.0',
    apps: () => 'Any brand, any protocol',
    alerts: () => activeAlerts().length + ' active',
    calibration: () => 'pH probe calibration',
    water: () => 'Test-kit results and limits',
    cycle: () => 'Stocking to harvest',
    settings: () => 'Server ' + (state.info?.hostname || '')
  };
  function render() {
    const r = route();
    const meta = ROUTES.find(x => x.id === r);
    document.title = meta.title + ' | SMARTFUZE AQUA';
    $('#pageTitle').textContent = meta.title;
    $('#pageSub').textContent = SUBS[r]?.() || '';
    charts.clear();
    document.body.classList.toggle('fit-ov', r === 'overview');
    renderNav();
    renderPondPicker();
    const view = $('#view');
    view.innerHTML = VIEWS[r]();
    mountCharts();
    if (VIEWS[r].after) VIEWS[r].after();
  }

  // live relative times
  setInterval(() => {
    for (const el of $$('[data-rel]')) { const ts = el.dataset.rel; el.textContent = ts ? rel(ts) : DASH; }
  }, 10000);

  // ------------------------------------------------------------ WebSocket
  let wsDelay = 1000;
  function connectWs() {
    const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    state.ws = ws;
    ws.onopen = async () => {
      const wasDown = state.loaded && !state.wsOk;
      state.wsOk = true; wsDelay = 1000;
      if (wasDown) { state.history = {}; await loadAll(); }
      render();
    };
    ws.onclose = async () => {
      state.wsOk = false; renderNav();
      if (state.ws !== ws) return; // replaced or closed on purpose
      if (state.auth?.required) {
        try { const st = await (await fetch('/api/auth/status', { cache: 'no-store' })).json(); if (!st.loggedIn) { showLogin('Please sign in again.'); return; } } catch (_) {}
      }
      setTimeout(connectWs, wsDelay);
      wsDelay = Math.min(wsDelay * 2, 15000);
    };
    ws.onerror = () => { try { ws.close(); } catch (_) {} };
    ws.onmessage = ev => {
      let msg; try { msg = JSON.parse(ev.data); } catch (_) { return; }
      handleWs(msg);
    };
  }
  const refetchTimers = {};
  function refetchSoon(kind) {
    clearTimeout(refetchTimers[kind]);
    refetchTimers[kind] = setTimeout(async () => { try { await load[kind](); } catch (_) {} if (!$('#modalRoot').innerHTML) render(); else renderNav(); }, 150);
  }
  function handleWs(msg) {
    const r = route();
    switch (msg.type) {
      case 'hello':
        for (const p of msg.ponds || []) state.ponds[p.id] = p;
        if (state.loaded) render();
        break;
      case 'telemetry':
      case 'pond': {
        const isNew = !state.ponds[msg.pond.id];
        state.ponds[msg.pond.id] = msg.pond;
        if (msg.type === 'telemetry' && msg.stored) {
          for (const k of Object.keys(state.history)) if (k.startsWith(msg.pond.id + '|')) delete state.history[k];
        }
        if (isNew) { toast(`${msg.pond.name} connected (real telemetry)`, 'ok'); load.integrations().catch(() => {}); }
        if (msg.type === 'telemetry' && $('#calLiveRaw')) { /* calibration view refreshes below */ }
        const liveRaw = $('#cLive');
        if (liveRaw && msg.pond.id === selectedPond()?.id) liveRaw.textContent = msg.pond.latest?.phRaw ?? DASH;
        if (['overview', 'ponds', 'calibration', 'trends'].includes(r) && !$('#modalRoot').innerHTML) {
          render();
          if (msg.type === 'telemetry' && r === 'overview') { $('#vTemp')?.classList.add('flash'); $('#vPh')?.classList.add('flash'); }
        } else renderNav();
        if (r === 'apps') refetchSoon('integrations');
        break;
      }
      case 'feedEvent':
        if (msg.event.status === 'Confirmed') toast('Feeding confirmed by the feeder', 'ok');
        if (msg.event.status === 'Failed') toast('Feeding failed: ' + (msg.event.detail || ''), 'err');
        refetchSoon('feeding');
        break;
      case 'alert':
        if (!msg.alert.resolvedAt && !msg.alert.acknowledged) toast(msg.alert.message, 'err');
        refetchSoon('alerts');
        break;
      case 'alerts': refetchSoon('alerts'); break;
      case 'integrations': refetchSoon('integrations'); break;
      case 'feeding': refetchSoon('feeding'); break;
      case 'calibrations': refetchSoon('calibrations'); break;
      case 'settings': refetchSoon('info'); refetchSoon('full'); break;
      case 'water': refetchSoon('water'); break;
      case 'backfill':
        for (const k of Object.keys(state.history)) if (k.startsWith(msg.pondId + '|')) delete state.history[k];
        if (['overview', 'trends'].includes(r) && !$('#modalRoot').innerHTML) render();
        break;
      case 'cycles': refetchSoon('cycles'); break;
    }
  }

  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && state.loaded && !document.body.classList.contains('locked')) {
      state.history = {};
      await loadAll();
      if (!$('#modalRoot').innerHTML) render();
    }
  });

  window.addEventListener('hashchange', () => {
    if (location.hash === '#more') return;
    closeModal();
    render();
    window.scrollTo(0, 0);
    $('#view').focus({ preventScroll: true });
  });

  // ------------------------------------------------------------ login (cloud mode)
  function showLogin(msg) {
    document.body.classList.add('locked');
    closeModal();
    if (state.ws) { const w = state.ws; state.ws = null; try { w.close(); } catch (_) {} }
    $('#pageTitle').textContent = 'Sign in'; $('#pageSub').textContent = ''; $('#pondPicker').innerHTML = '';
    $('#view').innerHTML = `<section class="panel login-card">
      <div class="login-brand"><svg viewBox="0 0 64 64" aria-hidden="true"><use href="#logo"/></svg><div><b>SMARTFUZE</b><span>AQUA</span></div></div>
      ${msg ? `<p class="muted small" style="margin:0 0 6px">${esc(msg)}</p>` : ''}
      <form id="loginForm" class="grid" style="gap:14px">
        <label class="field">Username<input type="text" id="lgUser" value="admin" autocomplete="username" autocapitalize="none" spellcheck="false"></label>
        <label class="field">Password<input type="password" id="lgPass" autocomplete="current-password"></label>
        <button class="btn primary" type="submit" id="lgGo">Sign in</button>
        <p class="muted small" style="margin:0">This device stays signed in for 90 days.</p>
      </form></section>`;
    setTimeout(() => $('#lgPass')?.focus(), 50);
    $('#loginForm').addEventListener('submit', async e => {
      e.preventDefault();
      $('#lgGo').disabled = true;
      try {
        const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: $('#lgUser').value.trim(), password: $('#lgPass').value }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'Sign-in failed');
        document.body.classList.remove('locked');
        state.auth = { ...state.auth, required: true, loggedIn: true, username: d.username };
        state.creds = null; state.history = {};
        await loadAll(); render(); connectWs();
      } catch (err) { toast(err.message, 'err'); $('#lgGo').disabled = false; }
    });
  }

  // ------------------------------------------------------------ boot
  (async () => {
    $('#view').innerHTML = `<div class="empty big"><b>Loading</b>Connecting to the AQUA server…</div>`;
    try { state.auth = await (await fetch('/api/auth/status', { cache: 'no-store' })).json(); }
    catch (_) { state.auth = { required: false, loggedIn: true }; }
    if (state.auth.required && !state.auth.loggedIn) { showLogin(); return; }
    await loadAll();
    render();
    connectWs();
  })();
  setInterval(() => { if (state.wsOk) load.info().catch(() => {}); }, 60000);

  if ('serviceWorker' in navigator && (window.isSecureContext)) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
})();
