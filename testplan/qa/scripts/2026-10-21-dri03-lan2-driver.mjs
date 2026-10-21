// DRI-03 lan 2 (card 211026180628) — rung-3 UI drive theo SHAPE THẬT lot QA
// 133/SHP-2610-00069 (2x20', containerNumber NULL, giờ hẹn RIÊNG từng cont):
// kẹp qua dispatch thật = 2 trip ghép KEP pair, mỗi trip 1 cont riêng.
//   R1 board /my-trips: 2 card nhóm KẸP, giờ chạy riêng 09:00 / 12:00.
//   R2 detail leg A: mã chuyến riêng, giờ kế hoạch 09:00, Cảng nâng/hạ per cont.
//   R3 nhập số cont A (NULL → MSKU7654328): chỉ cont A đổi; cont B (trip kia)
//      vẫn NULL — KHÔNG TRỘN (DB proof).
//   R4 detail leg B: giờ 12:00 riêng, cont B riêng; nhập CSQU3054383; cont A
//      giữ nguyên số đã nhập.
//   R5 nhận lệnh leg A: leg A IN_TRANSIT, leg B vẫn CREATED — không trộn.
// Viewport 390x844. Usage: node testplan/qa/scripts/2026-10-21-dri03-lan2-driver.mjs
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.QA_API || 'http://localhost:3002/api';
const FRONT = process.env.QA_BASE || 'http://localhost:7175';
const DRIVER = process.env.DRIVER || 'bqhuong';
const state = JSON.parse(fs.readFileSync(path.resolve('qa/2026-10-21-dri03-lan2/fixture-state.json'), 'utf8'));
const TRIP_A = state.legs[0].tripId; // 09:00 +07 — fulfillment của cont 1 (8000kg)
const TRIP_B = state.legs[1].tripId; // 12:00 +07 — fulfillment của cont 2 (7500kg)
const CONT_A = process.env.CONT_A || 'MSKU7654328';
const CONT_B = process.env.CONT_B || 'CSQU3054383';
const SEAL_A = 'SEAL-KEP-A1';
const SEAL_B = 'SEAL-KEP-B2';

const OUT = path.resolve('qa/2026-10-21-dri03-lan2');
const LOG = path.join(OUT, 'dri03-lan2-ui-driver.log');
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });

let failures = 0;
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

// ── 1. Health + login + API trạng thái gốc ─────────────────────────────────
const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
if (health?.status !== 'ok') { log('ABORT: API health not ok'); process.exit(2); }
const loginRes = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: DRIVER, password: 'Abc123' }),
});
if (!loginRes.ok) { log(`ABORT: login ${DRIVER} ${loginRes.status}`); process.exit(2); }
const { token } = await loginRes.json();
const H = { Authorization: `Bearer ${token}` };

const board0 = await fetch(`${API}/driver/me/journey-board`, { headers: H }).then((r) => r.json());
const cards0 = (board0.items ?? []).filter((c) => c.tripId === TRIP_A || c.tripId === TRIP_B);
log(`API BOARD legs: ${JSON.stringify(cards0.map((c) => ({ t: c.tripId, pair: c.pairKind, pairId: c.pairId, sched: c.scheduledAt, cont: c.containerNumber })))}`);
check('DRIL2-A1 board exposes BOTH kẹp legs under one ACTIVE KEP pair', cards0.length === 2 && cards0.every((c) => c.pairKind === 'KEP' && c.pairId != null && c.pairId === cards0[0].pairId), JSON.stringify(cards0.map((c) => c.pairId)));
check('DRIL2-A1 legs carry SEPARATE planned times (09:00Z-window vs 12:00Z-window)', cards0[0].scheduledAt !== cards0[1].scheduledAt, JSON.stringify(cards0.map((c) => c.scheduledAt)));
check('DRIL2-A1 real QA shape: container numbers NULL before driver entry', cards0.every((c) => !c.containerNumber));

// DB trước khi drive
import postgres from '../../../backend/node_modules/postgres/src/index.js';
const sql = postgres('postgres://postgres:postgres@127.0.0.1:5441/silversea');
const contIds = await sql`SELECT id, trip_id, container_number, seal_number FROM trip_containers WHERE trip_id IN (${TRIP_A}, ${TRIP_B}) ORDER BY id`;
log(`DB trip_containers BEFORE: ${JSON.stringify(contIds)}`);
const contRowA = contIds.find((c) => c.trip_id === TRIP_A);
const contRowB = contIds.find((c) => c.trip_id === TRIP_B);
check('DB mỗi trip 1 cont riêng (khác id)', contRowA && contRowB && contRowA.id !== contRowB.id, JSON.stringify({ a: contRowA?.id, b: contRowB?.id }));

