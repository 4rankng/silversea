// Full-guide Driver H — B.3 (Kế toán: Theo dõi hoàn cược — Thêm cược).
// Per the doc: /accounting/deposit-tracker → "Thêm dòng"/"Thêm cược" → dialog
// "Thêm dòng theo dõi hoàn cược": 4-digit Bill lookup → suggestion → Số Bill/
// Khách hàng/Hãng tàu autofill → Số tiền cược, Ngày cược, Ngày dự kiến hoàn,
// Trạng thái → "Lưu dòng" (enabled only when required fields filled).
// Fixture cleaned after (governed delete of the QA row).
import {
  BASE, PIN, sleep, uuid, makeLogger, healthGate, login, api, psql, boot, tap, waitText, bodyText,
} from './fullguide-lib.mjs';
import { writeFileSync } from 'node:fs';

const logger = makeLogger('h-deposit');
const { step } = logger;
const results = {};
const record = (id, verdict, note) => { results[id] = { verdict, note }; step('VERDICT', { id, verdict, note }); };

await healthGate(logger);
const acct = await login('hoapt');
if (!acct.token) throw new Error('hoapt login failed');

// A real bill to look up (4 last digits) — reuse a live shipment's booking/bl.
// Find a bill the suggestion API actually returns (needs carrier/customer
// data on the lot) — try candidate last-4 groups until one hits.
let billRef = null;
let last4 = null;
const candRefs = psql("SELECT DISTINCT coalesce(nullif(bl_number,''), booking_ref) AS ref FROM shipments WHERE deleted_at IS NULL AND coalesce(nullif(bl_number,''), booking_ref) ~ '[0-9]{4,}' AND coalesce(nullif(bl_number,''), booking_ref) !~* '^QA' ORDER BY 1 DESC LIMIT 12").split('\n').filter(Boolean);
for (const ref of candRefs) {
  const d4 = (ref.match(/\d/g) ?? []).join('').slice(-4);
  if (d4.length !== 4) continue;
  const probe = await api(acct.token, 'GET', `/accounting/deposits/bill-suggestions?q=${d4}`);
  const items = probe.json?.items ?? [];
  if (items.length) { billRef = items[0].billDisplay ?? ref; last4 = d4; break; }
}
step('h-bill', { billRef, last4 });

