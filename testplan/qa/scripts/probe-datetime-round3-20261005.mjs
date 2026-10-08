// Card 051026223607 — datetime auto-advance round 3 (symptom changed: siblings
// clear to placeholder). Local repro probe on the working tree (dispatch chain
// unchanged vs HEAD). Raw puppeteer, one fresh page per surface (input-death
// protocol), JWT injection, trusted CDP keys, per-keystroke activeElement +
// BOTH segment groups' values (time AND date) + selection state.
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:7175';
const IDENTIFIER = process.env.IDENTIFIER || 'dungnv';
const PASSWORD = process.env.PASSWORD || 'Abc123';
const OUT = process.env.OUT_DIR || '/Volumes/LexarSSD/projects/silversea-prod/qa/2026-10-05_card051026223607';
mkdirSync(OUT, { recursive: true });

const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const results = { base: BASE, startedAt: new Date().toISOString(), surfaces: [] };

const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: IDENTIFIER, password: PASSWORD }),
}).catch(() => null);
if (!loginRes || !loginRes.ok) throw new Error('local API login failed — dev stack down?');
const { token, user } = await loginRes.json();
console.log(`API login OK: ${user?.username ?? IDENTIFIER} role=${user?.role ?? '?'}`);
results.tokenUser = user?.username; results.tokenRole = user?.role;
try {
  const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
  results.buildHash = health.buildHash ?? health.build ?? null;
  console.log(`buildHash: ${results.buildHash ?? 'n/a'}`);
} catch { console.log('buildHash probe failed'); }

const browser = await puppeteer.launch({ headless: 'new' });

async function withFreshPage(name, fn) {
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT });
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

let WIDTH = 1440, HEIGHT = 900;

const groupState = (page) => page.evaluate(() => {
  const active = document.activeElement;
  const groups = [...document.querySelectorAll('[data-seg-part]')].map((g) => ({
    part: g.getAttribute('data-seg-part'),
    values: [...g.querySelectorAll('input')].map((i) => ({ v: i.value, ph: i.placeholder })),
  }));
  const picker = document.querySelector('[data-time-picker-overlay], .time-picker__popup');
  return {
    activeLabel: active?.getAttribute('aria-label') ?? active?.tagName ?? 'none',
    activeSeg: active?.getAttribute('data-seg') ?? null,
    selection: active && 'selectionStart' in active ? `${active.selectionStart}..${active.selectionEnd}` : 'n/a',
    groups, pickerOpen: Boolean(picker),
    trusted: window.__probe ? window.__probe.keydown : -1,
  };
});

