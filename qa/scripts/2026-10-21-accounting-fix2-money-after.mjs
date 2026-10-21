// Item 2 after-evidence: grouped money inputs render "1.000.000" while typing.
// LOCAL dev only — FE :7185 / BE :3012.
//   node qa/scripts/2026-10-21-accounting-fix2-money-after.mjs
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const FE = 'http://localhost:7185';
const API = 'http://localhost:3012/api';
const OUT = path.resolve('qa/2026-10-21-accounting-fix2');
const log = (m) => console.log(m);

const res = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'giaonhan', password: 'Abc123' }),
});
const token = (await res.json()).token;

const browser = await puppeteer.launch({ headless: 'new' });
const context = await browser.createBrowserContext();
const page = await context.newPage();
await page.setViewport({ width: 1440, height: 950 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
await page.goto(`${FE}/my-advances`, { waitUntil: 'domcontentloaded', timeout: 45000 });
await sleep(3500);

// Open the "Đề nghị tạm ứng" modal (the ops advance request form).
const reqIdx = await page.$$eval('button', (bs) => bs.findIndex((b) => /gửi yêu cầu tạm ứng/i.test(b.textContent ?? '')));
log(`open advance-request button idx=${reqIdx}`);
if (reqIdx >= 0) {
  (await page.$$('button'))[reqIdx].click();
  await sleep(1200);
  const field = await page.evaluateHandle(() => {
    const labels = Array.from(document.querySelectorAll('label'));
    const label = labels.find((l) => (l.textContent ?? '').includes('Số tiền'));
    const byFor = label?.htmlFor ? document.getElementById(label.htmlFor) : null;
    return byFor ?? document.querySelector('.ops-modal input, [role="dialog"] input');
  });
  const fieldEl = field.asElement();
  if (fieldEl) {
    await fieldEl.click();
    await fieldEl.type('1234500');
    await sleep(400);
    const value = await fieldEl.evaluate((el) => el.value);
    log(`typed 1234500 → field shows "${value}"`);
    fs.appendFileSync(path.join(OUT, 'money-after-driver.log'), `Số tiền (VND): typed 1234500 → "${value}" ${/1\.234\.500/.test(value) ? 'PASS' : 'FAIL'}\n`);
    await page.screenshot({ path: path.join(OUT, '02-money-grouped-ops-advance.png') });
  } else {
    log('field not found');
  }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
await browser.close();
