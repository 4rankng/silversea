// Evidence pack 9 cards — Script B: DISPATCH surfaces (desktop 1440, dieuvan).
// Cards: lcl-07 (Gán xe nhóm — advisory tính cước gom REQ-19),
//        dis-09 (phát lệnh xe ngoài CHƯA biển số — confirm "Vẫn phát lệnh?").
// Pin 536aad6c: FE :7175 → BE :3002 → local DB :5441.
import puppeteer from 'puppeteer-core';
import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';

const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const ART = 'qa/2026-10-21-evidence-9cards';
const LOG = `${ART}/ui-driver-dispatch.log`;
mkdirSync(ART, { recursive: true });
const log = (line) => { const t = `${new Date().toISOString()} ${line}`; console.log(t); appendFileSync(LOG, `${t}\n`); };
appendFileSync(LOG, `\n=== run ${new Date().toISOString()} (pin 536aad6c) ===\n`);

let failures = 0;
const check = (name, ok, detail = '') => { log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) failures += 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'dieuvan', password: 'Abc123' }) });
const { token } = await login.json();
log(`login dieuvan (DISPATCHER): ${token ? 'OK' : 'FAIL'}`);
if (!token) process.exit(1);

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
page.on('dialog', (d) => void d.accept());

await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 45000 });
await page.waitForFunction(() => document.body?.innerText.includes('Xóa lọc'), { timeout: 30000 });
await sleep(800);
check('dispatch-detail grid renders', await page.evaluate(() => !document.body.innerText.includes('Đăng nhập')), `url=${page.url()}`);

// scope: Xóa lọc → mở Bộ lọc nâng cao → Loại hàng = Hàng lẻ (LCL)
await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('Xóa lọc'))?.click(); });
await sleep(2000);
await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Bộ lọc')?.click(); });
await sleep(1000);
await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => (b.textContent || '').startsWith('Loại hàng:')), { timeout: 15000 });
await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => (b.textContent || '').startsWith('Loại hàng:'))?.click(); });
await sleep(500);
await page.evaluate(() => {
  const opt = [...document.querySelectorAll('[role="option"]')].find((o) => (o.textContent || '').includes('Hàng lẻ (LCL)'));
  opt?.click();
});
await sleep(1500);
// narrow to the pair via the quick search (Bill, Cont, Tờ khai...)
await page.evaluate(() => {
  const input = [...document.querySelectorAll('input')].find((i) => (i.placeholder ?? '').includes('Bill, Cont'));
  if (!input) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '1792208');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
});
await page.waitForFunction(() => document.body?.innerText.includes('BL-E2E-1792208709685'), { timeout: 20000 });
// q-search debounce may swap rows under us — poll until BOTH bills render together.
let bothVisible = false;
for (let i = 0; i < 40 && !bothVisible; i += 1) {
  bothVisible = await page.evaluate(() => document.body.innerText.includes('BL-E2E-1792208709685') && document.body.innerText.includes('BL-E2E-B-1792208958720'));
  if (!bothVisible) await sleep(500);
}
check('lcl-07 both lots visible after search', bothVisible);
await sleep(700);

// idempotency: if a previous run left the pair grouped, Tách nhóm first.
// Detect via the group badge text (survives stale first renders — poll).
let ungrouped = false;
for (let i = 0; i < 20 && !ungrouped; i += 1) {
  const ourRowsGrouped = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('tr')].filter((r) => (r.textContent || '').includes('BL-E2E-1792208709685') || (r.textContent || '').includes('BL-E2E-B-1792208958720'));
    return rows.length >= 2 && rows.some((r) => (r.textContent || '').includes('Lẻ · Ghép ('));
  });
  if (!ourRowsGrouped) {
    ungrouped = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('tr')].filter((r) => (r.textContent || '').includes('BL-E2E-1792208709685') || (r.textContent || '').includes('BL-E2E-B-1792208958720'));
      return rows.length >= 2 && rows.every((r) => !(r.textContent || '').includes('Lẻ · Ghép ('));
    });
    if (!ungrouped) await sleep(500);
    continue;
  }
  await page.evaluate(() => { document.querySelector('.detailed-plan-grid__lcl-unmerge')?.click(); });
  let confirmed = false;
  for (let j = 0; j < 10 && !confirmed; j += 1) {
    await sleep(400);
    confirmed = await page.evaluate(() => {
      const box = document.querySelector('.confirm-box');
      if (!box || !(box.textContent || '').includes('Tách nhóm')) return false;
      const btn = [...box.querySelectorAll('button')].find((b) => (b.textContent || '').includes('Tách nhóm') || (b.textContent || '').includes('Xác nhận'));
      if (!btn) return false;
      btn.click();
      return true;
    });
  }
  if (!confirmed) { log('WARN: Tách nhóm confirm never appeared'); break; }
  for (let j = 0; j < 20; j += 1) {
    await sleep(500);
    const still = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('tr')].filter((r) => (r.textContent || '').includes('BL-E2E-1792208709685') || (r.textContent || '').includes('BL-E2E-B-1792208958720'));
      return rows.some((r) => (r.textContent || '').includes('Lẻ · Ghép ('));
    });
    if (!still) break;
  }
  // re-narrow the search after the refresh
  await page.evaluate(() => {
    const input = [...document.querySelectorAll('input')].find((i) => (i.placeholder ?? '').includes('Bill, Cont'));
    if (input) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '1792208');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await sleep(1500);
  ungrouped = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('tr')].filter((r) => (r.textContent || '').includes('BL-E2E-1792208709685') || (r.textContent || '').includes('BL-E2E-B-1792208958720'));
    return rows.length >= 2 && rows.every((r) => !(r.textContent || '').includes('Lẻ · Ghép ('));
  });
  log(`ungroup cycle done — ungrouped=${ungrouped}`);
}
log(`ungroup pre-step: ungrouped=${ungrouped}`);

