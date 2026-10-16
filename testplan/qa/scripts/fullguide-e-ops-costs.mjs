// Full-guide Driver E — B.2 + B.3 (Vận hành khai chi phí lô hàng + cảnh báo trùng):
//   B.2: OPS hoangnh opens a lot's "Khai chi phí" on /ops/orders, fills a
//        container cost, saves — no permission refusal, row persists, then void.
//   B.3: second OPS duongtt opens the SAME lot+cont → per-cont heads-up
//        "Cont … đã có … nhập trước — bạn vẫn tiếp tục nhập chứ." + submitting
//        the SAME type bounces with the 409 confirm panel "đã được … nhập trước
//        đó — bạn vẫn tiếp tục nhập chứ?" → "Tiếp tục lưu" saves it (explicit
//        confirm, never a silent block). Both rows voided at cleanup.
import {
  BASE, API, PIN, sleep, uuid, makeLogger, healthGate, login, api, boot, tap, waitText, waitCount, bodyText,
} from './fullguide-lib.mjs';
import { writeFileSync } from 'node:fs';

const logger = makeLogger('e-ops-costs');
const { step } = logger;
const results = {};
const record = (id, verdict, note) => { results[id] = { verdict, note }; step('VERDICT', { id, verdict, note }); };

await healthGate(logger);
const ops1 = await login('hoangnh');
const ops2 = await login('duongtt');
step('logins', { hoangnh: !!ops1.token, duongtt: !!ops2.token });
if (!ops1.token || !ops2.token) throw new Error('ops logins failed');

