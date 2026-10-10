// Card 101026163010 (FB-009) — LOCAL UI rung: the per-row copy-time button
// must be STABLE in the accessibility tree and directly clickable, with the
// hover reveal kept (ruling 2026-09-18). Role CUS (thanhdc, local seed).
// Read-only — the create form is never saved.
//
//   AC0 control   : re-injecting the old `visibility: hidden` rule drops the
//                   button out of the AX tree — proves this rung detects the
//                   regression it pins (red-first control, no source edits)
//   AC1 at rest   : button present in the AX tree, opacity 0, hit-testable at
//                   its own centre with NO hover and NO focus in the row
//   AC2 hover     : row hover reveals it (opacity 1) and swaps the ordinal out
//   AC3 coarse/≤640: permanently revealed at 390px with the pointer parked
//   AC4 click     : a direct click copies the schedule to the empty row and
//                   the success toast fires
//
// Design provenance: house primitive (26px STT-cell icon button, rulings
// 2026-09-18 / card 20261010_3); Untitled UI PRO consulted for a table-cell
// copy affordance — no catalog component matches this slot, house button kept.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { appendFileSync, writeFileSync } from 'node:fs';

const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const DRIVER_LOG = `${QA}/2026-10-10_card101026163010_ui-driver.log`;
writeFileSync(DRIVER_LOG, '');
const step = (s, o = {}) => {
  const line = JSON.stringify({ at: new Date().toISOString(), step: s, ...o });
  appendFileSync(DRIVER_LOG, line + '\n');
  console.log(line);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'thanhdc', password: 'Abc123' }),
});
if (!login.ok) throw new Error(`login thanhdc failed: ${login.status}`);
const token = (await login.json()).token;
step('login', { user: 'thanhdc (CUS)', gotToken: Boolean(token) });