log('LCL scope active, rows SHP-2610-03519/03520 visible');

// select the two lots (checkbox "Chọn lô …")
let checked = 0;
for (let i = 0; i < 40 && checked < 2; i += 1) {
  checked = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('[role="checkbox"]')];
    const rowHas = (c) => c.closest('tr')?.textContent ?? '';
    const two = boxes.filter((c) => rowHas(c).includes('BL-E2E-1792208709685') || rowHas(c).includes('BL-E2E-B-1792208958720'));
    if (two.length < 2) return 0;
    two.forEach((c) => { if (c.getAttribute('aria-checked') !== 'true') c.click(); });
    return two.filter((c) => c.getAttribute('aria-checked') === 'true').length >= 2 || two.length >= 2 ? 2 : 0;
  });
  if (checked < 2) await sleep(600);
}
await sleep(600);
check('lcl-07 selected 2 LCL lots via row checkboxes', checked >= 2, `boxes=${checked}`);
const selBar = await page.evaluate(() => document.body.innerText.includes('Đang chọn'));
check('lcl-07 selection bar "Đang chọn" visible', selBar);

// open Gán xe nhóm (deterministic: the selection-bar assign button)
await page.evaluate(() => { document.querySelector('.lcl-selection-bar__assign')?.click(); });
await page.waitForFunction(() => document.querySelector('.assign-truck-group') != null, { timeout: 15000 });
await sleep(500);
check('lcl-07 dialog "Gán xe nhóm" opened', true);

// pick vehicle class → advisory line (RAC combobox: input[role=combobox])
const classPicked = await page.evaluate(() => {
  const dlg = document.querySelector('.assign-truck-group');
  const input = [...dlg.querySelectorAll('input[role="combobox"], input')].find((i) => (i.placeholder ?? '').includes('Chọn loại xe'));
  input?.click();
  return Boolean(input);
});
await sleep(900);
await page.evaluate(() => {
  const opts = [...document.querySelectorAll('[role="option"]')].filter((o) => o.offsetParent != null);
  opts[0]?.click();
});
await page.waitForFunction(() => (document.querySelector('.assign-truck-group')?.textContent ?? '').includes('Tổng 2 lô:'), { timeout: 10000 }).catch(() => {});
await sleep(600);
const fitLine = await page.evaluate(() => {
  const dlg = document.querySelector('.assign-truck-group');
  const m = (dlg?.textContent ?? '').match(/Tổng 2 lô:[^—]*—?[^\n]*/);
  return m ? m[0].slice(0, 200) : null;
});
check('lcl-07 advisory "Tổng N lô: … · CBM — <class>: vừa tải/…" rendered', Boolean(fitLine), String(fitLine));
writeFileSync(`${ART}/dom-lcl07-fitline.txt`, fitLine ?? '(missing)');
await page.screenshot({ path: `${ART}/ui-lcl07-fit-advisory.png` });
log('shot ui-lcl07-fit-advisory.png');

