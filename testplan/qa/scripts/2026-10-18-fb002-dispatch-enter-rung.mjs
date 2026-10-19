// FB-002 fix — rung 3 on the DISPATCH assignment dialog (the trip surface):
// hand-type Giờ trả hàng in the segmented field, press Enter in the segment →
// the form's requestSubmit path saves; API row proves plannedEndAt; then the
// same Enter path clears it back (restore).
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const API = 'http://localhost:3002/api';
const BASE = process.env.QA_BASE || 'http://localhost:7175';
const OUT = path.resolve(import.meta.dirname, '../../../qa/2026-10-18_fb002-fb030_fix');
fs.mkdirSync(OUT, { recursive: true });

const LOG = [];
const log = (step, obj = {}) => {
  const e = { at: new Date().toISOString(), step, ...obj };
  LOG.push(e);
  console.log(JSON.stringify(e));
};
let exitCode = 0;
let TARGET = 0;
const record = (id, pass, detail) => {
  if (!pass) exitCode = 1;
  log('RESULT', { id, pass, detail });
};

const login = async (identifier) => {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (!res.ok) throw new Error(`login ${identifier} -> ${res.status}`);
  return (await res.json()).token;
};

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash });

const token = await login('dieuvan');
let rowsUrl = null; // captured from the page's own fetch (its filter set is the truth)
const rowsFor = async () => {
  const url = rowsUrl ?? `${API}/shipments/dispatch-detail-plan-rows`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json();
  return Array.isArray(body) ? body : body.rows ?? body.items ?? [];
};

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
try {
  const page = await browser.newPage();
  const rowPayloads = [];
  let lastPlanResult = null;
  page.on('response', async (res) => {
    if (res.url().includes('/plan') && res.request().method() !== 'GET') {
      try { lastPlanResult = JSON.parse(await res.text()); } catch { /* ignore */ }
      log('api_plan', { status: res.status, url: res.url().replace('http://localhost:3002/api', ''), plannedEndAt: lastPlanResult?.plannedEndAt ?? null, fulfillmentVersion: lastPlanResult?.fulfillmentVersion ?? null });
    }
    if (res.url().includes('/dispatch-detail-plan-rows') && res.request().method() === 'GET') {
      rowsUrl = res.url();
      try { rowPayloads.push(JSON.parse(await res.text())); } catch { /* ignore */ }
    }
  });
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('button[aria-label^="Sửa ô điều phối"]', { timeout: 30000 });
  // Choose a row that ALREADY carries a carrier (its save then changes nothing
  // but Giờ trả hàng; carrier-less rows refuse to save: "Chọn nhà xe...").
  const carrierRows = rowPayloads.flatMap((body) => (Array.isArray(body) ? body : body.rows ?? body.items ?? []))
    .filter((r) => (r.dispatch ?? {}).carrierType != null);
  log('carrier_rows', { n: carrierRows.length, sample: carrierRows.slice(0, 5).map((r) => [r.fulfillmentId, (r.container ?? {}).containerNumber, r.plannedEndAt]) });
  // Rows can share a container number (three MSKU1234565 buttons) — the DOM
  // label alone cannot disambiguate, but the payload order mirrors the DOM
  // order, so walking the buttons and popping each container's row queue maps
  // every button to its row. Prefer a null plannedEndAt (pure set, clean restore).
  const domLabels = await page.evaluate(() => Array.from(document.querySelectorAll('button[aria-label^="Sửa ô điều phối"]')).map((b) => b.getAttribute('aria-label') ?? ''));
  const queues = new Map();
  for (const r of carrierRows) {
    const key = (r.container ?? {}).containerNumber ?? '';
    queues.set(key, [...(queues.get(key) ?? []), r]);
  }
  const cursors = new Map();
  let chosen = null;
  let buttonIndex = -1;
  domLabels.forEach((label, index) => {
    const key = label.replace('Sửa ô điều phối ', '');
    const queue = queues.get(key);
    if (!queue) return;
    const cursor = cursors.get(key) ?? 0;
    cursors.set(key, cursor + 1);
    const row = queue[cursor];
    if (!row || chosen) return;
    if (row.plannedEndAt == null || cursor === queue.length - 1) {
      chosen = row;
      buttonIndex = index;
    }
  });
  if (!chosen) throw new Error('no clickable carrier row visible on the page');
  TARGET = chosen.fulfillmentId;
  const before = chosen;
  log('snapshot', { fulfillmentId: TARGET, plannedEndAt: before?.plannedEndAt ?? null, identity: before?.container?.containerNumber ?? null });
  const needle = (chosen.container ?? {}).containerNumber ?? '';
  const editBtn = await page.evaluateHandle((index) => {
    const els = Array.from(document.querySelectorAll('button[aria-label^="Sửa ô điều phối"]'));
    const el = els[index] ?? els[0];
    el.scrollIntoView({ block: 'center' });
    return el;
  }, buttonIndex);
  await editBtn.asElement().click();
  await page.waitForSelector('[data-seg-part="time"] [data-seg="hh"]', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 500));
  // Scope every segment read to the DIALOG — the /dispatch-detail page also
  // renders DateRangeFields filters whose [data-seg-part="date"] groups would
  // otherwise shadow the dialog's own segments.
  const segDump = () => page.evaluate(() => {
    const dlg = document.querySelector('form.dispatch-assignment-dialog');
    return {
      activeSeg: document.activeElement?.getAttribute('data-seg') ?? null,
      hour: dlg?.querySelector('[data-seg-part="time"] [data-seg="hh"]')?.value ?? null,
      minute: dlg?.querySelector('[data-seg-part="time"] [data-seg="mm"]')?.value ?? null,
      day: dlg?.querySelector('[data-seg-part="date"] [data-seg="dd"]')?.value ?? null,
      month: dlg?.querySelector('[data-seg-part="date"] [data-seg="mm2"]')?.value ?? null,
      year: dlg?.querySelector('[data-seg-part="date"] [data-seg="yyyy"]')?.value ?? null,
    };
  });
  log('dispatch_prefill', await segDump());
  await page.screenshot({ path: path.join(OUT, '04-dispatch-dialog-open.png') });

  // Hand-type Giờ trả hàng: 14:30 18/10/2026.
  const hour = await page.$('form.dispatch-assignment-dialog [data-seg-part="time"] [data-seg="hh"]');
  await hour.click();
  await page.keyboard.type('14', { delay: 80 });
  await new Promise((r) => setTimeout(r, 200));
  const afterHour = await page.evaluate(() => ({
    activeSeg: document.activeElement?.getAttribute('data-seg') ?? null,
    hour: document.querySelector('[data-seg-part="time"] [data-seg="hh"]')?.value ?? null,
  }));
  log('dispatch_after_hour_14', afterHour);
  record('FB-030/075 dispatch: hour "14" auto-advances to minute', afterHour.activeSeg === 'mm' && afterHour.hour === '14', JSON.stringify(afterHour));

  // FB-002 story: the date half is prefilled (inherited runAt); the dispatcher
  // hand-types the GIỜ and presses Enter → save. (Typing over the prefilled
  // date segments scrambles through the runAt-prefill round-trip — separate
  // issue, noted in the report; not these cards' contract.)
  await page.keyboard.type('30', { delay: 80 });
  await new Promise((r) => setTimeout(r, 250));
  log('dispatch_after_minute_30', await segDump());
  await page.keyboard.type('18102026', { delay: 90 });
  await new Promise((r) => setTimeout(r, 300));
  log('dispatch_segments_full', await segDump());
  await page.screenshot({ path: path.join(OUT, '05-dispatch-datetime-typed.png') });

  // instrument the Enter path
  await page.evaluate(() => {
    window.__log = [];
    const form = document.querySelector('form.dispatch-assignment-dialog');
    const d = (tag) => (el) => window.__log.push([tag, el.key, el.defaultPrevented, (el.target instanceof HTMLElement) ? `${el.target.tagName}[${el.target.getAttribute('data-seg') ?? ''}]` : String(el.target)]);
    form.addEventListener('keydown', d('form-bubble'), true);
    window.addEventListener('keydown', d('window-capture'), true);
    window.addEventListener('keydown', d('window-bubble'));
    window.__alert = () => document.querySelector('.split-datetime__error, [role="alert"]')?.textContent ?? null;
  });
  const activeBeforeEnter = await page.evaluate(() => ({ seg: document.activeElement?.getAttribute('data-seg'), tag: document.activeElement?.tagName }));
  log('before_enter', activeBeforeEnter);
  // THE FIX (dispatch host): Enter with focus in a segment saves via requestSubmit.
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 300));
  log('enter_path', await page.evaluate(() => ({ log: window.__log, alert: window.__alert() })));
  await new Promise((r) => setTimeout(r, 2500));
  const dialogClosed = await page.evaluate(() => !document.querySelector('.dispatch-assignment-dialog'));
  log('dispatch_after_enter', { dialogClosed });
  await page.screenshot({ path: path.join(OUT, '06-dispatch-after-enter.png') });
  record('FB-002 dispatch: typed Giờ trả hàng + Enter saves the dialog', dialogClosed, `dialogClosed=${dialogClosed}`);

  const after = (await rowsFor()).find((r) => r.fulfillmentId === TARGET);
  log('api_after', { plannedEndAt: after?.plannedEndAt ?? null });
  record(
    'FB-002 dispatch API: fulfillment plannedEndAt persisted 14:30 18/10 (+07)',
    after?.plannedEndAt === '2026-10-18T07:30:00.000Z',
    `plannedEndAt=${after?.plannedEndAt ?? null}`,
  );

  // Restore through the plan API (deterministic; the UI clear path leaves the
  // stored value alone by design when the draft returns to the inherited
  // prefill shape). Same atomic-save contract the dialog rides.
  if (after?.plannedEndAt) {
    const restoreRes = await fetch(`${API}/shipments/dispatch-detail-plan-rows/${TARGET}/plan`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': `fb002-rung-restore-${TARGET}-${Date.now()}` },
      body: JSON.stringify({
        expectedFulfillmentVersion: lastPlanResult?.fulfillmentVersion ?? after?.fulfillmentVersion,
        expectedShipmentVersion: lastPlanResult?.shipmentVersion ?? after?.shipmentVersion,
        carrierType: (after?.dispatch ?? {}).carrierType ?? 'OWN',
        plannedRevenue: null,
        plannedCarrierCost: null,
        plannedEndAt: before?.plannedEndAt ?? null,
      }),
    });
    const restoreBody = await restoreRes.json().catch(() => null);
    log('dispatch_restore_api', { status: restoreRes.status, plannedEndAt: restoreBody?.plannedEndAt ?? null });
    record('FB-002 dispatch restore: plannedEndAt back to its pre-probe value', restoreRes.status === 200 && (restoreBody?.plannedEndAt ?? null) === (before?.plannedEndAt ?? null), `status=${restoreRes.status} now=${restoreBody?.plannedEndAt ?? null} before=${before?.plannedEndAt ?? null}`);
  }
  await page.close();
} catch (error) {
  record('driver', false, String(error));
}

await browser.close();
fs.writeFileSync(path.join(OUT, 'dispatch_driver_log.json'), JSON.stringify(LOG, null, 2));
console.log(`exit=${exitCode}`);
process.exit(exitCode);
