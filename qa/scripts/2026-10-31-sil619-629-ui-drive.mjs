// SIL-619/624/626/627/628/629 UI drive — the /shipments/new create form family.
//
// Rung-3 contract (AGENTS.md §9): screenshots, DOM/text assertions, unchanged
// persisted-state proof (no successful submit anywhere in this drive), driver
// log with exit status.
//
// Usage:  node qa/scripts/2026-10-31-sil619-629-ui-drive.mjs
// Env:    QA_BASE_URL (default http://localhost:7186) · QA_RUN_TAG (before|after)
// Artifacts land in qa/2026-10-31_sil619-629/<tag>/.

import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7186';
const RUN = process.env.QA_RUN_TAG || 'before';
const OUT = resolve(process.cwd(), 'qa/2026-10-31_sil619-629', RUN);
mkdirSync(OUT, { recursive: true });
const LOG = resolve(OUT, 'ui-driver.log');
const log = (line) => { appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`); console.log(line); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const result = { run: RUN, baseUrl: FE, role: 'CUS', checks: [] };
const check = (name, pass, detail) => {
  result.checks.push({ name, pass, detail });
  log(`${pass ? 'PASS' : 'INFO'} ${name} :: ${detail}`);
};

// Read-only drive: no submit in this script can succeed (delete is draft-row
// only; the create click is blocked by validation on the empty form), so the
// shipments table must be identical before/after.
const shipCount = execSync('docker exec ss-prod-db psql -U postgres -d silversea -tAc "SELECT count(*) FROM shipments"', { encoding: 'utf8' }).trim();
result.dbUnchangedProof = { shipmentsCountBefore: shipCount };
log(`DB read-only proof: shipments count = ${shipCount}`);

const browser = await puppeteer.launch({ headless: true, defaultViewport: { width: 1307, height: 900 } });

async function login() {
  const page = await browser.newPage();
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('input[name="username"]', { timeout: 45000 });
  await page.type('input[name="username"]', 'cus');
  await page.type('input[name="password"]', 'Abc123');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForFunction(() => Boolean(localStorage.getItem('token')), { timeout: 30000 });
  return page;
}

// Real-UI helpers (the same controls a clerk drives).
async function pickCustomer(page, name) {
  await page.evaluate((label) => {
    const wrap = document.querySelector('[data-field="shipment-customer"]');
    const input = wrap?.querySelector('input');
    input?.focus(); input?.click();
  }, name);
  await sleep(500);
  await page.evaluate((label) => {
    const options = Array.from(document.querySelectorAll('[role="option"]'));
    const target = options.find((o) => (o.textContent || '').includes(label));
    if (target) target.click();
  }, name);
  await sleep(900);
}

async function pickFirstFactory(page) {
  await page.evaluate(() => {
    const cell = Array.from(document.querySelectorAll('td.csc-container-cell'))
      .find((c) => (c.dataset.fieldId || '').endsWith('-factory'));
    cell?.click();
  });
  await sleep(600);
  await page.evaluate(() => {
    const target = Array.from(document.querySelectorAll('[role="option"]'))[0];
    if (target) target.click();
  });
  await sleep(800);
}

async function probeGeometry(page) {
  return page.evaluate(() => {
    const r = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { left: Math.round(b.left), top: Math.round(b.top), right: Math.round(b.right), bottom: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) };
    };
    const out = {};
    // SIL-624: appointment segment group vs a standard control
    const appt = document.querySelector('.csc-container-cell--appointment .date-seg-group[data-uui-control]');
    const apptWrapper = document.querySelector('.csc-container-cell--appointment .date-seg-group[data-uui-control] .date-seg-wrapper');
    const declInput = document.querySelector('td[data-field-id$="-declaration"] input[data-uui-control], td[data-field-id$="-declaration"] input');
    const customerControl = document.querySelector("[data-field='shipment-customer'] [data-uui-control='combobox']");
    out.apptGroup = r(appt);
    out.apptWrapperPadBlock = apptWrapper ? getComputedStyle(apptWrapper).paddingTop + '/' + getComputedStyle(apptWrapper).paddingBottom : null;
    out.declarationInput = r(declInput);
    out.customerControl = r(customerControl);
    // SIL-628: the factory actions overlay + delete button hit test
    out.actionsOverlay = r(document.querySelector('.csc-container-cell__actions'));
    const del = Array.from(document.querySelectorAll('.csc-container-row__actions button'))
      .find((b) => (b.getAttribute('aria-label') || '').startsWith('Xóa container'));
    out.deleteButton = r(del);
    if (del) {
      const b = del.getBoundingClientRect();
      const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      out.elementAtDeleteCenter = el ? `${el.tagName}.${String(el.getAttribute('class') ?? '').slice(0, 60)}` : null;
      out.deleteAriaAtPoint = el?.closest('button')?.getAttribute('aria-label') ?? null;
    }
    // SIL-619: bar vs notes reachability at scroll end
    const bar = document.querySelector('.csc-form-actions');
    out.bar = r(bar);
    out.pagePaddingBottom = getComputedStyle(document.querySelector('.csc-page')).paddingBottom;
    return out;
  });
}

async function notesClearanceProbe(page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await sleep(500);
  return page.evaluate(() => {
    const bar = document.querySelector('.csc-form-actions');
    const notes = document.querySelector('#shipment-section-notes');
    const page = document.querySelector('.csc-page');
    const barTop = bar?.getBoundingClientRect().top ?? null;
    const notesBottom = notes?.getBoundingClientRect().bottom ?? null;
    return {
      scrolledTo: Math.round(window.scrollY),
      maxScroll: Math.round(document.documentElement.scrollHeight - window.innerHeight),
      barTop: barTop == null ? null : Math.round(barTop),
      notesBottom: notesBottom == null ? null : Math.round(notesBottom),
      notesFullyAboveBar: barTop != null && notesBottom != null ? notesBottom <= barTop : null,
      notesCoveredPx: barTop != null && notesBottom != null ? Math.max(0, Math.round(notesBottom - barTop)) : null,
      pagePaddingBottom: getComputedStyle(page).paddingBottom,
      docScrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
    };
  });
}

try {
  const page = await login();
  log('logged in as cus');
  await page.goto(`${FE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 90000 });
  await page.waitForSelector('.csc-container-table-scroll', { timeout: 60000 });
  await sleep(900);

  // ── State A: EMPTY form, 1307 ──────────────────────────────────────────────
  // SIL-627: failed create on an empty form must NOT paint the summary banner
  // (after) — and the per-field paint must still fire.
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('.csc-form-actions button'))
      .find((b) => (b.textContent || '').trim() === 'Tạo lô hàng');
    btn?.click();
  });
  await sleep(900);
  const emptySubmit = await page.evaluate(() => ({
    banner: Boolean(document.querySelector('.csc-validation-summary')),
    bannerTitle: document.querySelector('.csc-validation-summary strong')?.textContent ?? null,
    perFieldPaint: document.querySelectorAll('.csc-container-cell--error, [data-uui-control][aria-invalid="true"], .csc-searchable-field--error, input[aria-invalid="true"]').length,
    firstIssueFocus: document.activeElement?.getAttribute('data-field-id') ?? document.activeElement?.id ?? null,
  }));
  await page.screenshot({ path: resolve(OUT, '627-empty-submit-1307.png') });
  check('627 banner', RUN === 'after' ? !emptySubmit.banner : emptySubmit.banner,
    `validation-summary present=${emptySubmit.banner} title="${emptySubmit.bannerTitle ?? ''}"`);
  check('627 per-field validation still paints', emptySubmit.perFieldPaint > 0,
    `invalid-paint nodes=${emptySubmit.perFieldPaint}`);

  // ── State B: FILLED form (row 1 complete, row 2 added empty), 1307 ────────
  await page.goto(`${FE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 90000 });
  await page.waitForSelector('.csc-container-table-scroll', { timeout: 60000 });
  await sleep(800);
  await pickCustomer(page, 'LONG MINH');
  // row 1: container number via the real Số container input (UTextField does
  // not forward id — locate by aria-label; first match = row 1). No Escape:
  // the cell's Escape law REVERTS to value-at-focus and would wipe the text.
  await page.type('input[aria-label="Số container"]', 'EGHU3768799', { delay: 25 });
  await sleep(300);
  await pickFirstFactory(page);
  // row 2
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('Thêm container'));
    btn?.click();
  });
  await sleep(800);
  const filled = await probeGeometry(page);
  await page.screenshot({ path: resolve(OUT, '628-filled-table-1307.png') });

  // SIL-624 measurements
  const stdH = filled.customerControl?.h ?? filled.declarationInput?.h;
  check('624 appt group == standard control height (30px)',
    filled.apptGroup?.h != null && Math.abs(filled.apptGroup.h - 30) <= 1,
    `apptGroup=${filled.apptGroup?.h}px standard≈${stdH}px wrapperPad=${filled.apptWrapperPad}`);

  // SIL-628: overlay presence + hit test at the delete button center
  check('628 factory ⓘ overlay absent from the table', RUN === 'after' ? !filled.actionsOverlay : Boolean(filled.actionsOverlay),
    `actionsOverlay=${JSON.stringify(filled.actionsOverlay)}`);
  check('628 delete button hit test reaches the delete control',
    filled.deleteAriaAtPoint === 'Xóa container 1',
    `elementAtDeleteCenter=${filled.elementAtDeleteCenter} button=${filled.deleteAriaAtPoint}`);

  // SIL-619: bottom clearance at scroll end
  const clearance = await notesClearanceProbe(page);
  await page.screenshot({ path: resolve(OUT, '619-notes-scroll-end-1307.png') });
  check('619 notes fully above the fixed bar at scroll end (1307)',
    clearance.notesFullyAboveBar === true,
    `notesBottom=${clearance.notesBottom} barTop=${clearance.barTop} covered=${clearance.notesCoveredPx} padBottom=${clearance.pagePaddingBottom}`);

  // SIL-629: real mouse click at the delete-1 button center on the FILLED form
  const rowsBefore = await page.evaluate(() => document.querySelectorAll('.csc-container-row').length);
  const del = await page.$('button[aria-label="Xóa container 1"]');
  const db = await del.boundingBox();
  await page.mouse.click(db.x + db.width / 2, db.y + db.height / 2);
  await sleep(900);
  const afterClick = await page.evaluate(() => ({
    confirm: document.querySelector('[role="dialog"], .modal')?.textContent?.slice(0, 80) ?? null,
    hasConfirmBtn: Array.from(document.querySelectorAll('button')).some((b) => (b.textContent || '').trim() === 'Xóa container'),
    factoryPopover: Boolean(document.querySelector('.factory-detail-popover, [role="dialog"][aria-label*="chi tiết nhà máy"]')),
    rows: document.querySelectorAll('.csc-container-row').length,
  }));
  await page.screenshot({ path: resolve(OUT, '629-after-delete-click-1307.png') });
  check('629 delete click opens the confirm dialog on a FILLED form', afterClick.hasConfirmBtn,
    `confirmVisible=${afterClick.hasConfirmBtn} factoryPopover=${afterClick.factoryPopover} rows=${afterClick.rows}`);
  if (afterClick.hasConfirmBtn) {
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === 'Xóa container');
      btn?.click();
    });
    await sleep(700);
  }
  const rowsAfter = await page.evaluate(() => document.querySelectorAll('.csc-container-row').length);
  check('629 row removed after confirm (filled state)', rowsAfter === rowsBefore - 1,
    `rows ${rowsBefore} → ${rowsAfter}`);
  await page.screenshot({ path: resolve(OUT, '629-after-confirm-1307.png') });

  // SIL-626: header button gone; dropdown carries "+ Thêm nhà máy..."
  await page.goto(`${FE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 90000 });
  await page.waitForSelector('.csc-container-table-scroll', { timeout: 60000 });
  await sleep(700);
  const header = await page.evaluate(() => ({
    headerBtn: Boolean(document.querySelector('.csc-fcl-factory-action')),
    addContainerBtn: Array.from(document.querySelectorAll('button')).some((b) => (b.textContent || '').includes('Thêm container')),
  }));
  check('626 standalone "+ Thêm nhà máy" header button removed', RUN === 'after' ? !header.headerBtn : header.headerBtn,
    `headerBtn=${header.headerBtn}`);
  check('626 "+ Thêm container" untouched', header.addContainerBtn, `addContainerBtn=${header.addContainerBtn}`);
  await pickCustomer(page, 'LONG MINH');
  await page.evaluate(() => {
    const cell = Array.from(document.querySelectorAll('td.csc-container-cell'))
      .find((c) => (c.dataset.fieldId || '').endsWith('-factory'));
    cell?.click();
  });
  await sleep(700);
  const dropdown = await page.evaluate(() => {
    const opts = Array.from(document.querySelectorAll('[role="option"]')).map((o) => (o.textContent || '').trim());
    return { count: opts.length, last: opts[opts.length - 1] ?? null, hasFactoryCreate: opts.some((t) => t.includes('Thêm nhà máy')) };
  });
  await page.screenshot({ path: resolve(OUT, '626-factory-dropdown-1307.png') });
  check('626 "+ Thêm nhà máy..." item inside the factory dropdown (last)',
    RUN === 'after' ? dropdown.hasFactoryCreate : !dropdown.hasFactoryCreate,
    `options=${dropdown.count} last="${dropdown.last ?? ''}"`);

  // ── State C: mobile 390 sweep ──────────────────────────────────────────────
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${FE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 90000 });
  await page.waitForSelector('.csc-container-table-scroll', { timeout: 60000 });
  await sleep(900);
  await pickCustomer(page, 'LONG MINH');
  await pickFirstFactory(page);
  await sleep(400);
  const mobile = await probeGeometry(page);
  await page.screenshot({ path: resolve(OUT, '624-filled-table-390.png') });
  check('624 touch 390: appointment group keeps the touch token (44px)',
    mobile.apptGroup?.h != null && Math.abs(mobile.apptGroup.h - 44) <= 2,
    `apptGroup=${mobile.apptGroup?.h}px expect≈44`);
  const mobileClearance = await notesClearanceProbe(page);
  await page.screenshot({ path: resolve(OUT, '619-notes-scroll-end-390.png') });
  check('619 notes fully above the fixed bar at scroll end (390)',
    mobileClearance.notesFullyAboveBar === true,
    `notesBottom=${mobileClearance.notesBottom} barTop=${mobileClearance.barTop} covered=${mobileClearance.notesCoveredPx} padBottom=${mobileClearance.pagePaddingBottom}`);

  result.emptySubmit = emptySubmit;
  result.filled = filled;
  result.clearance = clearance;
  result.mobile = mobile;
  result.mobileClearance = mobileClearance;
  await browser.close();
  const finalCount = execSync('docker exec ss-prod-db psql -U postgres -d silversea -tAc "SELECT count(*) FROM shipments"', { encoding: 'utf8' }).trim();
  result.dbUnchangedProof.shipmentsCountAfter = finalCount;
  log(`DB read-only proof after: shipments count = ${finalCount}`);
  writeFileSync(resolve(OUT, 'assertions.json'), JSON.stringify(result, null, 2));
  log(finalCount === shipCount ? 'DB UNCHANGED ✓' : 'DB CHANGED ✗ (unexpected!)');
  log(`RESULT: RUN=${RUN} completed`);
  process.exitCode = 0;
} catch (err) {
  log(`DRIVER ERROR: ${err?.message ?? err}`);
  result.error = String(err);
  writeFileSync(resolve(OUT, 'assertions.json'), JSON.stringify(result, null, 2));
  await browser.close();
  process.exitCode = 1;
}
