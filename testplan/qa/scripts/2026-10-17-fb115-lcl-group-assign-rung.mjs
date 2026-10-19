// FB-115 (kanban card 171026122160) — "Gán xe cho nhóm hàng lẻ không thực hiện được".
//
// The card's own preconditions say the flow is correct when a gate is missing.
// So this rung asserts the POSITIVE path with the stated preconditions:
//   role Điều vận (dungnv) + ≥2 LCL lots in the detail plan →
//   select 2 → "Đang chọn 2 lô" bar → "Gán xe nhóm" ENABLED → dialog with its
//   required fields. It also records the state with exactly ONE row selected,
//   because that is the most likely thing the tester hit.
// LOCAL ONLY: vite 7175 → api 3002.
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:7175';
const API = `${BASE}/api`;
const SHOTS = process.env.SHOTS ?? '/tmp/fb115';
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let L = null;
for (let i = 1; i <= 3 && !L?.token; i++) {
  const t = await (await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'dungnv', password: 'Abc123' }),
  })).text();
  try { L = JSON.parse(t); } catch { await sleep(1200 * i); }
}
if (!L?.token) { console.log('LOGIN FAILED as dungnv'); process.exit(1); }
console.log('login ok as dungnv');

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), L.token);

const state = async () => page.evaluate(() => {
  const boxes = [...document.querySelectorAll('[aria-label^="Chọn lô"]')];
  const bar = document.querySelector('.lcl-selection-bar');
  const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Gán xe nhóm');
  return {
    lclCheckboxes: boxes.length,
    checked: boxes.filter((b) => b.checked || b.getAttribute('aria-checked') === 'true').length,
    barText: bar ? (bar.textContent || '').replace(/\s+/g, ' ').trim() : null,
    btnPresent: Boolean(btn),
    btnDisabled: btn ? btn.disabled : null,
    btnTitle: btn ? btn.title : null,
    dialogOpen: Boolean(document.querySelector('.assign-truck-group')),
  };
});

try {
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(7000);

  const heading = await page.evaluate(() => (document.querySelector('h1,h2')?.textContent || '').trim());
  console.log('heading =', JSON.stringify(heading));

  const initial = await state();
  console.log('INITIAL  ', JSON.stringify(initial));
  await page.screenshot({ path: `${SHOTS}/01-plan.png` });

  if (initial.lclCheckboxes === 0) {
    console.log('NO LCL ROWS on this board — preconditions not met (card says that is correct).');
    console.log('=== INCONCLUSIVE ===');
    await browser.close();
    process.exit(2);
  }

  // --- one row: the bar appears, the button is disabled (tooltip-only reason)
  await page.evaluate(() => {
    const b = document.querySelector('[aria-label^="Chọn lô"]');
    b.scrollIntoView({ block: 'center' });
    b.click();
  });
  await sleep(900);
  const one = await state();
  console.log('AFTER 1  ', JSON.stringify(one));
  await page.screenshot({ path: `${SHOTS}/02-one-row.png` });

  if (initial.lclCheckboxes < 2) {
    console.log('ONLY 1 LCL ROW selectable — cannot reach the 2-row precondition.');
    console.log('=== INCONCLUSIVE ===');
    await browser.close();
    process.exit(2);
  }

  // --- two rows: the card's step 3 + 4
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('[aria-label^="Chọn lô"]')][1];
    b.scrollIntoView({ block: 'center' });
    b.click();
  });
  await sleep(900);
  const two = await state();
  console.log('AFTER 2  ', JSON.stringify(two));
  await page.screenshot({ path: `${SHOTS}/03-two-rows.png` });

  const barOk = /Đang chọn 2 lô/.test(two.barText || '');
  const btnOk = two.btnPresent && two.btnDisabled === false;
  console.log('bar shows "Đang chọn 2 lô" =', barOk);
  console.log('"Gán xe nhóm" enabled      =', btnOk);

  let dialog = null;
  if (btnOk) {
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')]
        .find((b) => (b.textContent || '').trim() === 'Gán xe nhóm');
      btn.click();
    });
    await sleep(2500);
    dialog = await page.evaluate(() => {
      const root = document.querySelector('.assign-truck-group');
      const scope = root ? root.parentElement : document;
      const labels = [...scope.querySelectorAll('label')].map((l) => (l.textContent || '').replace(/\s+/g, ' ').trim());
      const inputs = [...scope.querySelectorAll('input,[role="combobox"],select')].length;
      const title = (scope.querySelector('h2,h3,[role="dialog"]')?.textContent || '').replace(/\s+/g, ' ').trim();
      const lotItems = [...scope.querySelectorAll('.assign-truck-group__lots li')].map((li) => (li.textContent || '').replace(/\s+/g, ' ').trim());
      return { title, labels, inputs, lotItems };
    });
    console.log('DIALOG   ', JSON.stringify(dialog, null, 1));
    await page.screenshot({ path: `${SHOTS}/04-dialog.png` });
  }

  const fieldsOk = Boolean(dialog) && dialog.labels.some((l) => /Loại xe tính tiền/i.test(l))
    && dialog.labels.some((l) => /Biển số xe chạy thực tế/i.test(l))
    && dialog.labels.some((l) => /Biển số báo cho khách/i.test(l));

  console.log('dialog has the 3 required fields =', fieldsOk);
  const ok = barOk && btnOk && fieldsOk;
  console.log(ok ? '\n=== PASS — LCL group vehicle assignment works with the stated preconditions ==='
                 : '\n=== FAIL ===');
  process.exitCode = ok ? 0 : 1;
} catch (e) {
  console.log('ERR', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
