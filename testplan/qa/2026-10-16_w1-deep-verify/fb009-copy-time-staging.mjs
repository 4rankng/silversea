// FB-009 re-drive (card 131026233500) — staging rung-3 on the pinned build.
// The card: "nút copy thời gian vẫn không tồn tại ở bất kỳ đâu" — the fix
// (a56c6882, case-2026-10-16-fb009-copy-time-dialog-and-section.md) added two
// clipboard affordances on Tạo lô hàng (/shipments/new):
//   S1 section group "Ngày giờ đóng trả cho tất cả cont" — .csc-bulk-appointment__copy
//      beside the field, always visible, present only once the typed value
//      parses ("HH:mm DD/MM/YYYY" = formatDateTime24 non-empty)
//   S2 "Chọn ngày giờ" dialog (row appointment picker) — .combined-datetime__copy
//      in the header beside "Đóng lịch", present only once draft date AND time
//      parse
// Both write the OS clipboard and raise the "Đã copy giờ hẹn …" toast.
// Read-only phase: the create form is never saved. Driver role CUS (`cus`,
// sanctioned staging exception; fallback thanhdc). Extends
// testplan/qa/scripts/fb009-copy-button-ax-rung.mjs (local per-row rung).
// Run from repo root: node testplan/qa/2026-10-16_w1-deep-verify/fb009-copy-time-staging.mjs
import assert from 'node:assert/strict';
import {
  closeBrowser, finish, goto, log, openAs, shot,
} from './w1-lib.mjs';

const CARD = 'fb009';
const PIN = '9e400e63';
const results = {};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 0) Build gate — owner pin 2026-10-16 16:48+08: staging re-cut 5a139108 →
//    9e400e63 (fleet merge; no changes to FB-009 surfaces under test).
const health = await fetch('https://vantai.tingting.vip/api/health').then(r => r.json());
log(`HEALTH buildHash=${health.buildHash} (pin ${PIN})`);
if (health.buildHash !== PIN) throw new Error(`BUILD GATE FAIL: ${health.buildHash} != pin ${PIN}`);
results.buildHash = health.buildHash;

const page = await openAs('cus');
// Clipboard channel for the headless context — the button writes via
// navigator.clipboard.writeText (secure context on staging https).
await page.browserContext().overridePermissions('https://vantai.tingting.vip', [
  'clipboard-read', 'clipboard-write', 'clipboard-sanitized-write',
]);
await goto(page, '/shipments/new');
await page.waitForFunction(() => document.body.innerText.includes('Khách hàng'), { timeout: 90000 });
log('FORM-LOADED /shipments/new as cus');

const bulkField = () => page.$('.csc-bulk-appointment[data-field-id="shipment-bulk-appointment"]');
if (!await bulkField()) {
  // Ensure an FCL row exists so the bulk group renders (needs ≥1 empty row).
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === 'Thêm container');
    btn?.click();
  });
  await sleep(1000);
}
assert.ok(await bulkField(), 'bulk appointment group (.csc-bulk-appointment) is rendered');
await shot(page, `${CARD}_01-form.png`, { fullPage: false });

// S1 gating — no copy button while the group value is empty.
const s1AbsentInitially = await page.$('.csc-bulk-appointment__copy') === null;
log(`S1 copy absent on empty value -> ${s1AbsentInitially}`);
results.s1_absent_when_empty = s1AbsentInitially;

// Fill the bulk appointment segments (HH:mm DD/MM/YYYY), commit with Tab.
for (const [seg, val] of [['hh', '09'], ['mm', '00'], ['dd', '20'], ['mm2', '10'], ['yyyy', '2026']]) {
  const el = await (await bulkField()).$(`input[data-seg="${seg}"]`);
  assert.ok(el, `bulk segment ${seg} present`);
  await el.click({ clickCount: 3 });
  await el.type(val);
}
await page.keyboard.press('Tab');
await sleep(800);

const s1 = await page.$('.csc-bulk-appointment__copy');
assert.ok(s1, 'S1 copy button mounts once the bulk value parses');
// Always-visible contract: no hover-reveal — visible, hit-testable at rest.
const s1Probe = await page.evaluate(() => {
  const b = document.querySelector('.csc-bulk-appointment__copy');
  const r = b.getBoundingClientRect();
  const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return {
    aria: b.getAttribute('aria-label'),
    opacity: getComputedStyle(b).opacity,
    visibility: getComputedStyle(b).visibility,
    hitIsSelf: Boolean(hit && (hit === b || b.contains(hit))),
  };
});
log(`S1 probe ${JSON.stringify(s1Probe)}`);
results.s1_present_when_parsed = true;
results.s1_aria = s1Probe.aria;
results.s1_always_visible = s1Probe.opacity === '1' && s1Probe.visibility === 'visible' && s1Probe.hitIsSelf;
await shot(page, `${CARD}_02-s1-copy-present.png`, { fullPage: false });

// S1 click → clipboard + toast.
await s1.click();
let toast1 = null;
for (let i = 0; i < 12 && !toast1; i += 1) {
  await sleep(400);
  toast1 = await page.evaluate(() => [...document.querySelectorAll('.toast__message, .toast')]
    .map(n => (n.textContent || '').trim()).find(t => t.includes('Đã copy giờ hẹn')) || null);
}
await sleep(300);
const clip1 = await page.evaluate(() => navigator.clipboard.readText()).catch(e => `READ-ERR:${e.message}`);
log(`S1 clicked: toast=${JSON.stringify(toast1)} clipboard=${JSON.stringify(clip1)}`);
await shot(page, `${CARD}_03-s1-after-copy.png`, { fullPage: false });
results.s1_toast = toast1;
results.s1_clipboard = clip1;
results.s1_copy_ok = clip1 === '09:00 20/10/2026' && Boolean(toast1) && toast1.includes('09:00 20/10/2026');

