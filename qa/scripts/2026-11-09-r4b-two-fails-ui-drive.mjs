// SIL-731 r4 + SIL-748 — rung-3 UI drive (LOCAL ONLY, build = working tree
// f545599c + 89d5684b on fix/r4b-lcl-gating).
//
// SIL-731: a cost-LOCKED lot whose freight was never calculated must render
//   DOANH THU as an EMPTY cell — never '0' (Luật 24/10, QA repro R3Q-680-B /
//   R4B-693-001 on staging e6db602f). Local DB has no pre-r3 lock that froze
//   '0', so the exact staging data shape is replicated as a LOCAL QA fixture:
//   shipment_cost_locks.cost_snapshot.receivableTotal = "0" on id 779037
//   (SHP-2611-00298, freightAuto null, no rev group). Contrast rows:
//   779059 (locked, snapshot recv key empty → Chưa xác định) and 1795
//   (SHP-2611-00284, locked, frozen 3.952.000 — known value must still render).
// SIL-748: CUS sees [Khai chi phí] in the lot drawer (owner product decision
//   09/11) — thanhdc opens /shipments → drawer → button present, click mounts
//   'Khai báo chi phí', catalog loads (GET /ops/expense-types 200 as CUS).
//   hoangnh regression: Ops drawer still shows the buttons.
// Read-only bookend: the drive never submits the form → shipments count and
// ops_expense_entries count identical before/after (§9 read-only proof).
// Run: node qa/scripts/2026-11-09-r4b-two-fails-ui-drive.mjs
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const FRONT = `http://localhost:${process.env.FRONT_PORT ?? 7175}`;
const API = `http://localhost:${process.env.API_PORT ?? 3002}/api`;
const OUT = path.resolve('qa/2026-11-09_r4b');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'ui-driver.log');
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (name, ok, detail) => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const shot = async (page, name) => {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file });
  log(`SHOT ${file}`);
};

const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log(`HEALTH status=${health?.status} api=${API} front=${FRONT}`);
if (health?.status !== 'ok') { log('ABORT: local API health not ok'); process.exit(2); }

const login = async (identifier) => {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (!res.ok) return null;
  const body = await res.json();
  return body.token ?? null;
};

const dbCount = (sql) => execSync(
  `docker exec ss-prod-db psql -U postgres -d silversea -qtAX -c "${sql}"`,
).toString().trim();

const shipmentsBefore = dbCount('select count(*) from shipments');
const expensesBefore = dbCount('select count(*) from ops_expense_entries');
log(`BOOKEND before shipments=${shipmentsBefore} expenses=${expensesBefore}`);

