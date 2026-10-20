// FB-002 LAN 3 (card 211026034109) — staging repro, PART 2: drawer surfaces.
// /shipments → lot drawer (Tổng quan): popover "Giờ hẹn đóng/trả" (SplitDateTimeField
// with onCommit) and the "Thêm container" add-row (BufferedUuiDateTimeInput echo host).
// Probes:
//   D3 popover on a container WITH appointment: click giờ, type-over "1630", Enter
//      — save? wipe? stale-value commit?
//   D1 add-row fresh: type giờ "1630" only + Enter — swallowed? wiped?
//   D2 add-row full datetime + số cont + Enter — row submitted? appointment saved?
// Usage: node testplan/qa/scripts/2026-10-21-fb002-lan3-staging-drawer.mjs
import puppeteer from 'puppeteer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.QA_API || 'https://vantai.tingting.vip/api';
const BASE = process.env.QA_BASE || 'https://vantai.tingting.vip';
const OUT = path.resolve(import.meta.dirname, '../../../qa/2026-10-21-fb002-lan3');
fs.mkdirSync(OUT, { recursive: true });

const LOG = [];
const log = (step, obj = {}) => {
  const e = { at: new Date().toISOString(), step, ...obj };
  LOG.push(e);
  console.log(JSON.stringify(e));
};
const results = [];
let exitCode = 0;
const record = (id, pass, detail) => {
  results.push({ id, pass, detail });
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
  const { token } = await res.json();
  return token;
};
const api = (token) => async (method, p, body) => {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = text;
  try { parsed = JSON.parse(text); } catch { /* keep raw */ }
  return { status: res.status, body: parsed };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });

try {
  const token = await login('tiepvv');
  const call = api(token);
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const mutations = [];
  let lastMutationResponse = null;
  page.on('request', (req) => {
    if (/\/api\/shipments\/cus-workspace/.test(req.url()) && !['GET', 'OPTIONS'].includes(req.method())) {
      mutations.push({ method: req.method(), url: req.url(), body: req.postData() ?? null });
      log('mutation', { method: req.method(), url: req.url(), body: (req.postData() ?? '').slice(0, 300) });
    }
  });
  page.on('response', async (res) => {
    if (/\/api\/shipments\/cus-workspace/.test(res.url()) && !['GET', 'OPTIONS'].includes(res.request().method())) {
      let bodyText = '';
      try { bodyText = (await res.text()).slice(0, 300); } catch { /* noop */ }
      lastMutationResponse = { status: res.status, url: res.url(), body: bodyText };
      log('mutation_status', lastMutationResponse);
    }
  });

  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle2', timeout: 60000 });

  // ── Find a lot whose drawer has a container WITH an appointment ──────────
  // (FCL lots carry per-container giờ hẹn; list API finds them directly.)
  let popoverLot = null;
  for (let p = 1; p <= 6 && !popoverLot; p += 1) {
    const list = await call('GET', `/shipments/cus-workspace?page=${p}&limit=50`);
    const items = list.body?.items ?? [];
    for (const it of items) {
      if (it.cargoMode !== 'FCL' || !(it.customerAppointmentAts ?? []).length) continue;
      const d = await call('GET', `/shipments/cus-workspace/${it.id}`);
      const lines = d.body?.containers ?? [];
      const withApt = lines.find((l) => l.customerAppointmentAt);
      if (withApt) {
        popoverLot = { shipmentId: it.id, line: withApt, version: d.body?.summary?.version, bill: it.billOrBookNumber || '', page: p };
        break;
      }
    }
  }
  if (!popoverLot) throw new Error('no lot with an appointed container found');
  log('popover_target', { shipmentId: popoverLot.shipmentId, lineId: popoverLot.line.id, apt: popoverLot.line.customerAppointmentAt, page: popoverLot.page });

  const openDrawer = async (lot) => {
    // Locate the row by its bill/booking cell text, then open its drawer.
    let uiPage = null;
    for (let p = 1; p <= 8 && uiPage == null; p += 1) {
      await page.goto(`${BASE}/shipments?page=${p}`, { waitUntil: 'networkidle2', timeout: 60000 });
      try { await page.waitForSelector('table', { timeout: 15000 }); } catch { break; }
      const found = await page.evaluate((bill) => Boolean(Array.from(document.querySelectorAll('tr'))
        .find((tr) => bill && (tr.textContent || '').includes(bill))), lot.bill);
      if (found) uiPage = p;
    }
    if (uiPage == null) throw new Error(`row with bill ${lot.bill} not found in UI pages 1..8`);
    await page.evaluate((bill) => {
      const tr = Array.from(document.querySelectorAll('tr')).find((r) => bill && (r.textContent || '').includes(bill));
      tr?.querySelector('button[aria-label^="Mở chi tiết lô hàng"]')?.scrollIntoView({ block: 'center' });
    }, lot.bill);
    await sleep(200);
    await page.evaluate((bill) => {
      const tr = Array.from(document.querySelectorAll('tr')).find((r) => bill && (r.textContent || '').includes(bill));
      tr?.querySelector('button[aria-label^="Mở chi tiết lô hàng"]')?.click();
    }, lot.bill);
    await page.waitForSelector('.cus-container-ledger', { timeout: 20000 });
    await sleep(500);
  };
  const closeDrawer = async () => {
    await page.evaluate(() => {
      const dlg = Array.from(document.querySelectorAll('[role="dialog"]')).find((m) => m.querySelector('.cus-container-ledger'));
      dlg?.querySelector('button[aria-label*="Đóng"], button[aria-label="Close"]')?.click();
    });
    await sleep(200);
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await sleep(400);
  };
  const segState = () => page.evaluate(() => {
    const pop = document.querySelector('.cus-appointment-popover');
    const segVal = (root, part) => Array.from(root?.querySelectorAll(`[data-seg-part="${part}"] input[data-seg]`) ?? [])
      .map((i) => `${i.getAttribute('data-seg')}=${i.value}`);
    const addRow = document.querySelector('.cus-container-ledger__add-row');
    return {
      popoverOpen: Boolean(pop),
      timeSegs: segVal(pop, 'time'),
      dateSegs: segVal(pop, 'date'),
      saveError: pop?.querySelector('.cus-appointment-popover__error')?.textContent?.trim() ?? null,
      addRowPresent: Boolean(addRow),
      addContainer: addRow?.querySelector('input[aria-label="Số container"]')?.value ?? null,
      addWeight: addRow?.querySelector('input[aria-label="Trọng lượng (kg)"]')?.value ?? null,
      addTimeSegs: segVal(addRow, 'time'),
      addDateSegs: segVal(addRow, 'date'),
      fieldError: document.querySelector('.split-datetime__error, .cus-container-ledger [role="alert"]')?.textContent?.trim() ?? null,
      notice: document.querySelector('.app-notices, [role="status"]')?.textContent?.trim() ?? null,
      activeSeg: document.activeElement?.getAttribute('data-seg') ?? null,
      activePart: document.activeElement?.closest('[data-seg-part]')?.getAttribute('data-seg-part') ?? null,
    };
  });

  // ══ D3: popover giờ hẹn — click giờ, type-over 1630, Enter ═══════════════
  await openDrawer(popoverLot);
  const aptBefore = popoverLot.line.customerAppointmentAt;
  await page.evaluate(() => {
    const trigger = Array.from(document.querySelectorAll('button.cus-appointment-trigger'))
      .find((b) => !b.textContent.includes('Chọn ngày giờ'));
    trigger?.scrollIntoView({ block: 'center' });
  });
  await sleep(150);
  await page.evaluate(() => {
    const trigger = Array.from(document.querySelectorAll('button.cus-appointment-trigger'))
      .find((b) => !b.textContent.includes('Chọn ngày giờ'));
    trigger?.click();
  });
  await page.waitForSelector('.cus-appointment-popover', { timeout: 10000 });
  await sleep(400);
  let st = await segState();
  log('D3_popover_open', st);
  await page.screenshot({ path: path.join(OUT, 'D3_popover-open.png') });
  const timeSeg0 = await page.$('.cus-appointment-popover [data-seg-part="time"] input[data-seg]');
  await timeSeg0.click();
  await sleep(200);
  await page.keyboard.type('1630', { delay: 110 });
  await sleep(350);
  st = await segState();
  log('D3_after_typing_1630', st);
  await page.screenshot({ path: path.join(OUT, 'D3_after-typing-1630.png') });
  mutations.length = 0;
  await page.keyboard.press('Enter');
  await sleep(1500);
  st = await segState();
  log('D3_after_enter', { ...st, mutations: mutations.length, lastMutationResponse });
  await page.screenshot({ path: path.join(OUT, 'D3_after-enter.png') });
  const afterLine = await call('GET', `/shipments/cus-workspace/${popoverLot.shipmentId}`);
  const afterApt = (afterLine.body?.containers ?? []).find((l) => l.id === popoverLot.line.id)?.customerAppointmentAt ?? null;
  log('D3_after_value', { before: aptBefore, after: afterApt });
  const afterLocal1630 = afterApt != null && (/T16:30:00/.test(afterApt) || /T09:30:00\.000Z/.test(afterApt));
  record('D3 popover: type-over giờ "16:30" + Enter → saved (POST fired, value = 16:30 local, no wipe)',
    mutations.length > 0 && afterLocal1630,
    `mutations=${mutations.length} after=${afterApt} saveError=${st.saveError} timeSegs=${JSON.stringify(st.timeSegs)} notice=${st.notice}`);
  // Restore the appointment if changed
  if (afterApt !== aptBefore) {
    const fresh = await call('GET', `/shipments/cus-workspace/${popoverLot.shipmentId}`);
    const r = await call('POST', `/shipments/cus-workspace/${popoverLot.shipmentId}/containers/${popoverLot.line.id}`, {
      expectedShipmentVersion: fresh.body?.summary?.version,
      customerAppointmentAt: aptBefore,
    });
    log('D3_restore', { status: r.status });
  }
  if (await page.$('.cus-appointment-popover')) await page.keyboard.press('Escape').catch(() => {});
  await sleep(300);
  if (!(await page.$('.cus-container-ledger'))) await openDrawer(popoverLot);

  // ══ D1: add-row — giờ only "1630" + Enter ════════════════════════════════
  const addBtnEl = await page.$('.cus-container-ledger__add .btn');
  if (!addBtnEl) {
    record('D1 add-row probes', false, `"Thêm container" trigger not present on lot ${popoverLot.shipmentId}`);
  } else {
  await addBtnEl.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await sleep(150);
  await page.evaluate(() => Array.from(document.querySelectorAll('.cus-container-ledger__add button'))
    .find((b) => (b.textContent || '').trim() === 'Thêm container')?.click());
  await page.waitForSelector('.cus-container-ledger__add-row', { timeout: 10000 });
  await sleep(400);
  st = await segState();
  log('D1_addrow_open', st);
  // type a container number first (so the row carries real input)
  const numInput = await page.$('.cus-container-ledger__add-row input[aria-label="Số container"]');
  await numInput.click();
  await page.keyboard.type('TSTU9999860', { delay: 30 });
  const addTimeSeg = await page.$('.cus-container-ledger__add-row [data-seg-part="time"] input[data-seg]');
  await addTimeSeg.click();
  await sleep(200);
  await page.keyboard.type('1630', { delay: 110 });
  await sleep(350);
  st = await segState();
  log('D1_after_typing_1630', st);
  await page.screenshot({ path: path.join(OUT, 'D1_after-typing-1630.png') });
  mutations.length = 0;
  await page.keyboard.press('Enter');
  await sleep(1200);
  st = await segState();
  log('D1_after_enter', { ...st, mutations: mutations.length, lastMutationResponse });
  await page.screenshot({ path: path.join(OUT, 'D1_after-enter.png') });
  record('D1 add-row giờ-only "16:30" + Enter → NOT submitted (incomplete draft must not POST), inputs KEPT',
    mutations.length === 0 && st.addContainer === 'TSTU9999860' && st.addTimeSegs?.length > 0 && st.addTimeSegs.some((s) => s.includes('16') || s.includes('30')),
    `mutations=${mutations.length} addContainer=${st.addContainer} addTimeSegs=${JSON.stringify(st.addTimeSegs)} fieldError=${st.fieldError} notice=${st.notice}`);
  // cleanup add-row via Hủy
  await page.evaluate(() => Array.from(document.querySelectorAll('.cus-container-ledger__add-row button'))
    .find((b) => (b.textContent || '').trim() === 'Hủy')?.click());
  await sleep(300);

  // ══ D2: add-row — full datetime + số cont + Enter → submits ══════════════
  await page.evaluate(() => Array.from(document.querySelectorAll('button'))
    .find((b) => (b.textContent || '').trim() === 'Thêm container')?.click());
  await page.waitForSelector('.cus-container-ledger__add-row', { timeout: 10000 });
  await sleep(300);
  const numInput2 = await page.$('.cus-container-ledger__add-row input[aria-label="Số container"]');
  await numInput2.click();
  await page.keyboard.type('TSTU9999860', { delay: 30 });
  const addTimeSeg2 = await page.$('.cus-container-ledger__add-row [data-seg-part="time"] input[data-seg]');
  await addTimeSeg2.click();
  await sleep(200);
  await page.keyboard.type('1630', { delay: 110 }); // advances to date half
  await sleep(250);
  st = await segState();
  log('D2_after_time_1630', st);
  await page.keyboard.type('22112026', { delay: 100 }); // dd mm yyyy
  await sleep(350);
  st = await segState();
  log('D2_after_date', st);
  await page.screenshot({ path: path.join(OUT, 'D2_after-datetime-typed.png') });
  mutations.length = 0;
  await page.keyboard.press('Enter');
  await sleep(2000);
  st = await segState();
  log('D2_after_enter', { ...st, mutations: mutations.length, lastMutationResponse });
  await page.screenshot({ path: path.join(OUT, 'D2_after-enter.png') });
  const addedOk = mutations.some((m) => m.url.includes('/containers') && m.method === 'POST' && !m.url.includes('remove'));
  const bodyOk = /2026-11-22T16:30/.test(lastMutationResponse?.body ?? '') || /2026-11-22T09:30/.test(lastMutationResponse?.body ?? '');
  record('D2 add-row full "16:30 22/11/2026" + Enter → POST container-add fired with giờ hẹn',
    addedOk && bodyOk,
    `mutations=${JSON.stringify(mutations.map((m) => m.method + ' ' + m.url.replace(API, '')))} resp=${lastMutationResponse?.status} body=${(lastMutationResponse?.body ?? '').slice(0, 160)} fieldError=${st.fieldError}`);
  // ── cleanup: remove the added container if it exists ─────────────────────
  const afterAdd = await call('GET', `/shipments/cus-workspace/${popoverLot.shipmentId}`);
  const added = (afterAdd.body?.containers ?? []).find((l) => l.containerNumber === 'TSTU9999860');
  if (added) {
    const rm = await call('POST', `/shipments/cus-workspace/${popoverLot.shipmentId}/containers/${added.id}/remove`, {
      expectedShipmentVersion: afterAdd.body?.summary?.version,
    });
    log('D2_cleanup_remove', { status: rm.status, lineId: added.id });
    record('D2 cleanup: staging container TSTU9999860 removed', rm.status === 200, `status=${rm.status}`);
  } else {
    record('D2 cleanup: staging container TSTU9999860 removed', true, 'add never landed (nothing to clean)');
  }
  }

  await closeDrawer();
  await page.close();
} catch (error) {
  record('driver', false, String(error?.stack ?? error));
}

fs.writeFileSync(path.join(OUT, 'staging-drawer-driver.log'), JSON.stringify(LOG, null, 2));
fs.writeFileSync(path.join(OUT, 'staging-drawer-results.json'), JSON.stringify(results, null, 2));
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} pass — exit ${exitCode}`);
await browser.close();
process.exit(exitCode);
