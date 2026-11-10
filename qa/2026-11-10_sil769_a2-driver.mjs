// QA driver — SIL-769 A2 only: Phí vệ sinh (non-mandatory) saves WITHOUT a photo.
import puppeteer from 'puppeteer-core';
import crypto from 'node:crypto';
const BASE = 'http://localhost:7185';
const API = 'http://localhost:3004';
const TRIP = 779100;
const log = (...a) => console.log(...a);
const login = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'bqhuong', password: 'Abc123' }) });
const { token, user } = await login.json();
log('STEP login: status', login.status, '| role', user?.role);
// Rung-2 BE probe (SIL-769): a YARD_STORAGE lot row WITHOUT a photo must be
// refused BY THE SERVER with the fee-named message; a FEE_CLEANING row
// without a photo must be ACCEPTED (optional) — the two laws on the wire.
const probe = async (expenseTypeCode) => {
  const res = await fetch(`${API}/api/driver/me/trips/${TRIP}/incidental-costs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ costType: 'OTHER', costGroup: 'DRIVER_SHIPMENT', expenseTypeCode, feeName: 'QA-SIL769 probe', amount: 1000, occurredAt: new Date().toISOString().slice(0, 10) }),
  });
  return { code: expenseTypeCode, status: res.status, body: (await res.text()).slice(0, 160) };
};
log('BE PROBE YARD_STORAGE no photo →', JSON.stringify(await probe('YARD_STORAGE')));
log('BE PROBE FEE_CLEANING no photo →', JSON.stringify(await probe('FEE_CLEANING')));
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 768, height: 1100 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
page.setDefaultTimeout(20000);
let saveResponse = null;
page.on('response', async (r) => {
  if (r.url().includes('incidental-costs')) {
    saveResponse = { status: r.status(), body: await r.text().catch(() => '') };
    log('API POST incidental-costs →', r.status(), saveResponse.body.slice(0, 200));
  }
});
await page.goto(`${BASE}/my-trips/${TRIP}`, { waitUntil: 'networkidle2', timeout: 45000 });
await page.waitForSelector('.shipment-cost-entry', { timeout: 20000 });
log('STEP open /my-trips/' + TRIP);
// Count saved hygiene rows BEFORE
const before = await fetch(`${API}/api/driver/me/fulfillments/2182`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
const beforeCount = (before.incidentalCosts ?? []).filter((c) => /vệ sinh/i.test(c.feeName ?? '')).length;
log('BEFORE: hygiene rows =', beforeCount);
await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Thêm chi phí'))?.click(); });
await page.waitForSelector('[role="combobox"]', { timeout: 15000 });
await page.evaluate(() => { document.querySelector('[role="combobox"]')?.click(); });
await page.waitForFunction(() => [...document.querySelectorAll('[role="option"]')].some((o) => o.textContent?.includes('Phí vệ sinh')), { timeout: 15000 });
await page.evaluate(() => { [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes('Phí vệ sinh'))?.click(); });
await page.waitForFunction(() => document.body.textContent?.includes('Phí vệ sinh (theo danh mục phí)'), { timeout: 10000 });
log('STEP pick Phí vệ sinh');
const marked = await page.evaluate(() => {
  const row = [...document.querySelectorAll('.shipment-cost-entry__draft-row')].at(-1);
  const input = [...(row?.querySelectorAll('input') ?? [])].find((i) => i.type === 'text' && !i.getAttribute('aria-labelledby'));
  if (!input) return false;
  input.dataset.qaAmount = '1';
  return true;
});
if (!marked) throw new Error('amount input not found');
const input = await page.$('input[data-qa-amount="1"]');
await input.click({ clickCount: 3 });
await input.type('50000');
const typed = await page.evaluate(() => document.querySelector('input[data-qa-amount="1"]')?.value);
log('STEP typed amount → display:', typed);
await new Promise((r) => setTimeout(r, 300));
const pre = await page.evaluate(() => {
  const save = [...document.querySelectorAll('button')].find((b) => /^Lưu tất cả/.test(b.textContent?.trim() || ''));
  const msg = document.querySelector('[data-testid="shipment-cost-receipt-required"]');
  return { saveDisabled: save?.disabled, message: msg?.textContent ?? null };
});
log('ASSERT A2 (no photo):', JSON.stringify(pre));
const pass = pre.saveDisabled === false && pre.message === null;
await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => /^Lưu tất cả/.test(b.textContent?.trim() || ''))?.click(); });
// The batch CLOSES on success: the draft table hides and Thêm chi phí returns.
await page.waitForFunction(() => !![...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Thêm chi phí')), { timeout: 20000 }).catch(async () => {
  const alertText = await page.evaluate(() => [...document.querySelectorAll('[role="alert"], .toast')].map((el) => el.textContent?.trim()).filter(Boolean));
  log('SAVE DID NOT CLOSE — alerts:', JSON.stringify(alertText), '| saveResponse:', JSON.stringify(saveResponse));
});
log('STEP batch closed (Thêm chi phí button back) — save persisted');
await new Promise((r) => setTimeout(r, 500));
const after = await fetch(`${API}/api/driver/me/fulfillments/2182`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
const added = (after.incidentalCosts ?? []).filter((c) => /vệ sinh/i.test(c.feeName ?? ''));
log('AFTER: hygiene rows =', added.length, '| new row:', JSON.stringify(added[added.length - 1] ?? null));
await page.screenshot({ path: new URL('.', import.meta.url).pathname + '2026-11-10_sil769_ve-sinh-saved-no-photo.png' });
log('SHOT qa/2026-11-10_sil769_ve-sinh-saved-no-photo.png');
await browser.close();
log('VERDICT SIL-769 A2:', pass && added.length > beforeCount ? 'PASS' : 'FAIL');
process.exit(pass && added.length > beforeCount ? 0 : 2);