async function typeAndMeasure(page, chars, gap) {
  const steps = [];
  for (const ch of chars) {
    await page.keyboard.type(ch);
    await settle(gap);
    const step = await groupState(page);
    step.typed = ch;
    steps.push(step);
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

// ── The dispatch editor dialog on a row with a stored Giờ trả hàng ──
async function dispatchEditorSurface(label, { width, height, gap, mode, rowLabel }) {
  WIDTH = width; HEIGHT = height;
  await withFreshPage(label, async (page) => {
    await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('button[aria-label^="Sửa ô điều phối"]', { timeout: 30000 });
    if (rowLabel) {
      // Exact-row mode: drive the same trigger the user drives (e.g.
      // MSKU1234565), whatever its API state. Read-only: dialog + typing only.
      const trig = await page.evaluateHandle((needle) => {
        const enabled = [...document.querySelectorAll('button[aria-label^="Sửa ô điều phối"]')].filter((b) => !b.disabled);
        return enabled.find((b) => b.getAttribute('aria-label').includes(needle)) ?? null;
      }, rowLabel);
      const el = trig.asElement();
      if (!el) throw new Error(`no enabled trigger matching ${rowLabel}`);
      await el.click();
      await page.waitForSelector('input[aria-label="Giờ — Giờ trả hàng"]', { timeout: 15000 });
      await settle(500);
      await page.screenshot({ path: `${OUT}/${label}-open.png` });
      const before = await groupState(page);
      await hitClick(page, 'input[aria-label="Giờ — Giờ trả hàng"]');
      const afterClick = await groupState(page);
      const steps = await typeAndMeasure(page, ['0', '8'], gap);
      await settle(400);
      const final = await groupState(page);
      await page.screenshot({ path: `${OUT}/${label}-after-08.png` });
      const advanced = final.activeSeg === 'mm';
      results.surfaces.push({ surface: label, row: { label: rowLabel }, gap, before, afterClick, steps, final, verdict: { advanced } });
      console.log(`${label}: advanced=${advanced} active=${final.activeLabel} seg=${final.activeSeg} timeVals=${JSON.stringify(final.groups.find((g) => g.part === 'time')?.values)} dateVals=${JSON.stringify(final.groups.find((g) => g.part === 'date')?.values)}`);
      return;
    }
    const candidates = await page.evaluate(async (modeArg) => {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/shipments/dispatch-detail-plan-rows?limit=50', { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      const rows = json.items ?? [];
      return rows
        .filter((r) => (modeArg === 'empty'
          ? r.fulfillmentId != null && !r.plannedEndAt && !r.time?.runAt && r.taskStatus !== 'COMPLETED'
          : r.fulfillmentId != null && r.plannedEndAt && r.taskStatus !== 'COMPLETED' && r.dispatch?.tripId == null))
        .map((r) => ({ id: r.fulfillmentId, label: r.container?.containerNumber ?? '', bill: r.docs?.billNumber ?? '', plannedEndAt: r.plannedEndAt }));
    }, mode);
    if (!candidates.length) throw new Error('no matching row available for probe');
    const labels = await page.evaluate(() => [...document.querySelectorAll('button[aria-label^="Sửa ô điều phối"]')].filter((b) => !b.disabled).map((b) => b.getAttribute('aria-label')));
    const chosen = candidates.find((c) => (c.label && labels.includes(`Sửa ô điều phối ${c.label}`)) || (c.bill && labels.includes(`Sửa ô điều phối ${c.bill}`)));
    if (!chosen) throw new Error(`none of ${candidates.length} rows rendered on this grid page (labels: ${labels.slice(0, 3).join(' | ')})`);
    const matchLabel = chosen.label && labels.includes(`Sửa ô điều phối ${chosen.label}`) ? chosen.label : chosen.bill;
    const trig = await page.evaluateHandle((label) => {
      const enabled = [...document.querySelectorAll('button[aria-label^="Sửa ô điều phối"]')].filter((b) => !b.disabled);
      return enabled.find((b) => b.getAttribute('aria-label') === `Sửa ô điều phối ${label}`) ?? null;
    }, matchLabel);
    const el = trig.asElement();
    if (!el) throw new Error(`trigger for ${chosen.label} not visible/enabled`);
    await el.click();
    await page.waitForSelector('input[aria-label="Giờ — Giờ trả hàng"]', { timeout: 15000 });
    await settle(500);
    await page.screenshot({ path: `${OUT}/${label}-open.png` });
    const before = await groupState(page);
    await hitClick(page, 'input[aria-label="Giờ — Giờ trả hàng"]');
    const afterClick = await groupState(page);
    const steps = await typeAndMeasure(page, ['0', '8'], gap);
    await settle(400);
    const final = await groupState(page);
    await page.screenshot({ path: `${OUT}/${label}-after-08.png` });
    const advanced = final.activeSeg === 'mm';
    const siblingsRetained = final.groups.find((g) => g.part === 'date')?.values.every((x) => x.v !== '') ?? false;
    results.surfaces.push({ surface: label, row: chosen, gap, before, afterClick, steps, final, verdict: { advanced, siblingsRetained } });
    console.log(`${label}: advanced=${advanced} siblingsRetained=${siblingsRetained} active=${final.activeLabel} seg=${final.activeSeg}`);
  });
}

const ONLY = process.env.SURFACES || 'all';
if (ONLY === 'all' || ONLY.includes('full')) {
  await dispatchEditorSurface('dispatch-full-1440-burst', { width: 1440, height: 900, gap: 0, mode: 'full' });
  await dispatchEditorSurface('dispatch-full-1440-120ms', { width: 1440, height: 900, gap: 120, mode: 'full' });
  await dispatchEditorSurface('dispatch-full-1440-2s', { width: 1440, height: 900, gap: 2000, mode: 'full' });
  await dispatchEditorSurface('dispatch-full-390-120ms', { width: 390, height: 844, gap: 120, mode: 'full' });
}
if (ONLY === 'all' || ONLY.includes('empty')) {
  await dispatchEditorSurface('dispatch-empty-1440', { width: 1440, height: 900, gap: 120, mode: 'empty' });
}
const USER_ROW = process.env.USER_ROW || 'MSKU1234565';
if (ONLY === 'all' || ONLY.includes('user-row')) {
  await dispatchEditorSurface('dispatch-user-row-1440', { width: 1440, height: 900, gap: 120, mode: 'full', rowLabel: USER_ROW });
  await dispatchEditorSurface('dispatch-user-row-390', { width: 390, height: 844, gap: 120, mode: 'full', rowLabel: USER_ROW });
}

// Transcript lands BEFORE browser.close(): teardown must never cost evidence.
writeFileSync(`${OUT}/probe-results.json`, JSON.stringify(results, null, 2));
console.log('transcript written:', `${OUT}/probe-results.json`);
await browser.close();
