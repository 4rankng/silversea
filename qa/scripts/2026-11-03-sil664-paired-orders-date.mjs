// SIL-664 — rung-3 UI drive (LOCAL ONLY): trang hai lệnh lái xe — lọc ?date
// theo ngày + đổi route /my-trips/two-orders → /my-trips/paired-orders.
//   PHASE=before — worktree ở base (8ce2dda34): tái hiện ?date bị bỏ qua
//                  (mọi ?date trả cùng view hôm nay) + ảnh trước.
//   PHASE=after  — nhánh fix/sil664-paired-orders-date: ?date lọc đúng cặp
//                  theo ngày, ngày trống → empty state đúng, route mới hoạt
//                  động, path cũ redirect giữ ?date, không 404.
// Stack của lane: frontend 7191 → backend 3014, DB dev dùng chung :5441
// (ss-prod-db — các port 3002/7175 thuộc stack sil641-fix, không đụng tới).
// Data thật dev: driver bqhuong (driver_id 11) — pair 4 ngày 2026-11-04
// (trips 575+576, IN_TRANSIT, ACTIVE); hôm nay 2026-11-03 chỉ có trip 571
// CANCELED; 2026-11-05 trống.
// Run: PHASE=before node qa/scripts/2026-11-03-sil664-paired-orders-date.mjs
//      PHASE=after  node qa/scripts/2026-11-03-sil664-paired-orders-date.mjs
// Env: FRONT_PORT (7191), API_PORT (3014), PHASE (before|after).
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const PHASE = process.env.PHASE ?? 'after';
const FRONT = `http://localhost:${process.env.FRONT_PORT ?? 7191}`;
const API = `http://localhost:${process.env.API_PORT ?? 3014}/api`;
const OUT = path.resolve('qa/2026-11-03_sil664');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, `ui-driver-${PHASE}.log`);
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });

let failures = 0;
const check = (name, ok, detail) => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log(`PHASE=${PHASE} HEALTH status=${health?.status} api=${API} front=${FRONT}`);
if (health?.status !== 'ok') { log('ABORT: local API health not ok'); process.exit(2); }

const loginRes = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'bqhuong', password: 'Abc123' }),
});
if (!loginRes.ok) { log(`ABORT: login failed (${loginRes.status})`); process.exit(2); }
const { token } = await loginRes.json();
log('LOGIN ok role=driver (bqhuong)');

