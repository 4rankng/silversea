// Full-guide Driver F — B.4 (Kế toán thêm khoản chi trên lô hàng):
//   hoapt opens a shipment detail → the shared "Thêm khoản chi" drawer
//   (Nhóm chi phí Chi phí lô hàng / Tiền đường, Loại chi phí, Thực chi,
//   Thực thu, Tên khoản chi, Ngày chi, Bên thực chi, Loại chứng từ) →
//   "Lưu khoản chi" → row persists → a SECOND continuous add → cleanup.
//   Uses the same lot as Driver E (containers + already dispatched).
import {
  BASE, PIN, sleep, uuid, makeLogger, healthGate, login, api, psql, boot, tap, setInput, waitText, bodyText,
} from './fullguide-lib.mjs';
import { writeFileSync } from 'node:fs';

const logger = makeLogger('f-ketoan-chi');
const { step } = logger;
const results = {};
const record = (id, verdict, note) => { results[id] = { verdict, note }; step('VERDICT', { id, verdict, note }); };

await healthGate(logger);
const acct = await login('hoapt');
const ops = await login('hoangnh');
if (!acct.token || !ops.token) throw new Error('logins failed');

// Discover a container-bearing lot via the DISPATCHER orders surface (the
// ACCOUNTANT shipments list has no containerCount field), then drive as hoapt.
const vnDate = (offset = 0) => new Date(Date.now() + 7 * 3600 * 1000 + offset * 86400 * 1000).toISOString().slice(0, 10);
let target = null;
for (let offset = 0; offset >= -6 && !target; offset--) {
  const res = await api(ops.token, 'GET', `/ops/orders?date=${vnDate(offset)}`);
  const items = res.json?.items ?? [];
  const withCont = items.filter(i => i.containerCount > 0 && i.containerIds?.length > 0);
  if (withCont.length) target = { id: withCont[0].shipmentId ?? withCont[0].id, code: withCont[0].billRef ?? withCont[0].code, conts: withCont[0].containerNumbers };
}
step('f-target', target);
if (!target) throw new Error('no container-bearing shipment visible');

