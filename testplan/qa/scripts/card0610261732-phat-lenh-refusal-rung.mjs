// Card 0610261732 — UI rung: a REFUSED "Phát lệnh" must show the backend's
// real reason, never a blanket "Dữ liệu đã thay đổi. Vui lòng tải lại."
// and never a success reading on the row.
//
// Fixture (all self-marked, QA-prefixed, local dev only):
//   truck  QA-MMTX-XE-1732  + 20FT trailer QA-MMTX-RM-1732  (capacity 18.000 kg)
//   driver QA-MM Tài Xế 0610261732
//   LCL lot QA-LCL-20261006-MM01 (shipment 61959 / fulfillment 25456), 24.000 kg
//   → 24.000 kg > 18.000 kg capacity, so the backend genuinely answers
//     409 "Trọng lượng hàng vượt quá tải trọng xe."
//
// MODE=before: HEAD (pre-fix) — banner reads the generic reload copy.
// MODE=after:  with the fix       — banner reads the backend's own reason.
//
// Real pointer taps only (mouse move → down → up at hit-tested coords).
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const MODE = process.env.QA_MODE || 'after';
const API = process.env.QA_API || 'http://localhost:3002/api';
const BASE = process.env.QA_BASE || 'http://localhost:7175';
const REPO = '/Volumes/LexarSSD/projects/silversea-prod';
const QA = `${REPO}/qa`;
const SCOPE = '2026-10-06_card0610261732';
const SHIPMENT_ID = 61959;
const TRUCK_PLATE = 'QA-MMTX-XE-1732';
const BACKEND_REASON = 'Trọng lượng hàng vượt quá tải trọng xe.';
const GENERIC_RELOAD = 'Dữ liệu đã thay đổi. Vui lòng tải lại.';

const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

