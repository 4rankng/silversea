// QA driver — card 221026123031: UuiSelectField listbox click-được trong modal.
// Parameterized red/green repro: BASE (target origin), OUT (artifact dir), TAG.
// Usage: BASE=http://localhost:7176 OUT=../../2026-10-22-uui-select-modal TAG=green node qa-uui-modal-driver.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:7176';
const OUT = process.env.OUT || '../../2026-10-22-uui-select-modal';
const TAG = process.env.TAG || 'run';
mkdirSync(OUT, { recursive: true });

const TEMPLATE = `Mẫu repro QA ${TAG}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const netLog = [];
page.on('response', (r) => {
  try {
    const u = typeof r.url === 'function' ? r.url() : String(r.url);
    if (u.includes('/api/quotations') || u.includes('/api/auth')) netLog.push(`${r.status()} ${r.request().method()} ${u.slice(0, 100)}`);
  } catch {}
});

function fail(step, err) {
  console.log(`FAIL [${step}] ${err?.message ?? err}`);
}
try {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('input[name="username"]', 'admin');
  await page.fill('input[name="password"]', 'Abc123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);
  await page.goto(`${BASE}/config/quotations`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/ui-${TAG}-1-list.png` });

  let opened = false;
  for (const b of await page.$$('button')) {
    const t = (await b.textContent()) || '';
    if (/Tạo|Thêm|báo giá mới/i.test(t)) { await b.click(); opened = true; break; }
  }
  if (!opened) throw new Error('create button not found');
  const dlg = page.locator('[role="dialog"]').first();
  await dlg.waitFor({ timeout: 8000 });

  // Step 4 — select KH from the combobox popover. Scope to the portalled
  // popover: the page's own quotation-frames listbox ALSO renders
  // [role=option] rows (ul[role=listbox], card 20261002_288) and precedes the
  // body portal in DOM order — a page-wide [role=option] query hits those
  // first and clicks a page row under the open modal scrim. That page-wide
  // selector is what produced the false "modal intercepts listbox" blocker.
  const combo = dlg.locator('[role="combobox"]').first();
  await combo.click({ timeout: 5000 });
  await page.waitForTimeout(700);
  const opts = page.locator('.ds-uui-select__popover [role="option"]');
  const n = await opts.count();
  console.log(`OPTIONS_COUNT ${n}`);
  await page.screenshot({ path: `${OUT}/ui-${TAG}-2-dropdown-open.png`, fullPage: false });
  if (n < 2) throw new Error(`expected >1 options, got ${n}`);
  const chosen = await opts.nth(1).textContent({ timeout: 4000 }).catch(() => '?');
  await opts.nth(1).click({ timeout: 5000 });
  await page.waitForTimeout(400);
  const comboValue = await combo.inputValue().catch(() => '');
  console.log(`KH_CLICKED option="${(chosen || '').trim()}" inputValue="${comboValue.trim()}"`);
  if (!comboValue.trim()) throw new Error('KH not committed — combobox input empty after click');
  await page.screenshot({ path: `${OUT}/ui-${TAG}-3-kh-selected.png` });

  // Fill the rest of the required fields. The date field is segmented
  // (DD/MM/YYYY separate inputs): click the first segment and type digits —
  // a wholesale fill() dumps "22/10/2026" into the 2-char DD segment and the
  // component rejects the separators.
  for (const i of await page.$$('[role="dialog"] input')) {
    const el = i;
    const label = (await el.evaluate((node) => {
      const lbl = node.closest('label') || document.querySelector(`label[for="${node.id}"]`);
      return (lbl?.textContent || node.getAttribute('aria-label') || node.placeholder || '');
    })) + '';
    if (/Tên mẫu/i.test(label)) await el.fill(TEMPLATE);
    if (/Độ trễ/i.test(label)) await el.fill('1');
  }
  const dateSeg = page.locator('[role="dialog"] label:has-text("Ngày hiệu lực") + * [data-date-input], [role="dialog"] [data-date-input]').first();
  await dateSeg.click();
  await page.keyboard.type('22102026', { delay: 30 });
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);

  const submit = dlg.locator('button[type="submit"]');
  await submit.click({ timeout: 5000 });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${OUT}/ui-${TAG}-4-after-submit.png` });

  const alerts = await page.$$eval('[role="alert"], .alert', (els) => els.map((e) => (e.textContent || '').trim().slice(0, 160)));
  const dlgStill = await page.$('[role="dialog"]');
  const body = await page.evaluate(() => document.body.innerText.slice(0, 1500));
  const postCreated = netLog.some((l) => /POST/.test(l) && l.includes('/api/quotations') && !l.includes('preview'));
  console.log(`POST_QUOTATIONS_SEEN ${postCreated}`);
  console.log(`DIALOG_STILL_OPEN ${Boolean(dlgStill)}`);
  console.log(`LIST_CONTAINS_TEMPLATE ${body.includes(TEMPLATE)}`);
  console.log(`ALERTS ${JSON.stringify(alerts)}`);
  console.log(`NETWORK ${JSON.stringify(netLog, null, 1)}`);
  if (!postCreated) throw new Error('POST /api/quotations not observed');
  if (dlgStill) throw new Error('dialog still open after submit');
  if (!body.includes(TEMPLATE)) throw new Error('list does not contain the new template');
  console.log('RESULT PASS');
} catch (e) {
  fail('driver', e);
  await page.screenshot({ path: `${OUT}/ui-${TAG}-err.png` }).catch(() => {});
  console.log('RESULT FAIL');
  process.exitCode = 1;
}
await browser.close();