const AX_NAME = 'Copy ngày giờ đóng trả';
const axHasCopyButton = async (page) => {
  const snap = await page.accessibility.snapshot({ interestingOnly: false });
  const stack = snap ? [snap] : [];
  while (stack.length) {
    const n = stack.pop();
    if ((n.name || '').includes(AX_NAME) && n.role === 'button') return true;
    if (n.children) stack.push(...n.children);
  }
  return false;
};
const probe = (page) => page.evaluate(() => {
  const b = document.querySelector('.csc-container-row__copy');
  const ordinal = document.querySelector('.csc-container-row__desktop-index');
  const rows = [...document.querySelectorAll('.csc-container-row')];
  const r2 = rows[1];
  if (!b) {
    return {
      button: false,
      row2Filled: r2 ? Boolean(r2.querySelector('input[data-seg="hh"]')?.value) : null,
      rows: rows.length,
    };
  }
  const r = b.getBoundingClientRect();
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const inViewport = cy > 0 && cy < window.innerHeight;
  const hit = inViewport ? document.elementFromPoint(cx, cy) : null;
  return {
    button: true,
    opacity: getComputedStyle(b).opacity,
    visibility: getComputedStyle(b).visibility,
    inViewport,
    hitIsButtonOrChild: Boolean(hit && (hit === b || b.contains(hit))),
    hitDesc: hit ? `${hit.tagName}.${typeof hit.className === 'string' ? hit.className : 'svg'}` : null,
    ordinalVisibility: ordinal ? getComputedStyle(ordinal).visibility : null,
    rows: rows.length,
    row2Filled: r2 ? Boolean(r2.querySelector('input[data-seg="hh"]')?.value) : null,
  };
});
const parkPointer = async (page) => {
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.mouse.move(1300, 40);
  await sleep(400);
};

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle0', timeout: 90000 })
    .catch(() => step('goto', { note: 'networkidle timeout — continue' }));
  await page.waitForFunction(() => document.body.innerText.includes('Khách hàng'), { timeout: 90000 });
  step('form-loaded');

  // 2 rows, then schedule row 1 (segments committed by Tab).
  const addBtn = await page.evaluateHandle(() => [...document.querySelectorAll('button')]
    .find((b) => (b.innerText || '').trim() === 'Thêm container'));
  await addBtn.asElement().click();
  await sleep(600);
  const segValues = { hh: '09', mm: '00', dd: '20', mm2: '10', yyyy: '2026' };
  for (const [seg, val] of Object.entries(segValues)) {
    const el = await page.$(`tr.csc-container-row input[data-seg="${seg}"]`);
    await el.click({ clickCount: 3 });
    await el.type(val);
  }
  await page.keyboard.press('Tab');
  await sleep(600);

  // AC0 — control: the OLD rule drops the button out of the AX tree.
  const tag = await page.addStyleTag({ content: '.csc-container-row__copy { visibility: hidden !important; }' });
  await sleep(300);
  const axWithOldRule = await axHasCopyButton(page);
  step('AC0-control-old-visibility-hidden', { axHasButton: axWithOldRule });
  await tag.evaluate((el) => el.remove());
  await sleep(300);
  const axAfterControl = await axHasCopyButton(page);
  step('AC0-after-removing-control', { axHasButton: axAfterControl });
  assert.equal(axWithOldRule, false, 'AC0: old visibility:hidden rule removes the button from the AX tree');
  assert.equal(axAfterControl, true, 'AC0: without the old rule the button is back in the AX tree');

  // AC1 — at rest (no hover, no focus in the row).
  await parkPointer(page);
  const axAtRest = await axHasCopyButton(page);
  const rest = await probe(page);
  step('AC1-at-rest', { axHasButton: axAtRest, ...rest });
  await page.screenshot({ path: `${QA}/2026-10-10_card101026163010_ui-1-at-rest.png` });
  assert.equal(axAtRest, true, 'AC1: button present in the AX tree without hover/focus');
  assert.equal(rest.button, true, 'AC1: button mounted');
  assert.equal(rest.opacity, '0', 'AC1: visually hidden at rest');
  assert.equal(rest.visibility, 'visible', 'AC1: not visibility:hidden (that is the reported defect)');
  assert.equal(rest.hitIsButtonOrChild, true, 'AC1: hit-test at its centre lands on the button without hover');
  assert.equal(rest.ordinalVisibility, 'visible', 'AC1: ordinal still shown at rest');
  assert.equal(rest.row2Filled, false, 'AC1: destination row still empty before the click');

  // AC2 — row hover reveals the icon and swaps the ordinal out.
  await page.hover('tr.csc-container-row');
  await sleep(400);
  const hovered = await probe(page);
  step('AC2-hover', hovered);
  await page.screenshot({ path: `${QA}/2026-10-10_card101026163010_ui-2-hover.png` });
  assert.equal(hovered.opacity, '1', 'AC2: hover reveals the button');
  assert.equal(hovered.ordinalVisibility, 'hidden', 'AC2: ordinal swaps out while hovered');

  // AC3 — narrow (≤640px) keeps it revealed with the pointer parked.
  await page.setViewport({ width: 390, height: 844 });
  await parkPointer(page);
  const narrow = await probe(page);
  step('AC3-narrow-390', narrow);
  await page.screenshot({ path: `${QA}/2026-10-10_card101026163010_ui-3-narrow-390.png` });
  assert.equal(narrow.button, true, 'AC3: button still mounted at 390px');
  assert.equal(narrow.opacity, '1', 'AC3: ≤640px keeps the affordance permanently revealed');

  // AC4 — direct click copies the schedule to the empty row + success toast.
  await page.setViewport({ width: 1440, height: 1000 });
  await sleep(600);
  const handle = await page.$('.csc-container-row__copy');
  assert.ok(handle, 'AC4: copy button handle resolvable');
  await handle.click();
  let toast = null;
  for (let i = 0; i < 10 && !toast; i += 1) {
    await sleep(400);
    toast = await page.evaluate(() => [...document.querySelectorAll('.toast__message, .toast')]
      .map((n) => (n.textContent || '').trim()).find((t) => t.includes('Đã copy')) || null);
  }
  const after = await probe(page);
  step('AC4-after-click', { ...after, toast });
  await page.screenshot({ path: `${QA}/2026-10-10_card101026163010_ui-4-after-copy.png` });
  assert.equal(after.row2Filled, true, 'AC4: the empty row received the schedule');
  assert.ok(toast && /Đã copy ngày giờ đóng trả sang 1 container chưa có lịch/.test(toast), `AC4: success toast fired (got: ${toast})`);

  step('done', { note: 'read-only rung — create form never saved; no persisted mutation by design' });
} catch (err) {
  step('FATAL', { error: String((err && err.message) || err) });
  throw err;
} finally {
  await browser.close();
}
appendFileSync(DRIVER_LOG, 'RUNG PASS\nDRIVER OK\n');
console.log('RUNG PASS');
console.log('DRIVER OK');