const { browser, page } = await boot({ token: acct.token });
let rowId = null;
try {
  await page.goto(`${BASE}/accounting/deposit-tracker`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(4500);
  const ready = await waitText(page, 'hoàn cược', 20000) || await waitText(page, 'Thêm', 10000);
  await sleep(2000);
  await page.screenshot({ path: 'qa/2026-10-16_fullguide_b3_board.png', fullPage: true });

  // open the add dialog (label is "Thêm cược" per FB-096; older "Thêm dòng")
  const opened = await tap(page, `() => [...document.querySelectorAll('button')].find(b => /thêm cược|thêm dòng/i.test(b.textContent || '') && !b.disabled)`);
  await sleep(2000);
  const dlgText = await page.evaluate(() => {
    const dlgs = [...document.querySelectorAll('[role=dialog], [class*="modal"]')].filter(m => m.offsetParent !== null);
    const dlg = dlgs[dlgs.length - 1];
    return dlg ? (dlg.innerText || '').replace(/\s+/g, ' ').slice(0, 400) : null;
  });
  step('h-dialog-open', { ready, opened, dlgText });
  await page.screenshot({ path: 'qa/2026-10-16_fullguide_b3_dialog.png', fullPage: true });

  // Tra cứu Bill — the FB-096 pattern: input[placeholder="4 số cuối"], suggestions .bill-suggestions__item
  await page.waitForSelector('input[placeholder="4 số cuối"]', { timeout: 8000 }).catch(() => {});
  await page.click('input[placeholder="4 số cuối"]');
  await page.type('input[placeholder="4 số cuối"]', String(last4), { delay: 60 });
  await sleep(1800);
  await page.screenshot({ path: 'qa/2026-10-16_fullguide_b3_suggestions.png', fullPage: true });
  const suggestionTexts = await page.evaluate(() => [...document.querySelectorAll('.bill-suggestions__item')].map(li => (li.textContent || '').trim().slice(0, 120)));
  const suggestion = await tap(page, `() => [...document.querySelectorAll('.bill-suggestions__item')][0] ?? null`);
  await sleep(1800);
  const autofilled = await page.evaluate(() => {
    const out = {};
    for (const group of document.querySelectorAll('[role="dialog"] .field')) {
      const label = group.querySelector('label')?.textContent?.trim();
      const input = group.querySelector('input');
      if (label && input) out[label] = (input.value || '').slice(0, 30);
    }
    return out;
  });
  step('h-lookup', { last4, suggestionTexts, suggestion: Boolean(suggestion), autofilled });

  // Số tiền cược + QA note via label→htmlFor association
  const setByLabel = async (labelText, value) => page.evaluate((lt, v) => {
    for (const label of document.querySelectorAll('[role="dialog"] label')) {
      if (!label.textContent?.trim().startsWith(lt)) continue;
      let input = label.htmlFor ? document.getElementById(label.htmlFor) : null;
      if (!input) input = label.closest('div, fieldset')?.querySelector('input, textarea') ?? null;
      if (!input) continue;
      const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(input, v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  }, labelText, value);
  const moneySet = await setByLabel('Số tiền cược', '500000');
  const billSet = await setByLabel('Số Bill', `QA-${billRef}`);
  const noteSet = await setByLabel('Ghi chú', 'QA fullguide B.3 — tự xóa sau kiểm tra');
  await sleep(700);
  await page.screenshot({ path: 'qa/2026-10-16_fullguide_b3_filled.png', fullPage: true });

  // Lưu dòng
  const saved = await tap(page, `() => { const dlgs = [...document.querySelectorAll('[role=dialog], [class*="modal"]')].filter(m => m.offsetParent !== null); const dlg = dlgs[dlgs.length - 1]; return dlg ? [...dlg.querySelectorAll('button')].find(b => /lưu dòng/i.test(b.textContent || '') && !b.disabled) : null; }`);
  await sleep(3000);
  const after = await bodyText(page);
  const visible = /500\.000|500000/.test(after);
  await page.screenshot({ path: 'qa/2026-10-16_fullguide_b3_after-save.png', fullPage: true });
  step('h-save', { moneySet, billSet, noteSet, saved, visible });

  // persisted side effect
  const dep = await api(acct.token, 'GET', '/accounting/deposits?limit=100');
  const qaRow = (dep.json?.items ?? dep.json ?? []).find(r => (r.note ?? '').includes('QA fullguide B.3'));
  rowId = qaRow?.id ?? null;
  step('h-side-effect', { rowId, row: qaRow ? { id: qaRow.id, bill: qaRow.billNumber ?? qaRow.bill, amount: qaRow.amount } : null });
  record('B.3', saved && (visible || qaRow) ? 'PASS' : 'FAIL',
    `Thêm cược: dialog opened=${Boolean(dlgText)}, lookup 4 số cuối (${last4}) suggestion=${Boolean(suggestion)}, autofill fields=${autofilled?.filled}, save=${saved}, persisted row id=${rowId}`);
} catch (e) {
  step('driver-h-error', { error: String(e.message ?? e) });
  await page.screenshot({ path: 'qa/2026-10-16_fullguide_h_error.png', fullPage: true }).catch(() => {});
  record('B.3', 'FAIL', String(e.message ?? e));
} finally { await browser.close(); }

// cleanup — governed delete of the QA deposit row
if (rowId != null) {
  const d = await api(acct.token, 'DELETE', `/accounting/deposits/${rowId}`, { reason: 'QA cleanup fullguide B.3' });
  step('h-cleanup', { rowId, status: d.status, body: d.text?.slice(0, 80) });
}
writeFileSync('qa/2026-10-16_fullguide_h-results.json', JSON.stringify({ pin: PIN, date: new Date().toISOString(), results }, null, 2));
step('SUMMARY', results);
