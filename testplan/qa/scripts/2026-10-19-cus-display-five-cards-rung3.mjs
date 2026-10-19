// Cards 191026181942 x5 — CUS display fixes. Read-only rung-3 drive on the
// LOCAL dev stack (:7175 SPA / :3002 API), house pattern from
// w5w4-lib.mjs: puppeteer-core + system Chrome, localStorage token injection
// before SPA navigation. QA lot: BL-QA-DISPLAY-01 (shipment 293204 — LCL,
// expectedDeliveryDate = today, no allocation, customer LONG MINH).
import puppeteer from 'puppeteer-core';
import { mkdirSync, appendFileSync } from 'node:fs';

const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PREFIX = '2026-10-19_cus-display-five-cards';

mkdirSync('qa', { recursive: true });
const LOG = `qa/${PREFIX}_ui-driver.log`;
appendFileSync(LOG, `\n=== run ${new Date().toISOString()} ===\n`);
const log = (line) => {
  const t = `${new Date().toISOString()} ${line}`;
  console.log(t);
  appendFileSync(LOG, `${t}\n`);
};
log.shot = async (page, name) => {
  const path = `qa/${PREFIX}_${name}.png`;
  await page.screenshot({ path });
  log(`shot ${path}`);
  return path;
};
const expect = (cond, msg) => { if (!cond) throw new Error(`ASSERT FAIL: ${msg}`); };

