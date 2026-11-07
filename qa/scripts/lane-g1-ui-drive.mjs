// Lane G1 UI DRIVEN (rung 3) — SIL-721 unlock-by-role + SIL-723 Ops expense Lưu law.
// Drives the REAL local stack of this worktree: FE http://localhost:7193 → BE :3014
// (this branch's code), shared dev DB :5441.
//   U1 (SIL-721, ketoan/ACCOUNTANT @1440): chot-debit board row SHP-2611-00407
//      (lô 779247) — MỞ KHÓA button renders for ACCOUNTANT, reason prompt gates
//      the POST, success toast + Lịch sử khóa shows the UNLOCK event; KHÓA LÔ
//      HÀNG re-locks (state restored).
//   U2 (SIL-723, giaonhan/OPS @1440): /my-orders "Khai chi phí" drawer — invoice
//      block without Số hóa đơn keeps Lưu disabled with a footer notice NAMING
//      the field; no-invoice row Loại+Số tiền+Ghi chú saves (success toast).
//   U3 (SIL-723 @390): no-charge row without Ghi chú — footer names "Ghi chú".
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:7193';
const API = process.env.LANE_API ?? 'http://localhost:3014/api';
const OUT = process.env.EVIDENCE ?? 'qa/2026-11-07-lane-g1';
fs.mkdirSync(OUT, { recursive: true });
const log = [];
const say = (l) => { log.push(l); console.log(l); };
let checks = 0; const fails = [];
const check = (name, ok, detail = '') => {
  checks += 1;
  say(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function login(identifier) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  const body = await res.json();
  if (!body?.token) throw new Error(`LOGIN FAILED ${identifier}`);
  return body;
}

const LOT = Number(process.env.LOT_ID ?? 1786);
const LOT_CODE = process.env.LOT_CODE ?? 'SILW7114252A';

async function withPage(browser, token, viewport, fn) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  page.on('pageerror', (err) => say(`PAGEERROR: ${err.message}`));
  try { await fn(page); } finally { await page.close(); }
}

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const ketoan = await login('ketoan');
const ops = await login('giaonhan');
say(`logged in ketoan(${ketoan.user?.role}) giaonhan(${ops.user?.role}) — BASE ${BASE} API ${API}`);