const createdIds = [];
const { browser, page } = await boot({ token: acct.token });
try {
  await page.goto(`${BASE}/shipments/${target.id}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(4500);
  const ready = await waitText(page, 'chi phí', 20000);
  await sleep(2000);
  await page.screenshot({ path: 'qa/2026-10-16_fullguide_b4_lot-detail.png', fullPage: true });

  // open the shared "Thêm khoản chi" drawer ("Khai chi phí" / "+ Thêm khoản chi")
  const opened = await tap(page, `() => [...document.querySelectorAll('button')].find(b => /khai chi phí|thêm khoản chi|thêm dòng/i.test(b.textContent || '') && !b.disabled)`);
  await sleep(2500);
  const drawerEl = `() => document.querySelector('.expense-accounting-drawer')`;
  const drawerText = await page.evaluate(() => document.querySelector('.expense-accounting-drawer')?.innerText?.replace(/\s+/g, ' ').slice(0, 500) ?? null);
  step('f-drawer-open', { opened, drawerText });
  await page.screenshot({ path: 'qa/2026-10-16_fullguide_b4_drawer.png', fullPage: true });

  const fields = await page.evaluate(() => {
    const d = document.querySelector('.expense-accounting-drawer');
    if (!d) return null;
    const text = d.innerText || '';
    return {
      hasNhomChiPhi: /nhóm chi phí/i.test(text),
      hasLoaiChiPhi: /loại chi phí lái xe/i.test(text),
      hasThucChi: /thực chi/i.test(text),
      hasThucThu: /thực thu — thu khách/i.test(text),
      hasEqual: /nhập thu và trả bằng nhau/i.test(text),
      hasTenKhoanChi: /tên khoản chi/i.test(text),
      hasNgayChi: /ngày chi/i.test(text),
      hasBenThucChi: /bên thực chi/i.test(text),
      has3Ben: /công ty trả trực tiếp/i.test(text) && /nhân viên chi/i.test(text) && /nhà cung cấp/i.test(text),
      hasEvidence: /hóa đơn|phiếu thu/i.test(text),
      inputs: d.querySelectorAll('input').length,
    };
  });
  step('f-drawer-fields', fields);

  // drawer-scoped combobox picker (UUI select = combobox input by aria-labelledby)
  const pickDrawerSelect = async (labelRe, fragment, wantContains) => {
    const clicked = await tap(page, `() => {
      const d = document.querySelector('.expense-accounting-drawer');
      const re = new RegExp(${JSON.stringify(labelRe)}, 'i');
      return [...(d ?? document).querySelectorAll('input')].find(i => {
        const labelled = (i.getAttribute('aria-labelledby') ?? '').split(/\\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ');
        return re.test(labelled) || re.test(i.getAttribute('aria-label') ?? '');
      }) ?? null;
    }`);
    if (!clicked) return false;
    await sleep(600);
    if (fragment) { await page.keyboard.type(fragment, { delay: 40 }); await sleep(900); }
    else await sleep(900);
    const wantSrc = wantContains ?? fragment ?? '';
    const picked = await tap(page, `() => {
      const options = [...document.querySelectorAll('[role="option"]')].filter(o => o.offsetParent !== null);
      if (!options.length) return null;
      return options.find(o => ((o.textContent || '').trim().toLowerCase()).includes(${JSON.stringify(wantSrc)}.toLowerCase())) ?? options[0];
    }`);
    await sleep(700);
    return picked;
  };

  // Nhóm chi phí stays "Chi phí lô hàng" (default) — assert by picking explicitly
  const groupOk = await pickDrawerSelect('nhóm chi phí', '', 'chi phí lô hàng');
  // Loại chi phí lái xe — first real option
  const typeOk = await pickDrawerSelect('loại chi phí lái xe', '', '');
  // Thực chi (NumberField) + Tên khoản chi (TextField) — labeled inputs
  const fillLabeled = async (labelRe, value) => page.evaluate((labelReSrc, valueSrc) => {
    const re = new RegExp(labelReSrc, 'i');
    const d = document.querySelector('.expense-accounting-drawer');
    const input = [...(d ?? document).querySelectorAll('input')].find(i => {
      const labelled = (i.getAttribute('aria-labelledby') ?? '').split(/\\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ');
      return re.test(labelled) || re.test(i.getAttribute('aria-label') ?? '');
    });
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, String(valueSrc));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }, labelRe, value);
  // position-based fills (design-system Number/Text fields carry no accessible name)
  const setByNative = async (predicateSource, value) => page.evaluate(`(() => {
    const el = (${predicateSource});
    if (!el) return false;
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(String(value))});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  // Thực chi = first number input; Tên khoản chi = the input whose ancestor block labels it
  const moneySet = await setByNative(`document.querySelectorAll('.expense-accounting-drawer input[type="number"]')[0] ?? null`, 50000);
  const NAME_PRED = `(() => {
    const inputs = [...document.querySelectorAll('.expense-accounting-drawer input')];
    return inputs.find(i => {
      let n = i;
      for (let k = 0; k < 5 && n; k++) {
        n = n.parentElement;
        if (n?.textContent && /Tên khoản chi/.test(n.textContent) && n.querySelectorAll('input').length === 1 && n.querySelector('input') === i) return true;
      }
      return false;
    }) ?? null;
  })()`;
  const nameSet = await setByNative(NAME_PRED, 'QA fullguide B.4 — tự xóa');
  // "Nhập Thu và Trả bằng nhau" → charge mirrors amount
  const balanced = await page.evaluate(() => {
    const d = document.querySelector('.expense-accounting-drawer');
    const box = [...(d ?? document).querySelectorAll('input[type="checkbox"]')].find(c => /bằng nhau/i.test(c.closest('label, div, fieldset')?.textContent || ''));
    if (box) { box.click(); return 'checkbox'; }
    return null;
  });
  await sleep(500);
  step('f-filled', { groupOk, typeOk, moneySet, nameSet, balanced });
  await page.screenshot({ path: 'qa/2026-10-16_fullguide_b4_filled.png', fullPage: true });

  // "Lưu 1 khoản chi" — drawer STAYS OPEN (continuous entry, TC-COSTUX-04)
  const saved = await tap(page, `() => { const d = document.querySelector('.expense-accounting-drawer'); return [...(d ?? document).querySelectorAll('button')].find(b => /lưu \\d+ khoản chi/i.test(b.textContent || '') && !b.disabled); }`);
  await sleep(3000);
  const savedMsg = await page.evaluate(() => document.querySelector('.expense-accounting-drawer')?.innerText?.includes('Đã lưu khoản chi') ?? false);
  const stillOpen = await page.evaluate(() => Boolean(document.querySelector('.expense-accounting-drawer')));
  step('f-save1', { saved, savedMsg, stillOpen });

  // second continuous add — the fresh draft resets the type, so re-pick it, then name + amount
  await pickDrawerSelect('loại chi phí lái xe', '', '');
  await setByNative(NAME_PRED, 'QA fullguide B.4 thứ hai — tự xóa');
  await setByNative(`document.querySelectorAll('.expense-accounting-drawer input[type="number"]')[0] ?? null`, 50000);
  // the fresh draft also resets "Nhập Thu và Trả bằng nhau" — re-tick so Thực thu mirrors Thực chi
  await page.evaluate(() => {
    const d = document.querySelector('.expense-accounting-drawer');
    const box = [...(d ?? document).querySelectorAll('input[type="checkbox"]')].find(c => /bằng nhau/i.test(c.closest('label, div, fieldset')?.textContent || ''));
    if (box && !box.checked) box.click();
  });
  await sleep(400);
  const saved2 = await tap(page, `() => { const d = document.querySelector('.expense-accounting-drawer'); return [...(d ?? document).querySelectorAll('button')].find(b => /lưu \\d+ khoản chi/i.test(b.textContent || '') && !b.disabled); }`);
  await sleep(3000);
  const err2 = await page.evaluate(() => document.querySelector('.expense-accounting-drawer [role="alert"], .expense-accounting-drawer .expense-accounting-error')?.textContent?.trim() ?? null);
  const vals2 = await page.evaluate(() => [...document.querySelectorAll('.expense-accounting-drawer input')].map(i => (i.value || '').slice(0, 30)));
  await page.screenshot({ path: 'qa/2026-10-16_fullguide_b4_after-save2.png', fullPage: true });
  step('f-save2', { saved2, err2, vals2 });

  // DB side-effect: the QA rows land in ops_expense_entries (COMPANY payer) or
  // driver_incidental_costs (driver payer) — probe both by fee_name.
  const dbRows = psql(`(SELECT 'OPS' AS kind, e.id, e.fee_name, e.amount FROM ops_expense_entries e WHERE e.shipment_id=${target.id} AND e.fee_name LIKE 'QA fullguide B.4%' AND e.approval_status <> 'VOIDED') UNION ALL (SELECT 'DRIVER' AS kind, d.id, d.fee_name, d.amount FROM driver_incidental_costs d JOIN trips t ON t.id = d.trip_id WHERE t.shipment_id=${target.id} AND d.fee_name LIKE 'QA fullguide B.4%') ORDER BY kind DESC`);
  step('f-db', { dbRows });
  const twoRows = dbRows.split('\n').filter(Boolean).length >= 2;
  record('B.4', fields && fields.hasNhomChiPhi && fields.hasLoaiChiPhi && fields.has3Ben && saved && savedMsg && moneySet && nameSet && twoRows ? 'PASS' : 'FAIL',
    `Thêm khoản chi drawer: fields=${JSON.stringify(fields)}, fill(type=${typeOk}, money=${moneySet}, name=${nameSet}, balanced=${balanced}), save1=${saved}(msg=${savedMsg}, drawer stays open=${stillOpen}), save2=${saved2}, DB rows: ${dbRows.replace(/\n/g, '; ')}`);

  for (const line of dbRows.split('\n').filter(Boolean)) {
    const [kind, id] = line.split('|');
    createdIds.push({ kind, id: Number(id) });
  }
} catch (e) {
  step('driver-f-error', { error: String(e.message ?? e) });
  await page.screenshot({ path: 'qa/2026-10-16_fullguide_f_error.png', fullPage: true }).catch(() => {});
  record('B.4', 'FAIL', String(e.message ?? e));
} finally { await browser.close(); }

// cleanup — void the QA rows through the governed phoi-phieu row-void (by source)
for (const { kind, id } of createdIds) {
  const src = psql(`SELECT id FROM expense_accounting_sources WHERE source_kind='${kind === 'OPS' ? 'OPS' : 'DRIVER'}' AND source_id=${id} ORDER BY id DESC LIMIT 1`);
  if (!src) { step('f-cleanup-miss', { kind, id }); continue; }
  const d = await api(acct.token, 'DELETE', `/expense-accounting/phoi-phieu/${psql(`SELECT trip_id FROM expense_accounting_sources WHERE id=${src}`) || psql(`SELECT t.id FROM trips t WHERE t.shipment_id=${target.id} ORDER BY t.id DESC LIMIT 1`)}/rows/${src}`, { reason: 'QA cleanup fullguide B.4' });
  step('f-cleanup', { kind, id, sourceId: src, status: d.status, body: d.text?.slice(0, 80) });
}
const dbAfter = psql(`SELECT count(*) FROM trip_expenses te JOIN trips t ON t.id = te.trip_id WHERE t.shipment_id=${target?.id ?? 0} AND te.fee_name LIKE 'QA fullguide B.4%' AND te.deleted_at IS NULL`);
step('f-cleanup-db', { remaining: dbAfter });

writeFileSync('qa/2026-10-16_fullguide_f-results.json', JSON.stringify({ pin: PIN, date: new Date().toISOString(), results }, null, 2));
step('SUMMARY', results);
