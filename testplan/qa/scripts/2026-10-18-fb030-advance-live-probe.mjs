// FB-030/075 (171026215500) regression probes — card 171026215500 still fails
// on staging 8fc1bcf5: typing day "14" in the schedule dialog's "Ngày đóng/trả"
// does not advance focus to the month segment.
//
// Probes (all read-only — drafts are cancelled, mutation monitor must stay 0):
//   (a) quick-edit dialog "Chỉnh sửa Lịch trình": dd "14" → month focus
//       a1 fresh/empty dd, a2 type-over a just-typed dd, a3 dialog re-open state,
//       a4 typing dd right after the Giờ onComplete hand-off,
//       a6 QA's exact staging case: PREFILLED complete date (dated lot, fixture
//       130022 preferred) — typing "14" completes the draft and echoes through
//       the parent value (the path empty-date probes never touch)
//   (b) same dialog: Giờ "14" state, "1430" → "14:30" + onComplete → dd focus
//   (c) /shipments-detail ShipmentContainerLedger inline schedule editor:
//       same day→month and giờ probes (ScheduleEditorBody host)
//
// Usage: node testplan/qa/scripts/2026-10-18-fb030-advance-live-probe.mjs
import puppeteer from 'puppeteer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const API = 'http://localhost:3002/api';
const QA_BASE_URL = process.env.QA_BASE || 'http://localhost:7175';
const OUT = process.env.QA_OUT
  ? path.resolve(process.env.QA_OUT)
  : path.resolve(import.meta.dirname, '../../../qa/2026-10-18_fb030-advance_repro');
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
      log('mutation', { method: req.method(), url: req.url(), body: (req.postData() ?? '').slice(0, 300) });
    }
  });

  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  // Segment-state reader shared by all three surfaces.
  const segState = (scopeSelector) => page.evaluate((scopeSelector) => {
    const scope = scopeSelector ? document.querySelector(scopeSelector) : document;
    const a = document.activeElement;
    const segs = {};
    for (const s of ['dd', 'mm2', 'yyyy']) {
      segs[s] = scope?.querySelector(`[data-seg="${s}"]`)?.value ?? null;
    }
    return {
      activeSeg: a?.getAttribute('data-seg') ?? null,
      activeLabel: a?.getAttribute('aria-label') ?? null,
      timeValue: scope?.querySelector('.time-input input')?.value ?? null,
      ...segs,
    };
  }, scopeSelector);

  /* ══════════════ (a)+(b): quick-edit dialog "Chỉnh sửa Lịch trình" ══════════ */
  const DIALOG_TITLE = 'Chỉnh sửa Lịch trình';
  const dlg = () => '[role="dialog"]';

  // Collect every enabled schedule trigger on the default listing.
  await page.goto(`${QA_BASE_URL}/shipments`, { waitUntil: 'networkidle2', timeout: 60000 });
  const triggers = [];
  for (let p = 1; p <= 12; p += 1) {
    await page.goto(`${QA_BASE_URL}/shipments?page=${p}`, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('table', { timeout: 20000 });
    const found = await page.evaluate(() => Array.from(document.querySelectorAll('button[aria-label^="Sửa ô lịch trình lô hàng"]'))
      .filter((b) => !b.disabled)
      .map((b) => b.id));
    triggers.push(...found.map((id) => ({ page: p, id })));
  }
  log('schedule_triggers', { count: triggers.length, ids: triggers.slice(0, 20).map((t) => t.id) });
  if (triggers.length === 0) throw new Error('no enabled "Sửa ô lịch trình" trigger on pages 1..12');

  const lotInfo = async (id) => {
    const shipmentId = Number(id.replace('cus-inline-schedule-', ''));
    const d = await call('GET', `/shipments/cus-workspace/${shipmentId}`);
    const s = d.body?.summary ?? {};
    return {
      shipmentId, triggerId: id,
      transportDate: s.transportDate ?? null,
      closingAt: s.closingAt ?? null,
      plannedReturnAt: s.plannedReturnAt ?? null,
      version: s.version,
    };
  };

  // Dated lot first — QA's staging scenario (fixture 130022 if visible).
  let datedLot = null;
  for (const t of triggers) {
    const info = await lotInfo(t.id);
    if (info.transportDate) {
      log('dated_lot_candidate', info);
      if (info.shipmentId === 130022) { datedLot = { ...t, info, gotoUrl: `${QA_BASE_URL}/shipments?page=${t.page}` }; break; }
      if (!datedLot) datedLot = { ...t, info, gotoUrl: `${QA_BASE_URL}/shipments?page=${t.page}` };
    }
  }
  // No dated lot in the default queue (fixture residue moved 130022 under its
  // own date filter) — surface it through the transport-date filter instead.
  if (!datedLot) {
    for (const day of ['2026-10-20', '2026-10-19', '2026-10-21']) {
      const gotoUrl = `${QA_BASE_URL}/shipments?transportDateFrom=${day}&transportDateTo=${day}`;
      await page.goto(gotoUrl, { waitUntil: 'networkidle2', timeout: 60000 });
      await page.waitForSelector('table', { timeout: 20000 });
      await sleep(1500);
      const found = await page.evaluate(() => Array.from(document.querySelectorAll('button[aria-label^="Sửa ô lịch trình lô hàng"]'))
        .filter((b) => !b.disabled)
        .map((b) => b.id));
      for (const id of found) {
        const info = await lotInfo(id);
        if (info.transportDate) { datedLot = { id, page: 0, info, gotoUrl }; log('dated_lot_candidate_filtered', info); break; }
      }
      if (datedLot) break;
    }
  }
  const emptyLot = { ...triggers[0], info: await lotInfo(triggers[0].id) };
  log('empty_lot', emptyLot.info);

  const findTrigger = async (triggerId) => page.$(`button[id="${triggerId}"]:not([disabled])`);
  const openDialog = async (triggerId) => {
    // Shared-DB hardening (2026-10-18): concurrent fixture churn reshuffles
    // the queue pages between the scan and the revisit, so a pinned page
    // number goes stale mid-run (143351 drifted page 1 → 6 within seconds).
    // Relocate the trigger with a bounded re-scan instead of trusting it.
    let btn = await findTrigger(triggerId);
    for (let p = 1; p <= 12 && !btn; p += 1) {
      await page.goto(`${QA_BASE_URL}/shipments?page=${p}`, { waitUntil: 'networkidle2', timeout: 60000 });
      await page.waitForSelector('table', { timeout: 20000 });
      btn = await findTrigger(triggerId);
      if (btn) log('relocated', { triggerId, page: p });
    }
    if (!btn) throw new Error(`trigger ${triggerId} not found on pages 1..12 after relocate scan`);
    await page.evaluate((id) => document.getElementById(id)?.scrollIntoView({ block: 'center' }), triggerId);
    await sleep(150);
    await btn.click({ timeout: 5000 }).catch(async () => btn.evaluate((el) => el.click()));
    await page.waitForFunction(
      (title) => Array.from(document.querySelectorAll('.modal__title')).some((el) => (el.textContent || '').trim() === title),
      { timeout: 10000 }, DIALOG_TITLE,
    );
    await sleep(300);
  };
  const closeDialog = async () => {
    await page.evaluate((title) => {
      const dialog = Array.from(document.querySelectorAll('[role="dialog"]'))
        .find((m) => (m.querySelector('.modal__title')?.textContent || '').trim() === title);
      Array.from(dialog?.querySelectorAll('button') ?? []).find((b) => (b.textContent || '').trim() === 'Hủy')?.click();
    }, DIALOG_TITLE);
    await sleep(450);
  };

  /* ── Run 1+2 on the EMPTY-date lot (engine paths a1–a4, b1–b2) ─────────── */
  await page.goto(`${QA_BASE_URL}/shipments?page=${emptyLot.page}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('table', { timeout: 20000 });
  await openDialog(emptyLot.id);
  const init1 = await segState(dlg());
  log('run1_init', init1);
  await page.screenshot({ path: path.join(OUT, 'a0_dialog-open.png') });

  let dd = await page.$(`${dlg()} [data-seg="dd"]`);
  await dd.click();
  await page.keyboard.type('14', { delay: 90 });
  await sleep(350);
  let st = await segState(dlg());
  log('a1_after_typing_14', st);
  await page.screenshot({ path: path.join(OUT, 'a1_after-typing-14.png') });
  record('a1 dialog Ngày (empty date): type day "14" → focus advances to month (mm2)', st.activeSeg === 'mm2' && st.dd === '14', JSON.stringify(st));

  // a2: dd now holds "14" (prefilled) — click it again and retype another day.
  dd = await page.$(`${dlg()} [data-seg="dd"]`);
  await dd.click();
  await page.keyboard.type('20', { delay: 90 });
  await sleep(350);
  st = await segState(dlg());
  log('a2_after_typeover_20', st);
  await page.screenshot({ path: path.join(OUT, 'a2_typeover-20.png') });
  record('a2 dialog Ngày type-over: typing "20" over just-typed "14" → dd=20 + month focus', st.activeSeg === 'mm2' && st.dd === '20', JSON.stringify(st));

  await closeDialog();

  // ── Run 2: re-open (dialog state suspect) + a4 QA flow via Giờ ───────────
  await openDialog(emptyLot.id);
  const init2 = await segState(dlg());
  log('run2_init_after_cancel', init2);
  record('a3 dialog re-open restores the persisted date, not the cancelled draft', init2.dd === init1.dd && init2.mm2 === init1.mm2 && init2.yyyy === init1.yyyy, `run1=${JSON.stringify(init1)} run2=${JSON.stringify(init2)}`);

  dd = await page.$(`${dlg()} [data-seg="dd"]`);
  await dd.click();
  await page.keyboard.type('14', { delay: 90 });
  await sleep(350);
  st = await segState(dlg());
  log('a3_reopen_after_typing_14', st);
  record('a3 dialog Ngày after re-open: type day "14" → month focus', st.activeSeg === 'mm2' && st.dd === '14', JSON.stringify(st));

  // ── (b) Giờ: "14" then "30" — auto-colon + typed-complete onComplete ─────
  let time = await page.$(`${dlg()} .time-input input`);
  await time.click();
  await sleep(300);
  await page.keyboard.type('14', { delay: 90 });
  await sleep(300);
  st = await segState(dlg());
  log('b1_after_typing_14_in_gio', st);
  await page.screenshot({ path: path.join(OUT, 'b1_gio-after-14.png') });
  record('b1 Giờ "14" state captured (partial draft stays in the box)', typeof st.timeValue === 'string' && st.timeValue.replace(':', '').startsWith('14'), JSON.stringify(st));

  await page.keyboard.type('30', { delay: 90 });
  await sleep(400);
  st = await segState(dlg());
  log('b2_after_typing_30_complete', st);
  await page.screenshot({ path: path.join(OUT, 'b2_gio-1430-complete.png') });
  record('b2 Giờ "1430" → "14:30" + onComplete moves focus to the Ngày day segment', st.timeValue === '14:30' && st.activeSeg === 'dd', JSON.stringify(st));

  // ── a4 (QA's exact flow): with focus handed to dd by onComplete, type "14" ─
  await page.keyboard.type('14', { delay: 90 });
  await sleep(350);
  st = await segState(dlg());
  log('a4_after_handoff_typing_14_in_dd', st);
  await page.screenshot({ path: path.join(OUT, 'a4_after-handoff-typing-14.png') });
  record('a4 dialog Ngày after the Giờ→dd hand-off: type day "14" → month focus', st.activeSeg === 'mm2' && st.dd === '14', JSON.stringify(st));

  await closeDialog();

  /* ── Run 3: the PREFILLED complete-date lot (QA staging case, probe a6) ─── */
  if (!datedLot) {
    record('a6 prefilled-date lot available', false, 'no dated lot with an enabled schedule trigger on pages 1..12');
  } else {
    log('a6_target', datedLot.info);
    await page.goto(datedLot.gotoUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('table', { timeout: 20000 });
    await openDialog(datedLot.id);
    const initDated = await segState(dlg());
    log('a6_init_prefilled', initDated);
    await page.screenshot({ path: path.join(OUT, 'a6_dated-dialog-open.png') });

    dd = await page.$(`${dlg()} [data-seg="dd"]`);
    await dd.click();
    await page.keyboard.type('14', { delay: 90 });
    await sleep(400);
    st = await segState(dlg());
    log('a6_after_typing_14_over_prefilled', st);
    await page.screenshot({ path: path.join(OUT, 'a6_after-typing-14.png') });
    record('a6 QA case — PREFILLED complete date: type day "14" over the old day → dd=14 + month focus (complete-draft parent echo)',
      st.activeSeg === 'mm2' && st.dd === '14', `init=${JSON.stringify(initDated)} after=${JSON.stringify(st)}`);

    // a6b: type the SAME day back over itself (value unchanged → no echo path).
    dd = await page.$(`${dlg()} [data-seg="dd"]`);
    await dd.click();
    await page.keyboard.type('14', { delay: 90 });
    await sleep(400);
    st = await segState(dlg());
    log('a6b_after_retyping_14', st);
    record('a6b retype the same day "14" over "14" (unchanged complete draft) → month focus', st.activeSeg === 'mm2' && st.dd === '14', JSON.stringify(st));

    await closeDialog();
  }

  /* ══════════════ (c): /shipments-detail container ledger inline editor ═════ */
  await page.goto(`${QA_BASE_URL}/shipments-detail`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('table', { timeout: 20000 });
  let cTarget = null;
  for (let p = 1; p <= 12 && !cTarget; p += 1) {
    await page.goto(`${QA_BASE_URL}/shipments-detail?page=${p}`, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('table', { timeout: 20000 });
    cTarget = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button[id^="shipment-detail-edit-schedule-"]'));
      const enabled = buttons.find((b) => !b.disabled && !b.classList.contains('shipment-container-ledger__cell-trigger--read-only'));
      return enabled ? { id: enabled.id, text: (enabled.textContent || '').trim().slice(0, 80) } : null;
    });
    if (cTarget) log('ledger_schedule_trigger', { page: p, ...cTarget });
  }
  if (!cTarget) {
    record('c0 ledger schedule editor trigger found', false, 'no enabled shipment-detail-edit-schedule trigger on pages 1..12');
  } else {
    await page.evaluate((id) => document.getElementById(id)?.scrollIntoView({ block: 'center' }), cTarget.id);
    await sleep(150);
    const btn = await page.$(`#${cTarget.id}`);
    await btn.click({ timeout: 5000 }).catch(async () => btn.evaluate((el) => el.click()));
    await page.waitForFunction(
      () => Boolean(document.querySelector('.shipment-container-ledger__editor-grid--schedule')),
      { timeout: 10000 },
    );
    await sleep(300);
    const EDITOR = '.shipment-container-ledger__cell-editor--expanded';
    await page.screenshot({ path: path.join(OUT, 'c0_ledger-editor-open.png') });

    const cInit = await segState(EDITOR);
    log('c_init', cInit);

    dd = await page.$(`${EDITOR} [data-seg="dd"]`);
    await dd.click();
    await page.keyboard.type('14', { delay: 90 });
    await sleep(350);
    st = await segState(EDITOR);
    log('c1_after_typing_14', st);
    await page.screenshot({ path: path.join(OUT, 'c1_ledger-dd-14.png') });
    record('c1 ledger Ngày: type day "14" → month focus', st.activeSeg === 'mm2' && st.dd === '14', JSON.stringify(st));

    time = await page.$(`${EDITOR} .time-input input`);
    await time.click();
    await sleep(300);
    await page.keyboard.type('1430', { delay: 90 });
    await sleep(400);
    st = await segState(EDITOR);
    log('c2_after_typing_1430_in_gio', st);
    await page.screenshot({ path: path.join(OUT, 'c2_ledger-gio-1430.png') });
    record('c2 ledger Giờ "1430" → "14:30" + focus lands on the Ngày day segment (onComplete host wiring)',
      st.timeValue === '14:30' && st.activeSeg === 'dd', JSON.stringify(st));

    // Close without saving: the editor's own dismiss keeps the draft uncommitted.
    await page.keyboard.press('Escape');
    await sleep(400);
  }

  /* ══════════════ verdict ══════════════════════════════════════════════════ */
  record('MUTATION-FREE probe run (no POST/PATCH/PUT/DELETE at all)', mutations.length === 0, `mutations=${mutations.length} ${JSON.stringify(mutations)}`);
  log('SUMMARY', { pass: results.filter((r) => r.pass).length, fail: results.filter((r) => !r.pass).length, results });
  fs.writeFileSync(path.join(OUT, 'probe-log.json'), JSON.stringify(LOG, null, 2));
  fs.writeFileSync(path.join(OUT, 'probe-results.json'), JSON.stringify(results, null, 2));
  console.log(`\n== ${results.filter((r) => r.pass).length}/${results.length} probes pass; exit ${exitCode} ==`);
} finally {
  await browser.close();
}
process.exit(exitCode);
