// FB-096 (card 141026230730) — "Thêm cược" rename + bill suggestion flow.
// Rung 3: real click on Thêm cược → suggestion autofill → save → row persisted.
import {
  openAs, goto, shot, assertEval, clickButtonByText,
  api, finish,
} from './w1-lib.mjs';

const CARD = 'fb096';
const results = {};
const page = await openAs('hoapt');

// ── 0. Fixture source: an existing real bill to derive the 4-digit lookup ──
// Deposits hold almost no rows; the CUS bill book lives on shipments
// (blNumber/bookingRef). Skip refs that look like other lanes' QA fixtures.
let realBill = null;
for (let page_ = 1; page_ <= 8 && !realBill; page_++) {
  const res = await api({ user: 'hoapt', path: `/api/shipments?page=${page_}&limit=50` });
  const rows = res.json?.items ?? [];
  if (!rows.length) break;
  for (const row of rows) {
    const ref = [row.blNumber, row.bookingRef].find((v) => typeof v === 'string' && /\d{4}/.test(v) && !/qa/i.test(v));
    if (ref) { realBill = ref; break; }
  }
}
results.lookupDigits = realBill ? realBill.replace(/\D/g, '').slice(-4) : null;
if (!results.lookupDigits || results.lookupDigits.length !== 4) {
  results.ABORT = `no real bill to derive lookup digits from (list status ${depositsList.status})`;
  await finish(CARD, results);
  process.exit(1);
}

// ── 1. Page + button labels (FB-096 rename) ──
await goto(page, '/accounting/dehot-tracker').catch(async () => { /* typo guard */ });
await goto(page, '/accounting/deposit-tracker');
await shot(page, `${CARD}_01-tracker.png`);
results.buttonThemCuoc = await assertEval(page, 'button "Thêm cược"', () => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Thêm cược');
  return !!btn;
});
results.oldLabelThemDongGone = await assertEval(page, 'old "Thêm dòng" label absent', () =>
  !document.body.innerText.includes('Thêm dòng'));

// ── 2. Open modal + bill suggestion lookup ──
await clickButtonByText(page, 'Thêm cược', { exact: true });
await page.waitForSelector('[role="dialog"]', { timeout: 8000 }).catch(() => {});
results.dialogTitle = await assertEval(page, 'dialog title', () =>
  document.querySelector('[role="dialog"]')?.querySelector('h2, [class*="title"]')?.textContent?.trim() ?? null);
const lookupSel = 'input[placeholder="4 số cuối"]';
await page.waitForSelector(lookupSel, { timeout: 8000 }).catch(() => {});
await page.click(lookupSel);
await page.type(lookupSel, results.lookupDigits, { delay: 60 });
await new Promise((r) => setTimeout(r, 1800));
await shot(page, `${CARD}_02-suggestions.png`);
results.suggestionItems = await assertEval(page, 'suggestion items', () =>
  [...document.querySelectorAll('.bill-suggestions__item')].map((li) => li.textContent?.trim().slice(0, 120)));
results.suggestionsShown = Array.isArray(results.suggestionItems) && results.suggestionItems.length > 0;

// ── 3. Pick suggestion → autofill → QA-namespace → save ──
if (results.suggestionsShown) {
  await page.click('.bill-suggestions__item');
  await new Promise((r) => setTimeout(r, 900));
  results.autofill = await assertEval(page, 'autofill values', () => {
    const out = {};
    for (const group of document.querySelectorAll('[role="dialog"] .field')) {
      const label = group.querySelector('label')?.textContent?.trim();
      const input = group.querySelector('input');
      if (label && input) out[label] = input.value;
    }
    return out;
  });
  results.autofillBillFilled = typeof results.autofill === 'object' && (results.autofill['Số Bill'] ?? '').length > 0;
  results.autofillCustomerFilled = typeof results.autofill === 'object' && (results.autofill['Khách hàng'] ?? '').length > 0;

  // QA-namespace Số Bill + Ghi chú so the sanctioned purge matches the row
  // (registry: deposit_refund_trackers bill_number/note ILIKE 'QA%').
  const setByLabel = async (labelText, value) => {
    const ok = await page.evaluate((lt, v) => {
      // FormGroup renders .field; other fields (NumberField…) only render a
      // <label> — associate by htmlFor or by the nearest ancestor holding an
      // input.
      for (const label of document.querySelectorAll('[role="dialog"] label')) {
        if (label.textContent?.trim() !== lt) continue;
        let input = null;
        if (label.htmlFor) input = document.getElementById(label.htmlFor);
        if (!input) {
          let ancestor = label.parentElement;
          for (let hop = 0; hop < 3 && ancestor && !input; hop++) {
            input = ancestor.querySelector('input');
            ancestor = ancestor.parentElement;
          }
        }
        if (!input) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, v);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    }, labelText, value);
    if (!ok) throw new Error(`label input not found: ${labelText}`);
    await new Promise((r) => setTimeout(r, 250));
  };
  await setByLabel('Số Bill', `QA-W1-DEP-${results.lookupDigits}`);
  await setByLabel('Ghi chú', 'QA-W1 fixture 16/10 — xóa theo purge QA');
  await setByLabel('Số tiền cược (₫)', '5000000');
  await shot(page, `${CARD}_03-filled.png`);

  await clickButtonByText(page, 'Lưu dòng', { exact: true });
  await new Promise((r) => setTimeout(r, 2200));
  results.dialogClosedAfterSave = await assertEval(page, 'dialog closed', () =>
    !document.querySelector('[role="dialog"]'));
  results.dialogErrorAfterSave = await assertEval(page, 'dialog error text after save', () =>
    document.querySelector('[role="dialog"] [role="alert"]')?.textContent?.trim()
      ?? document.querySelector('[role="dialog"]')?.innerText?.match(/(?:lỗi|không|thất bại|yêu cầu)[^\n]*/i)?.[0]
      ?? (document.querySelector('[role="dialog"]') ? 'dialog still open, no alert' : null));
  await shot(page, `${CARD}_04-after-save.png`);
  results.rowVisibleInTable = await assertEval(page, 'row visible in table', () =>
    document.body.innerText.includes('QA-W1-DEP-6159'));
}

// ── 4. Persisted-state proof via API read ──
const after = await api({ user: 'hoapt', path: '/api/accounting/deposits' });
const created = after.json?.items?.filter((row) => (row.billNumber ?? '').startsWith('QA-W1-DEP')) ?? [];
results.createdFixtureRows = created.map((row) => ({ id: row.id, billNumber: row.billNumber, note: row.note }));
results.persistedViaApi = created.length > 0;

await finish(CARD, results);
