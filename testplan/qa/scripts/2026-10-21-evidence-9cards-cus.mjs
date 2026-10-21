// Evidence pack 9 cards — Script A: CUS surfaces (desktop 1440).
// Cards: cus-11 (header doc order + tờ khai), lcl-02 (kho quick-add),
// lcl-03 (bỏ Lịch & ghi chú), lcl-04 (quy cách gợi ý), lcl-05 (Ngày giao hàng).
// Stack pinned at 536aad6c: FE :7175 (this worktree) → BE :3002 → local DB :5441.
import puppeteer from 'puppeteer-core';
import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';

const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const ART = 'qa/2026-10-21-evidence-9cards';
const LOG = `${ART}/ui-driver-cus.log`;
mkdirSync(ART, { recursive: true });
const log = (line) => { const t = `${new Date().toISOString()} ${line}`; console.log(t); appendFileSync(LOG, `${t}\n`); };
appendFileSync(LOG, `\n=== run ${new Date().toISOString()} (pin 536aad6c) ===\n`);

let failures = 0;
const check = (name, ok, detail = '') => { log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) failures += 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'cus', password: 'Abc123' }) });
const { token } = await login.json();
log(`login cus (CUS): ${token ? 'OK' : 'FAIL'}`);
if (!token) process.exit(1);

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
page.on('dialog', (d) => void d.accept());

// ---------- cus-11: /shipments/312306 header order ----------
await page.goto(`${BASE}/shipments/312306`, { waitUntil: 'networkidle2', timeout: 45000 });
await page.waitForFunction(() => document.body?.innerText.includes('Số Bill / Số Booking'), { timeout: 30000 });
await sleep(700);
check('cus-11 detail page renders (not login)', await page.evaluate(() => !document.body.innerText.includes('Đăng nhập')), `url=${page.url()}`);

const header = await page.evaluate(() => {
  const dts = [...document.querySelectorAll('.shipment-detail__header dt')].map((d) => d.textContent?.trim());
  const dds = [...document.querySelectorAll('.shipment-detail__header dd')].map((d) => d.textContent?.trim());
  return { dts, dds };
});
const wantOrder = ['Số Bill / Số Booking', 'Số tờ khai', 'Xuất / Nhập', 'Hãng tàu'];
const pos = (label) => header.dts.indexOf(label);
const ordered = pos('Số Bill / Số Booking') > -1 && pos('Số tờ khai') > pos('Số Bill / Số Booking') && pos('Xuất / Nhập') > pos('Số tờ khai') && pos('Hãng tàu') > pos('Xuất / Nhập');
check('cus-11 header order Bill/Booking → Số tờ khai → Xuất/Nhập → Hãng tàu', ordered, JSON.stringify(header.dts.slice(0, 6)));
const val = (label) => { const i = pos(label); return i > -1 ? header.dds[i] : null; };
check('cus-11 Số Bill value = REGPKoy6zz1003B3679', val('Số Bill / Số Booking')?.includes('REGPKoy6zz1003B3679') === true, String(val('Số Bill / Số Booking')));
check('cus-11 Số tờ khai empty before add (—)', val('Số tờ khai') === '—', String(val('Số tờ khai')));
check('cus-11 Xuất/Nhập = Nhập (IMPORT)', val('Xuất / Nhập') === 'Nhập', String(val('Xuất / Nhập')));
check('cus-11 Hãng tàu = REGPK LINE', val('Hãng tàu') === 'REGPK LINE', String(val('Hãng tàu')));
writeFileSync(`${ART}/db-cus11-header-before.json`, JSON.stringify({ url: page.url(), dts: header.dts, dds: header.dds }, null, 2));
await page.screenshot({ path: `${ART}/ui-cus11-header-before.png` });
log('shot ui-cus11-header-before.png (1440px header)');

// Add tờ khai via the UI (local QA mutation → DB side effect)
const addBtn = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('Thêm tờ khai')));
await (addBtn.asElement()).click();
await page.waitForFunction(() => Boolean(document.querySelector('input[placeholder="Nhập số tờ khai..."]')), { timeout: 15000 });
await page.click('input[placeholder="Nhập số tờ khai..."]');
await page.type('input[placeholder="Nhập số tờ khai..."]', 'TKQA9cards01');
await sleep(300);
await page.screenshot({ path: `${ART}/ui-cus11-decl-dialog.png` });
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Thêm tờ khai' && b.className.includes('btn--primary'));
  btn?.click();
});
await page.waitForFunction(() => document.querySelector('.shipment-detail__header')?.innerText.includes('TKQA9cards01'), { timeout: 20000 });
const after = await page.evaluate(() => [...document.querySelectorAll('.shipment-detail__header dd')].map((d) => d.textContent?.trim()));
check('cus-11 header Số tờ khai shows TKQA9cards01 after add', after[pos('Số tờ khai')]?.includes('TKQA9cards01') === true || after.some((v) => v?.includes('TKQA9cards01')), JSON.stringify(after.slice(0, 5)));
writeFileSync(`${ART}/db-cus11-header-after.json`, JSON.stringify({ url: page.url(), dds: after }, null, 2));
await page.screenshot({ path: `${ART}/ui-cus11-header-after.png` });
log('shot ui-cus11-header-after.png (header shows tờ khai)');

