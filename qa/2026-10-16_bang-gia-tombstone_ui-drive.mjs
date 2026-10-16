// Card 161026121500 — rung-3 UI drive (AGENTS §9).
// ADMIN on /config/pricing-tables ("Bảng giá cước"): create a pricing row →
// delete it (soft) → re-create the SAME selector. Before the fix the re-create
// failed with the phantom duplicate (tombstone still held the DB unique slot);
// after the fix it must succeed. Then a REAL duplicate (two live rows) must
// still be rejected 409. Cleanup: delete the re-added row via the UI.
// Stack: frontend http://localhost:7175 → backend :3002 → dev DB :5441 (ss-prod-db).
import puppeteer from 'puppeteer-core';
import { mkdirSync, appendFileSync } from 'node:fs';

const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const ART = 'qa';
const LOG = 'qa/2026-10-16_bang-gia-tombstone_ui-driver.log';
const PRICE = 888777001;          // distinctive: easy to grep in DOM + DB
const PRICE_FMT = '888.777.001';  // formatCurrency VND rendering
const DATE_UI = '31/12/2099';     // sentinel effectiveDate, far future
const DATE_DB = '2099-12-31';
mkdirSync(ART, { recursive: true });
const log = (line) => { const t = `${new Date().toISOString()} ${line}`; console.log(t); appendFileSync(LOG, `${t}\n`); };
appendFileSync(LOG, `\n=== run ${new Date().toISOString()} ===\n`);

const login = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
});
const { token } = await login.json();
log(`login admin: ${token ? 'OK' : 'FAIL'}`);
if (!token) process.exit(1);

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1440,1000'],
  defaultViewport: { width: 1440, height: 1000 },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => { await page.screenshot({ path: `${ART}/2026-10-16_bang-gia-tombstone_ui-${name}.png` }); log(`shot ${name}`); };

const clickButtonByText = async (re) => {
  // NB: pass the pattern as a STRING source — puppeteer serializes a RegExp
  // object to {} on the other side and `new RegExp({})` becomes a character
  // class that matches nearly everything.
  const source = re instanceof RegExp ? re.source : String(re);
  const flags = re instanceof RegExp ? re.flags : '';
  const ok = await page.evaluate((src, fl) => {
    const re2 = new RegExp(src, fl);
    const btn = [...document.querySelectorAll('button')].find((b) => {
      const label = `${b.getAttribute('aria-label') || ''} ${b.textContent || ''}`.trim();
      return re2.test(label) && !b.disabled;
    });
    if (!btn) return false;
    btn.click();
    return true;
  }, source, flags);
  if (!ok) throw new Error(`button not found/enabled: ${source}`);
  await sleep(250);
};

// Find the FormGroup that renders the given label text, return its container.
const fieldContainer = (labelText) => page.evaluateHandle((lt) => {
  const labels = [...document.querySelectorAll('label')];
  const lbl = labels.find((l) => l.textContent.trim() === lt);
  if (!lbl) return null;
  let el = lbl;
  while (el && el.children.length <= 2) { const parent = el.parentElement; if (!parent) break; el = parent; if ([...parent.querySelectorAll('label')].length > 1) break; }
  return el || lbl;
}, labelText);

const fillInputInField = async (labelText, value, type = 'text') => {
  const field = await fieldContainer(labelText);
  const ok = await field.evaluate((el, val, typ) => {
    const input = [...el.querySelectorAll('input')].find((i) => i.type === typ && !i.disabled);
    if (!input) return false;
    const proto = input instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(input, val);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }, value, type);
  if (!ok) throw new Error(`no ${type} input in field ${labelText}`);
  await sleep(150);
};

const openAddForm = async () => {
  await clickButtonByText(/^Thêm mới$/);
  try {
    await page.waitForFunction(() => document.querySelectorAll('[role="dialog"]').length > 0, { timeout: 10000, polling: 120 });
  } catch {
    // one retry — cold vite compile can swallow the first click
    await clickButtonByText(/^Thêm mới$/);
    await page.waitForFunction(() => document.querySelectorAll('[role="dialog"]').length > 0, { timeout: 10000, polling: 120 });
  }
  await sleep(600);
};

// Combos scoped by dialog order (Khách hàng, Tuyến đường) — label-walking
// proved fragile (the "Tuyên đường" pick re-opened the customer listbox).
const dialogComboPick = async (nth, fieldLogName) => {
  const clicked = await page.evaluate((n) => {
    const combos = [...document.querySelectorAll('[role="dialog"] input[role="combobox"]')];
    if (!combos[n]) return false;
    combos[n].click();
    combos[n].focus();
    return true;
  }, nth);
  if (!clicked) throw new Error(`combobox #${nth} not found (${fieldLogName})`);
  await sleep(500);
  const chosen = await page.evaluate(() => {
    const opts = [...document.querySelectorAll('[role="option"]')].filter((o) => {
      const t = o.textContent.trim();
      return t && !/^(--\s*Chọn|--|—\s*Không áp dụng)/.test(t);
    });
    if (!opts.length) return null;
    opts[0].click();
    return opts[0].textContent.trim();
  });
  if (!chosen) throw new Error(`no options opened for ${fieldLogName}`);
  await sleep(300);
  log(`combo ${fieldLogName} → ${chosen}`);
  return chosen;
};

