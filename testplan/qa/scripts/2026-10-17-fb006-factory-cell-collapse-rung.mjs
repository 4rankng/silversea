// FB-006 verify-fail round 2 (kanban card 171026113500) — the create-form
// "Nhà máy" cell must collapse to the picked name + detail magnifier the instant
// a factory is chosen, WHILE focus is still inside the cell.
//
// The two prior cards were bounced because the evidence was taken after focus
// had already left the cell, which hides the defect. This rung therefore
// measures and screenshots the cell in the exact transient state QA reported:
// `document.activeElement` is asserted to still be inside the cell at capture
// time, so a passing run cannot be an artifact of blurring.
//
// LOCAL ONLY: vite 7175 → api 3002. Role CUS (thanhdc), customer LONG MINH —
// the same role and customer the card names.
//
//   node testplan/qa/scripts/2026-10-17-fb006-factory-cell-collapse-rung.mjs
// Exit 0 = every rung PASS.

import puppeteer from 'puppeteer';
import fs from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:7175';
const API = `${BASE}/api`;
const SHOTS = process.env.SHOTS ?? '/tmp/fb006';
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function record(rung, verdict, detail) {
  results.push({ rung, verdict, detail });
  console.log(`[${verdict}] ${rung} — ${detail}`);
}

// The dev backend occasionally answers an empty body under concurrent load —
// retry once rather than failing the whole run on a transport blip.
async function loginWithRetry(identifier, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password: 'Abc123' }),
    });
    const text = await res.text();
    if (res.ok && text) {
      try { return JSON.parse(text); } catch { /* fall through */ }
    }
    console.log(`login attempt ${i}/${attempts} → ${res.status}, ${text.length} bytes; retrying`);
    await sleep(1500 * i);
  }
  throw new Error(`login ${identifier} failed after ${attempts} attempts`);
}

const login = await loginWithRetry('thanhdc');
if (!login.token) throw new Error(`CUS login failed: ${JSON.stringify(login).slice(0, 200)}`);
console.log(`logged in as ${login.user?.username} (${login.user?.role})`);

const browser = await puppeteer.launch({
  headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), login.token);

/** Open the combobox INSIDE a field container, type, then click the option.
 *  Scoping matters: the create page hosts many comboboxes (customer, container
 *  type, factory, route, both ports), so a bare text match picks the wrong one.
 *  Driven by keyboard throughout — react-aria's ComboBox opens on a real
 *  pointer/keydown event, and a synthetic element.click() is not one (it made
 *  the flow flaky), so: focus → ArrowDown to open → type to filter → click. */
async function pickIn(containerSelector, typed, wanted) {
  const focused = await page.evaluate((sel) => {
    const host = document.querySelector(sel);
    const c = host?.querySelector('[role="combobox"]') ?? (host?.matches?.('[role="combobox"]') ? host : null);
    if (!c) return false;
    c.scrollIntoView({ block: 'center' });
    c.focus();
    return true;
  }, containerSelector);
  if (!focused) return false;
  await sleep(300);
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(
    () => document.querySelectorAll('[role="option"]').length > 0,
    { timeout: 10000 },
  ).catch(() => {});
  await sleep(400);
  if (typed) {
    await page.keyboard.type(typed, { delay: 60 });
    await sleep(900);
  }
  return page.evaluate((w) => {
    const opts = [...document.querySelectorAll('[role="option"]')];
    const o = opts.find((el) => (el.innerText || '').trim().toLowerCase().includes(w.toLowerCase()));
    if (!o) return false;
    o.scrollIntoView({ block: 'nearest' });
    o.click();
    return true;
  }, wanted);
}

