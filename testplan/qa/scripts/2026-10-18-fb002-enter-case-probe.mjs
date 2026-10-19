// FB-002 (181026000027) save-flow case probes on the schedule quick-edit
// dialog "Chỉnh sửa Lịch trình" (TimeInput host), per QA retest on staging
// 8fc1bcf5 (2026-10-18):
//   CASE 1 (must stay green): type "14:30" WITH colon + Enter → saves.
//   CASE 2 (FAILS on staging): type "1430" NO colon + Enter → first Enter
//         does not save; second Enter does. Suspect: unnormalized "1430"
//         draft → validation → swallow, or typedSinceOpen reset.
//   CASE 3 (FAILS on staging): ArrowDown opens picker → type + Enter →
//         only the picker closes. Suspect: focus stolen into the picker
//         panel (useFocusTrap activates in keyboard mode) so keystrokes
//         never reach the input → typedSinceOpen stays false.
//
// Every keystroke logs the DOM value + focused element + picker state; every
// Enter logs dialog/toast/mutation outcomes. Fixture lot 130022 (date
// 20/10/2026, giờ 15:45) is restored to 15:45 after every successful save.
//
// Usage: node testplan/qa/scripts/2026-10-18-fb002-enter-case-probe.mjs
import puppeteer from 'puppeteer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const API = 'http://localhost:3002/api';
const BASE = process.env.QA_BASE || 'http://localhost:7175';
const OUT = process.env.QA_OUT
  ? path.resolve(process.env.QA_OUT)
  : path.resolve(import.meta.dirname, '../../../qa/2026-10-18_fb002-enter-cases_repro');
fs.mkdirSync(OUT, { recursive: true });

const LOG = [];
const log = (step, obj = {}) => {
  const e = { at: new Date().toISOString(), step, ...obj };
  LOG.push(e);
  console.log(JSON.stringify(e));
};
const results = [];
let exitCode = 0;
const record = (id, pass, detail) => {
  results.push({ id, pass, detail });
  if (!pass) exitCode = 1;
  log('RESULT', { id, pass, detail });
};

const login = async (identifier) => {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (!res.ok) throw new Error(`login ${identifier} -> ${res.status}`);
  const { token } = await res.json();
  return token;
};

const api = (token) => async (method, p, body) => {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = text;
  try { parsed = JSON.parse(text); } catch { /* keep raw */ }
  return { status: res.status, body: parsed };
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });

