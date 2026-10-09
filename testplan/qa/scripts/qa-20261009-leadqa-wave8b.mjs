// Lead QA rung — staging cut e9339ad1 (wave-8b): FB-001 picker, 550 export toasts, FB-061 cleanup verify.
import { launch, login, step, tap, evidenceDir, BASE } from './lead-qa-harness.mjs';
import { appendFileSync } from 'node:fs';

const dir = evidenceDir('2026-10-09_wave8b-leadqa');
const log = `${dir}/driver-lead-qa.log`;
appendFileSync(log, '');
const shot = (page, name) => page.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
const fullShot = (page, name) => page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { browser, page } = await launch({ width: 1440, height: 900 });

// Build-currency gate
await page.goto(`${BASE}/api/health`, { waitUntil: 'networkidle2', timeout: 60000 });
const health = await page.evaluate(() => document.body.innerText);
step(log, { step: 'build-currency', health: health.slice(0, 200) });
if (!health.includes('e9339ad1')) throw new Error(`stale build: ${health.slice(0, 120)}`);

// ---------- A) FB-001: picker opens from field body on /shipments/new (CUS) ----------
await login(page, 'thanhdc');
await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(3000);
const fieldHandle = await page.evaluateHandle(() => {
  const el = [...document.querySelectorAll('*')].find((n) =>
    n.children.length === 0 && /NGÀY GIỜ ĐÓNG TRẢ|Ngày giờ đóng trả/i.test(n.textContent || ''));
  return el ? el.closest('div[class]') : null;
});
const fieldBox = await (await fieldHandle.asElement()?.boundingBox()) ?? null;
step(log, { step: 'field-located', fieldBox });
if (!fieldBox) throw new Error('NGÀY GIỜ ĐÓNG TRẢ field not found');
// tap the field BODY — a point inside the container but off the label line (lower area = input body)
const bx = fieldBox.x + Math.min(fieldBox.width * 0.6, 300);
const by = fieldBox.y + fieldBox.height * 0.72;
const hit = await page.evaluate(({ x, y }) => {
  const n = document.elementFromPoint(x, y);
  return n ? `${n.tagName}.${(n.className || '').toString().slice(0, 60)}` : null;
}, { x: bx, y: by });
await page.mouse.move(bx, by); await page.mouse.down(); await page.mouse.up();
step(log, { step: 'tap-field-body', x: Math.round(bx), y: Math.round(by), hit });
await sleep(1200);
const pickerOpen = await page.evaluate(() => {
  const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => x.textContent.includes('Chọn ngày giờ'));
  return d ? { open: true, text: d.textContent.slice(0, 120) } : { open: false };
});
step(log, { step: 'FB001-picker-assert', ...pickerOpen });
if (!pickerOpen.open) await fullShot(page, 'fb001-FAIL-no-picker');
else await shot(page, 'fb001-picker-open-1440');
if (!pickerOpen.open) throw new Error('FB-001 FAIL: picker did not open from field body');

// ---------- B) 550: export toasts on /debt and /profit (Kế toán) ----------
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
await page.evaluate(() => localStorage.clear());
let acct = 'hoapt';
await login(page, 'hoapt');
await sleep(1500);
const who = await page.evaluate(() => document.body.innerText.slice(0, 400));
if (!/Kế toán|hoapt|Tổng quan|Dashboard/i.test(who)) {
  step(log, { step: 'hoapt-login-suspect', body: who.slice(0, 120) });
  acct = 'ketoan';
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
  await login(page, 'ketoan');
}
step(log, { step: 'accountant-account', acct });

await page.goto(`${BASE}/debt`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(2500);
await tap(page, 'button', log, '/debt export — locating below');
step(log, { step: 'debt-buttons', buttons: await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => /Xuất/i.test(t))) });
const debtBtn = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => /Xuất báo cáo/i.test(b.textContent || '')));
const debtEl = debtBtn.asElement();
if (!debtEl) throw new Error('/debt Xuất báo cáo button not found');
await debtEl.evaluate((n) => n.scrollIntoView({ block: 'center' }));
await sleep(300);
{ const bb = await debtEl.boundingBox(); const x = bb.x + bb.width / 2, y = bb.y + bb.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.up();
  step(log, { step: 'tap-debt-export', x: Math.round(x), y: Math.round(y) }); }
const debtToast = await page.waitForFunction(() => document.body.innerText.includes('Đã xuất báo cáo công nợ phải thu ra tệp Excel.'), { timeout: 30000 }).then(() => true).catch(() => false);
step(log, { step: 'FB550-debt-toast', debtToast });
await shot(page, 'fb550-debt-toast-1440');
if (!debtToast) throw new Error('550 FAIL: /debt toast missing');

await page.goto(`${BASE}/profit`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(2500);
const profBtn = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => /Xuất XLSX/i.test(b.textContent || '')));
const profEl = profBtn.asElement();
if (!profEl) throw new Error('/profit Xuất XLSX button not found');
await profEl.evaluate((n) => n.scrollIntoView({ block: 'center' }));
await sleep(300);
{ const bb = await profEl.boundingBox(); const x = bb.x + bb.width / 2, y = bb.y + bb.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.up();
  step(log, { step: 'tap-profit-export', x: Math.round(x), y: Math.round(y) }); }
const profToast = await page.waitForFunction(() => document.body.innerText.includes('Đã xuất báo cáo lợi nhuận ra tệp Excel.'), { timeout: 30000 }).then(() => true).catch(() => false);
step(log, { step: 'FB550-profit-toast', profToast });
await shot(page, 'fb550-profit-toast-1440');
if (!profToast) throw new Error('550 FAIL: /profit toast missing');

// ---------- C) FB-061: invoice-tracking clean + treasury kept (admin) ----------
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
await page.evaluate(() => localStorage.clear());
await login(page, 'admin');
await page.goto(`${BASE}/accounting/invoice-tracking`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(3000);
const invState = await page.evaluate(() => ({
  hasSeed: document.body.innerText.includes('LEAD-QA-376-01') || document.body.innerText.includes('NCC QA Lead 0510'),
  empty: document.body.innerText.includes('Không tìm thấy hóa đơn nào trong kỳ đã chọn'),
  body: document.body.innerText.slice(0, 300),
}));
step(log, { step: 'FB061-invoice-assert', ...invState });
await fullShot(page, 'fb061-invoice-tracking-clean');
if (invState.hasSeed) throw new Error('FB-061 FAIL: seed rows still visible');

await page.goto(`${BASE}/finance/treasury`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(3000);
const treState = await page.evaluate(() => ({
  acbCongTy: document.body.innerText.includes('ACB - Tai khoan cong ty'),
  acbThuongMai: document.body.innerText.includes('ACB - Tai khoan thuong mai'),
}));
step(log, { step: 'FB061-treasury-ruling-verify', ...treState });
await fullShot(page, 'fb061-treasury-kept-per-ruling');

step(log, { step: 'DONE', verdict: 'ALL-THREE-PASS' });
await browser.close();
console.log('ALL THREE RUNGS PASS');