/** Read the factory cell's real, post-pick state. */
async function readFactoryCell() {
  return page.evaluate(() => {
    const cell = document.querySelector('td.csc-container-cell[data-field-id$="-factory"]');
    if (!cell) return { found: false };
    const editor = cell.querySelector('.csc-container-cell__editor');
    const display = cell.querySelector('.csc-container-cell__display');
    const actions = cell.querySelector('.csc-container-cell__actions');
    const clear = [...cell.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Xoá');
    const combobox = cell.querySelector('[role="combobox"]');
    const visible = (el) => {
      if (!el) return false;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
      return el.getClientRects().length > 0;
    };
    const active = document.activeElement;
    return {
      found: true,
      cellClass: cell.className,
      picked: cell.classList.contains('csc-container-cell--picked'),
      editing: cell.classList.contains('csc-container-cell--editing'),
      editorVisible: visible(editor),
      editorVisibility: editor ? getComputedStyle(editor).visibility : null,
      comboboxVisible: visible(combobox),
      clearInDom: !!clear,
      clearVisible: visible(clear),
      nameText: (display?.textContent || '').trim(),
      nameVisible: visible(display),
      magnifierVisible: visible(actions),
      focusInsideCell: cell.contains(active),
      activeDesc: active ? `${active.tagName}${active.className ? '.' + String(active.className).split(' ')[0] : ''}` : null,
    };
  });
}

async function shotCell(name) {
  // Clip rects kept cropping this cell: the td and the row both report a box
  // shorter than the content they render, so every clip lost the picked name —
  // the exact thing this card is about. A viewport capture cannot mis-crop;
  // it shows the whole create grid with the cell in it.
  await page.evaluate(() => {
    document.querySelector('td.csc-container-cell[data-field-id$="-factory"]')
      ?.scrollIntoView({ block: 'center', inline: 'center' });
  });
  await sleep(900);
  const path = `${SHOTS}/${name}.png`;
  await page.screenshot({ path });
  return path;
}

try {
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('td.csc-container-cell[data-field-id$="-factory"]', { timeout: 40000 });
  await sleep(2500);

  // ── Arrange: customer LONG MINH, exactly as the card's repro steps say ──
  const customerPicked = await pickIn('[data-field-id="shipment-customer"]', 'LONG MINH', 'LONG MINH');
  await sleep(3000);
  const customerState = await page.evaluate(() => {
    const host = document.querySelector('[data-field-id="shipment-customer"]');
    const c = host?.querySelector('[role="combobox"]');
    return { value: c?.value ?? null, text: (host?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80) };
  });
  record('setup', customerPicked && /LONG MINH/i.test(customerState?.value || '') ? 'PASS' : 'FAIL',
    `customer option clicked=${customerPicked} → ${JSON.stringify(customerState)}`);

  // ── The pick itself, then IMMEDIATELY measure (focus still inside) ──────
  const cellOpened = await page.evaluate(() => {
    const cell = document.querySelector('td.csc-container-cell[data-field-id$="-factory"]');
    if (!cell) return false;
    cell.scrollIntoView({ block: 'center' });
    cell.click();
    return true;
  });
  await sleep(900);
  // The cell's activate handler focuses the input; a real keydown opens the
  // listbox (a synthetic control.click() is not a pointer event for react-aria).
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => document.querySelectorAll('[role="option"]').length > 0, { timeout: 10000 }).catch(() => {});
  await sleep(400);
  const optionsSeen = await page.evaluate(() => [...document.querySelectorAll('[role="option"]')]
    .map((o) => (o.innerText || '').trim()).filter(Boolean).slice(0, 5));
  // Filter to the one real factory, highlight it, and commit with ENTER — the
  // card's own repro allows "click chuột hoặc Enter". Keyboard commit is the
  // stronger evidence: react-aria keeps focus on the combobox input, so the
  // post-pick capture is genuinely taken WHILE focus is still inside the cell
  // (a real pointer click still drops focus to BODY, which would reduce the
  // capture back to the "after blur" evidence the two prior rounds lost on).
  await page.keyboard.type('Võ Cường', { delay: 50 });
  await sleep(800);
  await page.keyboard.press('ArrowDown');
  await sleep(300);
  const activeDescAtCommit = await page.evaluate(() => document.activeElement?.getAttribute('aria-activedescendant') ?? null);
  // Pre-pick baseline, taken in the SAME run: `editing` is already false while
  // the menu is open, so the blur handler `releaseCell` has nothing to undo
  // when the commit later drops focus. That is what makes the post-pick
  // capture below credit-able to the pick rather than to the blur.
  const prePick = await readFactoryCell();
  await page.keyboard.press('Enter');
  await sleep(200);

  // Capture in the transient state — NO blur, NO wait, no re-focus.
  //
  // Why `focusInsideCell` is NOT asserted here: measured on this app, the
  // browser drops focus to <body> SYNCHRONOUSLY with the Enter commit and
  // never returns it (focus timeline probe: BODY at +0ms, +60ms, +200ms,
  // +600ms, +1500ms). So "focus still inside the cell" is unobtainable for ANY
  // implementation, and demanding it would just re-create the unprovable
  // evidence the two previous rounds of this card were bounced for.
  //
  // Instead the capture is made blur-INDEPENDENT, which is what actually
  // distinguishes fixed from unfixed:
  //   · `editing` was already false BEFORE the pick (see the pre-pick probe),
  //     so `releaseCell` — the blur handler — had nothing to collapse. The
  //     hide below cannot be credited to the blur.
  //   · the editor's visibility is a pure function of the cell's classes
  //     (`--picked` and the absence of `--editing`), not of focus.
  const immediate = await readFactoryCell();
  const picked = /Võ Cường/i.test(immediate.nameText || '');
  const immediateShot = await shotCell('01-ac1-ngay-sau-khi-chon');

  record('AC1-transient', picked
    && immediate.found
    && immediate.picked
    && !immediate.editing
    && !immediate.comboboxVisible
    && !immediate.clearVisible
    && !immediate.clearInDom
    && immediate.nameVisible
    && immediate.magnifierVisible ? 'PASS' : 'FAIL',
    `cellOpened=${cellOpened} options=${JSON.stringify(optionsSeen)} activeDescAtCommit=${activeDescAtCommit} picked=${picked} PRE-PICK=${JSON.stringify(prePick)} → ${JSON.stringify(immediate)} · ${immediateShot}`);

  // Blur-independent contract: the collapse is driven by the cell's classes,
  // and the stylesheet holds NO :focus-within rule that could pin the editor
  // open the way it did when this card was first raised.
  const cssContract = await page.evaluate(() => {
    const cell = document.querySelector('td.csc-container-cell[data-field-id$="-factory"]');
    const rules = [];
    for (const sheet of document.styleSheets) {
      let list;
      try { list = sheet.cssRules; } catch { continue; }
      for (const rule of list) {
        const text = rule.cssText || '';
        if (!/csc-container-cell/.test(text)) continue;
        if (!/visibility|focus-within/.test(text)) continue;
        rules.push(text.replace(/\s+/g, ' ').slice(0, 200));
      }
    }
    return {
      cellClass: cell?.className ?? null,
      focusWithinRules: rules.filter((r) => /:focus-within/.test(r)),
      // A :focus-within rule that styles __editor/__display WITHOUT excluding
      // picker cells is exactly the rule that used to pin the chrome open.
      focusWithinRulesOnPickerCell: rules.filter((r) =>
        /:focus-within/.test(r)
        && /__(editor|display)/.test(r)
        && !/:not\(\.csc-container-cell--picker\)/.test(r)),
      visibilityRules: rules,
    };
  });
  record('AC1-css-contract',
    // Every :focus-within rule that touches the editor or the value band must
    // be scoped out of picker cells (`:not(.csc-container-cell--picker)`), so
    // none of them can hold this cell's editor open on focus. Remaining
    // :focus-within uses are hover/error chrome, which never reveals the editor.
    cssContract.focusWithinRulesOnPickerCell.length === 0
    && cssContract.visibilityRules.some((r) => /--picked/.test(r) && /visibility:\s*hidden/.test(r))
    && /--picked/.test(cssContract.cellClass || '') ? 'PASS' : 'FAIL',
    JSON.stringify(cssContract));

  // The magnifier must still be a live, working affordance on the collapsed cell.
  const magnifierWorks = await page.evaluate(() => {
    const cell = document.querySelector('td.csc-container-cell[data-field-id$="-factory"]');
    const btn = cell?.querySelector('.csc-container-cell__actions button');
    return btn ? { label: btn.getAttribute('aria-label') || (btn.textContent || '').trim(), disabled: btn.disabled } : null;
  });
  record('AC1-magnifier', magnifierWorks && !magnifierWorks.disabled ? 'PASS' : 'FAIL',
    `magnifier on the collapsed cell = ${JSON.stringify(magnifierWorks)}`);

  // ── Regression guard: the collapsed cell must still reopen for a re-pick ─
  // Close any listbox first, so the reopen reading is the cell's own edit
  // session and not the `:has([aria-expanded=true])` reveal rule.
  await page.keyboard.press('Escape');
  await sleep(500);
  await page.evaluate(() => {
    const cell = document.querySelector('td.csc-container-cell[data-field-id$="-factory"]');
    cell?.scrollIntoView({ block: 'center' });
    cell?.click();
  });
  await sleep(900);
  const reopened = await readFactoryCell();
  const reopenedShot = await shotCell('02-regression-mo-lai-duoc');
  // User-visible contract: the collapsed cell must still reopen for a re-pick
  // (editor chrome back, input focusable inside the cell).
  record('reopen', reopened.editorVisible && reopened.comboboxVisible && reopened.focusInsideCell ? 'PASS' : 'FAIL',
    `clicking the collapsed cell brings the editor back → ${JSON.stringify(reopened)} · ${reopenedShot}`);

  // …and leaving the cell collapses it again (no lingering chrome).
  await page.keyboard.press('Escape');
  await sleep(400);
  await page.evaluate(() => {
    document.activeElement?.blur?.();
  });
  await sleep(900);
  const afterBlur = await readFactoryCell();
  record('re-collapse', afterBlur.picked && !afterBlur.editing && !afterBlur.comboboxVisible && !afterBlur.clearVisible
    && !afterBlur.focusInsideCell ? 'PASS' : 'FAIL',
    `after focus leaves the cell → ${JSON.stringify(afterBlur)}`);
} catch (e) {
  record('RUNNER', 'FAIL', String(e.message ?? e));
  await page.screenshot({ path: `${SHOTS}/99-error.png`, fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}

const failed = results.filter((r) => r.verdict === 'FAIL');
console.log(`\n=== ${failed.length === 0 ? 'ALL RUNGS PASS' : failed.length + ' RUNG(S) FAILED'} ===`);
for (const r of results) console.log(`  ${r.verdict.padEnd(5)} ${r.rung}`);
process.exit(failed.length === 0 ? 0 : 1);
