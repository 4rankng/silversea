// Card 20261006_391 — staging rung: every file export reports busy + toast.
// S1 /trips/141 FuelCard xlsx (live ERROR path — no staging trip has a fuel
//   supplier, so the API 400s; the fixed contract = a visible toast, never
//   silence — the old code swallowed this in catch{}).
// S2 /customers: export-all + select-one-row + export-selected.
// S3 /fleet/productivity: monthly export success toast.
// Real pointer taps at hit-tested coordinates; toast lifetime 4500ms.
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-06_kb391-export-feedback';
const WIDTHS = [1280, 1440, 1920, 2560];

const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
if (!login.ok) throw new Error(`admin login ${login.status}`);
const token = (await login.json()).token;
const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  const waitToast = async (patterns, timeoutMs = 15000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const found = await page.evaluate((pats) => {
        const leaves = [...document.querySelectorAll('body *')].filter((n) => n.children.length === 0);
        for (const p of pats) {
          const el = leaves.find((n) => (n.textContent || '').trim().includes(p));
          if (el) {
            const r = el.getBoundingClientRect();
            return { matched: p, text: (el.textContent || '').trim(), x: Math.round(r.x), y: Math.round(r.y) };
          }
        }
        return null;
      }, patterns);
      if (found) return found;
      await sleep(100);
    }
    return null;
  };

  const tapButton = async (findFn, labelForHit) => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const t = await page.evaluate(findFn);
      if (t && !t.missing && !t.offscreen) {
        const hit = await page.evaluate((pt) => document.elementFromPoint(pt.x, pt.y)?.textContent?.trim().slice(0, 60), t);
        if (hit && hit.includes(labelForHit)) {
          await page.mouse.move(t.x, t.y); await page.mouse.down(); await page.mouse.up();
          return true;
        }
      }
      await sleep(800);
    }
    return false;
  };

  const shot = async (name) => {
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.screenshot({ path: `${QA}/${SCOPE}_${name}.png`, fullPage: h <= 12000 });
    log('shot', { name, fullPage: h <= 12000, scrollHeight: h });
  };

  // ── S1: FuelCard on /trips/141 (error toast path, live) ───────────────────
  await page.goto(`${BASE}/trips/141`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(4000);
  // First-load of trip detail can land shell-only (card 221813's crash class);
  // the reporter's own recovery is the Thử lại button — use it if content is missing.
  const s1NeedsRetry = await page.evaluate(() => ![...document.querySelectorAll('button')].some((b) => /Xuất Excel/.test(b.textContent || '')));
  if (s1NeedsRetry) {
    const retried = await tapButton(() => {
      const btn = [...document.querySelectorAll('button')].filter((b) => b.offsetParent !== null).find((b) => /Thử lại/.test(b.textContent || ''));
      if (!btn) return { missing: true };
      const r = btn.getBoundingClientRect();
      return (r.y > 60 && r.y < window.innerHeight - 60) ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : { offscreen: true };
    }, 'Thử lại');
    log('s1-retry-clicked', { ok: retried });
    await sleep(4000);
  }
  for (const w of WIDTHS) { await page.setViewport({ width: w, height: 1000 }); await sleep(900); await shot(`s1-fuel-idle-${w}`); }
  await page.setViewport({ width: 1920, height: 1000 }); await sleep(900);
  const s1 = await tapButton(() => {
    const card = [...document.querySelectorAll('*')].find((e) => /Phiếu cấp nhiên liệu|Nhiên liệu/.test(e.textContent || '') && e.querySelector('button') && (e.className || '').toString().includes('card'));
    const scope = card ?? document;
    const btn = [...scope.querySelectorAll('button')].filter((b) => b.offsetParent !== null).find((b) => /Xuất Excel/.test(b.textContent || ''));
    if (!btn) return { missing: true };
    btn.scrollIntoView({ block: 'center' });
    const r = btn.getBoundingClientRect();
    const vh = window.innerHeight;
    return (r.y > 60 && r.y < vh - 60) ? { x: r.x + r.width / 2, y: r.y + r.height / 2, label: (btn.textContent || '').trim() } : { offscreen: true };
  }, 'Xuất Excel');
  log('s1-tap', { ok: s1 });
  const t1 = await waitToast(['Đã xuất phiếu cấp nhiên liệu', 'Chưa xuất được tệp Excel', 'phiếu cấp nhiên liệu']);
  log('s1-toast', t1 ?? { none: true });
  await shot('s1-fuel-toast-1920');
  if (!t1) { log('FAIL-s1-no-toast'); exitCode = 1; }

  // ── S2: Customers exports ──────────────────────────────────────────────────
  await page.goto(`${BASE}/customers`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(4000);
  for (const w of WIDTHS) { await page.setViewport({ width: w, height: 1000 }); await sleep(900); await shot(`s2-cust-idle-${w}`); }
  await page.setViewport({ width: 1920, height: 1000 }); await sleep(900);
  const s2a = await tapButton(() => {
    const btn = [...document.querySelectorAll('button')].filter((b) => b.offsetParent !== null).find((b) => /Xuất Excel/.test(b.textContent || ''));
    if (!btn) return { missing: true };
    btn.scrollIntoView({ block: 'center' });
    const r = btn.getBoundingClientRect();
    return (r.y > 60 && r.y < window.innerHeight - 60) ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : { offscreen: true };
  }, 'Xuất Excel');
  log('s2-export-all-tap', { ok: s2a });
  const t2a = await waitToast(['Đã xuất danh sách khách hàng', 'Chưa xuất được danh sách khách hàng']);
  log('s2-all-toast', t2a ?? { none: true });
  await shot('s2-cust-toast-all-1920');
  if (!t2a) { log('FAIL-s2-all-no-toast'); exitCode = 1; }
  await sleep(5200);

  // Select one row, then export-selected.
  const s2sel = await page.evaluate(() => {
    const cb = [...document.querySelectorAll('tbody input[type="checkbox"], tbody [role="checkbox"]')].find((c) => c.offsetParent !== null);
    if (!cb) return { missing: true };
    cb.scrollIntoView({ block: 'center' });
    const r = (cb.closest('label') ?? cb).getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (s2sel && !s2sel.missing) {
    await page.mouse.move(s2sel.x, s2sel.y); await page.mouse.down(); await page.mouse.up();
    await sleep(900);
    const s2b = await tapButton(() => {
      const btn = [...document.querySelectorAll('button')].filter((b) => b.offsetParent !== null).find((b) => /Xuất CSV đã chọn/.test(b.textContent || ''));
      if (!btn) return { missing: true };
      btn.scrollIntoView({ block: 'center' });
      const r = btn.getBoundingClientRect();
      return (r.y > 60 && r.y < window.innerHeight - 60) ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : { offscreen: true };
    }, 'Xuất CSV đã chọn');
    log('s2-export-selected-tap', { ok: s2b });
    const t2b = await waitToast(['Đã xuất khách hàng đã chọn', 'Chưa xuất được danh sách đã chọn']);
    log('s2-selected-toast', t2b ?? { none: true });
    await shot('s2-cust-toast-selected-1920');
    if (!t2b) { log('FAIL-s2-selected-no-toast'); exitCode = 1; }
  } else { log('s2-no-row-checkbox', { note: 'selected-export not driven' }); }

  // ── S3: Monthly productivity export ────────────────────────────────────────
  await page.goto(`${BASE}/fleet/productivity`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(4000);
  // The monthly view lives behind the 'Từng xe trong 1 tháng' tab.
  const tabTapped = await tapButton(() => {
    const btn = [...document.querySelectorAll('button,[role="tab"]')].filter((b) => b.offsetParent !== null).find((b) => /Từng xe trong 1 tháng/.test(b.textContent || ''));
    if (!btn) return { missing: true };
    const r = btn.getBoundingClientRect();
    return (r.y > 60 && r.y < window.innerHeight - 60) ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : { offscreen: true };
  }, 'Từng xe trong 1 tháng');
  log('s3-tab', { ok: tabTapped });
  await sleep(3000);
  for (const w of WIDTHS) { await page.setViewport({ width: w, height: 1000 }); await sleep(900); await shot(`s3-prod-idle-${w}`); }
  await page.setViewport({ width: 1920, height: 1000 }); await sleep(900);
  const s3 = await tapButton(() => {
    const btn = [...document.querySelectorAll('button')].filter((b) => b.offsetParent !== null).find((b) => /Xuất Excel/.test(b.textContent || ''));
    if (!btn) return { missing: true };
    btn.scrollIntoView({ block: 'center' });
    const r = btn.getBoundingClientRect();
    return (r.y > 60 && r.y < window.innerHeight - 60) ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : { offscreen: true };
  }, 'Xuất Excel');
  log('s3-tap', { ok: s3 });
  const t3 = await waitToast(['Đã xuất báo cáo năng suất xe', 'Chưa xuất được']);
  log('s3-toast', t3 ?? { none: true });
  await shot('s3-prod-toast-1920');
  if (!t3) { log('FAIL-s3-no-toast'); exitCode = 1; }
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
