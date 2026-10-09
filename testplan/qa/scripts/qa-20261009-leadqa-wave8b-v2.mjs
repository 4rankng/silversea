// Lead QA rung v2 — staging cut e9339ad1: FB-001 (correct root target), 550 toasts, FB-061 verify.
import { launch, login, step, tap, evidenceDir, BASE } from './lead-qa-harness.mjs';
const dir = evidenceDir('2026-10-09_wave8b-leadqa');
const log = `${dir}/driver-lead-qa-v2.log`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name, full = false) => page.screenshot({ path: `${dir}/${name}.png`, fullPage: full });

const { browser, page } = await launch({ width: 1440, height: 900 });
await page.goto(`${BASE}/api/health`, { waitUntil: 'networkidle2', timeout: 60000 });
const health = await page.evaluate(() => document.body.innerText);
if (!health.includes('e9339ad1')) throw new Error(`stale build: ${health.slice(0, 120)}`);
step(log, { step: 'build-currency', buildHash: 'e9339ad1' });

// ---------- A) FB-001 ----------
await login(page, 'thanhdc');
await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(3000);
const root = await page.$('[data-split-datetime]');
if (!root) throw new Error('appointment [data-split-datetime] not found');
await root.evaluate((n) => n.scrollIntoView({ block: 'center' }));
await sleep(300);
const rb = await root.boundingBox();
// real tap on the root's dead space (right edge inside, mid row) — probe P1 zone
const x = rb.x + rb.width - 12, y = rb.y + rb.height * 0.7;
await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.up();
step(log, { step: 'tap-root-body', x: Math.round(x), y: Math.round(y) });
await sleep(1000);
const picker = await page.evaluate(() => {
  const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => x.textContent.includes('Chọn ngày giờ'));
  return d ? { open: true, hasDate: !!d.querySelector('.combined-datetime__date'), hasTime: !!d.querySelector('.combined-datetime__time') } : { open: false };
});
step(log, { step: 'FB001-assert', ...picker });
await shot(page, 'fb001-picker-open-1440');
if (!picker.open) throw new Error('FB-001 FAIL');
await page.keyboard.press('Escape'); await sleep(500);
// law check: segment tap opens nothing
const seg = await page.$('input[data-seg="hh"]');
{ const b = await seg.boundingBox(); await page.mouse.move(b.x + 6, b.y + b.height / 2); await page.mouse.down(); await page.mouse.up(); }
await sleep(700);
const caretOnly = await page.evaluate(() => ![...document.querySelectorAll('[role="dialog"]')].some((d) => d.textContent.includes('Chọn ngày giờ')));
step(log, { step: 'FB001-segment-caret-law', caretOnly });

// ---------- B) 550 ----------
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
await page.evaluate(() => localStorage.clear());
await login(page, 'hoapt');
await sleep(1500);
const who = await page.evaluate(() => document.body.innerText.slice(0, 300));
step(log, { step: 'account', who: who.slice(0, 80) });

await page.goto(`${BASE}/debt`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(2500);
const debtBtn = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => /Xuất báo cáo/i.test(b.textContent || '')));
const debtEl = debtBtn.asElement();
if (!debtEl) throw new Error('/debt button missing');
await debtEl.evaluate((n) => n.scrollIntoView({ block: 'center' }));
await sleep(300);
{ const bb = await debtEl.boundingBox(); await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.mouse.down(); await page.mouse.up(); }
step(log, { step: 'tap-debt-export' });
const debtToast = await page.waitForFunction(() => document.body.innerText.includes('Đã xuất báo cáo công nợ phải thu ra tệp Excel.'), { timeout: 30000 }).then(() => true).catch(() => false);
step(log, { step: 'FB550-debt-toast', debtToast });
await shot(page, 'fb550-debt-toast-1440');
if (!debtToast) throw new Error('550 FAIL /debt');

await page.goto(`${BASE}/profit`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(2500);
const profBtn = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => /Xuất XLSX/i.test(b.textContent || '')));
const profEl = profBtn.asElement();
if (!profEl) throw new Error('/profit button missing');
await profEl.evaluate((n) => n.scrollIntoView({ block: 'center' }));
await sleep(300);
{ const bb = await profEl.boundingBox(); await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.mouse.down(); await page.mouse.up(); }
step(log, { step: 'tap-profit-export' });
const profToast = await page.waitForFunction(() => document.body.innerText.includes('Đã xuất báo cáo lợi nhuận ra tệp Excel.'), { timeout: 30000 }).then(() => true).catch(() => false);
step(log, { step: 'FB550-profit-toast', profToast });
await shot(page, 'fb550-profit-toast-1440');
if (!profToast) throw new Error('550 FAIL /profit');

// ---------- C) FB-061 ----------
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
await page.evaluate(() => localStorage.clear());
await login(page, 'admin');
await page.goto(`${BASE}/accounting/invoice-tracking`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(3000);
const inv = await page.evaluate(() => ({
  hasSeed: document.body.innerText.includes('LEAD-QA-376-01') || document.body.innerText.includes('NCC QA Lead 0510'),
  empty: document.body.innerText.includes('Không tìm thấy hóa đơn nào trong kỳ đã chọn'),
}));
step(log, { step: 'FB061-invoice-assert', ...inv });
await shot(page, 'fb061-invoice-tracking-clean', true);
if (inv.hasSeed || !inv.empty) throw new Error('FB-061 FAIL invoice-tracking');
await page.goto(`${BASE}/finance/treasury`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(3000);
const tre = await page.evaluate(() => ({
  acb1: document.body.innerText.includes('ACB - Tai khoan cong ty'),
  acb2: document.body.innerText.includes('ACB - Tai khoan thuong mai'),
}));
step(log, { step: 'FB061-treasury-kept', ...tre });
await shot(page, 'fb061-treasury-kept-per-ruling', true);

step(log, { step: 'DONE', verdict: 'ALL-THREE-PASS' });
await browser.close();
console.log('ALL THREE RUNGS PASS');