async function login(identifier) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (!res.ok) throw new Error(`login ${identifier}: HTTP ${res.status}`);
  const { token } = await res.json();
  if (!token) throw new Error(`login ${identifier}: no token`);
  return token;
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1920,1200', '--hide-scrollbars'],
  defaultViewport: { width: 1440, height: 1000 },
});
try {
  // ── Cards 1+2+7 (Chi tiết lô — /shipments-detail) as CUS ────────────────
  const cusToken = await login('cus');
  log('login cus OK');
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), cusToken);
  await page.goto(`${BASE}/shipments-detail?searchSuffix=BL-QA-DISPLAY-01`, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForSelector('table tbody tr', { timeout: 30000 });
  await page.waitForFunction(() => document.body.innerText.includes('BL-QA-DISPLAY-01'), { timeout: 30000, polling: 250 });
  await new Promise((r) => setTimeout(r, 800));

  const detail = await page.evaluate(() => {
    const row = [...document.querySelectorAll('table tbody tr')]
      .find((tr) => tr.innerText.includes('BL-QA-DISPLAY-01'));
    if (!row) return { found: false };
    const cell = (label) => row.querySelector(`td[data-label="${label}"]`)?.innerText.replace(/\s+/g, ' ').trim() ?? null;
    const scheduleCell = row.querySelector('td[data-label="Lịch trình"]');
    const vehicleCell = row.querySelector('td[data-label="Phân xe"]');
    const identityName = row.querySelector('th[data-label="Khách hàng & lộ trình"] .name-cell');
    return {
      found: true,
      schedule: cell('Lịch trình'),
      scheduleText: scheduleCell?.innerText.replace(/\s+/g, ' ').trim() ?? null,
      vehicle: cell('Phân xe'),
      customerNameCell: identityName
        ? { text: identityName.textContent.trim(), title: identityName.getAttribute('title'), aria: identityName.getAttribute('aria-label'), cls: identityName.className }
        : null,
      rowText: row.innerText.replace(/\s+/g, ' ').slice(0, 400),
    };
  });
  log(`CARD1/2 lot row found=${detail.found}`);
  expect(detail.found, 'the QA lot row BL-QA-DISPLAY-01 renders on /shipments-detail');
  log(`CARD1 schedule cell="${detail.schedule}"`);
  // R1 TRUTH WINS: the lot's real ngày vận chuyển renders; no placeholder.
  expect(detail.schedule?.includes('19/10/2026'), `schedule cell shows the lot ngày vận chuyển (got: ${detail.schedule})`);
  expect(!detail.schedule?.includes('Chưa có lịch hẹn'), `no "Chưa có lịch hẹn" placeholder over real data (got: ${detail.schedule})`);
  expect(detail.schedule?.includes('Ngày vận chuyển'), `the lot-schedule segment names itself (got: ${detail.schedule})`);
  await log.shot(page, 'ui-01-card1-lot-schedule-truth');
  log(`CARD2 vehicle cell="${detail.vehicle}"`);
  // R2 empty allocation = ONE muted pending label, no BKS composite.
  expect(detail.vehicle?.includes('Chưa phân xe'), `vehicle cell reads "Chưa phân xe" (got: ${detail.vehicle})`);
  expect(!detail.vehicle?.includes('BKS Thực'), `no "BKS Thực" composite on the unallocated lot (got: ${detail.vehicle})`);
  expect(!detail.vehicle?.includes('BKS Báo khách'), `no "BKS Báo khách" line on the unallocated lot (got: ${detail.vehicle})`);
  await log.shot(page, 'ui-02-card2-phanxe-pending-chip');
  // R7 (Chi tiết): the customer name rides NameCell with the full name layer.
  log(`CARD7 chi-tiet customer name cell=${JSON.stringify(detail.customerNameCell)}`);
  expect(detail.customerNameCell?.text === 'LONG MINH', `customer short name renders (got: ${detail.customerNameCell?.text})`);
  expect(!!detail.customerNameCell?.cls.includes('name-cell'), 'customer name rides the shared NameCell');
  expect(detail.customerNameCell?.title === 'LONG MINH' && detail.customerNameCell?.aria === 'LONG MINH', 'NameCell exposes title + aria-label full name');
  await log.shot(page, 'ui-07-card7-chitiet-namecell');

  // ── Cards 5+6+7 (Tổng quan — /shipments) as CUS ─────────────────────────
  // A day with no cargo on the QA lot (its schedule is today) proves the
  // cargoMode-parameterized empty copy; the unfiltered row proves CBM + signal.
  await page.goto(`${BASE}/shipments?searchSuffix=BL-QA-DISPLAY-01`, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForSelector('.cus-dashboard-row', { timeout: 30000 });
  await page.waitForFunction(() => document.body.innerText.includes('BL-QA-DISPLAY-01'), { timeout: 30000, polling: 250 });
  await new Promise((r) => setTimeout(r, 800));

  const overview = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.cus-dashboard-row')]
      .find((tr) => tr.innerText.includes('BL-QA-DISPLAY-01'));
    if (!row) return { found: false };
    const cargo = row.querySelector('td[data-label="Tổng quan hàng hóa"]');
    const signal = row.querySelector('.cus-row-actions__signal');
    const customer = row.querySelector('.cus-customer-name');
    return {
      found: true,
      cargoText: cargo?.innerText.replace(/\s+/g, ' ').trim() ?? null,
      signalText: signal?.textContent.trim() ?? null,
      signalCls: signal?.className ?? null,
      customer: customer ? { text: customer.textContent.trim(), title: customer.getAttribute('title'), aria: customer.getAttribute('aria-label'), cls: customer.className } : null,
    };
  });
  log(`CARD6a overview row found=${overview.found} cargo="${overview.cargoText}"`);
  expect(overview.found, 'the QA lot row renders on Tổng quan');
  // R4a: weight-only metrics — no "— CBM" placeholder beside real weight.
  expect(overview.cargoText?.includes('1.200 kg'), `weight renders (got: ${overview.cargoText})`);
  expect(!overview.cargoText?.includes('— CBM'), `no "— CBM" placeholder when volume is unset (got: ${overview.cargoText})`);
  await log.shot(page, 'ui-06a-card6a-cbm-suppressed');
  // R4b: muted pending signal, no counted false alarm.
  log(`CARD6b signal="${overview.signalText}" cls="${overview.signalCls}"`);
  expect(overview.signalText === 'Chưa phân xe', `signal reads "Chưa phân xe" (got: ${overview.signalText})`);
  expect(overview.signalCls?.includes('cus-attention-label--info'), `signal tone is muted info (got: ${overview.signalCls})`);
  expect(!overview.signalText?.includes('0 cont'), 'no "0 cont" counted false alarm');
  await log.shot(page, 'ui-06b-card6b-muted-signal');
  // R7 (Tổng quan): the customer cell rides NameCell.
  log(`CARD7 tongquan customer=${JSON.stringify(overview.customer)}`);
  expect(overview.customer?.text === 'LONG MINH', `short name renders on Tổng quan (got: ${overview.customer?.text})`);
  expect(overview.customer?.cls.includes('name-cell'), 'customer cell rides NameCell on Tổng quan');
  expect(overview.customer?.aria === 'LONG MINH', 'NameCell aria-label carries the full name on Tổng quan');

  // R3 wording: with a day filter active the server keeps the lot (its
  // expectedDeliveryDate matches) while the cell's day-aggregate is empty —
  // an LCL lot has no container groups, so the copy must name hàng lẻ.
  await page.goto(`${BASE}/shipments?searchSuffix=BL-QA-DISPLAY-01&transportDateFrom=2026-10-19&transportDateTo=2026-10-19`, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForFunction(() => document.body.innerText.includes('BL-QA-DISPLAY-01'), { timeout: 30000, polling: 250 });
  await new Promise((r) => setTimeout(r, 600));
  const wording = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.cus-dashboard-row')]
      .find((tr) => tr.innerText.includes('BL-QA-DISPLAY-01'));
    return { cargo: row?.querySelector('td[data-label="Tổng quan hàng hóa"]')?.innerText.replace(/\s+/g, ' ').trim() ?? null };
  });
  log(`CARD3 filtered-day cargo="${wording.cargo}"`);
  expect(wording.cargo?.includes('Không có hàng lẻ chạy ngày đã chọn'), `LCL lot empty-day copy names hàng lẻ (got: ${wording.cargo})`);
  expect(!wording.cargo?.includes('Không có cont chạy ngày đã chọn'), `no cont copy on an LCL lot (got: ${wording.cargo})`);
  await log.shot(page, 'ui-05-card5-hangle-wording');

  // ── Card 7 (Kế hoạch grid — /dispatch) as ADMIN ─────────────────────────
  const adminToken = await login('admin');
  log('login admin OK');
  const adminPage = await browser.newPage();
  await adminPage.evaluateOnNewDocument((t) => localStorage.setItem('token', t), adminToken);
  await adminPage.goto(`${BASE}/dispatch`, { waitUntil: 'networkidle2', timeout: 60000 });
  await adminPage.waitForSelector('table', { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1500));
  const plan = await adminPage.evaluate(() => {
    const nameCells = [...document.querySelectorAll('.master-plan-grid .name-cell')];
    const first = nameCells[0];
    return {
      nameCellCount: nameCells.length,
      sample: first ? { text: first.textContent.trim().slice(0, 60), title: first.getAttribute('title'), aria: first.getAttribute('aria-label') } : null,
    };
  });
  log(`CARD7 kehoach nameCell count=${plan.nameCellCount} sample=${JSON.stringify(plan.sample)}`);
  expect(plan.nameCellCount > 0, 'the Kế hoạch grid renders customer names through NameCell');
  expect(plan.sample?.title != null && plan.sample?.aria != null, 'NameCell carries title + aria-label on Kế hoạch');
  await log.shot(adminPage, 'ui-07b-card7-kehoach-namecell');

  await browser.close();
  log('CARDS 191026181942 x5 — RUNG3 DRIVE PASS');
  process.exit(0);
} catch (e) {
  log(`FAIL: ${e.message}`);
  try {
    const pages = await browser.pages();
    await log.shot(pages[pages.length - 1], 'FAIL-last-state');
  } catch {}
  await browser.close().catch(() => {});
  process.exit(1);
}
