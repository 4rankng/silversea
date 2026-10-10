// Card 101026163000 (FB-006) — LOCAL UI rung: after a committed factory pick
// the create-grid "Nhà máy" cell collapses to name + magnifier; the editor
// chrome is visible only while the picker menu is open. Role CUS (thanhdc,
// local seed). Read-only flow — the form is never saved.
//
// Assertions (not just logs) per AC, so a regression exits non-zero:
//   AC1 committed pick  → display opacity 1, editor chrome opacity 0,
//                         magnifier present and revealed
//   AC2 magnifier       → detail popover opens with the factory's data
//   AC3 click collapsed → editor reopens (menu open); Escape collapses again
//   AC4 Tab handoff     → card 20261002_272 unchanged: type picker menu opens
//   AC6 sibling port    → pickup-port picker cell collapses after its pick
//   AC5 narrow (390px)  → stacked layout keeps the editor continuously visible
// Design provenance: house primitive (compact value + magnifier, rulings
// 20261002_268 / this card); Untitled UI PRO searched for a table-cell
// collapsed-select + detail-peek pattern — only slideout/modal menus returned
// (project-details-menu, dropdown-modal), wrong context, so no catalog
// component is adopted here.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { appendFileSync, writeFileSync } from 'node:fs';

const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const DRIVER_LOG = `${QA}/2026-10-10_card101026163000_ui-driver.log`;
writeFileSync(DRIVER_LOG, '');
const step = (s, o) => {
  const e = { at: new Date().toISOString(), step: s, ...o };
  appendFileSync(DRIVER_LOG, JSON.stringify(e) + '\n');
  console.log(JSON.stringify(e));
};

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'thanhdc', password: 'Abc123' }),
});
if (!login.ok) throw new Error(`login thanhdc failed: ${login.status}`);
const session = await login.json();
const token = session.token ?? session.accessToken ?? session?.data?.token;
step('login', { user: 'thanhdc (CUS)', gotToken: Boolean(token) });

