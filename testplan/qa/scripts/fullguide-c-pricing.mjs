// Full-guide Driver C — A.6 (Bảng giá tiền & loại xe, role admin):
//   1. Vehicle-class options complete: 1,25/2,5/3,5/5/8/10/15 tấn + 20'/40'.
//   2. Add a price row WITH Loại xe (phiếu 161026095800 regression).
//   3. Delete → re-add the same selector trio (phiếu 161026121500 regression).
//   4. Cleanup: delete the QA row again; DB proof of tombstones.
import {
  BASE, PIN, sleep, uuid, makeLogger, healthGate, login, api, psql, boot, tap, setInput, waitText, waitCount, bodyText,
} from './fullguide-lib.mjs';
import { writeFileSync } from 'node:fs';

const logger = makeLogger('c-pricing');
const { step } = logger;
const results = {};
const record = (id, verdict, note) => { results[id] = { verdict, note }; step('VERDICT', { id, verdict, note }); };

await healthGate(logger);
const admin = await login('admin');
if (!admin.token) throw new Error('admin login failed');

// catalog completeness (API read + UI options later)
const classes = await api(admin.token, 'GET', '/vehicle-size-classes?limit=50');
const classList = classes.json?.items ?? classes.json ?? [];
const names = classList.map(c => `${c.name} (${c.code})`);
const wantTons = ['1.25', '2.5', '3.5', '5', '8', '10', '15'].map(t => new RegExp(`(^|\\D)${t.replace('.', '\\.')}\\s*tấn`, 'i'));
const tonsOk = wantTons.every(re => names.some(n => re.test(n)));
const contOk = names.some(n => /20/i.test(n)) && names.some(n => /40/i.test(n));
step('c-classes', { names, tonsOk, contOk });

// catalog facts for the QA row
const customers = await api(admin.token, 'GET', '/customers?limit=50');
const customer = (customers.json?.items ?? customers.json ?? []).find(c => !c.deletedAt && c.name && c.name.length <= 40);
const routes = await api(admin.token, 'GET', '/routes?limit=50');
const route = (routes.json?.items ?? routes.json ?? []).find(r => !r.deletedAt);
const cls5t = classList.find(c => /(^|\D)5\s*tấn/i.test(c.name)) ?? classList.find(c => !c.deletedAt);
const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
step('c-facts', { customer: customer?.id, route: route?.id, cls5t: cls5t ? { id: cls5t.id, name: cls5t.name } : null });