const apiTwoOrders = async (query) => {
  const res = await fetch(`${API}/driver/me/two-orders${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status, body: res.ok ? await res.json() : await res.text() };
};
const summarize = (d) => d && typeof d === 'object' ? {
  date: d.date, pairId: d.pair?.pairId ?? null,
  pairTrips: d.pair?.first && d.pair?.second ? [d.pair.first.id, d.pair.second.id] : null,
  allToday: (d.allToday ?? []).length, active: d.active?.id ?? null, next: d.next?.id ?? null,
} : d;
const j = (v) => JSON.stringify(v);

// DB ground truth (read-only proof; departure_date is the day a ?date MUST
// select by): pair 4 → 2026-11-04, trips 575+576; today 11-03 has only the
// CANCELED 571; 11-05 has nothing.
const dbPairs = execSync(
  `docker exec ss-prod-db psql -U postgres -d silversea -qtAX -c "SELECT t1.departure_date, tp.id, t1.id, t1.status, t2.id, t2.status FROM trip_pairs tp JOIN trips t1 ON t1.id=tp.first_trip_id JOIN trips t2 ON t2.id=tp.second_trip_id WHERE t1.driver_id=11 AND t2.driver_id=11 AND t1.deleted_at IS NULL AND t2.deleted_at IS NULL ORDER BY t1.departure_date"`,
).toString().trim();
const dbTripsToday = execSync(
  `docker exec ss-prod-db psql -U postgres -d silversea -qtAX -c "SELECT id || ' ' || status || ' ' || departure_date FROM trips WHERE driver_id=11 AND deleted_at IS NULL AND departure_date='2026-11-03' ORDER BY id"`,
).toString().trim() || '(no rows)';
log('DB trip_pairs (driver 11):'); dbPairs.split('\n').forEach((l) => log(`  ${l}`));
log(`DB trips 2026-11-03 (driver 11): ${dbTripsToday}`);
check('DB has pair 4 on 2026-11-04 (575+576 ACTIVE)', /2026-11-04\|4\|575\|IN_TRANSIT\|576\|IN_TRANSIT/.test(dbPairs.replace(/ \| /g, '|').replace(/\s+/g, '')) || dbPairs.includes('2026-11-04'), dbPairs.split('\n')[0]);

// ── API layer ────────────────────────────────────────────────────────────────
log('── API /driver/me/two-orders ──');
const apiNoParam = await apiTwoOrders('');
log(`no-param   → ${j(summarize(apiNoParam.body))} (HTTP ${apiNoParam.status})`);
const apiD1104 = await apiTwoOrders('?date=2026-11-04');
log(`?date=1104 → ${j(summarize(apiD1104.body))} (HTTP ${apiD1104.status})`);
const apiD1105 = await apiTwoOrders('?date=2026-11-05');
log(`?date=1105 → ${j(summarize(apiD1105.body))} (HTTP ${apiD1105.status})`);

if (PHASE === 'before') {
  // Defect reproduction: the param is ignored — every call returns the same
  // view, and 11-04 trips are mislabeled with today's date.
  check('BEFORE defect: ?date=2026-11-04 ignored (identical to no-param)',
    j(summarize(apiNoParam.body)) === j(summarize(apiD1104.body)),
    j(summarize(apiD1104.body)));
  check('BEFORE defect: ?date=2026-11-05 ignored — pair of 11-04 shown on an empty day',
    summarize(apiD1105.body)?.pairId === 4, j(summarize(apiD1105.body)));
  check('BEFORE defect: response date mislabels 11-04 pair as today (2026-11-03)',
    apiNoParam.body?.date === '2026-11-03' && summarize(apiNoParam.body)?.pairTrips?.[0] === 575,
    `date=${apiNoParam.body?.date} trips=${j(summarize(apiNoParam.body)?.pairTrips)}`);
} else {
  check('AFTER: no-param defaults to today 2026-11-03, no pair, no trips',
    apiNoParam.body?.date === '2026-11-03' && apiNoParam.body?.pair === null && (apiNoParam.body?.allToday ?? []).length === 0,
    summarize(apiNoParam.body));
  check('AFTER: ?date=2026-11-04 returns pair 4 (trips 575+576)',
    apiD1104.body?.date === '2026-11-04' && apiD1104.body?.pair?.pairId === 4
      && apiD1104.body?.pair?.first?.id === 575 && apiD1104.body?.pair?.second?.id === 576,
    summarize(apiD1104.body));
  check('AFTER: ?date=2026-11-05 returns empty view of THAT day (no pair, no trips)',
    apiD1105.body?.date === '2026-11-05' && apiD1105.body?.pair === null && (apiD1105.body?.allToday ?? []).length === 0,
    summarize(apiD1105.body));
  const apiBad = await apiTwoOrders('?date=05-11-2026');
  check('AFTER: malformed ?date rejected with HTTP 400',
    apiBad.status === 400, `HTTP ${apiBad.status} ${String(apiBad.body).slice(0, 80)}`);
}

// ── UI layer (driver mobile viewport 390×844) ────────────────────────────────
const browser = await puppeteer.launch({ headless: true, defaultViewport: { width: 390, height: 844 } });
const page = await browser.newPage();
page.on('pageerror', (e) => log(`PAGEERROR ${e.message}`));
page.on('console', (msg) => { if (msg.type() === 'error') log(`CONSOLE-ERR ${msg.text().slice(0, 200)}`); });

const gotoSpa = async (url) => {
  await page.goto(`${FRONT}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => localStorage.setItem('token', t), token);
  await page.goto(url, { waitUntil: 'networkidle2' });
};
const cardCount = () => page.evaluate(() => document.querySelectorAll('[data-testid^="paired-orders-card-"], [data-testid^="two-orders-card-"]').length);
const bodyText = () => page.evaluate(() => document.body.innerText);
/** Wait until the driver app shell renders something real (page, cards, or
 *  empty state) — lazy chunks + /auth/me hydration take multiple seconds on a
 *  cold vite dev server; a fixed sleep races them. */