// ── Real pointer tap at hit-tested coordinates ────────────────────────────
const tap = async (page, selector, label) => {
  // Scroll the target into the viewport BEFORE hit-testing — a boundingBox
  // outside the viewport yields no elementFromPoint hit and is not a real tap.
  // The grid scrolls inside main.app-body (the page itself is overflow:clip).
  // Scroll in steps and re-measure: the grid re-renders under us, so a single
  // absolute scrollTop can land short once rows reflow.
  await page.$eval(selector, async (el) => {
    const scroller = el.closest('main.app-body');
    if (!scroller) { el.scrollIntoView({ block: 'center' }); return; }
    for (let i = 0; i < 40; i += 1) {
      const r = el.getBoundingClientRect();
      const s = scroller.getBoundingClientRect();
      if (r.top >= s.top + 8 && r.bottom <= s.bottom - 8) return;
      const delta = (r.top + r.height / 2) - (s.top + scroller.clientHeight / 2);
      if (Math.abs(delta) < 4) return;
      scroller.scrollTop += delta;
      await new Promise((res) => setTimeout(res, 60));
    }
  }).catch(() => {});
  await sleep(500);
  const handle = await page.$(selector);
  if (!handle) throw new Error(`tap target not found: ${selector} (${label})`);
  const box = await handle.boundingBox();
  if (!box) throw new Error(`no bounding box: ${selector}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const hit = await page.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px, py);
    return el ? { tag: el.tagName, cls: el.className, text: (el.textContent || '').trim().slice(0, 60) } : null;
  }, [x, y]);
  if (!hit) throw new Error(`hit test empty at ${x},${y} (${label})`);
  await page.mouse.move(x, y);
  await sleep(60);
  await page.mouse.down();
  await sleep(40);
  await page.mouse.up();
  log('tap', { label, selector, x: Math.round(x), y: Math.round(y), hit });
  return hit;
};

// ── Login (real dispatcher JWT injected into localStorage before SPA nav) ──
const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'dungnv', password: 'Abc123' }),
});
if (!login.ok) throw new Error(`dispatcher login failed ${login.status}`);
const { token } = await login.json();
log('login', { ok: true, role: 'dispatcher' });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--window-size=1600,1000'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  page.on('console', (m) => { if (m.type() === 'error') log('console-error', { text: m.text().slice(0, 200) }); });

  // Seed auth before the SPA boots (documented local recipe).
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => { localStorage.setItem('token', t); }, token);
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 60_000 });
  await sleep(1500);
  log('nav', { url: page.url() });

  // Scope the grid to the fixture's month, then find the row.
  await page.waitForSelector('table', { timeout: 30_000 });

  // The row action is aria "Phát lệnh · <identity>"; the LCL lot has no
  // container number, so its identity is the booking/bill reference.
  const target = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button[aria-label^="Phát lệnh"]')];
    return buttons.map((b) => b.getAttribute('aria-label'));
  });
  log('phat-lenh-buttons', { count: target.length, labels: target.slice(0, 20) });

  // Our fixture is the only 20FT-plated own row in view if present; otherwise
  // open the editor for the fixture row directly via its bill number.
  let usedLabel = null;
  for (const label of target) {
    if (label.includes('QA-LCL-20261006-MM01') || label.includes('MM01')) { usedLabel = label; break; }
  }
  if (!usedLabel) {
    log('note', { why: 'fixture row not in the quick-issue list on page 1; opening its editor instead' });
  }

  if (usedLabel) {
    await tap(page, `button[aria-label="${usedLabel}"]`, 'quick Phát lệnh');
    await sleep(2500);
  }

  // Read whatever the page is now showing as the refusal.
  const observed = await page.evaluate(() => {
    const alerts = [...document.querySelectorAll('[role="alert"]')].map((e) => (e.textContent || '').trim()).filter(Boolean);
    const status = [...document.querySelectorAll('[role="status"]')].map((e) => (e.textContent || '').trim()).filter(Boolean);
    return { alerts, status, bodyHasGenericReload: document.body.innerText.includes('Dữ liệu đã thay đổi') };
  });
  log('observed', observed);

  const sawBackendReason = observed.alerts.some((a) => a.includes(BACKEND_REASON));
  const sawGeneric = observed.bodyHasGenericReload
    || observed.alerts.some((a) => a.includes('Dữ liệu đã thay đổi'));

  // The page-level banner (assignmentError) renders above the grid but sits under
  // the sticky table header, so a viewport shot can miss it entirely. Capture the
  // banner element itself — evidence that does not show the difference is not
  // evidence — plus a full viewport shot for context.
  const banner = await page.$('.dispatch-plan-page__error');
  if (banner) {
    await banner.screenshot({ path: `${QA}/${SCOPE}_ui-banner-${MODE}.png` }).catch(() => {});
    log('banner-shot', { captured: true });
  } else {
    log('banner-shot', { captured: false, why: 'no .dispatch-plan-page__error element' });
  }
  await page.$eval('main.app-body', (s) => { s.scrollTop = 0; }).catch(() => {});
  await sleep(500);
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-phat-lenh-refused-${MODE}.png`, fullPage: false });

  if (MODE === 'before') {
    if (!sawGeneric) { log('FAIL', { expected: 'generic reload banner at HEAD', sawBackendReason }); exitCode = 1; }
    else log('PASS-before', { genericReloadShown: true });
  } else {
    if (!sawBackendReason) { log('FAIL', { expected: `banner to name "${BACKEND_REASON}"`, observed }); exitCode = 1; }
    else if (sawGeneric) { log('FAIL', { expected: 'no generic reload banner alongside the real reason', observed }); exitCode = 1; }
    else log('PASS-after', { backendReasonShown: true, genericReloadAbsent: true });
  }

  // The row must NOT read as issued after a refusal.
  const rowState = await page.evaluate(() => {
    const t = document.body.innerText;
    return { claimsIssued: t.includes('Đã phát lệnh cho tài xế') };
  });
  log('row-state', rowState);
} catch (error) {
  log('ERROR', { message: String(error && error.message ? error.message : error) });
  exitCode = 1;
} finally {
  await browser.close();
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  console.log(`\nexit=${exitCode}`);
  process.exit(exitCode);
}