// pick EXTERNAL carrier (options: "Đội xe nội bộ SilverSea" + "<name> — xe ngoài")
const carrierOk = await page.evaluate(() => {
  const dlg = document.querySelector('.assign-truck-group');
  const input = [...dlg.querySelectorAll('input[role="combobox"], input')].find((i) => (i.placeholder ?? '').includes('Nhà xe'));
  input?.click();
  return Boolean(input);
});
await sleep(900);
await page.evaluate(() => {
  const opts = [...document.querySelectorAll('[role="option"]')].filter((o) => o.offsetParent != null);
  const external = opts.find((o) => (o.textContent || '').includes('xe ngoài'));
  (external ?? opts[0])?.click();
});
await sleep(900);
const bksTyped = await page.evaluate(() => {
  const dlg = document.querySelector('.assign-truck-group');
  const input = [...dlg.querySelectorAll('input')].find((i) => (i.placeholder ?? '').includes('BKS'));
  if (!input) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '51QA-009.99');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
});
check('lcl-07 BKS input filled', bksTyped);
await sleep(300);
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Gán nhóm xe');
  btn?.click();
});
await page.waitForFunction(() => document.body?.innerText.includes('Đã gán nhóm xe'), { timeout: 20000 }).catch(() => {});
const toast = await page.evaluate(() => document.body.innerText.match(/Đã gán nhóm xe[^\n]*/)?.[0] ?? null);
check('lcl-07 assign success toast (Lô 1 giữ 100% cước, còn lại 0₫)', Boolean(toast), String(toast));
writeFileSync(`${ART}/dom-lcl07-toast.txt`, toast ?? '(missing)');
await page.screenshot({ path: `${ART}/ui-lcl07-assigned-toast.png` });
log('shot ui-lcl07-assigned-toast.png');

// ---------- dis-09: plate-less EXTERNAL issue on FCL row BULK-IMP-0235 ----------
// fresh load: the post-assign refresh may leave stale filter state
await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 45000 });
await page.waitForFunction(() => document.body?.innerText.includes('Xóa lọc'), { timeout: 30000 });
await sleep(1200);
await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('Xóa lọc'))?.click(); });
await sleep(2000);
await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Bộ lọc')?.click(); });
await sleep(1000);
await page.evaluate(() => {
  const input = [...document.querySelectorAll('input')].find((i) => (i.placeholder ?? '').includes('Bill, Cont'));
  if (input) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'BULK-IMP-0235');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
});
let bulkRowVisible = false;
for (let i = 0; i < 30 && !bulkRowVisible; i += 1) {
  bulkRowVisible = await page.evaluate(() => [...document.querySelectorAll('tr')].some((r) => (r.textContent || '').includes('BULK-IMP-0235')));
  if (!bulkRowVisible) await sleep(700);
}
if (!bulkRowVisible) {
  const diag = await page.evaluate(() => ({ rows: document.querySelectorAll('tbody tr').length, q: [...document.querySelectorAll('input')].find((i) => (i.placeholder ?? '').includes('Bill, Cont'))?.value, head: document.body.innerText.slice(0, 300).replace(/\n+/g, ' | ') }));
  log(`DIAG dis-09 row not found: ${JSON.stringify(diag)}`);
}
await sleep(600);

