// Card 182300 — driver "Tiền đường" norm amount is READONLY (chiphispec §1:
// tiền đường hệ thống tự ghi; lái xe chỉ xem). LOCAL drive of THIS worktree:
// frontend :7178 (Vite) → backend :3003 (tsx, this branch) → shared dev DB.
// Evidence: DOM asserts + screenshots; the locked field's value is identity-
// checked against GET /driver/me/fee-norms (the system source of the figure).
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const BASE = 'http://localhost:7178';
const API = `${BASE}/api`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LOG = 'qa/2026-10-18_card182300_ui-driver.log';
fs.mkdirSync('qa', { recursive: true });
fs.writeFileSync(LOG, `card 182300 UI drive ${new Date().toISOString()} — worktree frontend :7178 → backend :3003\n`);
const log = (l) => { console.log(l); fs.appendFileSync(LOG, l + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const health = await (await fetch(`${API}/health`)).json();
log(`HEALTH status=${health.status}`);

const token = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'laixe', password: 'Abc123' }),
}).then((r) => r.json()).then((j) => j.token);
if (!token) throw new Error('login laixe failed');
const auth = { Authorization: `Bearer ${token}` };

// API/data identity (rung-3 path 3 for a read-only UI change): the locked
// field must show exactly the system norm figure the API serves.
const norms = await (await fetch(`${API}/driver/me/fee-norms`, { headers: auth })).json();
const night = norms.items.find((n) => n.code === 'NIGHT_RETURN');
if (!night) throw new Error('NIGHT_RETURN norm missing from /driver/me/fee-norms');
const expectDisplay = new Intl.NumberFormat('vi-VN').format(Number(night.amount));
log(`FEE-NORM NIGHT_RETURN amount=${night.amount} label="${night.label}" → locked field must display ${expectDisplay}`);

const trips = await (await fetch(`${API}/driver/me/trips`, { headers: auth })).json();
const candidates = (trips.items ?? []).filter((t) => t.status !== 'CANCELED');
log(`TRIPS total=${(trips.items ?? []).length} non-canceled=${candidates.length}`);
if (!candidates.length) throw new Error('laixe has no non-canceled trip to drive');

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--hide-scrollbars'],
  defaultViewport: { width: 390, height: 844, isMobile: true, hasTouch: true },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

async function clickButtonByText(text) {
  const handle = await page.evaluateHandle((t) => [...document.querySelectorAll('button')]
    .find((b) => (b.textContent || '').includes(t)), text);
  const el = handle.asElement();
  if (!el) throw new Error(`button "${text}" not found`);
  await el.click();
}