// ─── U1: SIL-721 on the chot-debit board ────────────────────────────────────
await withPage(browser, ketoan.token, { width: 1440, height: 1000 }, async (page) => {
  say('\nU1 — SIL-721 ketoan unlock on /shipments-debit (1440)');
  await page.goto(`${BASE}/shipments-debit`, { waitUntil: 'networkidle2', timeout: 60000 });
  // Find the lot row by its Số Bill code; if the default filter hides it, use
  // the board's search box.
  await page.waitForFunction((code) => document.body.innerText.includes(code) || document.querySelectorAll('input[type="text"], input[type="search"]').length > 0, { timeout: 45000 }, LOT_CODE);
  const visible = await page.evaluate((code) => document.body.innerText.includes(code), LOT_CODE);
  if (!visible) {
    await page.evaluate((code) => {
      const input = [...document.querySelectorAll('input[type="text"], input[type="search"]')].find(i => i.offsetParent != null);
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, code);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, LOT_CODE);
    await page.waitForFunction((code) => document.body.innerText.includes(code), { timeout: 30000 }, LOT_CODE);
  }
  check('board shows the locked lot row', true, LOT_CODE);
  // DebitLotTable: workspace renders in an expanded row — open via the row's
  // ⋯ menu ("Mở chi tiết lô …").
  const menuOpened = await page.evaluate((code) => {
    const row = [...document.querySelectorAll('tr')].find(tr => tr.innerText.includes(code));
    const trigger = row?.querySelector('button[aria-haspopup="menu"]');
    if (!trigger) return false;
    trigger.click();
    return true;
  }, LOT_CODE);
  check('row ⋯ menu opened', menuOpened);
  await page.waitForFunction(() => [...document.querySelectorAll('[role="menuitem"]')].some(i => i.textContent.includes('Mở chi tiết lô')), { timeout: 10000 });
  await page.evaluate(() => {
    [...document.querySelectorAll('[role="menuitem"]')].find(i => i.textContent.includes('Mở chi tiết lô')).click();
  });
  await page.waitForFunction(() => document.body.innerText.includes('KHÓA LÔ HÀNG'), { timeout: 20000 });
  const preState = await page.evaluate(() => {
    const unlockBtn = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') ?? '') === 'Mở khóa lô hàng');
    const lockBtn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('KHÓA LÔ HÀNG'));
    return { unlockAbsentWhenOpen: !unlockBtn, lockEnabled: lockBtn ? !lockBtn.disabled : false, history: document.body.innerText.includes('Lịch sử khóa') };
  });
  // Unlocked lot: MỞ KHÓA hidden (nothing to unlock), KHÓA enabled; the
  // trail section reads under the same clearance and may render already.
  check('lô đang mở: MỞ KHÓA chưa render, KHÓA LÔ HÀNG enabled', preState.unlockAbsentWhenOpen && preState.lockEnabled, JSON.stringify(preState));
  check('Lịch sử khóa section renders for ACCOUNTANT', preState.history);

  // Ketoan LOCKS through the UI (ACCOUNTANT lock already legal).
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find(b => b.textContent.includes('KHÓA LÔ HÀNG')).click();
  });
  await page.waitForFunction((code) => document.body.innerText.includes('MỞ KHÓA') && document.body.innerText.includes('Lịch sử khóa'), { timeout: 25000 }, LOT_CODE);
  const lockedInfo = await page.evaluate((code) => {
    const btn = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') ?? '') === 'Mở khóa lô hàng');
    const text = document.body.innerText;
    const lockEvent = new RegExp(`Khóa lô[^\\n]*${''}`).test(text) && text.includes(code);
    return { present: !!btn, disabled: btn?.disabled ?? null, history: text.includes('Lịch sử khóa'), lockEvent };
  }, LOT_CODE);
  check('MỞ KHÓA renders for ACCOUNTANT on the locked row', lockedInfo.present && !lockedInfo.disabled, JSON.stringify(lockedInfo));
  await page.screenshot({ path: `${OUT}/sil-721_ui-1-ketoan-unlock-visible-1440.png` });

  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') ?? '') === 'Mở khóa lô hàng').click();
  });
  await page.waitForFunction(() => document.body.innerText.includes('Nhập lý do'), { timeout: 15000 });
  const promptInfo = await page.evaluate(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"], .modal, .drawer')].find(d => d.innerText.includes('Nhập lý do'));
    const input = dialog?.querySelector('textarea, input[type="text"]');
    if (!input) return { ok: false };
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
      ?? Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'QA lane G1 — kế toán mở khóa theo quyết định boss 07/11 (SIL-721)');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return { ok: true };
  });
  check('reason prompt accepted text', promptInfo.ok);
  await page.screenshot({ path: `${OUT}/sil-721_ui-2-ketoan-reason-prompt.png` });
  await page.evaluate(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"], .modal, .drawer')].find(d => d.innerText.includes('Nhập lý do'));
    [...dialog.querySelectorAll('button')].find(b => b.textContent.trim() === 'Mở khóa').click();
  });
  const toast = await page.waitForFunction(() => document.body.innerText.includes('Đã mở khóa chi phí lô'), { timeout: 20000 }).then(() => true).catch(() => false);
  check('unlock success toast "Đã mở khóa chi phí lô …"', toast);
  const historyAfter = await page.evaluate(() => {
    const text = document.body.innerText;
    return {
      unlockEvent: text.includes('Mở khóa lô — Nguyễn Thị Mai') || (text.includes('Mở khóa lô') && text.includes('SIL-721')),
      lockBtnBack: [...document.querySelectorAll('button')].some(b => b.textContent.includes('KHÓA LÔ HÀNG') && !b.disabled),
    };
  });
  check('history shows the new UNLOCK event (actor + reason)', historyAfter.unlockEvent);
  await page.screenshot({ path: `${OUT}/sil-721_ui-3-ketoan-unlocked-history-1440.png` });

  // Restore through the same UI: lock → unlock (lot 1786 was unlocked before).
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find(b => b.textContent.includes('KHÓA LÔ HÀNG') && !b.disabled).click();
  });
  const relock = await page.waitForFunction(() => document.body.innerText.includes('MỞ KHÓA'), { timeout: 25000 }).then(() => true).catch(() => false);
  check('re-lock through UI', relock);
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') ?? '') === 'Mở khóa lô hàng').click();
  });
  await page.waitForFunction(() => document.body.innerText.includes('Nhập lý do'), { timeout: 15000 });
  await page.evaluate(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"], .modal, .drawer')].find(d => d.innerText.includes('Nhập lý do'));
    const input = dialog.querySelector('textarea, input[type="text"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(input, 'QA lane G1 — mở lại nguyên trạng ban đầu (lô chưa khóa)');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    [...dialog.querySelectorAll('button')].find(b => b.textContent.trim() === 'Mở khóa').click();
  });
  const restored = await page.waitForFunction(() => document.body.innerText.includes('Đã mở khóa chi phí lô'), { timeout: 20000 }).then(() => true).catch(() => false);
  check('lot restored to its original unlocked state', restored);
  await page.screenshot({ path: `${OUT}/sil-721_ui-4-ketoan-restored-1440.png` });
  await page.setViewport({ width: 390, height: 844 });
  await sleep(700);
  await page.screenshot({ path: `${OUT}/sil-721_ui-5-lot-detail-390.png` });
});