const PROBE = `((suffix) => {
  const cell = document.querySelector('td[data-field-id$="' + suffix + '"]');
  if (!cell) return { cell: false, suffix };
  const display = cell.querySelector('.csc-container-cell__display');
  const editorChild = cell.querySelector('.csc-container-cell__editor > *');
  const input = cell.querySelector('input');
  const clear = [...cell.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Xoá');
  const magnifier = cell.querySelector('button[aria-label^="Xem chi tiết nhà máy"]');
  const op = (el) => (el ? getComputedStyle(el).opacity : null);
  return {
    cell: true,
    suffix,
    isPicker: cell.classList.contains('csc-container-cell--picker'),
    activeIsCellInput: input ? document.activeElement === input : null,
    inputAriaExpanded: input ? input.getAttribute('aria-expanded') : null,
    displayOpacity: op(display),
    displayText: display ? display.textContent : null,
    editorOpacity: op(editorChild),
    clearOpacity: clear ? op(clear) : 'absent',
    magnifierOpacity: magnifier ? op(magnifier) : 'absent',
  };
})`;

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle0', timeout: 90000 }).catch(() => step('goto', { note: 'networkidle timeout — continue' }));
  await page.waitForFunction(() => document.body.innerText.includes('Khách hàng'), { timeout: 90000 });
  step('form-loaded');

  const custInput = await page.evaluateHandle(() => {
    const lbl = [...document.querySelectorAll('label')].find((l) => (l.textContent || '').includes('Khách hàng'));
    return (lbl?.closest('div') ?? document).querySelector('input, [role="combobox"]');
  });
  await custInput.asElement().click();
  await page.keyboard.type('Long Minh');
  await page.waitForFunction(() => [...document.querySelectorAll('[role="option"]')].some((o) => (o.textContent || '').toLowerCase().includes('long minh')), { timeout: 30000 });
  await page.evaluate(() => [...document.querySelectorAll('[role="option"]')].find((o) => (o.textContent || '').toLowerCase().includes('long minh'))?.click());
  step('customer-picked');

  await page.waitForSelector('input[placeholder="Chọn nhà máy"]', { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1500));

  // --- AC1: mouse pick → cell collapses to name + magnifier ---
  await (await page.$('input[placeholder="Chọn nhà máy"]')).click();
  await new Promise((r) => setTimeout(r, 800));
  const optionLabel = await page.evaluate(() => document.querySelector('[role="option"]')?.textContent?.trim().slice(0, 60) ?? null);
  await page.evaluate(() => document.querySelector('[role="option"]')?.click());
  await new Promise((r) => setTimeout(r, 800));
  const ac1 = await page.evaluate(`${PROBE}('-factory')`);
  step('AC1-after-mouse-pick', { option: optionLabel, ...ac1 });
  await page.screenshot({ path: `${QA}/2026-10-10_card101026163000_ui-1-after-pick.png` });
  assert.ok(ac1.cell, 'AC1: factory cell present');
  assert.equal(ac1.isPicker, true, 'AC1: factory cell carries the picker modifier');
  assert.ok(optionLabel, 'AC1: a factory option was offered');
  assert.ok(ac1.displayText && ac1.displayText !== 'Chọn nhà máy', 'AC1: cell shows a factory name, not the placeholder');
  assert.ok(
    optionLabel.includes(ac1.displayText) || ac1.displayText.includes(optionLabel),
    `AC1: displayed name "${ac1.displayText}" matches the picked option "${optionLabel}"`,
  );
  assert.equal(ac1.displayOpacity, '1', 'AC1: picked name is the visible value');
  assert.equal(ac1.editorOpacity, '0', 'AC1: editor chrome (combobox + Xoá) collapses after the pick');
  assert.equal(ac1.magnifierOpacity, '1', 'AC1: magnifier revealed beside the name');
  assert.equal(ac1.inputAriaExpanded, 'false', 'AC1: picker menu closed after the pick');

  // --- AC2: magnifier live right after the pick → popover opens ---
  const popover = await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label^="Xem chi tiết nhà máy"]');
    if (!btn) return { found: false };
    btn.click();
    return { found: true };
  });
  await new Promise((r) => setTimeout(r, 600));
  const popState = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    return { popoverOpen: Boolean(dlg), text: (dlg?.textContent || '').slice(0, 120) };
  });
  step('AC2-magnifier-popover', { trigger: popover, ...popState });
  await page.screenshot({ path: `${QA}/2026-10-10_card101026163000_ui-2-popover.png` });
  assert.equal(popover.found, true, 'AC2: magnifier button present right after the pick');
  assert.equal(popState.popoverOpen, true, 'AC2: magnifier opens the factory detail popover');
  assert.ok((popState.text || '').length > 0, 'AC2: popover carries factory detail text');
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 600));

  // --- AC3: collapsed cell re-opens its editor on click; Escape collapses ---
  await page.evaluate(() => {
    const cell = document.querySelector('td[data-field-id$="-factory"]');
    const input = cell?.querySelector('input');
    input?.focus();
    input?.click();
  });
  await new Promise((r) => setTimeout(r, 800));
  const reopen = await page.evaluate(`${PROBE}('-factory')`);
  step('AC3-menu-reopened', reopen);
  await page.screenshot({ path: `${QA}/2026-10-10_card101026163000_ui-3-menu-open.png` });
  assert.equal(reopen.inputAriaExpanded, 'true', 'AC3: clicking the collapsed cell reopens the picker menu');
  assert.equal(reopen.editorOpacity, '1', 'AC3: editor chrome visible while the menu is open');
  assert.equal(reopen.displayOpacity, '0', 'AC3: value text yields to the editor while the menu is open');
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 600));
  const recollapsed = await page.evaluate(`${PROBE}('-factory')`);
  step('AC3-after-escape', recollapsed);
  assert.equal(recollapsed.inputAriaExpanded, 'false', 'AC3: Escape closes the menu');
  assert.equal(recollapsed.editorOpacity, '0', 'AC3: Escape collapses the editor chrome again');
  assert.equal(recollapsed.displayOpacity, '1', 'AC3: picked name back as the visible value');

  // --- AC4: keyboard flow — Tab from Số container opens the type picker (272) ---
  await page.evaluate(() => document.querySelector('td[data-field-id$="-number"] input')?.focus());
  await page.keyboard.press('Tab');
  await new Promise((r) => setTimeout(r, 900));
  const tabHandoff = await page.evaluate(`${PROBE}('-type')`);
  step('AC4-tab-handoff-type-picker', tabHandoff);
  assert.equal(tabHandoff.inputAriaExpanded, 'true', 'AC4: Tab from Số container opens the type picker (card 20261002_272 intact)');
  assert.equal(tabHandoff.editorOpacity, '1', 'AC4: type editor chrome visible while its menu is open');
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 500));

  // --- AC6 sibling: pickup port picker collapses after a pick ---
  await page.evaluate(() => {
    const input = document.querySelector('td[data-field-id$="-pickup-port"] input');
    input?.focus();
    input?.click();
  });
  await new Promise((r) => setTimeout(r, 800));
  const portPickLabel = await page.evaluate(() => document.querySelector('[role="option"]')?.textContent?.trim().slice(0, 60) ?? null);
  await page.evaluate(() => document.querySelector('[role="option"]')?.click());
  await new Promise((r) => setTimeout(r, 800));
  const portAfter = await page.evaluate(`${PROBE}('-pickup-port')`);
  step('AC6-port-after-pick', { option: portPickLabel, ...portAfter });
  await page.screenshot({ path: `${QA}/2026-10-10_card101026163000_ui-4-port-after-pick.png` });
  assert.ok(portPickLabel, 'AC6: a port option was offered');
  assert.equal(portAfter.inputAriaExpanded, 'false', 'AC6: port picker menu closed after the pick');
  assert.equal(portAfter.editorOpacity, '0', 'AC6: port cell collapses to its value after the pick');
  assert.equal(portAfter.displayOpacity, '1', 'AC6: port name is the visible value');
  assert.ok(portAfter.displayText && portAfter.displayText !== 'Chọn cảng nâng', 'AC6: picked port shown, not the placeholder');

  // --- AC5: narrow layout keeps editors continuously visible (≤1037px container) ---
  await page.setViewport({ width: 390, height: 844 });
  await new Promise((r) => setTimeout(r, 1200));
  const narrow = await page.evaluate(`${PROBE}('-factory')`);
  step('AC5-narrow-390-editor-visible', narrow);
  await page.screenshot({ path: `${QA}/2026-10-10_card101026163000_ui-5-narrow-390.png` });
  assert.equal(narrow.editorOpacity, '1', 'AC5: ≤1037px stacked layout keeps the editor continuously visible');
  assert.equal(narrow.displayOpacity, '1', 'AC5: value line still readable in the stacked card');

  step('done', { note: 'read-only rung — create form never saved; no persisted mutation by design' });
} catch (err) {
  step('FATAL', { error: String(err && err.message || err) });
  throw err;
} finally { await browser.close(); }
appendFileSync(DRIVER_LOG, 'RUNG PASS\nDRIVER OK\n');
console.log('RUNG PASS');
console.log('DRIVER OK');
