// Full-guide Driver B — A.5 + B.5 (Kế toán chốt công nợ, role hoapt):
//   A.5: board "Kế hoạch điều động tổng hợp" + "Chọn Debit (N dòng)" dialog
//        "Chọn Debit – chốt đợt đối soát" (Từ/Đến ngày, kỳ, chiều, VAT, ghi chú).
//   B.5: filters + buttons (Xác nhận đối soát, Chọn Debit, Đối soát, Hoàn tác)
//        + column groups PHẢI THU / PHẢI TRẢ.
// Read-only drive: no chốt đợt is committed (dialog is opened + captured).
import {
  BASE, PIN, sleep, makeLogger, healthGate, login, boot, tap, setInput, waitText, bodyText,
} from './fullguide-lib.mjs';
import { writeFileSync } from 'node:fs';

const logger = makeLogger('b-acct-close');
const { step } = logger;
const results = {};
const record = (id, verdict, note) => { results[id] = { verdict, note }; step('VERDICT', { id, verdict, note }); };

await healthGate(logger);
const acct = await login('hoapt');
step('login', { ok: !!acct.token, role: acct.user?.role });
if (!acct.token) throw new Error('hoapt login failed');

const { browser, page } = await boot({ token: acct.token });
try {
  await page.goto(`${BASE}/accounting/chot-debit`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(4000);
  // widen the date window so the board actually has rows (default window can be empty)
  const setDate = async (which, value) => {
    const ok = await tap(page, `() => { const g = document.querySelector('[aria-label="Khoảng ngày lô hàng"]') || document; return [...g.querySelectorAll('input')].find(i => (i.getAttribute('aria-label') || '').toLowerCase().includes(${JSON.stringify(which)})) ?? (which === 'từ' ? g.querySelectorAll('input')[0] : g.querySelectorAll('input')[1]) ?? null; }`);
    if (!ok) return false;
    await page.keyboard.type(value, { delay: 25 });
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
    await sleep(800);
    return true;
  };
  const fromSet = await setDate('từ ngày', '01/09/2026');
  const toSet = await setDate('đến ngày', '16/10/2026');
  await sleep(4000);
  const rowCount = await page.evaluate(() => document.querySelectorAll('tbody tr').length);
  step('b-date-window', { fromSet, toSet, rowCount });
  const ready = await waitText(page, 'Kế hoạch điều động tổng hợp', 20000) || await waitText(page, 'Đối soát', 15000);
  await sleep(2500);
  const boardText = await bodyText(page);
  await page.screenshot({ path: 'qa/2026-10-16_fullguide_b5_board.png', fullPage: true });

  // B.5 structural assertions
  const hasPhaiThu = /PHẢI THU|Phải thu/.test(boardText);
  const hasPhaiTra = /PHẢI TRẢ|Phải trả/.test(boardText);
  const hasTienThu = /Tiền thu tự động|Cước thu auto/i.test(boardText);
  const btnXacNhan = await page.evaluate(() => [...document.querySelectorAll('button')].some(b => /xác nhận đối soát/i.test(b.textContent || '')));
  const btnDebit = await page.evaluate(() => [...document.querySelectorAll('button')].some(b => /chọn debit/i.test(b.textContent || '')));
  const btnDoiSoat = await page.evaluate(() => [...document.querySelectorAll('button')].some(b => /^đối soát$/i.test((b.textContent || '').trim())));
  const btnHoanTac = await page.evaluate(() => [...document.querySelectorAll('button')].some(b => /hoàn tác/i.test(b.textContent || '')));
  const hasSearch = await page.evaluate(() => Boolean([...document.querySelectorAll('input')].find(i => /tìm|search/i.test(i.placeholder || '') || /mã lô|bill|khách/i.test(i.placeholder || ''))));
  const hasDateFilters = await page.evaluate(() => document.querySelectorAll('input[type="date"]').length >= 2);
  const hasKhachHangSelect = /Khách hàng/.test(boardText);
  const hasNhaXeSelect = /Nhà xe/.test(boardText);
  step('b5-structure', { ready, hasPhaiThu, hasPhaiTra, hasTienThu, btnXacNhan, btnDebit, btnDoiSoat, btnHoanTac, hasSearch, hasDateFilters, hasKhachHangSelect, hasNhaXeSelect });
  record('B.5', ready && hasPhaiThu && hasPhaiTra && btnDebit ? 'PASS' : 'FAIL',
    `board structure: PHẢI THU=${hasPhaiThu}, PHẢI TRẢ=${hasPhaiTra}, Tiền thu=${hasTienThu}, buttons(Đối soát=${btnDoiSoat}, Hoàn tác=${btnHoanTac}, Xác nhận=${btnXacNhan}, Chọn Debit=${btnDebit}), filters(search=${hasSearch}, dates=${hasDateFilters})`);

  // A.5 — select a PICKABLE row (adjustment status NONE/CONFIRMED) then open "Chọn Debit (N dòng)"
  const selected = await page.evaluate(() => {
    const pickable = [...document.querySelectorAll('tr.debit-row--pickable')].filter(r => r.offsetParent !== null);
    if (pickable.length) { pickable[0].click(); return 'pickable-row'; }
    const boxes = [...document.querySelectorAll('tbody input[type="checkbox"], tr input[type="checkbox"]')].filter(b => b.offsetParent !== null && !b.disabled);
    if (boxes.length) { boxes[0].click(); return 'checkbox'; }
    const rows = [...document.querySelectorAll('tbody tr')].filter(r => r.offsetParent !== null);
    if (rows.length) { rows[0].click(); return 'rowclick'; }
    return null;
  });
  await sleep(1500);
  const debitBtnText = await page.evaluate(() => [...document.querySelectorAll('button')].map(b => (b.textContent || '').trim()).find(t => /chọn debit/i.test(t)) ?? null);
  const opened = await tap(page, `() => [...document.querySelectorAll('button')].find(b => /chọn debit/i.test(b.textContent || '') && !b.disabled)`);  await sleep(1800);
  const dlg = await page.evaluate(() => {
    const d = [...document.querySelectorAll('[role=dialog], [class*="modal"]')].filter(m => m.offsetParent !== null).pop();
    return d ? {
      text: (d.innerText || '').replace(/\s+/g, ' ').slice(0, 700),
      fields: [...d.querySelectorAll('input, select, textarea')].map(i => i.getAttribute('aria-label') || i.name || i.placeholder || i.type).slice(0, 20),
    } : null;
  });
  await page.screenshot({ path: 'qa/2026-10-16_fullguide_a5_debit-dialog.png', fullPage: true });
  step('a5-dialog', { selected, opened, debitBtnText, dlg });
  const wantFields = ['Từ ngày', 'Đến ngày', 'Chiều đối soát', 'VAT', 'Ghi chú', 'Chốt đợt'];
  const dlgAll = (dlg?.text ?? '') + ' ' + (dlg?.fields ?? []).join(' ');
  const fieldsOk = wantFields.every(f => dlgAll.includes(f));
  record('A.5', opened && dlg && /chốt đợt đối soát|chọn debit/i.test(dlg.text) && fieldsOk ? 'PASS' : 'FAIL',
    `Chọn Debit dialog: opened=${opened}, btn="${debitBtnText}", fieldsOk=${fieldsOk}, text=${(dlg?.text ?? '').slice(0, 200)}`);
} catch (e) {
  step('driver-b-error', { error: String(e.message ?? e) });
  await page.screenshot({ path: 'qa/2026-10-16_fullguide_b_error.png', fullPage: true }).catch(() => {});
  record('A.5', 'FAIL', String(e.message ?? e));
  record('B.5', 'FAIL', String(e.message ?? e));
} finally { await browser.close(); }

writeFileSync('qa/2026-10-16_fullguide_b-results.json', JSON.stringify({ pin: PIN, date: new Date().toISOString(), results }, null, 2));
step('SUMMARY', results);
