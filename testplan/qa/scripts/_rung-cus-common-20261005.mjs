// Shared rung helpers for the CusQA lane (cards 365 + 360). Staging only.
// Real trusted pointer input + hit-testing, per the kanban QA standard.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

export const BASE = process.env.QA_BASE || 'https://vantai.tingting.vip';
export const OUT_365 = new URL('../evidence/2026-10-05_hang-le-lcl-365-tong-quan-chi-tiet/', import.meta.url).pathname;
export const OUT_360 = new URL('../evidence/2026-10-05_360-trong-luong-bo-2-so-0-thap-phan/', import.meta.url).pathname;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function http(method, p, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const u = new URL(p.startsWith('http') ? p : BASE + p);
    const r = https.request({ method, hostname: u.hostname, path: u.pathname + u.search,
      headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) } },
      (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => { let j = b; try { j = JSON.parse(b); } catch {} resolve({ status: res.statusCode, body: j }); }); });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}

export async function health() {
  const r = await http('GET', '/api/health');
  return r.body;
}

export async function launch({ width = 1440, height = 960, user = 'thanhdc' } = {}) {
  const lr = await http('POST', '/api/auth/login', { body: { identifier: user, password: 'Abc123' } });
  if (lr.status !== 200) throw new Error(`login ${user} -> ${lr.status}`);
  const token = lr.body.token;
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=2600,1800'] });
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text().slice(0, 240)); });
  await page.evaluateOnNewDocument((t, origin) => {
    window.__probe = { pointerdown: 0, click: 0, keydown: 0 };
    for (const type of ['pointerdown', 'click', 'keydown']) {
      document.addEventListener(type, (e) => { if (e.isTrusted) window.__probe[type] += 1; }, { capture: true, passive: true });
    }
    if (location.origin === origin) localStorage.setItem('token', t);
  }, token, new URL(BASE).origin);
  return { browser, page, token, errors };
}

export async function goto(page, url, settleMs = 1800) {
  await page.goto(BASE + url, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(settleMs);
}

export async function probe(page) {
  return page.evaluate(() => ({ ...(window.__probe || {}) }));
}

// Real tap: hit-test at the element centre, then mouse move → down → up and
// confirm a trusted pointerdown reached the document.
export async function tap(page, selector, { label = selector, expectEvent = true } = {}) {
  const el = await page.$(selector);
  if (!el) throw new Error(`tap: no element for ${label}`);
  const box = await el.boundingBox();
  if (!box) throw new Error(`tap: no box for ${label}`);
  const cx = Math.round(box.x + box.width / 2);
  const cy = Math.round(box.y + box.height / 2);
  const hit = await page.evaluate((x, y) => {
    const e = document.elementFromPoint(x, y);
    return e ? { tag: e.tagName, cls: (e.className || '').toString().slice(0, 70), txt: (e.textContent || '').trim().slice(0, 60) } : null;
  }, cx, cy);
  const before = await probe(page);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.up();
  await sleep(700);
  const after = await probe(page);
  if (expectEvent && after.pointerdown <= before.pointerdown) {
    throw new Error(`tap: NO trusted pointer events at ${cx},${cy} for ${label} (hit=${JSON.stringify(hit)})`);
  }
  return { cx, cy, hit, before, after };
}

// Real tap at page coordinates (hit-tested): move → down → up + event proof.
export async function tapAt(page, x, y, { label = `${x},${y}`, expectEvent = true } = {}) {
  const hit = await page.evaluate((xx, yy) => {
    const e = document.elementFromPoint(xx, yy);
    return e ? { tag: e.tagName, cls: (e.className || '').toString().slice(0, 70), txt: (e.textContent || '').trim().slice(0, 60) } : null;
  }, Math.round(x), Math.round(y));
  const before = await probe(page);
  await page.mouse.move(Math.round(x), Math.round(y));
  await page.mouse.down();
  await page.mouse.up();
  await sleep(700);
  const after = await probe(page);
  if (expectEvent && after.pointerdown <= before.pointerdown) {
    throw new Error(`tapAt: NO trusted pointer events at ${x},${y} for ${label} (hit=${JSON.stringify(hit)})`);
  }
  return { x, y, hit, before, after };
}

// Screenshot a table row by text content (element screenshot; no manual clip).
export async function cropRowByText(page, dir, name, needle) {
  const handle = await page.evaluateHandle((n) => Array.from(
    document.querySelectorAll('.shipment-container-ledger table tbody tr, .cus-dashboard-table tbody tr'),
  ).find((r) => (r.innerText || '').includes(n)) || null, needle);
  const el = handle.asElement();
  if (!el) return null;
  await el.scrollIntoView().catch(() => {});
  await sleep(500);
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name + '.png');
  await el.screenshot({ path: p });
  return p;
}

export async function shot(page, dir, name, { full = true } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  await page.screenshot({ path: p, fullPage: full });
  return p;
}

export async function setViewport(page, width, height = 1000) {
  await page.setViewport({ width, height });
  await sleep(900);
}

// Full-page state matrix: the screen at 1280 / 1440 / 1920 / 2560.
export async function matrix(page, dir, label) {
  const out = [];
  for (const w of [1280, 1440, 1920, 2560]) {
    await setViewport(page, w, w >= 1920 ? 1080 : 960);
    out.push(await shot(page, dir, `${label}_${w}.png`));
  }
  await setViewport(page, 1440, 960);
  return out;
}

// Arm a URL-substring abort and navigate in the SAME step (the abort must be
// live when the request fires, per the harness pitfalls).
export async function withAborted(page, urlPart, fn, { settleMs = 8000 } = {}) {
  await page.setRequestInterception(true);
  const handler = (req) => (req.url().includes(urlPart) ? req.abort().catch(() => {}) : req.continue().catch(() => {}));
  page.on('request', handler);
  try {
    await fn();
    await sleep(settleMs);
  } finally {
    page.off('request', handler);
    await page.setRequestInterception(false);
  }
}

export function writeJson(dir, name, obj) {
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
}
