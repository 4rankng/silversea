// QA1-007 verify-fail round 2 (kanban card 171026113510) — the create-form
// "Bắt buộc" chip must count EVERY enforced field of the current mode, and the
// "Cần bổ sung N thông tin" panel must be on screen BEFORE the operator ever
// presses "Tạo lô hàng". The reported defect was "Bắt buộc: 3/3" with six
// unmet requirements and no panel until a submit attempt.
//
// LOCAL ONLY: vite 7175 → api 3002. Role CUS (thanhdc).
//   node testplan/qa/scripts/2026-10-17-qa1007-chip-denominator-rung.mjs
// Exit 0 = every rung PASS.

import puppeteer from 'puppeteer';
import fs from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:7175';
const API = `${BASE}/api`;
const SHOTS = process.env.SHOTS ?? '/tmp/qa1007';
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function record(rung, verdict, detail) {
  results.push({ rung, verdict, detail });
  console.log(`[${verdict}] ${rung} — ${detail}`);
}

async function loginWithRetry(identifier, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password: 'Abc123' }),
    });
    const text = await res.text();
    if (res.ok && text) { try { return JSON.parse(text); } catch { /* retry */ } }
    await sleep(1500 * i);
  }
  throw new Error(`login ${identifier} failed after ${attempts} attempts`);
}

const login = await loginWithRetry('thanhdc');
console.log(`logged in as ${login.user?.username} (${login.user?.role})`);

const browser = await puppeteer.launch({
  headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), login.token);

/** Chip + panel, read straight out of the live DOM. */
async function readProgress() {
  return page.evaluate(() => {
    const chip = document.querySelector('.csc-topline__progress');
    const panel = document.querySelector('.csc-validation-summary');
    const items = panel ? [...panel.querySelectorAll('li')].map((li) => (li.innerText || '').trim()).filter(Boolean) : [];
    return {
      chip: (chip?.innerText || '').replace(/\s+/g, ' ').trim(),
      panelHeadline: panel?.querySelector('strong')?.innerText?.trim() ?? null,
      panelItems: items,
      panelVisible: !!panel && panel.getClientRects().length > 0,
    };
  });
}

/** Keyboard-driven pick inside a field host (react-aria needs a real event). */
async function pickIn(hostSelector, typed, wanted) {
  const focused = await page.evaluate((sel) => {
    const host = document.querySelector(sel);
    const c = host?.querySelector('[role="combobox"]') ?? (host?.matches?.('[role="combobox"]') ? host : null);
    if (!c) return false;
    c.scrollIntoView({ block: 'center' });
    c.focus();
    return true;
  }, hostSelector);
  if (!focused) return false;
  await sleep(300);
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => document.querySelectorAll('[role="option"]').length > 0, { timeout: 10000 }).catch(() => {});
  await sleep(400);
  if (typed) { await page.keyboard.type(typed, { delay: 50 }); await sleep(900); }
  return page.evaluate((w) => {
    const o = [...document.querySelectorAll('[role="option"]')]
      .find((el) => (el.innerText || '').trim().toLowerCase().includes(w.toLowerCase()));
    if (!o) return false;
    o.scrollIntoView({ block: 'nearest' });
    o.click();
    return true;
  }, wanted);
}

async function shot(name) {
  await sleep(700);
  const path = `${SHOTS}/${name}.png`;
  await page.screenshot({ path });
  return path;
}