// ── 2. Puppeteer 390px ──────────────────────────────────────────────────────
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.evaluateOnNewDocument((t) => {
  if (location.origin.startsWith('http://localhost')) localStorage.setItem('token', t);
}, token);
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

const contInputSel = 'input[placeholder="Ví dụ: TCKU1234567"]';
const sealInputSel = 'input[placeholder="Ví dụ: AB123456"]';
const clearAndType = async (sel, text) => {
  const input = await page.$(sel);
  if (!input) throw new Error(`input ${sel} not found`);
  await input.click();
  await page.keyboard.down('Meta'); await page.keyboard.press('KeyA'); await page.keyboard.up('Meta');
  for (let i = 0; i < 22; i++) await page.keyboard.press('Backspace');
  await input.type(text, { delay: 25 });
  await sleep(250);
};

// ════ R1: board — 2 card KẸP, giờ chạy riêng từng cont ════
await page.goto(`${FRONT}/my-trips`, { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForSelector('.driver-journey-card', { timeout: 45000 });
await sleep(1200);
const kepGroups = await page.$$eval('.driver-journey-list, .driver-journey', () => null).catch(() => null);
const cards = await page.$$eval('.driver-journey-card', (els) => els.map((el) => ({
  text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
  tag: el.querySelector('.driver-journey-card__tag')?.textContent?.trim(),
  bill: el.querySelector('.driver-journey-card__bill')?.textContent?.trim(),
  time: el.querySelector('.driver-journey-card__time')?.textContent?.replace(/\s+/g, ' ').trim(),
  code: el.querySelector('[data-testid="trip-code"]')?.textContent?.replace(/\s+/g, ' ').trim(),
})));
log(`UI CARDS: ${JSON.stringify(cards)}`);
const kepCards = cards.filter((c) => c.tag === 'KẸP' && c.bill === 'DRIL2-KEP');
check('DRIL2-R1 board: đúng 2 card KẸP của lô (nhóm kẹp)', kepCards.length === 2, `found=${kepCards.length}`);
const cardA = kepCards.find((c) => (c.time || '').includes('09:00'));
const cardB = kepCards.find((c) => (c.time || '').includes('12:00'));
check('DRIL2-R1 card leg A Giờ chạy 09:00 (giờ riêng cont 1)', Boolean(cardA), JSON.stringify(kepCards.map((c) => c.time)));
check('DRIL2-R1 card leg B Giờ chạy 12:00 (giờ riêng cont 2)', Boolean(cardB), JSON.stringify(kepCards.map((c) => c.time)));
check('DRIL2-R1 cả 2 card hiện "Chưa có số cont" (shape thật QA)', kepCards.length === 2 && kepCards.every((c) => c.text.includes('Chưa có số cont')));
await shot(page, 'dri03l2-01-board-kep-390');
log('CAPTURE dri03l2-01-board-kep-390.png');

// ════ R2: leg A detail — giờ riêng + nâng/hạ riêng + cont riêng ════
const factsOf = () => page.$$eval('.driver-task-fact', (els) => els.map((el) => ({
  label: el.querySelector('.driver-task-fact__label')?.textContent?.trim(),
  value: el.querySelector('.driver-task-fact__value')?.textContent?.replace(/\s+/g, ' ').trim(),
})));
const factValue = (facts, label) => facts.find((f) => f.label === label)?.value ?? null;

await page.goto(`${FRONT}/my-trips/${TRIP_A}`, { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForSelector('.dcc-section', { timeout: 45000 });
await sleep(1000);
const factsA = await factsOf();
log(`DETAIL A FACTS: ${JSON.stringify(factsA)}`);
check('DRIL2-R2 leg A: Mã chuyến TRP 2026-10 · 1589 riêng', factValue(factsA, 'Mã chuyến')?.includes('1589'), factValue(factsA, 'Mã chuyến'));
check('DRIL2-R2 leg A: Ngày giờ kế hoạch 09:00 (giờ cont 1)', (factValue(factsA, 'Ngày giờ kế hoạch') || '').includes('09:00'), factValue(factsA, 'Ngày giờ kế hoạch'));
check('DRIL2-R2 leg A: Cảng nâng đúng cont 1', (factValue(factsA, 'Cảng nâng') || '').includes('SITC'), factValue(factsA, 'Cảng nâng'));
check('DRIL2-R2 leg A: Cảng hạ đúng cont 1', (factValue(factsA, 'Cảng hạ') || '').includes('HICT'), factValue(factsA, 'Cảng hạ'));
const bentoA0 = await page.$$eval('[data-testid^="driver-container-item-"]', (els) => els.map((el) => ({
  plate: el.querySelector('.dcc-bento__plate')?.textContent?.trim(),
  type: el.querySelector('.dcc-bento__hero-meta')?.textContent?.replace(/\s+/g, ' ').trim(),
})));
log(`BENTO A BEFORE: ${JSON.stringify(bentoA0)}`);
check('DRIL2-R2 leg A: ĐÚNG 1 cont (20DC · 8.000 kg), chưa có số', bentoA0.length === 1 && (bentoA0[0]?.plate === 'Chưa có số cont') && (bentoA0[0]?.type || '').includes("20'DC") && (bentoA0[0]?.type || '').includes('8.000'), JSON.stringify(bentoA0));
await shot(page, 'dri03l2-02-legA-detail-390');

// ════ R3: nhập số cont A — chỉ cont A đổi ════
await page.click('button[aria-label="Sửa số cont"]');
await page.waitForSelector(contInputSel, { timeout: 15000 });
await clearAndType(contInputSel, CONT_A);
await clearAndType(sealInputSel, SEAL_A);
await page.click('button.dcc-save');
await page.waitForSelector('[data-testid="driver-container-item-0"]', { timeout: 20000 });
await sleep(1200);
const bentoA1 = await page.$$eval('[data-testid^="driver-container-item-"]', (els) => els.map((el) => ({
  plate: el.querySelector('.dcc-bento__plate')?.textContent?.trim(),
  seal: el.querySelector('.dcc-bento__seal-value')?.textContent?.trim(),
})));
log(`BENTO A AFTER SAVE: ${JSON.stringify(bentoA1)}`);
check('DRIL2-R3 cont A lưu số + seal (bento render)', bentoA1[0]?.plate === CONT_A && bentoA1[0]?.seal === SEAL_A, JSON.stringify(bentoA1));
await shot(page, 'dri03l2-03-legA-cont-saved-390');

// ════ R4: leg B detail — giờ 12:00 riêng, cont B riêng, không trộn ════
await page.goto(`${FRONT}/my-trips/${TRIP_B}`, { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForSelector('.dcc-section', { timeout: 45000 });
await sleep(1000);
const factsB = await factsOf();
log(`DETAIL B FACTS: ${JSON.stringify(factsB)}`);
check('DRIL2-R4 leg B: Mã chuyến riêng (1590 ≠ 1589)', (factValue(factsB, 'Mã chuyến') || '').includes('1590') && !(factValue(factsB, 'Mã chuyến') || '').includes('1589'), factValue(factsB, 'Mã chuyến'));
check('DRIL2-R4 leg B: Ngày giờ kế hoạch 12:00 (giờ RIÊNG cont 2)', (factValue(factsB, 'Ngày giờ kế hoạch') || '').includes('12:00'), factValue(factsB, 'Ngày giờ kế hoạch'));
check('DRIL2-R4 leg B: nâng/hạ per cont (SITC/HICT)', (factValue(factsB, 'Cảng nâng') || '').includes('SITC') && (factValue(factsB, 'Cảng hạ') || '').includes('HICT'), `${factValue(factsB, 'Cảng nâng')} / ${factValue(factsB, 'Cảng hạ')}`);
const bentoB0 = await page.$$eval('[data-testid^="driver-container-item-"]', (els) => els.map((el) => ({
  plate: el.querySelector('.dcc-bento__plate')?.textContent?.trim(),
  type: el.querySelector('.dcc-bento__hero-meta')?.textContent?.replace(/\s+/g, ' ').trim(),
})));
log(`BENTO B BEFORE: ${JSON.stringify(bentoB0)}`);
check('DRIL2-R4 leg B: ĐÚNG 1 cont KHÁC (7.500 kg), KHÔNG leak số cont A', bentoB0.length === 1 && bentoB0[0]?.plate === 'Chưa có số cont' && (bentoB0[0]?.type || '').includes('7.500'), JSON.stringify(bentoB0));

await page.click('button[aria-label="Sửa số cont"]');
await page.waitForSelector(contInputSel, { timeout: 15000 });
await clearAndType(contInputSel, CONT_B);
await clearAndType(sealInputSel, SEAL_B);
await page.click('button.dcc-save');
await page.waitForSelector('[data-testid="driver-container-item-0"]', { timeout: 20000 });
await sleep(1200);
const bentoB1 = await page.$$eval('[data-testid^="driver-container-item-"]', (els) => els.map((el) => ({
  plate: el.querySelector('.dcc-bento__plate')?.textContent?.trim(),
  seal: el.querySelector('.dcc-bento__seal-value')?.textContent?.trim(),
})));
check('DRIL2-R4 cont B lưu số + seal riêng (bento render)', bentoB1[0]?.plate === CONT_B && bentoB1[0]?.seal === SEAL_B, JSON.stringify(bentoB1));
await shot(page, 'dri03l2-04-legB-cont-saved-390');

// ════ DB proof: 2 cont riêng biệt, không trộn ════
const contAfter = await sql`SELECT id, trip_id, container_number, seal_number FROM trip_containers WHERE trip_id IN (${TRIP_A}, ${TRIP_B}) ORDER BY id`;
log(`DB trip_containers AFTER: ${JSON.stringify(contAfter)}`);
const dbA = contAfter.find((c) => c.trip_id === TRIP_A);
const dbB = contAfter.find((c) => c.trip_id === TRIP_B);
check('DRIL2-R4 DB: cont A (trip A) = số A, seal A', dbA?.container_number === CONT_A && dbA?.seal_number === SEAL_A, JSON.stringify(dbA));
check('DRIL2-R4 DB: cont B (trip B) = số B, seal B — không trộn', dbB?.container_number === CONT_B && dbB?.seal_number === SEAL_B, JSON.stringify(dbB));

// ════ R5: nhận lệnh leg A — leg B không bị kéo theo ════
await page.goto(`${FRONT}/my-trips/${TRIP_A}`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(1500);
const receiveBtn = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button'));
  const b = btns.find((x) => (x.textContent || '').replace(/\s+/g, ' ').trim().match(/^Nhận lệnh/) && x.offsetParent !== null);
  return b ? (x => null, (b.getAttribute('aria-label') || b.textContent || '').trim()) : null;
});
log(`RECEIVE BUTTON leg A: ${JSON.stringify(receiveBtn)}`);
let received = false;
if (receiveBtn != null) {
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const b = btns.find((x) => (x.textContent || '').replace(/\s+/g, ' ').trim().match(/^Nhận lệnh/) && x.offsetParent !== null);
    if (b instanceof HTMLElement) b.click();
  });
  await sleep(2500);
  await shot(page, 'dri03l2-05-legA-received-390');
  const tripsA = await fetch(`${API}/driver/me/trips/${TRIP_A}`, { headers: H }).then((r) => r.json());
  const tripsB = await fetch(`${API}/driver/me/trips/${TRIP_B}`, { headers: H }).then((r) => r.json());
  log(`STATUS AFTER RECEIVE: A=${tripsA.status} B=${tripsB.status}`);
  check('DRIL2-R5 nhận lệnh leg A: A → IN_TRANSIT, B VẪN CREATED (không trộn)', tripsA.status === 'IN_TRANSIT' && tripsB.status === 'CREATED', `A=${tripsA.status} B=${tripsB.status}`);
  const evA = await sql`SELECT event_type FROM driver_progress_events WHERE trip_id = ${TRIP_A} ORDER BY id`;
  const evB = await sql`SELECT event_type FROM driver_progress_events WHERE trip_id = ${TRIP_B} ORDER BY id`;
  log(`PROGRESS EVENTS: A=${JSON.stringify(evA)} B=${JSON.stringify(evB)}`);
  check('DRIL2-R5 ORDER_RECEIVED chỉ nằm trên trip A; trip B 0 event', evA.some((e) => e.event_type === 'ORDER_RECEIVED') && evB.length === 0, JSON.stringify({ evA, evB }));
  received = true;
} else {
  // Board đã nhận lệnh từ lần chạy trước (idempotent rerun) — xác minh DB.
  const tripsA = await fetch(`${API}/driver/me/trips/${TRIP_A}`, { headers: H }).then((r) => r.json());
  const tripsB = await fetch(`${API}/driver/me/trips/${TRIP_B}`, { headers: H }).then((r) => r.json());
  const evA = await sql`SELECT event_type FROM driver_progress_events WHERE trip_id = ${TRIP_A} ORDER BY id`;
  const evB = await sql`SELECT event_type FROM driver_progress_events WHERE trip_id = ${TRIP_B} ORDER BY id`;
  check('DRIL2-R5 (rerun) A IN_TRANSIT / B CREATED, events chỉ ở A', tripsA.status === 'IN_TRANSIT' && tripsB.status === 'CREATED' && evB.length === 0, `A=${tripsA.status} B=${tripsB.status} evA=${evA.length} evB=${evB.length}`);
  received = true;
}

check('Console errors none', consoleErrors.length === 0, consoleErrors.join('; ').slice(0, 300));
await sql.end();
await browser.close();
log(`DONE failures=${failures}`);
process.exit(failures === 0 ? 0 : 1);
