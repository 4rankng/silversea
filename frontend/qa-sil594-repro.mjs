// TEMP repro driver — SIL-594 (id 694): stale SỐ TỜ KHAI value after save on
// /dispatch-detail. NOT for commit (scratch verification, deleted after use).
// Usage: QA_BASE=http://localhost:7185 [QA_ENGINE=webkit] node qa-sil594-repro.mjs
import { chromium, webkit } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const BASE = process.env.QA_BASE || 'http://localhost:7175';
const USER = process.env.QA_USER || 'dieuvan';
const PASS = process.env.QA_PASS || 'Abc123';
const ENGINE = process.env.QA_ENGINE === 'webkit' ? webkit : chromium;
const ENGINE_NAME = process.env.QA_ENGINE === 'webkit' ? 'webkit' : 'chromium';

async function launch() {
  try {
    return await ENGINE.launch({ headless: true });
  } catch {
    return await ENGINE.launch({ headless: true, channel: 'chrome' });
  }
}

const browser = await launch();
const page = await browser.newPage();
const netLog = [];

page.on('response', async (res) => {
  const url = res.url();
  if (url.includes('dispatch-detail-plan-rows')) {
    let hit = null;
    try {
      const body = await res.json();
      const items = body.items || [];
      hit = items.length;
    } catch { hit = -1; }
    netLog.push({ t: Date.now(), status: res.status(), rows: hit, url: url.slice(url.indexOf('/api')) });
  }
});

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('input[name="username"]', USER);
await page.fill('input[type="password"]', PASS);
await Promise.all([
  page.waitForURL((u) => !String(u).includes('/login'), { timeout: 20000 }),
  page.click('button[type="submit"]'),
]);

await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle' });
const cellBtn = page.locator('button[aria-label^="Sửa số tờ khai"]').first();
await cellBtn.waitFor({ timeout: 20000 });
const label = await cellBtn.getAttribute('aria-label');
const before = (await cellBtn.textContent())?.trim();

const newValue = 'REPRO594-' + Math.random().toString(36).slice(2, 8);
await cellBtn.click();
const input = page.locator('input[aria-label="Số tờ khai"]');
await input.waitFor({ timeout: 5000 });
await input.fill(newValue);
const t0 = Date.now();
await input.press('Enter');
await page.getByText(/Đã lưu số tờ khai/).first().waitFor({ timeout: 10000 });
const toastAt = Date.now() - t0;

let updatedAt = null;
for (let i = 0; i < 24; i++) {
  await page.waitForTimeout(250);
  const now = (await cellBtn.textContent())?.trim();
  if (now === newValue) { updatedAt = Date.now() - t0; break; }
}
const after = (await cellBtn.textContent())?.trim();
const verdict = updatedAt != null ? `FRESH at +${updatedAt}ms` : 'STALE (cell never showed the saved value within 6s)';

// restore the original value through the same UI cell
if (before && before !== 'Chưa có tờ khai') {
  await cellBtn.click();
  const input2 = page.locator('input[aria-label="Số tờ khai"]');
  await input2.waitFor({ timeout: 5000 });
  await input2.fill(before);
  await input2.press('Enter');
  await page.getByText(/Đã lưu số tờ khai/).first().waitFor({ timeout: 10000 });
}

console.log(`engine=${ENGINE_NAME} cell=${label}`);
console.log(`before=${JSON.stringify(before)} saved=${newValue} after6s=${JSON.stringify(after)}`);
console.log(`toast +${toastAt}ms | VERDICT: ${verdict}`);
console.log('rows-requests:', netLog.map((r) => `${r.t - t0}ms:${r.status}:rows=${r.rows}`).join(' | '));

writeFileSync(new URL(`../qa/2026-10-30_sil594_repro-${ENGINE_NAME}.json`, import.meta.url), JSON.stringify({
  engine: ENGINE_NAME, base: BASE, label, before, saved: newValue, after, toastMs: toastAt, updatedAtMs: updatedAt,
  verdict, netLog,
}, null, 2));

await browser.close();
