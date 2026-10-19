// Card 191026181942 (×3) — rung-3 UI drive on the ephemeral stack
// (frontend :7175 → backend :3002 → dev DB :5441).
//
//   DV3 — /dispatch: an LCL lot's "Phân bổ nhà xe" opens the lclspec field-set
//         (loại xe / nhà xe facts + BKS pair, NO container fields); the BKS
//         save rides updateLclTruck (SQL proof below). An FCL lot keeps the
//         cont field-set.
//   KT4 — /accounting/chot-debit: the board opens on the essential set (≤6),
//         the Columns3 picker toggles breakdowns, the choice persists in
//         localStorage across reloads.
//   KT8 — the leading red-dot track marks rows with missing cost data
//         ("Thiếu chi phí"); money cells stay muted.
//
// Usage: QA_BASE=http://localhost:7175 API=http://localhost:3002/api \
//        node testplan/qa/scripts/2026-10-19-card191026181942-rung.mjs
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.API || 'http://localhost:3002/api';
const BASE = process.env.QA_BASE || 'http://localhost:7175';
const OUT = process.env.QA_OUT
  ? path.resolve(process.env.QA_OUT)
  : path.resolve(import.meta.dirname, '../../../qa/2026-10-19_card191026181942');
fs.mkdirSync(OUT, { recursive: true });

const step = (s, o = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), step: s, ...o }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Mount waits instead of fixed sleeps alone (rb1 re-run 2026-10-19): the
// chốt-debit board renders ~8.8k rows × two surfaces in dev mode, and a cold
// vite module graph + loaded machine stretched the old 3.5 s settle past the
// mount — every KT4/KT8 probe then read an unmounted page. Same assertions,
// explicit readiness: poll a DOM predicate until true or timeout (false lets
// the existing record() branches report the miss instead of throwing).
async function waitFor(page, predicate, timeoutMs = 60000, everyMs = 500) {
  const t0 = Date.now();
  for (;;) {
    const ok = await page.evaluate(predicate).catch(() => false);
    if (ok) return true;
    if (Date.now() - t0 > timeoutMs) return false;
    await sleep(everyMs);
  }
}
let exitCode = 0;
const record = (id, pass, detail) => { if (!pass) exitCode = 1; step('RESULT', { id, pass, detail }); };