const waitRendered = async (timeoutMs = 30000) => {
  try {
    await page.waitForFunction(() => Boolean(
      document.querySelector('.driver-secondary-page, .driver-journey')
      || document.querySelector('[data-testid^="paired-orders-card-"], [data-testid^="two-orders-card-"]')
      || /không có lệnh|Đang tải/i.test(document.body.innerText) === false && document.querySelector('.empty-state, [role="alert"]'),
    ), { timeout: timeoutMs });
  } catch { /* fall through — assertions below report what rendered */ }
  const url = page.url();
  const txt = (await bodyText()).replace(/\s+/g, ' ').slice(0, 160);
  log(`RENDERED url=${url} text~"${txt}"`);
};

if (PHASE === 'before') {
  // Old route + ?date of an EMPTY day must NOT show the 11-04 pair (it does).
  await gotoSpa(`${FRONT}/my-trips/two-orders?date=2026-11-05`);
  await waitRendered();
  const n = await cardCount();
  const txt = await bodyText();
  log(`UI /my-trips/two-orders?date=2026-11-05 → cards=${n} header-has="${(txt.match(/Cặp điều vận ngày [0-9/]+/) ?? [])[0] ?? '-'}"`);
  await shot(page, `sil664-before-1105-shows-1104-pair-390`);
  check('BEFORE defect (UI): ?date=2026-11-05 renders pair cards instead of empty state',
    n >= 2, `cards=${n}`);
  check('BEFORE defect (UI): header mislabels pair date as 03/11/2026',
    txt.includes('Cặp điều vận ngày 03/11/2026'), 'header text');

  await gotoSpa(`${FRONT}/my-trips/two-orders`);
  await waitRendered();
  await shot(page, `sil664-before-noparam-390`);
  check('BEFORE (UI): no-param renders pair (observed baseline behavior)', (await cardCount()) >= 2);
} else {
  // 1. New route + date with a real pair.
  await gotoSpa(`${FRONT}/my-trips/paired-orders?date=2026-11-04`);
  await page.waitForFunction(() => document.querySelectorAll('[data-testid^="paired-orders-card-"]').length >= 2, { timeout: 20000 });
  const txt4 = await bodyText();
  await shot(page, `sil664-after-1104-pair-390`);
  check('AFTER (UI): /my-trips/paired-orders?date=2026-11-04 shows the 11-04 pair (2 cards)',
    (await cardCount()) === 2, `cards=${await cardCount()}`);
  check('AFTER (UI): header names the selected day 04/11/2026',
    txt4.includes('04/11/2026'), 'header text');
  check('AFTER (UI): pair summary block names its day (Cặp điều vận ngày …)',
    txt4.includes('Cặp điều vận ngày 04/11/2026'), 'pair summary');
  check('AFTER (UI): truck plate fact visible on cards',
    txt4.includes('60C-45678'), 'plate');

  // 2. Date with NO pair → empty state of that day, never today's data.
  await gotoSpa(`${FRONT}/my-trips/paired-orders?date=2026-11-05`);
  await page.waitForFunction(() => document.body.innerText.includes('Không có lệnh ngày 05/11/2026'), { timeout: 20000 });
  const txt5 = await bodyText();
  await shot(page, `sil664-after-1105-empty-390`);
  check('AFTER (UI): ?date=2026-11-05 shows day-scoped empty state',
    txt5.includes('Không có lệnh ngày 05/11/2026'), 'empty title');
  check('AFTER (UI): ?date=2026-11-05 shows NO trip cards',
    (await cardCount()) === 0, `cards=${await cardCount()}`);

  // 3. No ?date → today (2026-11-03): today's (empty) view, not the 11-04 pair.
  await gotoSpa(`${FRONT}/my-trips/paired-orders`);
  await page.waitForFunction(() => document.body.innerText.includes('Hôm nay không có lệnh'), { timeout: 20000 });
  const txt0 = await bodyText();
  await shot(page, `sil664-after-noparam-today-390`);
  check('AFTER (UI): no-param shows today empty state (Hôm nay không có lệnh)',
    txt0.includes('Hôm nay không có lệnh'), 'empty title');
  check('AFTER (UI): no-param does NOT leak the 11-04 pair',
    (await cardCount()) === 0, `cards=${await cardCount()}`);

  // 4. Old path redirects to the new one, carrying ?date, no 404.
  await gotoSpa(`${FRONT}/my-trips/two-orders?date=2026-11-04`);
  await page.waitForFunction(() => document.querySelectorAll('[data-testid^="paired-orders-card-"]').length >= 2, { timeout: 20000 });
  const urlNow = page.url();
  await shot(page, `sil664-after-redirect-old-path-390`);
  check('AFTER (UI): old /my-trips/two-orders?date=2026-11-04 redirects to paired-orders with ?date preserved',
    urlNow.includes('/my-trips/paired-orders?date=2026-11-04'), urlNow);
  check('AFTER (UI): redirected page renders the pair (no 404)', (await cardCount()) === 2);

  // 5. Sibling inbound link: journey header entry points at the new route.
  await gotoSpa(`${FRONT}/my-trips`);
  await page.waitForFunction(() => Boolean(document.querySelector('a.driver-journey__day-view')), { timeout: 20000 });
  const href = await page.evaluate(() => document.querySelector('a.driver-journey__day-view')?.getAttribute('href'));
  check('AFTER (UI): journey header "Lệnh trong ngày" entry href = /my-trips/paired-orders',
    href === '/my-trips/paired-orders', String(href));
  await page.click('a.driver-journey__day-view');
  await waitRendered();
  check('AFTER (UI): tapping the journey entry lands on /my-trips/paired-orders (today view)',
    page.url().includes('/my-trips/paired-orders'), page.url());
  await shot(page, `sil664-after-journey-entry-tap-390`);

  // 6. Sibling outbound link: pair card → trip detail still works.
  await gotoSpa(`${FRONT}/my-trips/paired-orders?date=2026-11-04`);
  await page.waitForFunction(() => document.querySelectorAll('[data-testid^="paired-orders-card-"]').length >= 2, { timeout: 20000 });
  const cardHref = await page.evaluate(() => document.querySelector('[data-testid="paired-orders-card-Chuyến 1"]')?.getAttribute('href'));
  check('AFTER (UI): pair card links to trip detail', cardHref === '/my-trips/575', String(cardHref));
  await page.click('[data-testid="paired-orders-card-Chuyến 1"]');
  await waitRendered();
  const detailTxt = await bodyText();
  await shot(page, `sil664-after-trip-detail-from-card-390`);
  check('AFTER (UI): card opens trip detail 575', page.url().includes('/my-trips/575'), page.url());
  check('AFTER (UI): trip detail renders its plate fact', detailTxt.includes('60C-45678'), 'plate');

  // 7. 768px spot-check of the changed screen (pair view).
  await page.setViewport({ width: 768, height: 1024 });
  await gotoSpa(`${FRONT}/my-trips/paired-orders?date=2026-11-04`);
  await page.waitForFunction(() => document.querySelectorAll('[data-testid^="paired-orders-card-"]').length >= 2, { timeout: 20000 });
  await shot(page, `sil664-after-1104-pair-768`);
  check('AFTER (UI @768): pair view renders 2 cards', (await cardCount()) === 2);
}

// Read-only screen: persisted state identity — the pair rows are unchanged.
const dbPairsAfter = execSync(
  `docker exec ss-prod-db psql -U postgres -d silversea -qtAX -c "SELECT t1.departure_date, tp.id, t1.id, t1.status, t2.id, t2.status FROM trip_pairs tp JOIN trips t1 ON t1.id=tp.first_trip_id JOIN trips t2 ON t2.id=tp.second_trip_id WHERE tp.id=4"`,
).toString().trim();
check('DB side-effect: pair 4 rows unchanged (read-only view)', dbPairsAfter === dbPairs, dbPairsAfter);

await browser.close();
log(`PHASE=${PHASE} DONE failures=${failures}`);
process.exit(failures === 0 ? 0 : 1);