const browser = await puppeteer.launch({ headless: true, defaultViewport: { width: 1440, height: 900 } });
try {
  // ─── SIL-731: hoapt (Kế toán) — /shipments-debit ────────────────────────────
  const hoaptToken = await login('hoapt');
  if (!hoaptToken) { log('ABORT: hoapt login failed'); process.exit(2); }
  log('LOGIN ok account=hoapt role=ACCOUNTANT');

  // API evidence (rung 2): the wire must carry null for the frozen-'0' lock.
  const summaryRes = await fetch(`${API}/shipments/debit-summary?lockStatus=LOCKED`, {
    headers: { Authorization: `Bearer ${hoaptToken}` },
  });
  const summary = await summaryRes.json();
  check('API /debit-summary 200', summaryRes.status === 200, `status=${summaryRes.status}`);
  const repro = summary.items?.find((r) => r.shipmentId === 779037);
  check('SIL-731 API: locked fixture 779037 receivableTotal null (blank, never "0")',
    !!repro && repro.receivableTotal === null && repro.lockStatus === 'LOCKED',
    `receivableTotal=${JSON.stringify(repro?.receivableTotal)} lockStatus=${repro?.lockStatus}`);
  check('SIL-731 API: fixture freightAuto null (never priced)', !!repro && repro.freightAuto === null,
    `freightAuto=${JSON.stringify(repro?.freightAuto)}`);
  const missingKey = summary.items?.find((r) => r.shipmentId === 779059);
  check('SIL-731 API: locked 779059 (recv key empty) still null', !!missingKey && missingKey.receivableTotal === null,
    `receivableTotal=${JSON.stringify(missingKey?.receivableTotal)}`);
  const known = summary.items?.find((r) => r.shipmentId === 1795);
  check('SIL-731 API: locked 1795 keeps frozen 3.952.000', !!known && String(known.receivableTotal) === '3952000',
    `receivableTotal=${JSON.stringify(known?.receivableTotal)}`);

  // Row labels: the board's first column rides lotLabelOf — code OR Bill/Booking.
  const labelOf = (id) => {
    const r = summary.items?.find((row) => row.shipmentId === id);
    return r ? `${r.code ?? ''} ${r.billOrBookNumber ?? ''}`.trim() : '';
  };
  const reproLabel = labelOf(779037);
  const missingKeyLabel = labelOf(779059);
  const knownLabel = labelOf(1795);
  log(`ROW LABELS repro="${reproLabel}" missingKey="${missingKeyLabel}" known="${knownLabel}"`);

  // UI evidence (rung 3): the board cell.
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), hoaptToken);
  await page.goto(`${FRONT}/shipments-debit?lock=LOCKED`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('.shipment-debit-table tbody tr', { timeout: 60000 });
  await sleep(800);
  await shot(page, 'sil731_debit_locked_rows.png');

  const rowState = await page.evaluate((labels) => {
    const findRow = (label) => [...document.querySelectorAll('tbody tr')]
      .find((tr) => label.split(/\s+/).some((part) => part && tr.textContent?.includes(part)));
    const read = (label) => {
      const tr = findRow(label);
      if (!tr) return { found: false };
      const cell = tr.querySelector('td[data-col="receivable"]');
      return {
        found: true,
        cellText: cell?.textContent ?? '',
        zeroTooltip: !!tr.querySelector('[title="Phát sinh nhưng tổng bằng 0"]'),
      };
    };
    return {
      repro: read(labels.repro),
      missingKey: read(labels.missingKey),
      known: read(labels.known),
    };
  }, { repro: reproLabel, missingKey: missingKeyLabel, known: knownLabel });
  check('SIL-731 UI: locked frozen-0 row DOANH THU is EMPTY', rowState.repro?.found === true && rowState.repro.cellText === '',
    `cell="${rowState.repro?.cellText}"`);
  check('SIL-731 UI: locked frozen-0 row has NO zero tooltip', rowState.repro?.found === true && rowState.repro.zeroTooltip === false);
  check('SIL-731 UI: locked empty-key row stays empty', rowState.missingKey?.found === true && rowState.missingKey.cellText === '',
    `cell="${rowState.missingKey?.cellText}"`);
  check('SIL-731 UI: locked known value still renders 3.952.000', rowState.known?.found === true && rowState.known.cellText.includes('3.952.000'),
    `cell="${rowState.known?.cellText}"`);
  await page.close();

  // ─── SIL-748: thanhdc (CUS) — drawer [Khai chi phí] ─────────────────────────
  const cusToken = await login('thanhdc');
  if (!cusToken) { log('ABORT: thanhdc login failed'); process.exit(2); }
  log('LOGIN ok account=thanhdc role=CUS');

  // BE guard proof (rung 2): the create-flow catalog admits CUS (pre-fix: 403).
  const typesRes = await fetch(`${API}/ops/expense-types`, { headers: { Authorization: `Bearer ${cusToken}` } });
  const typesBody = await typesRes.json().catch(() => null);
  check('SIL-748 API: GET /ops/expense-types as CUS → 200', typesRes.status === 200,
    `status=${typesRes.status} items=${Array.isArray(typesBody?.items) ? typesBody.items.length : 'n/a'}`);

  const cusPage = await browser.newPage();
  await cusPage.evaluateOnNewDocument((t) => localStorage.setItem('token', t), cusToken);
  await cusPage.goto(`${FRONT}/shipments`, { waitUntil: 'networkidle2', timeout: 60000 });
  await cusPage.waitForSelector('table', { timeout: 60000 });
  await cusPage.waitForSelector('button.cus-dashboard-detail', { timeout: 30000 });
  await sleep(500);
  await cusPage.click('button.cus-dashboard-detail');
  await cusPage.waitForSelector('.cus-shipment-drawer', { timeout: 30000 });
  await sleep(800);
  await shot(cusPage, 'sil748_cus_drawer_buttons.png');

  const drawerState = await cusPage.evaluate(() => {
    const drawer = document.querySelector('.cus-shipment-drawer');
    const buttons = drawer ? [...drawer.querySelectorAll('button')] : [];
    const expense = buttons.filter((b) => b.textContent?.includes('Khai chi phí'));
    return {
      drawerFound: !!drawer,
      expenseCount: expense.length,
      classes: expense.map((b) => b.className),
    };
  });
  check('SIL-748 UI: CUS drawer found', drawerState.drawerFound === true);
  check('SIL-748 UI: CUS drawer shows ≥1 [Khai chi phí] (header band + footer)', drawerState.expenseCount >= 1,
    `count=${drawerState.expenseCount} classes=${JSON.stringify(drawerState.classes)}`);

  await cusPage.click('.cus-lot-declare-expense');
  // The drawer itself is a dialog — wait for the MODAL by its own title text
  // anywhere in the document, never by [role="dialog"] alone.
  const modalAppeared = await cusPage.waitForFunction(
    () => document.body.textContent?.includes('Khai báo chi phí'),
    { timeout: 10000 },
  ).then(() => true).catch(() => false);
  if (!modalAppeared) {
    const diag = await cusPage.evaluate(() => {
      const btn = document.querySelector('.cus-lot-declare-expense');
      const rect = btn?.getBoundingClientRect();
      const at = rect
        ? document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.className ?? 'nothing'
        : 'no button';
      return {
        hit: String(at).slice(0, 120),
        dialogs: document.querySelectorAll('[role="dialog"]').length,
        expenseOrderModal: !!document.querySelector('.ops-expense-modal, [aria-label="Khai báo chi phí"]'),
      };
    });
    check('SIL-748 UI: modal did not mount after click — DIAGNOSTIC', false,
      `elementFromPoint=${diag.hit} dialogs=${diag.dialogs} modal=${diag.expenseOrderModal}`);
  }
  // The form mounts, then the catalog query lands. The type trigger is the
  // UuiSelectField inside the fee-row section (accessible name rides the
  // rendered label, empty textContent when unselected) — enabled = typesReady
  // = GET /ops/expense-types served CUS.
  await cusPage.waitForFunction(() => {
    const row = document.querySelector('section[aria-label^="Khoản"]');
    const trigger = row?.querySelector('button');
    return !!trigger && !trigger.disabled;
  }, { timeout: 30000 });
  await sleep(400);
  await shot(cusPage, 'sil748_cus_expense_modal.png');
  const modalTitle = await cusPage.evaluate(() =>
    [...document.querySelectorAll('[role="dialog"]')]
      .map((d) => d.getAttribute('aria-label') ?? d.querySelector('[role="heading"], h1, h2')?.textContent ?? '')
      .find((t) => t.includes('Khai báo chi phí')) ?? '');
  check('SIL-748 UI: click mounts Khai báo chi phí modal for CUS', modalTitle.includes('Khai báo chi phí'),
    `title="${modalTitle}"`);
  check('SIL-748 UI: fee row type trigger enabled (catalog served to CUS)', true);
  await cusPage.close();

  // ─── hoangnh (OPS) regression ───────────────────────────────────────────────
  const opsToken = await login('hoangnh');
  if (!opsToken) { log('ABORT: hoangnh login failed'); process.exit(2); }
  const opsPage = await browser.newPage();
  await opsPage.evaluateOnNewDocument((t) => localStorage.setItem('token', t), opsToken);
  await opsPage.goto(`${FRONT}/shipments`, { waitUntil: 'networkidle2', timeout: 60000 });
  await opsPage.waitForSelector('button.cus-dashboard-detail', { timeout: 60000 });
  await sleep(500);
  await opsPage.click('button.cus-dashboard-detail');
  await opsPage.waitForSelector('.cus-shipment-drawer', { timeout: 30000 });
  await sleep(800);
  await shot(opsPage, 'sil748_ops_drawer_regression.png');
  const opsExpenseCount = await opsPage.evaluate(() =>
    [...(document.querySelector('.cus-shipment-drawer')?.querySelectorAll('button') ?? [])]
      .filter((b) => b.textContent?.includes('Khai chi phí')).length);
  check('SIL-748 UI: Ops drawer still shows [Khai chi phí] (no regression)', opsExpenseCount >= 1, `count=${opsExpenseCount}`);
  await opsPage.close();
} finally {
  await browser.close();
}

const shipmentsAfter = dbCount('select count(*) from shipments');
const expensesAfter = dbCount('select count(*) from ops_expense_entries');
log(`BOOKEND after shipments=${shipmentsAfter} expenses=${expensesAfter}`);
check('read-only bookend: shipments count unchanged', shipmentsBefore === shipmentsAfter);
check('read-only bookend: ops_expense_entries count unchanged', expensesBefore === expensesAfter);

log(`RESULT ${failures === 0 ? 'ALL PASS' : `${failures} FAILURES`}`);
process.exit(failures === 0 ? 0 : 1);