async function loginAs(identifier) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (!res.ok) throw new Error(`login ${identifier} -> ${res.status}`);
  const { token } = await res.json();
  return token;
}

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
try {
  // ═══ Part A — Điều vận: dialog phân bổ theo cargoMode (card DV3) ═══════
  const dvToken = await loginAs('dieuvan');
  const dvPage = await browser.newPage();
  await dvPage.setViewport({ width: 1440, height: 1000 });
  await dvPage.evaluateOnNewDocument((t) => localStorage.setItem('token', t), dvToken);

  // — A1: the LCL lot FB107-9A7A2E-IMP (id 110539) — has a stored CONT20
  //   class, an OWN planned carrier and BKS 60C-12345, so every lclspec fact
  //   is populated. Narrow the grid through the search box (the page's q is
  //   component state, not a URL param).
  await dvPage.goto(`${BASE}/dispatch`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await waitFor(dvPage, () => Boolean(document.querySelector('[aria-label="Tìm kiếm lô hàng"]')), 60000);
  await sleep(3000);
  await dvPage.type('[aria-label="Tìm kiếm lô hàng"]', 'FB107-9A7A2E-IMP');
  await sleep(1500);
  await waitFor(dvPage, () => Boolean(document.querySelector('button[aria-label="Chỉnh sửa phân bổ nhà xe"]')), 30000);
  const trigger = await dvPage.evaluateHandle(() => document.querySelector('button[aria-label="Chỉnh sửa phân bổ nhà xe"]'));
  if (!trigger || !(await trigger.asElement())) {
    record('DV3-open-lcl', false, 'allocation trigger not found on the LCL row');
  } else {
    await trigger.asElement().click();
    await waitFor(dvPage, () => Boolean(document.querySelector('.dispatch-allocation-popover')), 20000);
    await sleep(1200);
    const lclDialog = await dvPage.evaluate(() => {
      const dialog = document.querySelector('.dispatch-allocation-popover');
      const text = dialog?.textContent ?? '';
      return {
        open: Boolean(dialog),
        hasClassFact: text.includes('Loại xe tính cước trả ĐV'),
        classValue: [...(dialog?.querySelectorAll('.dispatch-allocation-lcl__fact dd') ?? [])].map((dd) => dd.textContent?.trim()),
        hasCont20Column: text.includes("Container 20'"),
        hasCont40Column: text.includes("Container 40'"),
        hasDemandTable: Boolean(dialog?.querySelector('[aria-label="Tổng phân bổ theo loại container"]')),
        hasAddCarrier: text.includes('Thêm nhà xe'),
        bksActual: dialog?.querySelector('[role="combobox"]')?.value ?? null,
        saveLabel: [...(dialog?.querySelectorAll('button') ?? [])].some((b) => b.textContent?.includes('Lưu phân bổ')),
      };
    });
    step('DV3-lcl-dialog', lclDialog);
    record('DV3-lcl-fieldset', lclDialog.open && lclDialog.hasClassFact && !lclDialog.hasCont20Column && !lclDialog.hasCont40Column && !lclDialog.hasDemandTable && !lclDialog.hasAddCarrier,
      `facts=${lclDialog.classValue?.join(' | ')} contFields=${lclDialog.hasCont20Column || lclDialog.hasCont40Column}`);
    // Seeding law: the BKS field opens on the lot's STORED plate (60C-12345 on
    // a clean DB; 60C-QA942 once this driver's own earlier save persisted).
    record('DV3-lcl-bks-seeded', Boolean(lclDialog.bksActual && lclDialog.bksActual !== 'Đội xe nội bộ SilverSea'), `bks=${lclDialog.bksActual}`);
    await dvPage.screenshot({ path: path.join(OUT, 'ui-dv3-lcl-dialog.png'), fullPage: false });

    // — A2: rewrite the BKS pair through the dialog (updateLclTruck path).
    //   BKS ảo untouched ⇒ auto-copy ⇒ stays off the wire; SQL proof below.
    //   Clear through the FIELD's own affordances (rb2 hardening): the old
    //   `el.value = ''` direct-DOM hack races React's controlled restore —
    //   under load the seeded value came back between the clear and the
    //   first keystroke, the typed text APPENDED to it, and the doubled
    //   string rode onCustomValue into state and the DB (the doubled seed
    //   this run then read back was that residue). The Xoá button is the
    //   product's own clear (fires onChange('') + onCustomValue('')); the
    //   select-all fallback replaces atomically with the first keystroke.
    const typed = await dvPage.evaluate(() => {
      const input = document.querySelector('.dispatch-allocation-popover [role="combobox"]');
      if (!input) return false;
      const clear = input.closest('.csc-searchable-field')?.querySelector('button[aria-label="Xoá"]');
      if (clear) { clear.click(); return true; }
      input.focus();
      return true;
    });
    if (typed) {
      const sel = '.dispatch-allocation-popover [role="combobox"]';
      const emptied = await dvPage.evaluate(() => document.querySelector('.dispatch-allocation-popover [role="combobox"]')?.value === '');
      if (!emptied) {
        // No Xoá affordance (or it missed): select-all + type-over replaces
        // the seeded text atomically — per-keystroke events can never append.
        await dvPage.focus(sel);
        await dvPage.keyboard.down(process.platform === 'darwin' ? 'Meta' : 'Control');
        await dvPage.keyboard.press('a');
        await dvPage.keyboard.up(process.platform === 'darwin' ? 'Meta' : 'Control');
      }
      await dvPage.type(sel, '60C-QA942');
      await sleep(300);
      const typedValue = await dvPage.evaluate(() => document.querySelector('.dispatch-allocation-popover [role="combobox"]')?.value ?? '');
      if (typedValue.trim() !== '60C-QA942') {
        record('DV3-lcl-save-closed', false, `typed field reads "${typedValue}" — refusing to save a corrupted value`);
      } else {
      await dvPage.evaluate(() => {
        const save = [...document.querySelectorAll('.dispatch-allocation-popover button')].find((b) => b.textContent?.includes('Lưu phân bổ'));
        save?.click();
      });
      await sleep(1800);
      const afterSave = await dvPage.evaluate(() => ({
        dialogClosed: !document.querySelector('.dispatch-allocation-popover'),
        toast: [...document.querySelectorAll('[role="status"], .toast, [data-sonner-toast]')].map((n) => n.textContent?.trim()).filter(Boolean).slice(0, 3),
      }));
      step('DV3-lcl-save', afterSave);
      record('DV3-lcl-save-closed', afterSave.dialogClosed, JSON.stringify(afterSave.toast));
      }
    }
  }

  // — A3: the FCL lot keeps the cont field-set.
  await dvPage.goto(`${BASE}/dispatch`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await waitFor(dvPage, () => Boolean(document.querySelector('[aria-label="Tìm kiếm lô hàng"]')), 60000);
  await sleep(3000);
  await dvPage.type('[aria-label="Tìm kiếm lô hàng"]', 'T8BOOK-1792402300379-a4ma0m-7');
  await sleep(1500);
  await waitFor(dvPage, () => Boolean(document.querySelector('button[aria-label="Chỉnh sửa phân bổ nhà xe"]')), 30000);
  const fclTrigger = await dvPage.evaluateHandle(() => document.querySelector('button[aria-label="Chỉnh sửa phân bổ nhà xe"]'));
  if (fclTrigger && (await fclTrigger.asElement())) {
    await fclTrigger.asElement().click();
    await waitFor(dvPage, () => Boolean(document.querySelector('.dispatch-allocation-popover')), 20000);
    await sleep(1200);
    const fclDialog = await dvPage.evaluate(() => {
      const dialog = document.querySelector('.dispatch-allocation-popover');
      const text = dialog?.textContent ?? '';
      return {
        open: Boolean(dialog),
        hasCont20: text.includes("Container 20'"),
        hasCont40: text.includes("Container 40'"),
        hasDemandTable: Boolean(dialog?.querySelector('[aria-label="Tổng phân bổ theo loại container"]')),
        hasAddCarrier: text.includes('Thêm nhà xe'),
        hasLclFields: text.includes('Loại xe tính cước trả ĐV') || text.includes('BKS báo khách'),
      };
    });
    step('DV3-fcl-dialog', fclDialog);
    record('DV3-fcl-fieldset', fclDialog.open && fclDialog.hasCont20 && fclDialog.hasCont40 && fclDialog.hasDemandTable && !fclDialog.hasLclFields, JSON.stringify(fclDialog));
    await dvPage.screenshot({ path: path.join(OUT, 'ui-dv3-fcl-dialog.png'), fullPage: false });
  } else {
    record('DV3-fcl-fieldset', false, 'FCL row trigger not found');
  }
  await dvPage.close();

  // ═══ Part B — Kế toán: essential default + picker persist (KT4) + dot (KT8) ═══
  const ktToken = await loginAs('ketoan');
  const ktPage = await browser.newPage();
  await ktPage.setViewport({ width: 1440, height: 1000 });
  await ktPage.evaluateOnNewDocument((t) => localStorage.setItem('token', t), ktToken);

  await ktPage.goto(`${BASE}/accounting/chot-debit?from=2026-03-09&to=2026-03-13`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  // Board mount first (heavy dev render), then a short settle — never probe an
  // unmounted page again.
  await waitFor(ktPage, () => Boolean(document.querySelector('.debit-board')), 180000);
  await sleep(800);
  const defaultBoard = await ktPage.evaluate(() => {
    const board = [...document.querySelectorAll('.debit-board')].pop();
    const headers = [...(board?.querySelectorAll('thead th') ?? [])]
      .map((th) => th.textContent?.trim())
      .filter((t) => t && t.length > 0);
    const bodyRows = board ? [...board.querySelectorAll('tbody tr')] : [];
    const dots = [...(board?.querySelectorAll('.debit-cost-dot') ?? [])];
    const dottedRow = dots[0]?.closest('tr');
    return {
      boardFound: Boolean(board),
      headers,
      rowCount: bodyRows.length,
      dotCount: dots.length,
      firstDotAria: dots[0]?.getAttribute('aria-label') ?? null,
      firstDotTitle: dots[0]?.getAttribute('title') ?? null,
      dottedRowText: dottedRow?.textContent?.slice(0, 160) ?? null,
      dottedRowHasMutedMissing: Boolean(dottedRow?.querySelector('.debit-missing')),
      storedChoice: localStorage.getItem('accounting-debit-hidden-cols'),
    };
  });
  step('KT4-default-board', defaultBoard);
  const essentialOk = defaultBoard.headers.length <= 8 // dot(s sr-only)+Ngày+ló+Tổng thu+Tổng 1+Đối soát (+2 group heads)
    && defaultBoard.headers.includes('Ngày') && defaultBoard.headers.includes('Tổng thu')
    && defaultBoard.headers.includes('Tổng 1') && defaultBoard.headers.includes('Đối soát')
    && !defaultBoard.headers.includes('Cước thu (tự động)') && !defaultBoard.headers.includes('Lợi nhuận');
  record('KT4-essential-default', essentialOk, `headers=${defaultBoard.headers.join(' | ')}`);
  record('KT8-dot-renders', defaultBoard.dotCount > 0 && defaultBoard.firstDotAria === 'Thiếu chi phí' && defaultBoard.firstDotTitle === 'Thiếu chi phí',
    `dots=${defaultBoard.dotCount}/${defaultBoard.rowCount} row=${defaultBoard.dottedRowText}`);
  record('KT8-money-cell-muted', defaultBoard.dottedRowHasMutedMissing, 'dotted row keeps its muted "Thiếu …" label');
  record('KT4-no-stored-choice-yet', defaultBoard.storedChoice === null, `storage=${defaultBoard.storedChoice}`);
  await ktPage.screenshot({ path: path.join(OUT, 'ui-kt4-kt8-default-board.png'), fullPage: false });

  // — KT4: open the Columns3 picker, enable a breakdown, prove persistence.
  const pickerOpened = await ktPage.evaluate(() => {
    const trigger = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? '').startsWith('Cột hiển thị'));
    if (!trigger) return false;
    trigger.click();
    return true;
  });
  await sleep(700);
  if (pickerOpened) await waitFor(ktPage, () => Boolean(document.querySelector('[role="dialog"][aria-label="Cột hiển thị"]')), 20000);
  const toggled = await ktPage.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"][aria-label="Cột hiển thị"]');
    if (!dialog) return { ok: false, reason: 'picker dialog not open' };
    // The vendored UUI checkbox names itself through its label row — match the
    // option row by text, then click its [role=checkbox] input.
    const row = [...dialog.querySelectorAll('.column-picker__option')].find((o) => (o.textContent ?? '').includes('Cước thu (tự động)'));
    const box = row?.querySelector('[role="checkbox"], input[type="checkbox"]');
    if (!box) return { ok: false, reason: 'option/checkbox not found', options: [...dialog.querySelectorAll('.column-picker__option')].map((o) => o.textContent?.trim()).slice(0, 20) };
    box.click();
    return { ok: true };
  });
  step('KT4-picker-interaction', { pickerOpened, toggled });
  await sleep(900);
  const afterToggle = await ktPage.evaluate(() => {
    const board = [...document.querySelectorAll('.debit-board')].pop();
    return {
      headers: [...(board?.querySelectorAll('thead th') ?? [])].map((th) => th.textContent?.trim()).filter(Boolean),
      storedChoice: localStorage.getItem('accounting-debit-hidden-cols'),
    };
  });
  step('KT4-after-toggle', afterToggle);
  record('KT4-toggle-adds-column', afterToggle.headers.includes('Cước thu (tự động)'), `headers=${afterToggle.headers.join(' | ')}`);
  record('KT4-choice-persisted', typeof afterToggle.storedChoice === 'string' && afterToggle.storedChoice.includes('lachHuyen'), `storage=${afterToggle.storedChoice}`);
  await ktPage.screenshot({ path: path.join(OUT, 'ui-kt4-picker-toggled.png'), fullPage: false });

  // Reload: the stored choice must survive (per-workstation memory).
  await ktPage.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await waitFor(ktPage, () => Boolean(document.querySelector('.debit-board')), 180000);
  await sleep(800);
  const afterReload = await ktPage.evaluate(() => {
    const board = [...document.querySelectorAll('.debit-board')].pop();
    return {
      headers: [...(board?.querySelectorAll('thead th') ?? [])].map((th) => th.textContent?.trim()).filter(Boolean),
      storedChoice: localStorage.getItem('accounting-debit-hidden-cols'),
    };
  });
  step('KT4-after-reload', afterReload);
  record('KT4-reload-keeps-choice', afterReload.headers.includes('Cước thu (tự động)')
    && afterReload.storedChoice === afterToggle.storedChoice, `storage=${afterReload.storedChoice}`);
  await ktPage.screenshot({ path: path.join(OUT, 'ui-kt4-after-reload.png'), fullPage: false });
  await ktPage.close();
} catch (error) {
  exitCode = 1;
  step('driver-error', { message: String(error) });
} finally {
  await browser.close();
}
step('done', { exitCode });
process.exit(exitCode);