// ─── U2: SIL-723 Ops khai chi phí drawer ────────────────────────────────────
await withPage(browser, ops.token, { width: 1440, height: 1000 }, async (page) => {
  say('\nU2 — SIL-723 giaonhan khai chi phí drawer (1440)');
  await page.goto(`${BASE}/ops/orders`, { waitUntil: 'networkidle2', timeout: 60000 });
  // The board defaults to TODAY — lot 1786 delivers 04/11, so drive the
  // segmented date field to 04/11/2026 (type digits; segments auto-advance;
  // Enter commits the buffered draft).
  await page.waitForSelector('[data-date-boundary] input', { timeout: 20000 });
  await page.focus('[data-date-boundary] input');
  await page.type('[data-date-boundary] input', '04112026', { delay: 60 });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.body.innerText.includes('Khai chi phí'), { timeout: 60000 });
  await page.evaluate(() => {
    [...document.querySelectorAll('button.ops-orders__expense')].find(b => b.offsetParent != null).click();
  });
  await page.waitForFunction(() => document.body.innerText.includes('Khai báo chi phí'), { timeout: 20000 });
  check('drawer "Khai báo chi phí" opens', true);

  // Invoice block WITHOUT Số hóa đơn → Lưu disabled + footer names the field.
  await page.evaluate(() => {
    const block = [...document.querySelectorAll('section[aria-label]')].find(s => s.getAttribute('aria-label') === 'Phí có hóa đơn');
    const add = [...block.querySelectorAll('button')].find(b => b.textContent.includes('Thêm chi phí'));
    if (!add) throw new Error('add-row button not found');
    add.click();
  });
  await sleep(400);
  await page.evaluate(() => {
    const block = [...document.querySelectorAll('section[aria-label]')].find(s => s.getAttribute('aria-label') === 'Phí có hóa đơn');
    const row = block.querySelector('.ops-fee-row');
    // The type field renders as a React-Aria ComboBox INPUT when the catalog
    // section is large (menu opens on focus) or a plain Select button.
    const combo = row.querySelector('input[role="combobox"]');
    if (combo) { combo.focus(); return; }
    const trigger = [...row.querySelectorAll('button')].find(b => b.getAttribute('aria-haspopup') === 'listbox');
    if (!trigger) throw new Error('type trigger not found: ' + row.innerHTML.slice(0, 300));
    trigger.click();
  });
  await page.waitForFunction(() => !!document.querySelector('[role="option"]'), { timeout: 10000 });
  // The popover spends ~200ms in its entering state (opacity 0, pointer-events
  // none) — clicks there vanish. Wait until the option is hit-testable.
  await page.waitForFunction(() => {
    const real = [...document.querySelectorAll('[role="option"]')].find(o => !o.textContent.includes('Chọn loại phí'));
    if (!real) return false;
    const cs = getComputedStyle(real);
    return cs.pointerEvents === 'auto' && Number(cs.opacity) > 0.5;
  }, { timeout: 10000 });
  // The FIRST option is the placeholder '— Chọn loại phí —' (committing it
  // keeps typeCode empty — the probe trap). Click the FIRST REAL type with
  // a trusted pointer event (React-Aria ignores synthetic .click()).
  await page.evaluate(() => {
    const real = [...document.querySelectorAll('[role="option"]')].find(o => !o.textContent.includes('Chọn loại phí'));
    if (!real) throw new Error('no real type option found');
    real.dataset.qaRealOption = '1';
  });
  const realOptionInvoice = await page.$('[data-qa-real-option="1"]');
  await realOptionInvoice.click();
  await sleep(400);
  await page.evaluate(() => {
    const block = [...document.querySelectorAll('section[aria-label]')].find(s => s.getAttribute('aria-label') === 'Phí có hóa đơn');
    const amount = [...block.querySelectorAll('.ops-fee-row input')].find(i => i.getAttribute('role') !== 'combobox' && i.getAttribute('aria-haspopup') !== 'listbox');
    if (!amount) throw new Error('amount input not found: ' + [...block.querySelectorAll('.ops-fee-row')].map(r => r.innerHTML.slice(0, 400)).join('§'));
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(amount, '450000');
    amount.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(400);
  const lawInfo = await page.evaluate(() => {
    const form = document.querySelector('form.ops-modal');
    const save = [...form.querySelectorAll('button[type="submit"]')].find(b => b.textContent.includes('Lưu'));
    const foot = form.querySelector('.ops-modal__foot') ?? form;
    const block = [...document.querySelectorAll('section[aria-label]')].find(s => s.getAttribute('aria-label') === 'Phí có hóa đơn');
    const row = block?.querySelector('.ops-fee-row');
    const combo = row?.querySelector('input[role="combobox"]');
    return {
      disabled: save?.disabled,
      notice: (foot.innerText.match(/Nhập "Số hóa đơn".*/)?.[0] ?? '').trim(),
      footerText: foot.innerText,
      comboValue: combo?.value ?? 'NO-ROW',
      hints: row ? [...row.querySelectorAll('.ops-modal-hint')].map(p => p.textContent.slice(0, 80)) : [],
      pending: form.querySelectorAll('.spin').length,
    };
  });
  check('invoice row w/o Số hóa đơn keeps Lưu disabled', lawInfo.disabled === true, JSON.stringify(lawInfo));
  check('footer notice names "Số hóa đơn"', lawInfo.notice.includes('Nhập "Số hóa đơn"'), lawInfo.notice);
  await page.screenshot({ path: `${OUT}/sil-723_ui-1-invoice-block-missing-number-1440.png` });

  // Fill the named field → Lưu re-enables.
  await page.evaluate(() => {
    const block = [...document.querySelectorAll('section[aria-label]')].find(s => s.getAttribute('aria-label') === 'Phí có hóa đơn');
    const invoice = [...block.querySelectorAll('input')].find(i => (i.closest('label')?.textContent ?? '').includes('Số hóa đơn'));
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(invoice, 'TD-20261107-001');
    invoice.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(400);
  const reEnabled = await page.evaluate(() => {
    const form = document.querySelector('form.ops-modal');
    const save = [...form.querySelectorAll('button[type="submit"]')].find(b => b.textContent.includes('Lưu'));
    return save.disabled;
  });
  check('Lưu re-enables after Số hóa đơn filled', reEnabled === false, `disabled=${reEnabled}`);
  // Park the invoice row (remove it) — the saving row is the no-invoice one.
  await page.evaluate(() => {
    const block = [...document.querySelectorAll('section[aria-label]')].find(s => s.getAttribute('aria-label') === 'Phí có hóa đơn');
    [...block.querySelectorAll('button')].find(b => b.textContent.includes('Xóa dòng')).click();
  });
  await sleep(300);

  // No-invoice row: Loại + Số tiền + Ghi chú → Lưu succeeds (AC repro).
  await page.evaluate(() => {
    const block = [...document.querySelectorAll('section[aria-label]')].find(s => s.getAttribute('aria-label') === 'Phí không hóa đơn');
    const row = block.querySelector('.ops-fee-row');
    const combo = row.querySelector('input[role="combobox"]');
    if (combo) { combo.focus(); return; }
    const trigger = [...row.querySelectorAll('button')].find(b => b.getAttribute('aria-haspopup') === 'listbox');
    if (!trigger) throw new Error('no-invoice type trigger not found');
    trigger.click();
  });
  await page.waitForFunction(() => !!document.querySelector('[role="option"]'), { timeout: 10000 });
  // Entering-state wait (see the invoice block) + placeholder trap.
  await page.waitForFunction(() => {
    const real = [...document.querySelectorAll('[role="option"]')].find(o => !o.textContent.includes('Chọn loại phí'));
    if (!real) return false;
    const cs = getComputedStyle(real);
    return cs.pointerEvents === 'auto' && Number(cs.opacity) > 0.5;
  }, { timeout: 10000 });
  // Same placeholder trap — click the first REAL (non-placeholder) option.
  await page.evaluate(() => {
    const real = [...document.querySelectorAll('[role="option"]')].find(o => !o.textContent.includes('Chọn loại phí'));
    if (!real) throw new Error('no real type option found');
    real.dataset.qaRealOption = '1';
  });
  const realOptionRoad = await page.$('[data-qa-real-option="1"]');
  await realOptionRoad.click();
  await sleep(400);
  await page.evaluate(() => {
    const block = [...document.querySelectorAll('section[aria-label]')].find(s => s.getAttribute('aria-label') === 'Phí không hóa đơn');
    const amount = [...block.querySelectorAll('.ops-fee-row input')].find(i => i.getAttribute('role') !== 'combobox' && i.getAttribute('aria-haspopup') !== 'listbox');
    if (!amount) throw new Error('amount input not found');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(amount, '80000');
    amount.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(200);
  await page.evaluate(() => {
    const block = [...document.querySelectorAll('section[aria-label]')].find(s => s.getAttribute('aria-label') === 'Phí không hóa đơn');
    const note = block.querySelector('textarea');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(note, 'QA lane G1 — chi tiền mặt 2 công nhân dỡ hàng');
    note.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(400);
  const beforeSave = await page.evaluate(() => {
    const form = document.querySelector('form.ops-modal');
    const save = [...form.querySelectorAll('button[type="submit"]')].find(b => b.textContent.includes('Lưu'));
    return { disabled: save.disabled, notice: (form.querySelector('.ops-modal__foot')?.innerText ?? '').includes('bắt buộc') };
  });
  check('no-invoice row Loại+Số tiền+Ghi chú → Lưu enabled, no blocking notice', beforeSave.disabled === false && !beforeSave.notice, JSON.stringify(beforeSave));
  await page.screenshot({ path: `${OUT}/sil-723_ui-2-noinvoice-filled-save-enabled-1440.png` });
  await page.evaluate(() => {
    const form = document.querySelector('form.ops-modal');
    [...form.querySelectorAll('button[type="submit"]')].find(b => b.textContent.includes('Lưu')).click();
  });
  const savedToast = await page.waitForFunction(() => document.body.innerText.includes('Đã ghi nhận'), { timeout: 25000 }).then(() => true).catch(() => false);
  check('success toast "Đã ghi nhận N khoản chi"', savedToast);
  await page.screenshot({ path: `${OUT}/sil-723_ui-3-saved-toast-1440.png` });
});

// ─── U3: 390px blocked-state notice names "Ghi chú" ─────────────────────────
await withPage(browser, ops.token, { width: 390, height: 844 }, async (page) => {
  say('\nU3 — SIL-723 blocked notice @390');
  await page.goto(`${BASE}/ops/orders`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('[data-date-boundary] input', { timeout: 20000 });
  await page.focus('[data-date-boundary] input');
  await page.type('[data-date-boundary] input', '04112026', { delay: 60 });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.body.innerText.includes('Khai chi phí'), { timeout: 60000 });
  await page.evaluate(() => {
    [...document.querySelectorAll('button.ops-orders__expense')].find(b => b.offsetParent != null).click();
  });
  await page.waitForFunction(() => document.body.innerText.includes('Khai báo chi phí'), { timeout: 20000 });
  await page.evaluate(() => {
    const block = [...document.querySelectorAll('section[aria-label]')].find(s => s.getAttribute('aria-label') === 'Phí không hóa đơn');
    const row = block.querySelector('.ops-fee-row');
    const combo = row.querySelector('input[role="combobox"]');
    if (combo) { combo.focus(); return; }
    const trigger = [...row.querySelectorAll('button')].find(b => b.getAttribute('aria-haspopup') === 'listbox');
    if (!trigger) throw new Error('no-invoice type trigger not found');
    trigger.click();
  });
  await page.waitForFunction(() => !!document.querySelector('[role="option"]'), { timeout: 10000 });
  // Entering-state wait (see the invoice block) + placeholder trap.
  await page.waitForFunction(() => {
    const real = [...document.querySelectorAll('[role="option"]')].find(o => !o.textContent.includes('Chọn loại phí'));
    if (!real) return false;
    const cs = getComputedStyle(real);
    return cs.pointerEvents === 'auto' && Number(cs.opacity) > 0.5;
  }, { timeout: 10000 });
  // Same placeholder trap — click the first REAL (non-placeholder) option.
  await page.evaluate(() => {
    const real = [...document.querySelectorAll('[role="option"]')].find(o => !o.textContent.includes('Chọn loại phí'));
    if (!real) throw new Error('no real type option found');
    real.dataset.qaRealOption = '1';
  });
  const realOptionNote = await page.$('[data-qa-real-option="1"]');
  await realOptionNote.click();
  await sleep(400);
  await page.evaluate(() => {
    const block = [...document.querySelectorAll('section[aria-label]')].find(s => s.getAttribute('aria-label') === 'Phí không hóa đơn');
    const amount = [...block.querySelectorAll('.ops-fee-row input')].find(i => i.getAttribute('role') !== 'combobox' && i.getAttribute('aria-haspopup') !== 'listbox');
    if (!amount) throw new Error('amount input not found');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(amount, '80000');
    amount.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(400);
  const blocked = await page.evaluate(() => {
    const form = document.querySelector('form.ops-modal');
    const save = [...form.querySelectorAll('button[type="submit"]')].find(b => b.textContent.includes('Lưu'));
    const foot = form.querySelector('.ops-modal__foot');
    return { disabled: save.disabled, notice: (foot?.innerText.match(/Dòng không thu khách.*/)?.[0] ?? '').trim() };
  });
  check('@390 Lưu disabled without Ghi chú', blocked.disabled === true);
  check('@390 footer notice names "Ghi chú"', blocked.notice.includes('bắt buộc nhập trường "Ghi chú"'), blocked.notice);
  await page.screenshot({ path: `${OUT}/sil-723_ui-4-missing-note-notice-390.png` });
});

await browser.close();
fs.writeFileSync(`${OUT}/ui-driver.log`, log.join('\n') + `\n\nchecks ${checks}, fails ${fails.length}\n`, 'utf8');
console.log(`\nchecks ${checks}, fails ${fails.length}`);
if (fails.length > 0) { console.log('FAILED: ' + fails.join(' | ')); process.exit(1); }
console.log('LANE G1 UI VERIFIED');
