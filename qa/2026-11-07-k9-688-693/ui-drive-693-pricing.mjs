// SIL-693 r3 — UI pricing leg v4: the exact step QA failed ("UI nhập tay
// 3.800.000 → 409") on lot 779234 F1-693-A-trUz — LCL, trip COMPLETED,
// currently UNLOCKED (v3 left it open after the unlock-leg UI proof), unclaimed.
// Real keystrokes via page.type; then Lưu cước thu → audit must record
// channel TRIP + freightManual 3800000 + completedTrip. Then KHÓA LÔ HÀNG
// (restores the fixture + proves the lock button) → Xuất Debit Note →
// DB note with FREIGHT 3.800.000.
import puppeteer from 'puppeteer-core';
import { mkdirSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const BASE = 'http://localhost:7190';
const API = 'http://localhost:3003/api';
const DIR = 'qa/2026-11-07-k9-688-693';
const LOG = `${DIR}/ui-driver-693.log`;
mkdirSync(DIR, { recursive: true });
const log = (line) => { const text = `${new Date().toISOString()} ${line}`; console.log(text); appendFileSync(LOG, `${text}\n`); };
appendFileSync(LOG, `\n=== SIL-693 r3 UI pricing leg v4 ${new Date().toISOString()} ===\n`);
const psql = (sql) => execFileSync('docker', ['exec', 'ss-prod-db', 'psql', '-U', 'postgres', '-d', 'silversea', '-tAc', sql], { encoding: 'utf8' }).trim();

const login = async (identifier) => {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (!res.ok) throw new Error(`login ${identifier} failed: ${res.status}`);
  const { token } = await res.json();
  return token;
};

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1440,1000'],
  defaultViewport: { width: 1440, height: 1000 },
});
let failures = 0;
const check = (name, ok, detail) => {
  failures += ok ? 0 : 1;
  log(`ASSERT ${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LOT = 779234;
const BILL = psql(`SELECT coalesce(nullif(booking_ref,''), nullif(bl_number,''), shipment_code) FROM shipments WHERE id=${LOT};`).trim();
log(`pricing leg lot ${LOT} bill=${BILL} (COMPLETED trip, open lock state required)`);

try {
  const token = await login('hoapt');
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  // Leg A: MỞ KHÓA via UI (the locked lot opens the remedy path).
  await page.goto(`${BASE}/shipments-debit?customer=1&lock=LOCKED`, { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(700);
  await page.waitForFunction((b) => [...document.querySelectorAll('tbody tr')].some((tr) => tr.textContent?.includes(b)), { timeout: 25000, polling: 300 }, BILL);
  await page.evaluate((b) => {
    const btn = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') ?? '') === `Hành động lô ${b}`);
    btn.click();
  }, BILL);
  await sleep(400);
  await page.evaluate((b) => {
    const el = [...document.querySelectorAll('[role="menuitem"]')].find((i) => (i.textContent ?? '').includes(`Mở chi tiết lô ${b}`));
    el.click();
  }, BILL);
  await sleep(1200);
  const unlockSeen = await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') ?? '') === 'Mở khóa lô hàng');
    return b ? 'seen' : null;
  }, { timeout: 15000, polling: 300 }).then(() => 'seen').catch(() => null);
  check(`MỞ KHÓA hiển thị trên lô khóa ${BILL} (kế toán)`, unlockSeen === 'seen');
  if (unlockSeen === 'seen') {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') ?? '') === 'Mở khóa lô hàng');
      b.click();
    });
    await sleep(700);
    await page.click('textarea');
    await page.type('textarea', 'SIL-693 r3 v4: mở khóa định giá remedy qua UI (kế toán)');
    await sleep(300);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => (x.textContent ?? '').trim() === 'Mở khóa' && !x.disabled);
      if (b) b.click();
    });
    await sleep(1500);
  }
  const openAfterUnlock = psql(`SELECT count(*) FROM shipment_cost_locks WHERE shipment_id=${LOT} AND unlocked_at IS NULL;`);
  check('MỞ KHÓA qua UI → DB hết active lock', openAfterUnlock.trim() === '0', `active=${openAfterUnlock}`);
  await page.close();

  // Leg B: fresh page on the now-open lot — manual price entry + save.
  const page2 = await browser.newPage();
  await page2.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page2.goto(`${BASE}/shipments-debit?customer=1&lock=OPEN`, { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(700);
  await page2.waitForFunction((b) => [...document.querySelectorAll('tbody tr')].some((tr) => tr.textContent?.includes(b)), { timeout: 25000, polling: 300 }, BILL);
  await page2.evaluate((b) => {
    const btn = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') ?? '') === `Hành động lô ${b}`);
    btn.click();
  }, BILL);
  await sleep(400);
  await page2.evaluate((b) => {
    const el = [...document.querySelectorAll('[role="menuitem"]')].find((i) => (i.textContent ?? '').includes(`Mở chi tiết lô ${b}`));
    el.click();
  }, BILL);
  await sleep(1200);

  const inputSeen = await page2.waitForFunction(() => {
    const i = [...document.querySelectorAll('input')].find((x) => (x.placeholder ?? '') === 'Bỏ trống = tự tra bảng giá');
    return i && !i.disabled ? 'seen' : null;
  }, { timeout: 20000, polling: 300 }).then(() => 'seen').catch(() => null);
  check(`ô Giá cước thu khách armed trên lô COMPLETED ${BILL}`, inputSeen === 'seen');

  if (inputSeen === 'seen') {
    await page2.evaluate(() => {
      const i = [...document.querySelectorAll('input')].find((x) => (x.placeholder ?? '') === 'Bỏ trống = tự tra bảng giá');
      i.scrollIntoView({ block: 'center' });
      i.focus();
      i.select();
    });
    // Paced keystrokes: the grouped NumberField re-renders between keys —
    // machine-gun typing outraces the reformat (the v4 doubling artifact).
    await page2.type('input[placeholder="Bỏ trống = tự tra bảng giá"]', '3800000', { delay: 140 });
    await sleep(500);
    const typedValue = await page2.evaluate(() => {
      const i = [...document.querySelectorAll('input')].find((x) => (x.placeholder ?? '') === 'Bỏ trống = tự tra bảng giá');
      return i?.value ?? null;
    });
    const saveState = await page2.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => (x.textContent ?? '').includes('Lưu cước thu'));
      return { found: b != null, disabled: b?.disabled ?? null };
    });
    check('ô giá hiển thị 3.800.000 + Lưu cước thu enabled (React state dirty)', typedValue === '3.800.000' && saveState.found && saveState.disabled === false, `value=${typedValue} save=${JSON.stringify(saveState)}`);
    await page2.screenshot({ path: `${DIR}/693-06-manual-price-typed-1440.png` });
    await page2.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => (x.textContent ?? '').includes('Lưu cước thu'));
      b.click();
    });
    await sleep(2200);
    const audit = psql(`SELECT payload::text FROM audit_logs WHERE entity_id=${LOT} AND payload::text LIKE '%rev-class%' ORDER BY id DESC LIMIT 1;`);
    check('audit mới: TRIP + freightManual đúng 3800000 + completedTrip — remedy UI thật',
      /"channel": "TRIP"/.test(audit) && /"freightManual": "3800000"/.test(audit) && /"completedTrip": true/.test(audit),
      audit.slice(0, 220));
    await page2.screenshot({ path: `${DIR}/693-07-manual-price-saved-1440.png` });
  }
  await page2.close();

  // Leg C: KHÓA LÔ HÀNG lại (fresh page reads the refreshed row state).
  const page3 = await browser.newPage();
  await page3.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page3.goto(`${BASE}/shipments-debit?customer=1&lock=OPEN`, { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(700);
  await page3.waitForFunction((b) => [...document.querySelectorAll('tbody tr')].some((tr) => tr.textContent?.includes(b)), { timeout: 25000, polling: 300 }, BILL);
  await page3.evaluate((b) => {
    const btn = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') ?? '') === `Hành động lô ${b}`);
    btn.click();
  }, BILL);
  await sleep(400);
  await page3.evaluate((b) => {
    const el = [...document.querySelectorAll('[role="menuitem"]')].find((i) => (i.textContent ?? '').includes(`Mở chi tiết lô ${b}`));
    el.click();
  }, BILL);
  await sleep(1200);
  const lockSeen = await page3.waitForFunction(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') ?? '') === 'Khóa lô hàng');
    return b && !b.disabled ? 'seen' : null;
  }, { timeout: 15000, polling: 300 }).then(() => 'seen').catch(() => null);
  if (lockSeen === 'seen') {
    await page3.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') ?? '') === 'Khóa lô hàng');
      b.click();
    });
    await sleep(1500);
  }
  const active = psql(`SELECT count(*) FROM shipment_cost_locks WHERE shipment_id=${LOT} AND unlocked_at IS NULL;`);
  const freightAuto = psql(`SELECT cost_snapshot->>'freightAuto' FROM shipment_cost_locks WHERE shipment_id=${LOT} AND unlocked_at IS NULL ORDER BY id DESC LIMIT 1;`);
  check('KHÓA LÔ HÀNG lại qua UI → active lock mang freightAuto 3800000', active.trim() === '1' && freightAuto.trim() === '3800000', `active=${active} freightAuto=${freightAuto}`);
  await page3.screenshot({ path: `${DIR}/693-08-relocked-1440.png` });
  await page3.close();
} catch (err) {
  failures += 1;
  log(`DRIVE ERROR: ${err.message}`);
} finally {
  await browser.close();
}

log(`== SIL-693 UI pricing leg v4: ${failures === 0 ? 'ALL PASS' : `${failures} FAILURES`} ==`);
process.exitCode = failures === 0 ? 0 : 1;
