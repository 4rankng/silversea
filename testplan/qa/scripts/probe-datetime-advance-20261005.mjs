// Card 20261004_326 revocation-#2 rework — all-host keystroke probe v2 (raw
// puppeteer). 2026-10-05 is another trusted-input-death day: input works on a
// session's FIRST document (login typing) and never arrives on later
// documents (control run: pointerdown/click/keydown = 0 on /dispatch-detail).
// So this probe gives EVERY surface its own fresh page (own first-document
// window), injects the JWT (UI login skipped), and measures
// document.activeElement after EVERY keystroke. Login endpoint is the
// input-aliveness control: a bad/expired token fails loudly before any rung.
// Usage: BASE=https://vantai.tingting.vip node \
//   testplan/qa/scripts/probe-datetime-advance-20261005.mjs
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'https://vantai.tingting.vip';
const IDENTIFIER = process.env.IDENTIFIER || 'dungnv';
const PASSWORD = process.env.PASSWORD || 'Abc123';
const OUT = process.env.OUT_DIR || 'qa/2026-10-05_card326';
mkdirSync(OUT, { recursive: true });

const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const results = { base: BASE, identifier: IDENTIFIER, startedAt: new Date().toISOString(), note: 'one fresh page per surface (input-death-day protocol)', surfaces: [] };

// API login once; the token is injected per page below.
const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: IDENTIFIER, password: PASSWORD }),
});
if (!loginRes.ok) throw new Error(`API login failed: ${loginRes.status}`);
const { token, user } = await loginRes.json();
console.log(`API login OK: ${user?.username ?? IDENTIFIER} role=${user?.role ?? '?'}`);
results.tokenUser = user?.username; results.tokenRole = user?.role;

const browser = await puppeteer.launch({ headless: 'new' });

async function withFreshPage(name, fn) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((tok) => {
    localStorage.setItem('token', tok);
    window.__probe = { pointerdown: 0, click: 0, keydown: 0 };
    for (const type of ['pointerdown', 'click', 'keydown']) {
      document.addEventListener(type, (e) => { if (e.isTrusted) window.__probe[type] += 1; }, { capture: true, passive: true });
    }
  }, token);
  try { await fn(page); } catch (e) { results.surfaces.push({ surface: name, error: String(e) }); console.error(`${name} ERROR:`, e.message ?? e); }
  await page.close();
}

// Per-keystroke measurement (120ms settle: sync focus + microtask re-assert).
async function typeAndMeasure(page, chars) {
  const steps = [];
  for (const ch of chars) {
    await page.keyboard.type(ch);
    await settle(120);
    steps.push(await page.evaluate(() => {
      const active = document.activeElement;
      const group = active?.closest('[data-seg-part]');
      return {
        typed: null,
        activeLabel: active?.getAttribute('aria-label') ?? active?.tagName ?? 'none',
        activeSeg: active?.getAttribute('data-seg') ?? null,
        groupPart: group?.getAttribute('data-seg-part') ?? null,
        groupValues: group ? [...group.querySelectorAll('input')].map((i) => i.value) : null,
        trusted: window.__probe.keydown > 0,
      };
    }));
    steps[steps.length - 1].typed = ch;
  }
  return steps;
}

const hitClick = async (page, selector) => {
  const handle = await page.$(selector);
  if (!handle) return { clicked: false, reason: 'selector not found' };
  const box = await handle.boundingBox();
  if (!box) return { clicked: false, reason: 'no box' };
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await settle(300);
  return { clicked: true, at: [Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2)] };
};

// Segment-key variant: asserts by data-seg because wrapper families differ in
// aria-label contracts (BufferedUuiDateInput suppresses the first label).
async function typeAndMeasureSeg(page, chars) {
  const steps = [];
  for (const ch of chars) {
    await page.keyboard.type(ch);
    await settle(120);
    steps.push(await page.evaluate(() => {
      const active = document.activeElement;
      const group = active?.closest('[data-seg-part]');
      return {
        typed: null,
        activeSeg: active?.getAttribute('data-seg') ?? active?.tagName ?? 'none',
        activeLabel: active?.getAttribute('aria-label') ?? '',
        groupValues: group ? [...group.querySelectorAll('input')].map((i) => i.value) : null,
        trusted: window.__probe.keydown > 0,
      };
    }));
    steps[steps.length - 1].typed = ch;
  }
  return steps;
}