let editOpened = 'no-btn';
for (let i = 0; i < 15 && editOpened === 'no-btn'; i += 1) {
  editOpened = await page.evaluate(() => {
    const row = [...document.querySelectorAll('tr')].find((r) => (r.textContent || '').includes('BULK-IMP-0235'));
    if (!row) return 'no-btn';
    const alreadyDeferred = (row.textContent || '').includes('Chờ bổ sung biển');
    if (alreadyDeferred) return 'already-deferred';
    const btn = [...row.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? b.title ?? '').includes('Sửa ô điều phối') || (b.textContent || '').trim() === 'Sửa');
    if (!btn) return 'no-btn';
    btn.click();
    return 'editor-opened';
  });
  if (editOpened === 'no-btn') await sleep(600);
}
if (editOpened === 'already-deferred') {
  log('dis-09 row already AWAITING_PLATE from prior run — editor step skipped');
} else {
  check('dis-09 editor opened via row "Sửa"', editOpened === 'editor-opened');
  await page.waitForFunction(() => document.body?.innerText.includes('Chỉnh sửa điều phối'), { timeout: 15000 });
  await sleep(800);

  // pick an EXTERNAL carrier in #dispatch-carrier-164
  await page.evaluate(() => {
    const sel = document.querySelector('input[id^="dispatch-carrier-"], button[id^="dispatch-carrier-"], [id^="dispatch-carrier-"]');
    sel?.click();
  });
  await sleep(800);
  await page.evaluate(() => {
    const opts = [...document.querySelectorAll('[role="option"]')].filter((o) => o.offsetParent != null);
    const external = opts.find((o) => !/nội bộ/i.test(o.textContent || ''));
    (external ?? opts[0])?.click();
  });
  await sleep(1200);
  // vehicle select → "Bổ sung sau"
  const deferred = await page.evaluate(() => {
    const sel = document.querySelector('[id^="dispatch-vehicle-"]');
    sel?.click();
    return Boolean(sel);
  });
  await sleep(1000);
  await page.evaluate(() => {
    const opt = [...document.querySelectorAll('[role="option"]')].find((o) => (o.textContent || '').includes('Bổ sung sau'));
    opt?.click();
  });
  await sleep(500);
  const deferState = await page.evaluate(() => {
    const dlg = [...document.querySelectorAll('[role="dialog"]')].find((d) => d.textContent?.includes('Chỉnh sửa điều phối')) ?? document;
    return { hasDeferred: (dlg.textContent || '').includes('Bổ sung sau') };
  });
  check('dis-09 vehicle set to "Bổ sung sau" (deferred plate)', deferState.hasDeferred);
  await page.screenshot({ path: `${ART}/ui-dis09-editor-deferred.png` });
  log('shot ui-dis09-editor-deferred.png');

  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Lưu thay đổi');
    btn?.click();
  });
  await page.waitForFunction(() => ![...document.querySelectorAll('[role="dialog"]')].some((d) => (d.textContent || '').includes('Chỉnh sửa điều phối')), { timeout: 20000 });
  await sleep(800);
}
const awaiting = await page.evaluate(() => {
  const row = [...document.querySelectorAll('tr')].find((r) => (r.textContent || '').includes('BULK-IMP-0235'));
  return { rowText: row?.textContent?.replace(/\s+/g, ' ').slice(0, 300) ?? null, hasIssueBtn: Boolean(row && [...row.querySelectorAll('button')].some((b) => (b.getAttribute('aria-label') ?? '').includes('Phát lệnh'))) };
});
check('dis-09 row now AWAITING_PLATE with "Phát lệnh" button', awaiting.hasIssueBtn, String(awaiting.rowText));
writeFileSync(`${ART}/dom-dis09-awaiting-row.json`, JSON.stringify(awaiting, null, 2));
await page.screenshot({ path: `${ART}/ui-dis09-awaiting-plate-row.png` });
log('shot ui-dis09-awaiting-plate-row.png');

// Phát lệnh → 409 PLATE_DEFERRED_CONFIRM → confirm box
await page.evaluate(() => {
  const row = [...document.querySelectorAll('tr')].find((r) => (r.textContent || '').includes('BULK-IMP-0235'));
  const btn = row && [...row.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? '').includes('Phát lệnh'));
  btn?.click();
});
await page.waitForFunction(() => document.querySelector('.confirm-box') != null, { timeout: 15000 });
await sleep(500);
const confirmMsg = await page.evaluate(() => document.querySelector('.confirm-box')?.textContent?.trim() ?? null);
check('dis-09 confirm box names plate-less external issue "Vẫn phát lệnh?"', (confirmMsg ?? '').includes('Vẫn phát lệnh'), String(confirmMsg));
writeFileSync(`${ART}/dom-dis09-confirm.txt`, confirmMsg ?? '(missing)');
await page.screenshot({ path: `${ART}/ui-dis09-confirm-dialog.png` });
log('shot ui-dis09-confirm-dialog.png');

await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.confirm-box button')].find((b) => (b.textContent || '').includes('Xác nhận'));
  btn?.click();
});
await page.waitForFunction(() => document.querySelector('.confirm-box') == null, { timeout: 20000 });
await sleep(1200);
const issued = await page.evaluate(() => {
  const row = [...document.querySelectorAll('tr')].find((r) => (r.textContent || '').includes('BULK-IMP-0235'));
  return row?.textContent?.replace(/\s+/g, ' ').slice(0, 300) ?? null;
});
check('dis-09 row issued (DISPATCHED, no error toast)', issued != null && !issued.includes('Không thể phát lệnh'), String(issued));
writeFileSync(`${ART}/dom-dis09-issued-row.json`, JSON.stringify({ issued }, null, 2));
await page.screenshot({ path: `${ART}/ui-dis09-issued-row.png` });
log('shot ui-dis09-issued-row.png');

await browser.close();
log(`SCRIPT B DONE — failures=${failures}`);
process.exit(failures > 0 ? 1 : 0);