let tripId = null;
for (const t of candidates.slice(0, 8)) {
  await page.goto(`${BASE}/my-trips/${t.id}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1500);
  const has = await page.evaluate(() => [...document.querySelectorAll('button')]
    .some((b) => (b.textContent || '').includes('Thêm chi phí')));
  if (has) { tripId = t.id; break; }
}
if (tripId == null) throw new Error('no trip among first 8 with an enabled "Thêm chi phí" button');
log(`TRIP driving /my-trips/${tripId}`);

await clickButtonByText('Thêm chi phí');
await sleep(800);
// ≤767px (the driver's phone) the group Tabs collapse into a select with
// aria-label "Nhóm chi phí lái xe" (Tabs.tsx asSelect branch) — drive THAT.
const groupTrigger = await page.$('[aria-label="Nhóm chi phí lái xe"]');
if (!groupTrigger) throw new Error('group select "Nhóm chi phí lái xe" not found at 390px');
await groupTrigger.click();
await page.waitForSelector('[role="option"]', { timeout: 5000 });
const roadGroup = await page.evaluateHandle(() => [...document.querySelectorAll('[role="option"]')]
  .find((o) => (o.textContent || '').trim() === 'Tiền đường'));
if (!roadGroup.asElement()) { await page.keyboard.press('Escape'); throw new Error('group option "Tiền đường" not found'); }
await roadGroup.asElement().click();
await sleep(500);

async function chooseOption(page, label) {
  // The Loại chi phí control is a react-aria ComboBox INPUT named by its
  // visible label's htmlFor (no aria-label attribute on the trigger).
  const trigger = await page.evaluateHandle((l) => {
    const lab = [...document.querySelectorAll('label')].find((x) => (x.textContent || '').trim() === l);
    const id = lab?.getAttribute('for');
    return id ? document.getElementById(id) : null;
  }, 'Loại chi phí');
  const el = trigger.asElement();
  if (!el) throw new Error('Loại chi phí trigger not found');
  await el.click();
  await page.waitForSelector('[role="option"]', { timeout: 5000 });
  const opt = await page.evaluateHandle((l) => [...document.querySelectorAll('[role="option"]')]
    .find((o) => (o.textContent || '').trim() === l), label);
  const optEl = opt.asElement();
  if (!optEl) { await page.keyboard.press('Escape'); throw new Error(`option "${label}" not found`); }
  await optEl.click();
  await sleep(400);
}

async function readAmountField(page) {
  return page.evaluate(() => {
    const input = [...document.querySelectorAll('input')].find((i) => {
      const lab = i.id ? document.querySelector(`label[for="${CSS.escape(i.id)}"]`) : null;
      return (lab?.textContent || '').includes('Thực chi');
    });
    if (!input) return { error: 'Thực chi input not found' };
    const row = input.closest('.shipment-cost-entry__draft-row') ?? document.body;
    return {
      value: input.value,
      disabled: input.disabled,
      systemCopy: (row.innerText || '').includes('Hệ thống tự ghi nhận theo định mức'),
      suggestionCopy: (row.innerText || '').includes('Gợi ý'),
    };
  });
}

await chooseOption(page, 'Trả đêm');
const locked = await readAmountField(page);
log(`TD-RO-01 norm-locked ${JSON.stringify(locked)} (expect value=${expectDisplay} disabled=true systemCopy=true suggestionCopy=false)`);
if (locked.value !== expectDisplay || locked.disabled !== true || locked.systemCopy !== true || locked.suggestionCopy !== false) {
  await browser.close();
  throw new Error(`TD-RO-01 FAILED: ${JSON.stringify(locked)}`);
}
await page.screenshot({ path: 'qa/2026-10-18_card182300_ui-01-norm-readonly-390.png', fullPage: true });
log('SHOT qa/2026-10-18_card182300_ui-01-norm-readonly-390.png');

// Scoped lock — an ordinary driver spend stays editable (the tab is not dead).
await chooseOption(page, 'Tiền đường khác');
const editable = await readAmountField(page);
log(`TD-RO-01 sibling-editable ${JSON.stringify(editable)} (expect disabled=false value="" — typed actuals stay writable)`);
if (editable.disabled !== false) {
  await browser.close();
  throw new Error(`sibling option unexpectedly locked: ${JSON.stringify(editable)}`);
}
await page.screenshot({ path: 'qa/2026-10-18_card182300_ui-02-other-road-editable-390.png', fullPage: true });
log('SHOT qa/2026-10-18_card182300_ui-02-other-road-editable-390.png');

// 1440 desktop width on a FRESH page (fine pointer): the group control
// renders as a real tablist here — same locked state through the tab button.
const desk = await browser.newPage();
await desk.setViewport({ width: 1440, height: 900 });
await desk.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
await desk.goto(`${BASE}/my-trips/${tripId}`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(1500);
{
  const handle = await desk.evaluateHandle((t) => [...document.querySelectorAll('button')]
    .find((b) => (b.textContent || '').includes(t)), 'Thêm chi phí');
  if (!handle.asElement()) throw new Error('desktop: Thêm chi phí button not found');
  await handle.asElement().click();
  await sleep(800);
  const tab = await desk.evaluateHandle(() => [...document.querySelectorAll('[role="tab"]')]
    .find((t) => (t.textContent || '').trim() === 'Tiền đường'));
  if (!tab.asElement()) throw new Error('desktop: tab "Tiền đường" not found');
  await tab.asElement().click();
  await sleep(500);
}
await chooseOption(desk, 'Trả đêm');
const lockedWide = await readAmountField(desk);
log(`TD-RO-01 desktop-1440 tablist-form ${JSON.stringify(lockedWide)}`);
if (lockedWide.value !== expectDisplay || lockedWide.disabled !== true) {
  await browser.close();
  throw new Error(`desktop locked state failed: ${JSON.stringify(lockedWide)}`);
}
await desk.screenshot({ path: 'qa/2026-10-18_card182300_ui-03-norm-readonly-1440.png', fullPage: true });
log('SHOT qa/2026-10-18_card182300_ui-03-norm-readonly-1440.png');

await browser.close();
log('ALL PASS — TD-RO-01 UI evidence complete (norm field readonly = system value; sibling editable)');
log('DONE');
process.exit(0);