// ---------- lcl-03/04/05: /shipments/new LCL mode ----------
await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 45000 });
await page.waitForFunction(() => document.body?.innerText.includes('Hàng lẻ'), { timeout: 30000 });
await sleep(500);
const lclRadio = await page.evaluateHandle(() => [...document.querySelectorAll('.csc-mode__option, label, span')].find((el) => el.textContent?.trim() === 'Hàng lẻ'));
await (lclRadio.asElement()).click();
await page.waitForFunction(() => document.body?.innerText.includes('Ngày giao hàng'), { timeout: 20000 });
await sleep(600);
const lclText = await page.evaluate(() => document.body.innerText);
check('lcl-03 NO "Lịch & ghi chú" section on LCL form', !lclText.includes('Lịch & ghi chú'), `found=${lclText.includes('Lịch & ghi chú')}`);
check('lcl-03 no Lịch/ghi chú textareas (ghi chú cho khách/lái xe absent)', !lclText.includes('Ghi chú cho khách hàng') && !lclText.includes('Ghi chú cho lái xe'));
check('lcl-05 label "Ngày giao hàng" present', lclText.includes('Ngày giao hàng'));
await page.screenshot({ path: `${ART}/ui-lcl0305-form.png`, fullPage: false });
log('shot ui-lcl0305-form.png (LCL form, no Lịch & ghi chú)');
await page.screenshot({ path: `${ART}/ui-lcl0305-form-full.png`, fullPage: true });

// lcl-04: Quy cách đóng gói suggestions
const pkg = await page.evaluate(() => {
  const combo = [...document.querySelectorAll('input[role="combobox"], input')].find((i) => i.getAttribute('placeholder')?.includes('quy cách') || i.closest('label, div')?.textContent?.includes('Quy cách đóng gói'));
  return { found: Boolean(combo), placeholder: combo?.getAttribute('placeholder') ?? null };
});
check('lcl-04 "Quy cách đóng gói" combobox present with suggestion placeholder', pkg.found && (pkg.placeholder ?? '').includes('Pallet'), `placeholder=${pkg.placeholder}`);
if (pkg.found) {
  const comboEl = await page.evaluateHandle(() => [...document.querySelectorAll('input')].find((i) => (i.getAttribute('placeholder') ?? '').includes('quy cách')));
  await (comboEl.asElement()).click();
  await sleep(500);
  const opts = await page.evaluate(() => {
    const list = document.querySelector('[role="listbox"], [class*="combo"], [class*="option"], ul');
    const items = [...document.querySelectorAll('[role="option"], li')].map((li) => li.textContent?.trim()).filter((t) => t && t.length < 60);
    return items.slice(0, 12);
  });
  const hasSuggestions = ['Pallet', 'Roll', 'Carton'].some((s) => opts.some((o) => o?.includes(s)));
  check('lcl-04 suggestion list opens with Pallet/Roll/Carton options', hasSuggestions, JSON.stringify(opts));
  await page.screenshot({ path: `${ART}/ui-lcl04-packaging-suggestions.png` });
  log('shot ui-lcl04-packaging-suggestions.png');
  await page.keyboard.press('Escape');
}

// ---------- lcl-02: Thêm kho quick-add dialog ----------
// The Thêm kho affordance requires a customer (kho list is customer-scoped).
const custInput = await page.evaluateHandle(() => {
  const label = [...document.querySelectorAll('label')].find((l) => (l.textContent || '').trim().startsWith('Khách hàng'));
  const scope = label?.closest('div') ?? document;
  return scope.querySelector('input[role="combobox"], input');
});
const custEl = custInput.asElement();
check('lcl-02 customer field present', Boolean(custEl));
if (custEl) {
  await custEl.type('LONG', { delay: 40 });
  await sleep(1200);
  const firstOpt = await page.evaluateHandle(() => [...document.querySelectorAll('[role="option"]')].find((o) => o.offsetParent != null));
  const optEl = firstOpt.asElement();
  if (optEl) { await optEl.click(); log('picked first customer option'); }
  await sleep(1200);
}
await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => (b.textContent || '').includes('Thêm kho')), { timeout: 15000 });
const khoBtn = await page.evaluateHandle(() => [...document.querySelectorAll('button')].filter((b) => (b.textContent || '').includes('Thêm kho'))[0]);
const khoBtnEl = khoBtn.asElement();
check('lcl-02 "Thêm kho" button present on LCL route section', Boolean(khoBtnEl));
if (khoBtnEl) {
  await khoBtnEl.click();
  await page.waitForFunction(() => document.body?.innerText.includes('Thêm kho'), { timeout: 15000 });
  await sleep(500);
  const dlg = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"], .modal, [class*="dialog"]');
    const text = dialog?.textContent ?? document.body.textContent ?? '';
    const inputs = [...(dialog ?? document).querySelectorAll('label')].map((l) => l.textContent?.trim()).filter(Boolean);
    return { title: dialog?.querySelector('h1,h2,h3,[class*="title"]')?.textContent?.trim() ?? null, labels: inputs.slice(0, 10), text: text.slice(0, 400) };
  });
  check('lcl-02 quick-add dialog title names direction "Thêm kho lấy hàng"', (dlg.title ?? '').includes('Thêm kho lấy hàng'), `title=${dlg.title}`);
  const simple = ['Tên đầy đủ', 'Tên ngắn', 'Địa chỉ'].filter((f) => dlg.labels.some((l) => l?.includes(f)));
  const heavy = ['Google Maps', 'Liên hệ', 'Mã điểm', 'Tuyến đường'].filter((f) => dlg.text.includes(f));
  check('lcl-02 quick-add body is simple (name/short/address, not master-data form)', simple.length === 3 && heavy.length === 0, `labels=${JSON.stringify(dlg.labels)} heavy=${JSON.stringify(heavy)}`);
  writeFileSync(`${ART}/dom-lcl02-quickadd.json`, JSON.stringify(dlg, null, 2));
  await page.screenshot({ path: `${ART}/ui-lcl02-quickadd.png` });
  log('shot ui-lcl02-quickadd.png');
}

await browser.close();
log(`SCRIPT A DONE — failures=${failures}`);
process.exit(failures > 0 ? 1 : 0);