const { browser, page } = await boot({ token: admin.token });
let pricingRowId = null;
try {
  await page.goto(`${BASE}/config/pricing-tables`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(4000);
  const ready = await waitText(page, 'Thêm mới', 15000);
  await page.screenshot({ path: 'qa/2026-10-16_fullguide_c_board.png', fullPage: true });

  // open "Thêm mới" (inline form row in the CrudTable)
  const opened = await tap(page, `() => [...document.querySelectorAll('button')].find(b => /thêm mới/i.test(b.textContent || '') && !b.disabled)`);
  await sleep(2000);
  // Loại xe picker options (completeness in the FORM) — open the combobox, read options
  await tap(page, `() => {
    return [...document.querySelectorAll('input')].filter(i => i.offsetParent !== null).find(i => {
      const labelled = (i.getAttribute('aria-labelledby') ?? '').split(/\\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ');
      return /loại xe/i.test(labelled) || /loại xe/i.test(i.getAttribute('aria-label') ?? '');
    }) ?? null;
  }`);
  await sleep(1400);
  const classPickerOpts = await page.evaluate(() => [...document.querySelectorAll('[role="option"]')].filter(o => o.offsetParent !== null).map(o => (o.textContent || '').trim()));
  await page.keyboard.press('Escape');
  await sleep(400);
  step('c-form-open', { opened, classPickerOpts });
  const pickerOk = classPickerOpts.length > 0 && ['1.25', '2.5', '3.5', '5', '8', '10', '15'].every(t => classPickerOpts.some(o => o.includes(t)))
    && classPickerOpts.some(o => /20/i.test(o)) && classPickerOpts.some(o => /40/i.test(o));

  // UUI selects on this page render as combobox INPUTs (accessible name via
  // aria-labelledby). Click, type a fragment, pick the matching [role=option].
  const pickUuiSelect = async (labelRe, fragment, wantContains) => {
    const clicked = await tap(page, `() => {
      const re = new RegExp(${JSON.stringify(labelRe)}, 'i');
      return [...document.querySelectorAll('input')].filter(i => i.offsetParent !== null).find(i => {
        const labelled = (i.getAttribute('aria-labelledby') ?? '').split(/\\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ');
        return re.test(labelled) || re.test(i.getAttribute('aria-label') ?? '');
      }) ?? null;
    }`);
    if (!clicked) return false;
    await sleep(600);
    await page.keyboard.type(fragment, { delay: 40 });
    await sleep(1100);
    const wantSrc = wantContains ?? fragment;
    const picked = await tap(page, `() => {
      const options = [...document.querySelectorAll('[role="option"]')].filter(o => o.offsetParent !== null);
      return options.find(o => ((o.textContent || '').trim().toLowerCase()).includes(${JSON.stringify(wantSrc)}.toLowerCase())) ?? options[0] ?? null;
    }`);
    await sleep(700);
    return picked;
  };

  const todayVN = today.split('-').reverse().join('/');
  const customerLabel = customer.shortName || customer.name;
  const routeLabel = route.shortName || route.name || route.code;
  const customerOk = await pickUuiSelect('khách hàng', customerLabel.slice(0, 6));
  const routeOk = await pickUuiSelect('tuyến đường', routeLabel.slice(0, 6));
  // Cước thu khách (đ) — number input placeholder "0"
  const moneySet = await page.evaluate(() => {
    const input = [...document.querySelectorAll('input[type="number"]')].find(i => /cước thu khách/i.test(i.closest('label, div, fieldset')?.textContent || '') || i.placeholder === '0');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, '777000');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  });
  const classOk = await pickUuiSelect('loại xe', cls5t.code, cls5t.code);
  // Hiệu lực từ — DD/MM/YYYY typed into the date field
  const dateSet = await page.evaluate((todayVnSrc) => {
    const field = [...document.querySelectorAll('label, div')].find(l => /^hiệu lực từ/i.test((l.textContent || '').trim()));
    const input = field?.querySelector('input');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, todayVnSrc);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, todayVN);
  step('c-form-filled', { customerOk, routeOk, moneySet, classOk, dateSet });
  await page.screenshot({ path: 'qa/2026-10-16_fullguide_c_form-filled.png', fullPage: true });

  const saved = await tap(page, `() => [...document.querySelectorAll('button')].find(b => /^thêm$/i.test((b.textContent || '').trim()) && !b.disabled)`);
  await sleep(3000);
  const afterSave = await bodyText(page);
  const addByClassOk = saved && /777\.000|777000/.test(afterSave) && !/chỉ được chọn một trục giá/i.test(afterSave);
  step('c-save-by-class', { saved, addByClassOk, snippet: afterSave.match(/[^\n]*777[^\n]*/)?.[0] ?? null });
  await page.screenshot({ path: 'qa/2026-10-16_fullguide_c_after-add.png', fullPage: true });
  record('A.6.add-by-class', addByClassOk ? 'PASS' : 'FAIL', `add price WITH Loại xe "${cls5t.name}": saved=${saved}, row visible=${/777/.test(afterSave)}, no axis error=${!/chỉ được chọn một trục giá/i.test(afterSave)}`);

  // find the QA row id via API for delete + DB proof
  const rows = await api(admin.token, 'GET', '/pricing-tables?limit=200');
  const qaRow = (rows.json?.items ?? rows.json ?? []).find(r => r.price === '777000' && !r.deletedAt && r.routeId === route.id && r.customerId === customer.id);
  pricingRowId = qaRow?.id ?? null;
  step('c-qa-row', { pricingRowId, qaRow });

  if (pricingRowId) {
    // delete via UI: the row's Xóa icon (aria-label="Xóa") + confirm dialog
    const uiDeleted = await page.evaluate(() => {
      const trs = [...document.querySelectorAll('tr')];
      const row = trs.find(r => (r.innerText || '').includes('777'));
      const btn = row ? [...row.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '').trim() === 'Xóa') : null;
      if (btn) { btn.click(); return true; }
      return false;
    }, pricingRowId);
    await sleep(1500);
    // confirm dialog (confirmLabel 'Xóa')
    await tap(page, `() => { const dlg = [...document.querySelectorAll('[role=dialog], [class*="modal"]')].filter(m => m.offsetParent !== null).pop(); return dlg ? [...dlg.querySelectorAll('button')].find(b => /^xóa$/i.test((b.textContent || '').trim())) : null; }`);
    await sleep(2500);
    const gone = !(await bodyText(page)).includes('777.000');
    let deleted = uiDeleted && gone;
    if (!deleted) {
      const fresh = (await api(admin.token, 'GET', '/pricing-tables?limit=200')).json?.items ?? [];
      const cur = fresh.find(r => r.id === pricingRowId);
      if (cur && !cur.deletedAt) {
        const d = await api(admin.token, 'DELETE', `/pricing-tables/${pricingRowId}`, undefined, { 'If-Unmodified-Since': cur.updatedAt });
        deleted = d.ok;
        step('c-delete-api-fallback', { status: d.status, body: d.text?.slice(0, 100) });
      } else deleted = true;
    }
    step('c-delete', { uiDeleted, deleted });

    // re-add the SAME trio (161026121500)
    await tap(page, `() => [...document.querySelectorAll('button')].find(b => /thêm mới/i.test(b.textContent || '') && !b.disabled)`);
    await sleep(2000);
    await pickUuiSelect('khách hàng', customerLabel.slice(0, 6));
    await pickUuiSelect('tuyến đường', routeLabel.slice(0, 6));
    await page.evaluate(() => {
      const input = [...document.querySelectorAll('input[type="number"]')].find(i => /cước thu khách/i.test(i.closest('label, div, fieldset')?.textContent || '') || i.placeholder === '0');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '777000');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    });
    await pickUuiSelect('loại xe', cls5t.code, cls5t.code);
    await page.evaluate((todayVnSrc) => {
      const field = [...document.querySelectorAll('label, div')].find(l => /^hiệu lực từ/i.test((l.textContent || '').trim()));
      const input = field?.querySelector('input');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, todayVnSrc);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, todayVN);
    const resaved = await tap(page, `() => [...document.querySelectorAll('button')].find(b => /^thêm$/i.test((b.textContent || '').trim()) && !b.disabled)`);
    await sleep(3000);
    const afterRe = await bodyText(page);
    const reAddOk = resaved && !/đã tồn tại/i.test(afterRe) && /777/.test(afterRe);
    await page.screenshot({ path: 'qa/2026-10-16_fullguide_c_after-readd.png', fullPage: true });
    step('c-readd', { resaved, reAddOk, dupErr: /đã tồn tại/i.test(afterRe) });
    record('A.6.readd-after-delete', reAddOk ? 'PASS' : 'FAIL', `delete → re-add same trio: reAddOk=${reAddOk}, duplicate-error=${/đã tồn tại/i.test(afterRe)}`);

    record('A.6', (tonsOk && contOk && pickerOk && addByClassOk && reAddOk) ? 'PASS' : 'FAIL',
      `classes API tons=${tonsOk} cont=${contOk}, picker=${pickerOk}, add-by-class=${addByClassOk}, re-add=${reAddOk}`);

    // cleanup: tombstone the re-added row
    const fresh = (await api(admin.token, 'GET', '/pricing-tables?limit=200')).json?.items ?? [];
    const cur = fresh.find(r => r.price === '777000' && !r.deletedAt && r.routeId === route.id && r.customerId === customer.id);
    if (cur) {
      const d = await api(admin.token, 'DELETE', `/pricing-tables/${cur.id}`, undefined, { 'If-Unmodified-Since': cur.updatedAt });
      step('c-cleanup', { id: cur.id, status: d.status });
    }
    const dbProof = psql(`SELECT count(*) FROM pricing_tables WHERE customer_id=${customer.id} AND route_id=${route.id} AND price='777000' AND deleted_at IS NULL`);
    step('c-db', { liveQaRows: dbProof });
  } else {
    record('A.6', 'FAIL', 'QA pricing row was not created — cannot test delete/re-add');
  }
} catch (e) {
  step('driver-c-error', { error: String(e.message ?? e) });
  await page.screenshot({ path: 'qa/2026-10-16_fullguide_c_error.png', fullPage: true }).catch(() => {});
  record('A.6', 'FAIL', String(e.message ?? e));
} finally { await browser.close(); }

writeFileSync('qa/2026-10-16_fullguide_c-results.json', JSON.stringify({ pin: PIN, date: new Date().toISOString(), results }, null, 2));
step('SUMMARY', results);