const fillPricingForm = async () => {
  await dialogComboPick(0, 'Khách hàng');
  await dialogComboPick(1, 'Tuyến đường');
  await fillInputInField('Cước thu khách (đ)', String(PRICE), 'number');
  await fillInputInField('Hiệu lực từ', DATE_UI, 'text');
};

const saveForm = async () => {
  const ok = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('[role="dialog"] button')].find((b) => /^(Thêm|Cập nhật)$/.test(b.textContent.trim()) && !b.disabled);
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (!ok) throw new Error('save button not found in dialog');
  await sleep(1100);
};

const rowWithPriceVisible = () => page.evaluate((fmt) => document.body.textContent.includes(fmt), PRICE_FMT);

const deleteRowWithPrice = async () => {
  // open the edit modal by clicking the row that shows the sentinel price
  const opened = await page.evaluate((fmt) => {
    const row = [...document.querySelectorAll('tr')].find((r) => r.textContent.includes(fmt));
    if (!row) return false;
    row.click();
    return true;
  }, PRICE_FMT);
  if (!opened) throw new Error('sentinel row not found for edit');
  await page.waitForFunction((fmt) => {
    const dlg = [...document.querySelectorAll('[role="dialog"]')].find((d) => d.textContent.includes('Chỉnh sửa'));
    return !!dlg && document.body.textContent.includes(fmt);
  }, { timeout: 8000, polling: 120 }, PRICE_FMT);
  await sleep(400);
  await clickButtonByText(/Xóa cấu hình này/);
  await sleep(400);
  // custom ConfirmDialog (React), not a native dialog
  await page.waitForFunction(() => !!document.querySelector('[role="alertdialog"], .confirm-dialog, [data-confirm]'), { timeout: 5000, polling: 120 }).catch(() => null);
  await clickButtonByText(/^Xóa$/);
  await sleep(1100);
};

// ─── drive ───────────────────────────────────────────────────────────────────
await page.goto(`${BASE}/config/pricing-tables`, { waitUntil: 'networkidle0', timeout: 30000 });
await page.waitForFunction(() => !!document.querySelector('table'), { timeout: 15000, polling: 150 });
await sleep(800);
await shot('01-page-loaded');

// Step 1: create
await openAddForm();
await fillPricingForm();
await shot('02-form-filled-create');
await saveForm();
if (!await rowWithPriceVisible()) { await shot('FAIL-create'); throw new Error('create: row not visible after save'); }
log('step1 create: row visible OK');
await shot('03-created');

// Step 2: delete (soft)
await deleteRowWithPrice();
if (await rowWithPriceVisible()) { await shot('FAIL-delete'); throw new Error('delete: row still visible'); }
log('step2 delete: row removed OK');
await shot('04-deleted');

// Step 3: re-create the SAME selector — the phantom-duplicate repro
await openAddForm();
await fillPricingForm();
await shot('05-form-filled-recreate');
await saveForm();
await sleep(400);
const dupError = await page.evaluate(() => {
  const alerts = [...document.querySelectorAll('[role="alert"], .alert')];
  return alerts.map((a) => a.textContent.trim()).join(' | ');
});
if (!await rowWithPriceVisible()) {
  await shot('FAIL-recreate-duplicate-error');
  throw new Error(`re-create failed — duplicate error shown: ${dupError}`);
}
log(`step3 re-create same selector: SUCCESS (no duplicate error)`);
await shot('06-recreated-same-selector');

// Step 4: real duplicate (two LIVE rows) must still be rejected
await openAddForm();
await fillPricingForm();
await saveForm();
await sleep(400);
const errText = await page.evaluate(() => {
  const alerts = [...document.querySelectorAll('[role="alert"], .alert')];
  return alerts.map((a) => a.textContent.trim()).join(' | ');
});
if (!/đã tồn tại/.test(errText)) { await shot('FAIL-duplicate-not-blocked'); throw new Error(`real duplicate NOT blocked: ${errText}`); }
log(`step4 real duplicate blocked: "${errText}"`);
await shot('07-real-duplicate-still-blocked');
await clickButtonByText(/^Hủy$/);

// Step 5: cleanup — delete the live sentinel row via the UI
await deleteRowWithPrice();
if (await rowWithPriceVisible()) { await shot('FAIL-cleanup'); throw new Error('cleanup delete failed'); }
log('step5 cleanup: sentinel row deleted via UI');
await shot('08-cleaned-up');

await browser.close();
log('ALL STEPS PASS');
process.exit(0);