// find a container-bearing lot (same scan as the proven 141026230710 driver)
const vnDate = (offset = 0) => new Date(Date.now() + 7 * 3600 * 1000 + offset * 86400 * 1000).toISOString().slice(0, 10);
async function fetchOrders(token, date) {
  const res = await fetch(`${API}/ops/orders?date=${date}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const body = await res.json();
  return body.items ?? body.data?.items ?? null;
}
let target = null;
for (let offset = 0; offset >= -6 && !target; offset--) {
  const items = await fetchOrders(ops1.token, vnDate(offset));
  if (!items) continue;
  const withConts = items.filter(i => i.containerCount > 0 && i.containerIds?.length > 0);
  if (withConts.length) target = { date: vnDate(offset), order: withConts[0] };
}
step('e-target', target ? { date: target.date, id: target.order.id, billRef: target.order.billRef, conts: target.order.containerNumbers } : null);
if (!target) throw new Error('no container-bearing lot found');

const NOTE1 = 'QA fullguide B.2 — tự xóa sau kiểm tra';
const NOTE2 = 'QA fullguide B.3 — tự xóa sau kiểm tra';
let expense1 = null;
let expense2 = null;

/** Opens the khai-chi-phí modal on /ops/orders for the target row. */
async function openModal(page) {
  await page.goto(`${BASE}/ops/orders?date=${target.date}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  for (let i = 0; i < 20 && !(await page.evaluate(() => document.querySelectorAll('tbody tr').length)); i++) await sleep(2500);
  const opened = await page.evaluate((billRef) => {
    const trs = [...document.querySelectorAll('tbody tr')];
    const row = trs.find(r => r.innerText.includes(billRef)) ?? trs[0];
    const btn = row?.querySelector('button.ops-orders__expense');
    if (!btn) return null;
    btn.click();
    return row.innerText.replace(/\s+/g, ' ').slice(0, 160);
  }, target.order.billRef ?? '');
  await sleep(2500);
  const state = await page.evaluate(() => {
    const modal = document.querySelector('.ops-modal');
    const text = modal?.textContent ?? '';
    return { modalOpen: Boolean(modal), refusal: text.includes('không thuộc xe bạn phụ trách') || text.includes('không có quyền') };
  });
  return { opened, ...state };
}

/** Picks the cont, a cost type (first catalog entry), types the amount + note. */
async function fillForm(page, { typeName, amount, note }) {
  const realClick = async (predicateSource) => {
    const handle = await page.evaluateHandle(`(${predicateSource})()`);
    const el = handle.asElement();
    if (!el) { await handle.dispose(); return false; }
    await el.click();
    await handle.dispose();
    return true;
  };
  // Số Cont
  await realClick(`() => {
    const buttons = [...document.querySelectorAll('.ops-modal button')];
    const byLabel = (b) => {
      const label = b.getAttribute('aria-label') ?? '';
      if (/Số Cont/i.test(label)) return true;
      const labelled = (b.getAttribute('aria-labelledby') ?? '').split(/\\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
      return /Số Cont/i.test(labelled);
    };
    return buttons.find(byLabel) ?? null;
  }`);
  await sleep(900);
  let contChosen = false;
  for (let i = 0; i < 6 && !contChosen; i++) {
    contChosen = await realClick(`() => [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.trim() === ${JSON.stringify(target.order.containerNumbers[0])}) ?? null`);
    if (!contChosen) await sleep(700);
  }
  await sleep(600);
  // Loại phí — combobox
  await page.evaluate(() => {
    const combo = document.querySelector('.ops-modal input[role="combobox"]');
    if (!combo) return false;
    combo.focus();
    combo.click();
    return true;
  });
  await sleep(900);
  const firstName = await page.evaluate(() => {
    const options = [...document.querySelectorAll('[role="option"]')].filter(o => !o.getAttribute('aria-disabled') && o.textContent && !o.textContent.startsWith('—') && !/Chọn loại phí/.test(o.textContent ?? ''));
    return options[0]?.textContent?.trim() ?? null;
  });
  const wantType = typeName ?? firstName;
  if (wantType) {
    await page.keyboard.type(wantType.slice(0, 8), { delay: 40 });
    await sleep(700);
  }
  let typePicked = false;
  for (let i = 0; i < 6 && !typePicked; i++) {
    typePicked = await realClick(`() => [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.trim() === ${JSON.stringify(wantType)}) ?? null`);
    if (!typePicked) await sleep(700);
  }
  await sleep(600);
  // Thực chi
  await realClick(`() => [...document.querySelectorAll('.ops-modal input')].find((i) => {
    const own = i.getAttribute('aria-label') ?? '';
    if (/Thực chi/i.test(own)) return true;
    const lbl = i.closest('label')?.textContent ?? i.parentElement?.textContent ?? '';
    return /Thực chi/i.test(lbl);
  }) ?? null`);
  await page.keyboard.type(String(amount), { delay: 30 });
  // Ghi chú
  await realClick(`() => document.querySelector('.ops-modal textarea') ?? null`);
  await page.keyboard.type(note, { delay: 8 });
  await sleep(400);
  return { contChosen, typePicked, typeName: wantType };
}

// ══ B.2 — first OPS declares a container cost ════════════════════════════════
{
  const { browser, page } = await boot({ token: ops1.token });
  try {
    const openState = await openModal(page);
    step('e-b2-modal', openState);
    await page.screenshot({ path: 'qa/2026-10-16_fullguide_b2_modal-open.png', fullPage: true });
    if (!openState.modalOpen) throw new Error('modal did not open');
    if (openState.refusal) throw new Error('permission refusal still present');

    const fill = await fillForm(page, { amount: 15000, note: NOTE1 });
    step('e-b2-filled', fill);

    const saved = await page.evaluate(() => {
      const save = [...document.querySelectorAll('.ops-modal button')].find(b => b.textContent?.trim() === 'Lưu');
      if (!save || save.disabled) return false;
      save.click();
      return true;
    });
    let toastText = null;
    for (let i = 0; i < 12 && toastText == null; i++) {
      await sleep(1000);
      toastText = await page.evaluate(() => {
        const modalGone = !document.querySelector('.ops-modal');
        const toasts = [...document.querySelectorAll('[role="status"], .toast, [class*="toast"]')].map(n => n.textContent?.trim()).filter(Boolean);
        return modalGone ? (toasts.at(-1) ?? 'modal-closed') : (toasts.at(-1) ?? null);
      });
    }
    await page.screenshot({ path: 'qa/2026-10-16_fullguide_b2_after-save.png', fullPage: true });
    const wallet = await api(ops1.token, 'GET', '/ops/wallet/expenses?status=RECORDED&limit=100');
    const row = (wallet.json?.items ?? []).find(r => (r.note ?? '').includes('QA fullguide B.2') && r.shipmentId === target.order.id);
    expense1 = row ?? null;
    step('e-b2-side-effect', { saved, toastText, row: row ? { id: row.id, type: row.expenseTypeCode, amount: row.amount, cont: row.containerNumber, by: row.paidByName } : null });
    record('B.2', saved && row ? 'PASS' : 'FAIL', `OPS khai chi phí: modal ok (no refusal), saved=${saved}, toast="${toastText}", persisted row id=${row?.id} (${row?.expenseTypeCode} ${row?.amount}₫ cont ${row?.containerNumber} by ${row?.paidByName})`);
  } catch (e) {
    step('e-b2-error', { error: String(e.message ?? e) });
    await page.screenshot({ path: 'qa/2026-10-16_fullguide_b2_error.png', fullPage: true }).catch(() => {});
    record('B.2', 'FAIL', String(e.message ?? e));
  } finally { await browser.close(); }
}

// ══ B.3 — second OPS, same lot+cont+type → warning + explicit confirm ═══════
if (expense1) {
  const { browser, page } = await boot({ token: ops2.token });
  try {
    const openState = await openModal(page);
    step('e-b3-modal', openState);
    const fill = await fillForm(page, { typeName: expense1.expenseTypeName ?? undefined, amount: 15000, note: NOTE2 });
    step('e-b3-filled', fill);

    // per-cont heads-up should already be visible after picking the claimed cont
    const headsUp = await page.evaluate(() => (document.querySelector('.ops-modal')?.textContent ?? '').includes('đã có') && (document.querySelector('.ops-modal')?.textContent ?? '').includes('nhập trước'));
    await page.screenshot({ path: 'qa/2026-10-16_fullguide_b3_heads-up.png', fullPage: true });

    // first Lưu → 409 panel (warning, NOT a block)
    await page.evaluate(() => {
      const save = [...document.querySelectorAll('.ops-modal button')].find(b => b.textContent?.trim() === 'Lưu');
      if (save && !save.disabled) save.click();
    });
    await sleep(2500);
    const panel = await page.evaluate(() => {
      const modal = document.querySelector('.ops-modal');
      const text = modal?.textContent ?? '';
      const dup = modal?.querySelector('.ops-modal__duplicate');
      return {
        duplicatePanel: Boolean(dup),
        panelText: dup ? (dup.textContent ?? '').replace(/\s+/g, ' ').slice(0, 300) : null,
        keepEnabled: dup ? [...dup.querySelectorAll('button')].some(b => /tiếp tục lưu/i.test(b.textContent ?? '') && !b.disabled) : false,
        modalStillOpen: Boolean(modal),
      };
    });
    await page.screenshot({ path: 'qa/2026-10-16_fullguide_b3_duplicate-panel.png', fullPage: true });
    step('e-b3-panel', { headsUp, ...panel });

    // explicit confirm → "Tiếp tục lưu"
    const confirmed = await page.evaluate(() => {
      const dup = document.querySelector('.ops-modal__duplicate');
      const btn = dup ? [...dup.querySelectorAll('button')].find(b => /tiếp tục lưu/i.test(b.textContent ?? '') && !b.disabled) : null;
      if (!btn) return false;
      btn.click();
      return true;
    });
    let toast2 = null;
    for (let i = 0; i < 12 && toast2 == null; i++) {
      await sleep(1000);
      toast2 = await page.evaluate(() => {
        const modalGone = !document.querySelector('.ops-modal');
        const toasts = [...document.querySelectorAll('[role="status"], .toast, [class*="toast"]')].map(n => n.textContent?.trim()).filter(Boolean);
        return modalGone ? (toasts.at(-1) ?? 'modal-closed') : (toasts.at(-1) ?? null);
      });
    }
    await page.screenshot({ path: 'qa/2026-10-16_fullguide_b3_after-confirm-save.png', fullPage: true });
    const wallet2 = await api(ops2.token, 'GET', '/ops/wallet/expenses?status=RECORDED&limit=100');
    const row2 = (wallet2.json?.items ?? []).find(r => (r.note ?? '').includes('QA fullguide B.3') && r.shipmentId === target.order.id);
    expense2 = row2 ?? null;
    step('e-b3-side-effect', { confirmed, toast2, row2: row2 ? { id: row2.id, by: row2.paidByName } : null });
    record('B.3', panel.duplicatePanel && panel.keepEnabled && confirmed && row2 ? 'PASS' : 'FAIL',
      `duplicate warning: headsUp=${headsUp}, panel="${(panel.panelText ?? '').slice(0, 120)}", Tiếp tục lưu enabled=${panel.keepEnabled}, confirmed=${confirmed}, second row persisted id=${row2?.id}`);
  } catch (e) {
    step('e-b3-error', { error: String(e.message ?? e) });
    await page.screenshot({ path: 'qa/2026-10-16_fullguide_b3_error.png', fullPage: true }).catch(() => {});
    record('B.3', 'FAIL', String(e.message ?? e));
  } finally { await browser.close(); }
}

// ══ cleanup — each OPS voids their own fixture row ══════════════════════════
for (const [token, row, tag] of [[ops1.token, expense1, 'B.2'], [ops2.token, expense2, 'B.3']]) {
  if (!row) continue;
  const del = await api(token, 'DELETE', `/ops/expenses/${row.id}`, { reason: `QA cleanup fullguide ${tag}` });
  step('e-cleanup', { tag, id: row.id, status: del.status, body: del.text?.slice(0, 80) });
}

writeFileSync('qa/2026-10-16_fullguide_e-results.json', JSON.stringify({ pin: PIN, date: new Date().toISOString(), results, target: { id: target.order.id, cont: target.order.containerNumbers?.[0] } }, null, 2));
step('SUMMARY', results);