// ── Surface 1: dispatch editor dialog (the user's original repro surface) ──
await withFreshPage('dispatch-editor-dialog', async (page) => {
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('button[aria-label^="Sửa ô điều phối"]', { timeout: 30000 });
  // Pick a row with a stored Giờ trả hàng (type-over needs a full segment):
  // fid present, not completed, no live trip — via the same API the page uses.
  const candidates = await page.evaluate(async () => {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/shipments/dispatch-detail-plan-rows?limit=50', { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json();
    const rows = json.items ?? [];
    return rows
      .filter((r) => r.fulfillmentId != null && r.plannedEndAt && r.taskStatus !== 'COMPLETED' && r.dispatch?.tripId == null)
      .map((r) => r.container?.containerNumber || r.docs?.billNumber);
  });
  if (!candidates.length) throw new Error('no row with stored plannedEndAt available for type-over probe');
  // Intersect with the triggers actually RENDERED and enabled (the grid
  // paginates — a matching row on page 2 has no visible trigger).
  const trig = await page.evaluateHandle((ids) => {
    const enabled = [...document.querySelectorAll('button[aria-label^="Sửa ô điều phối"]')].filter((b) => !b.disabled);
    for (const id of ids) {
      const hit = enabled.find((b) => b.getAttribute('aria-label') === `Sửa ô điều phối ${id}`);
      if (hit) return hit;
    }
    return null;
  }, candidates);
  const el = trig.asElement();
  if (!el) throw new Error(`no VISIBLE enabled trigger matches candidates: ${candidates.join(', ').slice(0, 120)}`);
  await el.click();
  await page.waitForSelector('input[aria-label="Giờ — Giờ trả hàng"]', { timeout: 15000 });
  await settle(500);
  const dialogTitle = await page.evaluate(() => document.querySelector('[role="dialog"]')?.textContent?.replace(/\s+/g, ' ').slice(0, 100) ?? '');
  await page.screenshot({ path: `${OUT}/dispatch-dialog-open.png` });

  // The user's exact flow: trusted click on the FULL hour, type "08".
  const hourClick = await hitClick(page, 'input[aria-label="Giờ — Giờ trả hàng"]');
  const afterClick = await page.evaluate(() => {
    const el = document.activeElement;
    return { active: el?.getAttribute('aria-label'), selection: el && 'selectionStart' in el ? `${el.selectionStart}..${el.selectionEnd}` : 'n/a', probe: window.__probe };
  });
  const hourSteps = await typeAndMeasure(page, ['0', '8']);
  await page.screenshot({ path: `${OUT}/dispatch-after-hour-type.png` });
  const dayClick = await hitClick(page, 'input[aria-label="Ngày — Giờ trả hàng"]');
  const daySteps = await typeAndMeasure(page, ['0', '2']);
  await page.screenshot({ path: `${OUT}/dispatch-after-day-type.png` });
  const verdict = hourSteps.at(-1)?.activeLabel === 'Phút — Giờ trả hàng' && daySteps.at(-1)?.activeLabel === 'Tháng — Giờ trả hàng' ? 'ADVANCES' : 'STUCK';
  results.surfaces.push({ surface: 'dispatch-editor-dialog', dialogTitle, hourClick, afterClick, hourSteps, dayClick, daySteps, verdict });
  console.log(`surface dispatch-editor-dialog: ${verdict} (hourClick=${JSON.stringify(hourClick)}, focusAfterClick=${afterClick.active}, sel=${afterClick.selection}, trustedClicks=${afterClick.probe.click})`);
});

// ── Surface 2: /shipments/new booking form — time→date hand-off included ──
await withFreshPage('shipments-new-booking-form', async (page) => {
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('input[aria-label="Giờ — Ngày giờ đóng trả"]', { timeout: 30000 });
  const hourClick = await hitClick(page, 'input[aria-label="Giờ — Ngày giờ đóng trả"]');
  const steps = await typeAndMeasure(page, ['0', '8', '3', '0']);
  await page.screenshot({ path: `${OUT}/shipments-new-after-0830.png` });
  const finalFocus = steps.at(-1)?.activeLabel;
  const verdict = finalFocus === 'Ngày — Ngày giờ đóng trả' ? 'ADVANCES (incl. time→date hand-off)' : 'STUCK';
  results.surfaces.push({ surface: 'shipments-new-booking-form', hourClick, steps, verdict });
  console.log(`surface shipments-new: ${verdict} (finalFocus=${finalFocus})`);
});

// ── Surface 3: shipments ledger add-row form — BufferedUuiDateInput +
// TimeSegmentsField together (the two wrappers without a live rung yet). ──
await withFreshPage('ledger-add-container-form', async (page) => {
  await page.goto(`${BASE}/shipments-detail`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('button[aria-label^="Thêm container cùng lô"]', { timeout: 30000 });
  const addBtn = await page.evaluateHandle(() => [...document.querySelectorAll('button[aria-label^="Thêm container cùng lô"]')].find((b) => !b.disabled));
  const el = addBtn.asElement();
  if (!el) throw new Error('no enabled "＋ Thêm" button');
  await el.click();
  await page.waitForSelector('[data-testid="add-container-form"]', { timeout: 15000 });
  await settle(400);
  // Date half: the first segment's aria-label is suppressed by design (a real
  // <Label> names it) — target by data-seg/data-date-input, assert by data-seg.
  const dateClick = await hitClick(page, '[data-testid="add-container-form"] input[data-date-input]');
  const daySteps = await typeAndMeasureSeg(page, ['0', '2']);
  await page.screenshot({ path: `${OUT}/ledger-after-day-type.png` });
  const timeClick = await hitClick(page, '[data-testid="add-container-form"] [data-seg-part="time"] [data-seg="hh"]');
  const hourSteps = await typeAndMeasureSeg(page, ['0', '8']);
  await page.screenshot({ path: `${OUT}/ledger-after-hour-type.png` });
  const lastDay = daySteps.at(-1)?.activeSeg;
  const lastHour = hourSteps.at(-1)?.activeSeg;
  const verdict = lastDay === 'mm2' && lastHour === 'mm' ? 'ADVANCES' : 'STUCK';
  results.surfaces.push({ surface: 'ledger-add-container-form', dateClick, daySteps, timeClick, hourSteps, verdict });
  console.log(`surface ledger-add-form: ${verdict} (day→${lastDay}, hour→${lastHour})`);
});

await browser.close();
writeFileSync(`${OUT}/probe-results.json`, JSON.stringify(results, null, 2));
console.log('transcript →', `${OUT}/probe-results.json`);