// S2 negative — open the row picker on an EMPTY appointment: no copy button.
const rowTimeInput = await page.$('tr.csc-container-row input[data-seg="hh"]');
assert.ok(rowTimeInput, 'container row appointment segments present');
await rowTimeInput.click();
await sleep(900);
const s2AbsentOnEmpty = await page.evaluate(() => {
  const header = [...document.querySelectorAll('header')].find(h => (h.textContent || '').includes('Chọn ngày giờ'));
  if (!header) return 'no-dialog';
  return header.querySelector('.combined-datetime__copy') === null;
});
log(`S2 copy absent on empty draft -> ${s2AbsentOnEmpty}`);
results.s2_absent_when_empty = s2AbsentOnEmpty === true;
results.s2_dialog_opened_on_empty = s2AbsentOnEmpty !== 'no-dialog';
await shot(page, `${CARD}_04-s2-dialog-empty.png`, { fullPage: false });
await page.keyboard.press('Escape');
await sleep(600);

// Fill row 1's appointment, commit, reopen the picker.
for (const [seg, val] of [['hh', '10'], ['mm', '30'], ['dd', '21'], ['mm2', '10'], ['yyyy', '2026']]) {
  const el = await page.$(`tr.csc-container-row input[data-seg="${seg}"]`);
  await el.click({ clickCount: 3 });
  await el.type(val);
}
await page.keyboard.press('Tab');
await sleep(800);
await (await page.$('tr.csc-container-row input[data-seg="hh"]')).click();
await sleep(900);
await shot(page, `${CARD}_05-s2-dialog-parsed.png`, { fullPage: false });

const s2Probe = await page.evaluate(() => {
  const header = [...document.querySelectorAll('header')].find(h => (h.textContent || '').includes('Chọn ngày giờ'));
  if (!header) return { dialog: false };
  const copy = header.querySelector('.combined-datetime__copy');
  const close = header.querySelector('button[aria-label="Đóng lịch"]');
  if (!copy) return { dialog: true, copy: false, closeBesideCopy: null };
  const parent = copy.parentElement;
  return {
    dialog: true,
    copy: true,
    aria: copy.getAttribute('aria-label'),
    closeBesideCopy: Boolean(close && parent === close.parentElement),
  };
});
log(`S2 probe ${JSON.stringify(s2Probe)}`);
results.s2_dialog_with_copy = s2Probe.dialog === true && s2Probe.copy === true;
results.s2_aria = s2Probe.aria ?? null;
results.s2_beside_close_button = s2Probe.closeBesideCopy ?? false;

const s2btn = await page.$('.combined-datetime__copy');
await s2btn.click();
let toast2 = null;
for (let i = 0; i < 12 && !toast2; i += 1) {
  await sleep(400);
  toast2 = await page.evaluate(() => [...document.querySelectorAll('.toast__message, .toast')]
    .map(n => (n.textContent || '').trim()).find(t => t.includes('Đã copy giờ hẹn')) || null);
}
await sleep(300);
const clip2 = await page.evaluate(() => navigator.clipboard.readText()).catch(e => `READ-ERR:${e.message}`);
log(`S2 clicked: toast=${JSON.stringify(toast2)} clipboard=${JSON.stringify(clip2)}`);
await shot(page, `${CARD}_06-s2-after-copy.png`, { fullPage: false });
results.s2_toast = toast2;
results.s2_clipboard = clip2;
results.s2_copy_ok = clip2 === '10:30 21/10/2026' && Boolean(toast2) && toast2.includes('10:30 21/10/2026');

// Regression context (card 101026163010 surface): the per-row copy-down
// button still fills empty sibling rows. It is gated on an empty row
// existing, so add a second container first. In-form only — nothing saved.
await page.keyboard.press('Escape');
await sleep(600);
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === 'Thêm container');
  btn?.click();
});
await sleep(1200);
// "Thêm container" clones the last row — clear row 2's appointment so an
// empty sibling exists for the copy-down.
await page.evaluate(() => {
  const rows = [...document.querySelectorAll('tr.csc-container-row')];
  const r2 = rows[1];
  [...(r2?.querySelectorAll('input[data-seg]') ?? [])].forEach((i) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(i, '');
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
});
await sleep(900);
const perRow = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('tr.csc-container-row')];
  const target = rows.find(r => r.querySelector('.csc-container-row__copy'));
  const btn = target?.querySelector('.csc-container-row__copy');
  if (!btn) return { present: false, rows: rows.length };
  btn.scrollIntoView({ block: 'center' });
  btn.click();
  return { present: true, rows: rows.length };
});
await sleep(1200);
const row2After = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('tr.csc-container-row')];
  const r2 = rows[1];
  const segs = r2 ? [...r2.querySelectorAll('input[data-seg]')].map(i => i.value) : [];
  return segs.join('|');
});
log(`per-row copy: ${JSON.stringify(perRow)} row2="${row2After}"`);
results.per_row_present = perRow.present === true;
results.per_row_filled_empty_sibling = row2After.includes('10') && row2After.includes('30') && row2After.includes('2026');

log('note: create form never saved — read-only phase by design (clipboard + toast only)');
await finish(CARD, results);

const fails = Object.entries(results).filter(([, v]) => v === false || v === null);
console.log('FB009 RESULT:', fails.length ? `FAIL — ${fails.map(([k]) => k).join(', ')}` : 'PASS');
if (fails.length) process.exit(1);
