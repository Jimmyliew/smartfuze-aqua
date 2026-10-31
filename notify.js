'use strict';
/**
 * SMARTFUZE AQUA - outbound notifications.
 * Pushover works on both iPhone and Android. Priority 2 ("emergency") repeats every
 * `retry` seconds until someone acknowledges it in the Pushover app, or `expire` passes.
 * Only outbound HTTPS is used, so it works behind 4G CGNAT without opening any port.
 */
async function request(url, opts = {}, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

async function pushover(cfg, { title, message, priority = 0, url, urlTitle, retry = 30, expire = 1800 }) {
  if (!cfg || !cfg.enabled || !cfg.appToken || !cfg.userKey) return { ok: false, skipped: true, error: 'Pushover is not configured' };
  const body = new URLSearchParams({
    token: cfg.appToken, user: cfg.userKey,
    title: String(title || 'SMARTFUZE AQUA').slice(0, 250),
    message: String(message || '').slice(0, 1024),
    priority: String(priority)
  });
  if (priority === 2) { body.set('retry', String(Math.max(30, retry))); body.set('expire', String(Math.min(10800, expire))); }
  if (url) { body.set('url', url); if (urlTitle) body.set('url_title', urlTitle); }
  try {
    const res = await request('https://api.pushover.net/1/messages.json', { method: 'POST', body });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.status !== 1) return { ok: false, error: (j.errors && j.errors.join('; ')) || 'HTTP ' + res.status };
    return { ok: true, receipt: j.receipt || null };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'timeout (no internet?)' : (e.cause && e.cause.code) || e.message };
  }
}

async function ping(url) {
  try {
    const res = await request(url, { method: 'GET' });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'timeout' : (e.cause && e.cause.code) || e.message };
  }
}

module.exports = { pushover, ping };