try {
  const token = await login('cus');
  const call = api(token);
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const mutations = [];
  page.on('request', (req) => {
    if (/\/api\//.test(req.url()) && !['GET', 'OPTIONS'].includes(req.method())) {
      mutations.push({ method: req.method(), url: req.url(), body: req.postData() ?? null });
      log('mutation', { method: req.method(), url: req.url(), body: (req.postData() ?? '').slice(0, 400) });
    }
  });
  page.on('response', (res) => {
    if (/\/api\//.test(res.url()) && !['GET', 'OPTIONS'].includes(res.request().method())) {
      log('mutation_status', { status: res.status(), url: res.url() });
    }
  });

  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  const state = () => page.evaluate(() => {
    const dlg = Array.from(document.querySelectorAll('[role="dialog"]'))
      .find((m) => (m.querySelector('.modal__title')?.textContent || '').trim() === 'Chỉnh sửa Lịch trình') ?? null;
    const a = document.activeElement;
    const time = dlg?.querySelector('.time-input input') ?? null;
    return {
      dialogOpen: Boolean(dlg),
      timeValue: time?.value ?? null,
      activeIsTimeInput: a === time,
      activeTag: a?.tagName ?? null,
      activeRole: a?.getAttribute('role') ?? null,
      activeLabel: (a?.getAttribute('aria-label') ?? a?.textContent ?? '').trim().slice(0, 40),
      activeInPicker: Boolean(a?.closest?.('.time-picker__popup, .time-picker__sheet, [data-time-picker-overlay]')),
      pickerOpen: Boolean(document.querySelector('.time-picker__popup, .time-picker__sheet')),
      alertText: Array.from(dlg?.querySelectorAll('[role="alert"]') ?? []).map((e) => e.textContent?.trim()).join('|') || null,
      toast: document.querySelector('.app-notices, [role="status"]')?.textContent?.trim() ?? null,
    };
  });

  const DIALOG_TITLE = 'Chỉnh sửa Lịch trình';
  const TRIGGER_ID = 'cus-inline-schedule-130022';
  const LIST_URL = `${BASE}/shipments?transportDateFrom=2026-10-20&transportDateTo=2026-10-20`;

  const openDialog = async () => {
    await page.goto(LIST_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector(`#${TRIGGER_ID}`, { timeout: 20000 });
    await page.evaluate((id) => document.getElementById(id)?.scrollIntoView({ block: 'center' }), TRIGGER_ID);
    await sleep(150);
    const btn = await page.$(`#${TRIGGER_ID}`);
    await btn.click({ timeout: 5000 }).catch(async () => btn.evaluate((el) => el.click()));
    await page.waitForFunction(
      (title) => Array.from(document.querySelectorAll('.modal__title')).some((el) => (el.textContent || '').trim() === title),
      { timeout: 10000 }, DIALOG_TITLE,
    );
    await sleep(300);
    return state();
  };
  const closeDialog = async () => {
    await page.evaluate((title) => {
      const dlg = Array.from(document.querySelectorAll('[role="dialog"]'))
        .find((m) => (m.querySelector('.modal__title')?.textContent || '').trim() === title);
      Array.from(dlg?.querySelectorAll('button') ?? []).find((b) => (b.textContent || '').trim() === 'Hủy')?.click();
    }, DIALOG_TITLE);
    await sleep(450);
  };

  const snapshot = async () => {
    const d = await call('GET', '/shipments/cus-workspace/130022');
    const s = d.body?.summary ?? {};
    return { closingAt: s.closingAt ?? null, transportDate: s.transportDate ?? null, version: s.version };
  };

  // Type text char-by-char, logging the DOM state after every keystroke.
  const typeLogged = async (text, label, delayMs = 60) => {
    for (const ch of text) {
      await page.keyboard.type(ch);
      await sleep(delayMs);
      log(`${label}_key_${ch}`, await state());
    }
  };

  const pressEnterLogged = async (label) => {
    mutations.length = 0;
    await page.keyboard.press('Enter');
    await sleep(1200);
    const st = await state();
    log(`${label}_enter`, { ...st, mutations: mutations.length, mutationBodies: mutations.map((m) => `${m.method} ${m.url.replace('http://localhost:3002/api', '')} ${m.body ?? ''}`) });
    return st;
  };

  const before = await snapshot();
  log('fixture_before', before);

  /* ── CASE 2: type "1430" NO colon + Enter (QA: first Enter must save) ──── */
  let st = await openDialog();
  log('case2_open', st);
  await page.screenshot({ path: path.join(OUT, 'case2_01_open.png') });
  const timeInput = await page.$('[role="dialog"] .time-input input');
  await timeInput.click();
  await sleep(300);
  log('case2_after_click', await state());
  await typeLogged('1430', 'case2');
  st = await state();
  await page.screenshot({ path: path.join(OUT, 'case2_02_after-typing-1430.png') });
  mutations.length = 0;
  const c2first = await pressEnterLogged('case2_first');
  await page.screenshot({ path: path.join(OUT, 'case2_03_after-first-enter.png') });
  const c2saved = !c2first.dialogOpen && mutations.length > 0;
  if (!c2saved) {
    const c2second = await pressEnterLogged('case2_second');
    await page.screenshot({ path: path.join(OUT, 'case2_04_after-second-enter.png') });
    record('CASE2 typed "1430" + FIRST Enter saves the schedule (no double Enter)', c2saved,
      `firstEnter: dialogOpen=${c2first.dialogOpen} mutations=${c2first.mutations ?? mutations.length} timeValue=${c2first.timeValue} activeIsTime=${c2first.activeIsTimeInput} pickerOpen=${c2first.pickerOpen} alert=${c2first.alertText}; secondEnter: dialogOpen=${c2second.dialogOpen} toast=${c2second.toast}`);
  } else {
    record('CASE2 typed "1430" + FIRST Enter saves the schedule (no double Enter)', true,
      `firstEnter: dialogOpen=false toast=${c2first.toast} timeValue(before)=${st.timeValue}`);
  }
  if ((await state()).dialogOpen) await closeDialog();

  // Restore fixture giờ 15:45 when a save changed it.
  let snap = await snapshot();
  log('case2_after_snapshot', snap);
  if (snap.closingAt !== before.closingAt) {
    st = await openDialog();
    await (await page.$('[role="dialog"] .time-input input')).click();
    await sleep(250);
    await typeLogged('1545', 'case2_restore');
    await pressEnterLogged('case2_restore');
    snap = await snapshot();
    log('case2_restored', snap);
    if ((await state()).dialogOpen) await closeDialog();
  }

  /* ── CASE 3: ArrowDown opens picker → type "1430" + Enter (QA: saves) ─── */
  st = await openDialog();
  log('case3_open', st);
  await page.screenshot({ path: path.join(OUT, 'case3_01_open.png') });
  // Focus the giờ input WITHOUT clicking (click opens the picker): Tab from
  // the dialog's autofocus landing or focus() directly — mirror the QA
  // keyboard path. autoFocus is on the giờ input when the dialog opens.
  await page.keyboard.press('ArrowDown');
  await sleep(350);
  log('case3_after_arrowdown', await state());
  await page.screenshot({ path: path.join(OUT, 'case3_02_after-arrowdown.png') });
  await typeLogged('1430', 'case3');
  st = await state();
  await page.screenshot({ path: path.join(OUT, 'case3_03_after-typing-1430.png') });
  mutations.length = 0;
  const c3first = await pressEnterLogged('case3_first');
  await page.screenshot({ path: path.join(OUT, 'case3_04_after-first-enter.png') });
  const c3saved = !c3first.dialogOpen && mutations.length > 0;
  if (!c3saved) {
    const c3second = await pressEnterLogged('case3_second');
    await page.screenshot({ path: path.join(OUT, 'case3_05_after-second-enter.png') });
    record('CASE3 ArrowDown picker + typed "1430" + FIRST Enter saves the schedule', c3saved,
      `firstEnter: dialogOpen=${c3first.dialogOpen} pickerOpen=${c3first.pickerOpen} mutations=${c3first.mutations ?? mutations.length} timeValue=${c3first.timeValue} activeInPicker=${c3first.activeInPicker}; secondEnter: dialogOpen=${c3second.dialogOpen} toast=${c3second.toast}`);
  } else {
    record('CASE3 ArrowDown picker + typed "1430" + FIRST Enter saves the schedule', true,
      `firstEnter: dialogOpen=false toast=${c3first.toast}`);
  }
  if ((await state()).dialogOpen) await closeDialog();

  snap = await snapshot();
  log('case3_after_snapshot', snap);
  if (snap.closingAt !== before.closingAt) {
    st = await openDialog();
    await (await page.$('[role="dialog"] .time-input input')).click();
    await sleep(250);
    await typeLogged('1545', 'case3_restore');
    await pressEnterLogged('case3_restore');
    snap = await snapshot();
    log('case3_restored', snap);
    if ((await state()).dialogOpen) await closeDialog();
  }

  /* ── CASE 1: type "14:30" WITH colon + Enter (must stay green) ────────── */
  st = await openDialog();
  log('case1_open', st);
  await (await page.$('[role="dialog"] .time-input input')).click();
  await sleep(300);
  await typeLogged('14:30', 'case1');
  await page.screenshot({ path: path.join(OUT, 'case1_01_after-typing-14-30.png') });
  mutations.length = 0;
  const c1first = await pressEnterLogged('case1_first');
  await page.screenshot({ path: path.join(OUT, 'case1_02_after-enter.png') });
  record('CASE1 typed "14:30" + Enter saves the schedule (unchanged law)', !c1first.dialogOpen && mutations.length > 0,
    `dialogOpen=${c1first.dialogOpen} mutations=${c1first.mutations ?? mutations.length} toast=${c1first.toast}`);
  if ((await state()).dialogOpen) await closeDialog();

  snap = await snapshot();
  log('case1_after_snapshot', snap);
  if (snap.closingAt !== before.closingAt) {
    st = await openDialog();
    await (await page.$('[role="dialog"] .time-input input')).click();
    await sleep(250);
    await typeLogged('1545', 'case1_restore');
    await pressEnterLogged('case1_restore');
    snap = await snapshot();
    log('case1_restored', snap);
    if ((await state()).dialogOpen) await closeDialog();
  }

  const final = await snapshot();
  log('fixture_final', final);
  record('FIXTURE RESTORED (closingAt back to the pre-probe value)', final.closingAt === before.closingAt,
    `before=${JSON.stringify(before)} final=${JSON.stringify(final)}`);

  log('SUMMARY', { pass: results.filter((r) => r.pass).length, fail: results.filter((r) => !r.pass).length, results });
  fs.writeFileSync(path.join(OUT, 'probe-log.json'), JSON.stringify(LOG, null, 2));
  fs.writeFileSync(path.join(OUT, 'probe-results.json'), JSON.stringify(results, null, 2));
  console.log(`\n== ${results.filter((r) => r.pass).length}/${results.length} probes pass; exit ${exitCode} ==`);
} finally {
  await browser.close();
}
process.exit(exitCode);