try {
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.csc-topline__progress', { timeout: 40000 });
  await sleep(2500);

  // ── Step 2 of the card's repro: pristine form ──────────────────────────
  // The card recorded "0/3" on an empty form as correct — that was the OLD
  // contract, where the denominator grew as you typed (which is exactly how
  // "3/3" sat next to six unmet requirements). The fixed contract is the
  // opposite: the denominator is the WHOLE mode from the first keystroke, so
  // an empty FCL form already reads 0/9 and never changes. Asserted as the
  // invariant it actually is: pristine total === filled total.
  const empty = await readProgress();
  const emptyTotal = Number((empty.chip.match(/\/(\d+)/) || [])[1] ?? 0);
  record('empty-form-denominator', empty.chip.includes('0/') && emptyTotal === 9 ? 'PASS' : 'FAIL',
    `pristine chip = ${JSON.stringify(empty.chip)} (denominator must already be the full mode)`);

  // ── Steps 3-5: fill the three identity fields, then READ — never submit ─
  const customerPicked = await pickIn('[data-field-id="shipment-customer"]', 'LONG MINH', 'LONG MINH');
  await sleep(2500);

  // Hình thức = Nhập khẩu
  const directionPicked = await page.evaluate(() => {
    const host = document.querySelector('[data-field-id="shipment-trade-direction"]')
      ?? [...document.querySelectorAll('[data-field-id]')].find((el) => /hình thức/i.test(el.getAttribute('data-field-id') || ''));
    const c = host?.querySelector('[role="combobox"], select, button');
    if (!c) return false;
    c.scrollIntoView({ block: 'center' });
    c.focus();
    c.click();
    return true;
  });
  await sleep(700);
  const directionChosen = await page.evaluate(() => {
    const o = [...document.querySelectorAll('[role="option"]')]
      .find((el) => /nhập khẩu/i.test((el.innerText || '').trim()));
    if (o) { o.click(); return 'option'; }
    const s = [...document.querySelectorAll('select')]
      .find((el) => [...el.options].some((op) => /nhập khẩu/i.test(op.text)));
    if (s) {
      const opt = [...s.options].find((op) => /nhập khẩu/i.test(op.text));
      s.value = opt.value;
      s.dispatchEvent(new Event('change', { bubbles: true }));
      return 'select';
    }
    return false;
  });
  await sleep(1500);

  // Số Bill/Booking
  const billTyped = await page.evaluate(() => {
    const host = document.querySelector('[data-field-id="shipment-booking-ref"]');
    const c = host?.querySelector('input');
    if (!c) return false;
    c.scrollIntoView({ block: 'center' });
    c.focus();
    return true;
  });
  if (billTyped) { await page.keyboard.type('BILL-QA1-007', { delay: 30 }); await sleep(1200); }

  const afterThree = await readProgress();
  const shotThree = await shot('01-ac-chip-sau-3-truong');

  // FCL, 1 container ⇒ every enforced field of the mode = 9.
  record('AC-chip-3-9', customerPicked && /Nhập khẩu/i.test(await page.evaluate(() => document.body.innerText || ''))
    && afterThree.chip.includes('3/9') ? 'PASS' : 'FAIL',
    `customerPicked=${customerPicked} directionPicked=${directionPicked} directionChosen=${directionChosen} billTyped=${billTyped} chip=${JSON.stringify(afterThree.chip)} · ${shotThree}`);

  record('AC-panel', afterThree.panelVisible && afterThree.panelHeadline === 'Cần bổ sung 6 thông tin'
    && afterThree.panelItems.length === 6 ? 'PASS' : 'FAIL',
    `panel=${JSON.stringify(afterThree)} (panel must be on screen WITHOUT any submit attempt)`);

  // ── Mode switch: LCL carries a third required operating point (FB-105),
  //    so its denominator must grow to the whole LCL form, not stay at 9. ──
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('button, [role="tab"], label')]
      .find((b) => /hàng lẻ/i.test((b.innerText || '').trim()));
    if (el) { el.scrollIntoView({ block: 'center' }); el.click(); }
  });
  await sleep(2000);
  const lcl = await readProgress();
  const shotLcl = await shot('02-ac-chip-hang-le');
  const lclTotal = Number((lcl.chip.match(/\/(\d+)/) || [])[1] ?? 0);
  record('AC-lcl-denominator', lclTotal > 9 && lcl.panelVisible ? 'PASS' : 'FAIL',
    `LCL chip=${JSON.stringify(lcl.chip)} panel=${JSON.stringify(lcl.panelHeadline)} items=${lcl.panelItems.length} · ${shotLcl}`);

  // ── Ad-hoc (Lệnh chạy ngoài) waives catalog prerequisites, so the
  //    denominator must SHRINK accordingly — no frozen denominator. ──
  // The toggle's text lives on the LABEL, not on the input — querying the
  // input for innerText finds nothing (that miss is what made this rung fail
  // the first time). Prefer the label, then fall back to any control ancestor.
  await page.evaluate(() => {
    const candidates = [...document.querySelectorAll('label, [role="checkbox"], button, span')];
    const labelled = candidates.find((el) => /lệnh chạy ngoài/i.test((el.innerText || '').trim())
      && (el.tagName === 'LABEL' || el.getAttribute('role') === 'checkbox'));
    const target = labelled
      ?? candidates.find((el) => /lệnh chạy ngoài/i.test((el.innerText || '').trim()));
    if (!target) return;
    target.scrollIntoView({ block: 'center' });
    const input = target.tagName === 'LABEL' ? target.querySelector('input') : null;
    (input ?? target).click();
  });
  await sleep(2000);
  const adhoc = await readProgress();
  const adhocTotal = Number((adhoc.chip.match(/\/(\d+)/) || [])[1] ?? 0);
  record('AC-adhoc-shrinks', adhocTotal > 0 && adhocTotal < lclTotal ? 'PASS' : 'FAIL',
    `Lệnh chạy ngoài chip=${JSON.stringify(adhoc.chip)} (was ${lcl.chip})`);
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
