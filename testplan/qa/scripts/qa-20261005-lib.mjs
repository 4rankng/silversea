// Shared helpers for the 2026-10-05 staging QA lane (cards 353/354/363).
// Real trusted input only: every tap is mouse move → down → up at hit-tested
// coords, and each returns the trusted-event delta it produced.
import puppeteer from 'puppeteer';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';

export const STAGING = 'https://vantai.tingting.vip';
export const API = `${STAGING}/api`;
export const BUILD_EXPECTED = process.env.QA_BUILD || '19ed100f';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── API ────────────────────────────────────────────────────────────────────
export async function loginApi(identifier = 'dungnv', password = 'Abc123') {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  if (!r.ok) throw new Error(`login ${identifier} failed: ${r.status}`);
  return r.json();
}

export function apiClient(token) {
  return async (method, path, body, extraHeaders = {}) => {
    const r = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(method === 'GET' || method === 'HEAD' ? {} : { 'Idempotency-Key': randomUUID() }),
        ...extraHeaders,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: r.status, ok: r.ok, body: parsed, raw: text };
  };
}

export async function health() {
  const r = await fetch(`${API}/health`);
  const b = await r.json();
  return b;
}

// ── browser ────────────────────────────────────────────────────────────────
export async function launch({ width = 1440, height = 1000 } = {}) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=2600,1800'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  await page.evaluateOnNewDocument(() => {
    window.__probe = { pointerdown: 0, click: 0, any: 0 };
    for (const t of ['pointerdown', 'click']) {
      document.addEventListener(t, (e) => { window.__probe.any += 1; if (e.isTrusted) window.__probe[t] += 1; }, { capture: true, passive: true });
    }
  });
  return { browser, page };
}

export async function auth(page, token, path = '/dispatch-detail') {
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${STAGING}${path}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(3000);
}

export async function probe(page) {
  return page.evaluate(() => ({ ...window.__probe }));
}

/** Real trusted tap at viewport coords; asserts a trusted pointerdown landed. */
export async function tapAt(page, x, y, { label = '', settle = 700 } = {}) {
  const before = await probe(page);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  await sleep(settle);
  const after = await probe(page);
  const hit = await page.evaluate((px, py) => {
    const e = document.elementFromPoint(px, py);
    return e ? `${e.tagName}.${(e.className || '').toString().slice(0, 50)}` : null;
  }, x, y);
  if (after.pointerdown <= before.pointerdown) {
    throw new Error(`tap "${label}": NO trusted pointerdown at ${x},${y} (hit=${hit})`);
  }
  return { x, y, hit, delta: after.pointerdown - before.pointerdown, label };
}

/** Real trusted tap on the centre of the first element matching a selector. */
export async function tapSel(page, selector, { label = selector, settle = 700, nth = 0 } = {}) {
  const box = await page.evaluate((sel, n) => {
    const els = document.querySelectorAll(sel);
    const el = els[n];
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const b = el.getBoundingClientRect();
    return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2), w: Math.round(b.width), h: Math.round(b.height) };
  }, selector, nth);
  if (!box) throw new Error(`tapSel "${label}": no element for ${selector}`);
  if (box.w === 0 || box.h === 0) throw new Error(`tapSel "${label}": zero-size (clipped?) element ${selector}`);
  await sleep(150);
  return tapAt(page, box.x, box.y, { label, settle });
}

/** Find a row index by text within a selector set. */
export async function rowIndex(page, rowSel, needle) {
  return page.evaluate((rs, n) => [...document.querySelectorAll(rs)].findIndex((r) => (r.innerText || '').includes(n)), rowSel, needle);
}

export async function shot(page, path, { full = true } = {}) {
  fs.mkdirSync(path.replace(/\/[^/]*$/, ''), { recursive: true });
  await page.screenshot({ path, fullPage: full });
  return path;
}

export async function setViewport(page, width, height = 1000) {
  await page.setViewport({ width, height });
  await sleep(1100);
}

export function logEvidence(dir, name, obj) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(`${dir}/${name}`, JSON.stringify(obj, null, 2));
}

/** Arm a request abort for a URL substring, run fn (which navigates), keep the
 *  abort armed through settleMs, then disarm. */
export async function withAborted(page, urlPart, fn, { settleMs = 9000 } = {}) {
  await page.setRequestInterception(true);
  const handler = (req) => {
    if (req.url().includes(urlPart)) return req.abort().catch(() => {});
    return req.continue().catch(() => {});
  };
  page.on('request', handler);
  try {
    await fn();
    await sleep(settleMs);
  } finally {
    page.off('request', handler);
    await page.setRequestInterception(false);
  }
}

/** Close any stray modal that would swallow taps. */
export async function closeStrayDialog(page) {
  const open = await page.evaluate(() => Boolean(document.querySelector('[role="dialog"]')));
  if (!open) return false;
  await page.keyboard.press('Escape');
  await sleep(500);
  return true;
}

/** React-Aria UuiSelectField: real-tap the trigger whose accessible label
 *  matches `labelText`, then real-tap the option whose text matches `optionText`
 *  (types into the popover search box first when the control is a combobox). */
export async function uuiSelect(page, labelText, optionText, { settle = 600 } = {}) {
  const trigger = await page.evaluate((lbl) => {
    const root = document.querySelector('[role="dialog"]') || document;
    const btns = [...root.querySelectorAll('button')];
    const btn = btns.find((b) => {
      const ids = (b.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
      const byLabel = ids.some((id) => (document.getElementById(id)?.textContent || '').includes(lbl));
      const byAria = (b.getAttribute('aria-label') || '').includes(lbl);
      return byLabel || byAria;
    });
    if (!btn) return null;
    btn.scrollIntoView({ block: 'center' });
    const r = btn.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), text: (btn.textContent || '').trim().slice(0, 60) };
  }, labelText);
  if (!trigger) throw new Error(`uuiSelect: no trigger for "${labelText}"`);
  await tapAt(page, trigger.x, trigger.y, { label: `select:${labelText}`, settle: 400 });

  // Combobox variant renders a search input inside the popover; type the option
  // text to filter, then re-measure.
  const hasSearch = await page.evaluate(() => Boolean(document.querySelector('[role="dialog"] input, [role="listbox"] input, [data-radix-popper-content-wrapper] input')));
  if (hasSearch) {
    const typed = await page.evaluate((t) => {
      const inp = [...document.querySelectorAll('input')].find((i) => i.offsetParent !== null && (i.getAttribute('role') === 'combobox' || i.type === 'text' || i.type === 'search'));
      if (!inp) return false;
      inp.focus(); inp.value = ''; return true;
    }, optionText);
    if (typed) { await page.keyboard.type(optionText, { delay: 25 }); await sleep(700); }
  }

  const opt = await page.evaluate((t) => {
    const norm = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const opts = [...document.querySelectorAll('[role="option"]')].filter((o) => o.offsetParent !== null);
    const o = opts.find((el) => norm(el.textContent).includes(norm(t)));
    if (!o) return { ok: false, seen: opts.map((el) => (el.textContent || '').trim().slice(0, 60)) };
    o.scrollIntoView({ block: 'nearest' });
    const r = o.getBoundingClientRect();
    return { ok: true, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), text: (o.textContent || '').trim().slice(0, 80) };
  }, optionText);
  if (!opt.ok) throw new Error(`uuiSelect("${labelText}") option "${optionText}" not found; saw ${JSON.stringify(opt.seen)}`);
  await sleep(150);
  await tapAt(page, opt.x, opt.y, { label: `option:${opt.text}`, settle });
  return { trigger, option: opt };
}
