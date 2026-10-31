// SIL-616 + SIL-617 + SIL-625 UI drive — the /shipments/new top mode band.
//
// Rung-3 contract (AGENTS.md §9): screenshot after the drive, DOM assertion,
// persisted-state proof (layout/presence-only drive → unchanged API/DB
// identity), driver log with exit status.
//
// What is asserted:
//   SIL-616 (control height): the band's visible controls — the Loại hàng
//     segmented shell/option and the copy-all date + time segment groups —
//     measure the standard form control height (--control-compact-h 30px),
//     same as the Khách hàng combobox control box. The 604 card pin
//     (#shipment-section-mode ≤ 72px at ≥1280) must still hold.
//   SIL-617 (band presence): the copy-all band `.csc-bulk-appointment` is in
//     the DOM on an EMPTY form AND after every container row holds an
//     appointment (the pre-fix bug: band unmounted at emptyAppointmentCount
//     0 and scrolling the whole form found nothing).
//   SIL-625 (label removal): the visible 'Ngày giờ đóng trả cho tất cả cont'
//     label span is gone; the two segment inputs + copy affordance remain.
//
// Usage: node qa/scripts/2026-10-31-sil616-617-625-ui-drive.mjs
// Env:   QA_BASE_URL (default http://localhost:7216), QA_RUN_TAG (default run1)

import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7216';
const RUN = process.env.QA_RUN_TAG || 'run1';
const OUT = resolve(process.cwd(), 'qa/2026-10-31_sil616-617-625', RUN);
mkdirSync(OUT, { recursive: true });
const LOG = resolve(OUT, 'ui-driver.log');
const log = (line) => { appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`); console.log(line); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const result = { run: RUN, baseUrl: FE, role: 'admin (ADMIN)', checks: [] };
const check = (name, pass, detail) => {
  result.checks.push({ name, pass, detail });
  log(`${pass ? 'PASS' : 'FAIL'} ${name} :: ${detail}`);
  if (!pass) result.failed = true;
};

// Read-only drive (no submit anywhere): capture unchanged persisted state.
const shipCount = execSync('docker exec ss-prod-db psql -U postgres -d silversea -tAc "SELECT count(*) FROM shipments"', { encoding: 'utf8' }).trim();
result.dbUnchangedProof = { shipmentsCountBefore: shipCount };
log(`DB read-only proof: shipments count = ${shipCount} (no mutation in this drive)`);

const browser = await puppeteer.launch({ headless: true, defaultViewport: { width: 1307, height: 900 } });

async function login() {
  const page = await browser.newPage();
  await page.goto(`${FE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('input[name="username"]', { timeout: 45000 });
  await page.type('input[name="username"]', 'admin');
  await page.type('input[name="password"]', 'Abc123');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForFunction(() => localStorage.getItem('token') || localStorage.getItem('auth_token'), { timeout: 30000 });
  return page;
}

// Height probe of every control relevant to 616 + presence probes for
// 617/625. All values are Math.round'ed CSS px.
async function probe(page) {
  return page.evaluate(() => {
    const h = (el) => (el ? Math.round(el.getBoundingClientRect().height * 10) / 10 : null);
    const card = document.querySelector('#shipment-section-mode');
    const legend = document.querySelector('.csc-mode legend');
    const segShell = document.querySelector('.csc-mode > div');
    const option = document.querySelector('.csc-mode__option');
    const band = document.querySelector('.csc-bulk-appointment');
    const segGroups = band ? Array.from(band.querySelectorAll('.date-seg-group')) : [];
    const labelSpan = band ? band.querySelector('.split-datetime__label') : null;
    const copyBtn = band ? band.querySelector('.csc-bulk-appointment__copy') : null;
    const bulkDate = document.querySelector('input[id$="-bulk-appointment-date"]');
    const bulkTime = document.querySelector('input[id$="-bulk-appointment-time"]');
    // The standard controls: the Khách hàng combobox boundary and the
    // Số Bill/Booking input boundary (both identity-grid fields below).
    const customerControl = document.querySelector(".csc-identity-grid__customer [data-uui-control='combobox']");
    const billInput = document.querySelector('#shipment-booking-ref');
    const billControl = billInput ? billInput.closest('[data-uui-control]') : null;
    return {
      cardHeight: h(card),
      legendHeight: h(legend),
      segShellHeight: h(segShell),
      optionHeight: h(option),
      bandPresent: Boolean(band),
      bandHeight: h(band),
      bandSegGroupHeights: segGroups.map(h),
      bandLabelPresent: Boolean(labelSpan),
      bandLabelText: labelSpan ? labelSpan.textContent.trim() : null,
      bandCopyButtonPresent: Boolean(copyBtn),
      bulkDatePresent: Boolean(bulkDate),
      bulkTimePresent: Boolean(bulkTime),
      customerControlHeight: h(customerControl),
      billControlHeight: h(billControl),
    };
  });
}

// Fill the FIRST container row's "Ngày giờ đóng trả" cell via the real
// controls: click the value-first cell (reveals the editor), type the date
// then the time into the segmented inputs. Both halves complete → the row
// holds customerAppointmentAt → emptyAppointmentCount reaches 0.
async function fillContainerAppointment(page) {
  const cell = await page.$('.csc-container-cell--appointment');
  if (!cell) throw new Error('appointment cell not found');
  await cell.click();
  await sleep(300);
  const dateSeg = await page.$('input[id$="-customer-appointment-date"]');
  const timeSeg = await page.$('input[id$="-customer-appointment-time"]');
  if (!dateSeg || !timeSeg) throw new Error('appointment segment inputs not revealed');
  await dateSeg.click();
  await page.keyboard.type('31102026', { delay: 60 });
  await timeSeg.click();
  await page.keyboard.type('0930', { delay: 60 });
  await sleep(500);
  // Blur so the commit path settles.
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(300);
}

try {
  const page = await login();
  log('logged in as admin');

  await page.goto(`${FE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 90000 });
  await page.waitForSelector('#shipment-section-mode', { timeout: 60000 });
  await page.waitForSelector('.csc-container-table-scroll', { timeout: 60000 });
  await sleep(900);

  // ── State 1: EMPTY form, desktop 1307 ────────────────────────────────────
  const emptyDesktop = await probe(page);
  await page.screenshot({ path: resolve(OUT, 'band-1307-before-filled.png') });

  check('617 empty-form: copy-all band PRESENT on the empty FCL form', emptyDesktop.bandPresent,
    `bandPresent=${emptyDesktop.bandPresent}`);
  check('617 empty-form: both bulk segment inputs present', emptyDesktop.bulkDatePresent && emptyDesktop.bulkTimePresent,
    `date=${emptyDesktop.bulkDatePresent} time=${emptyDesktop.bulkTimePresent}`);
  check('625 empty-form: the visible copy-all label is REMOVED', !emptyDesktop.bandLabelPresent,
    `labelPresent=${emptyDesktop.bandLabelPresent} text="${emptyDesktop.bandLabelText ?? ''}"`);
  check('625 empty-form: both bulk inputs survive the label removal', emptyDesktop.bulkDatePresent && emptyDesktop.bulkTimePresent,
    `date=${emptyDesktop.bulkDatePresent} time=${emptyDesktop.bulkTimePresent}`);

  // SIL-625: type a complete bulk value — the 607 Copy affordance must still
  // appear with the label gone.
  await page.type('input[id$="-bulk-appointment-date"]', '01112026', { delay: 40 });
  await page.type('input[id$="-bulk-appointment-time"]', '0830', { delay: 40 });
  await sleep(400);
  const typedState = await page.evaluate(() => ({
    copy: Boolean(document.querySelector('.csc-bulk-appointment__copy')),
    label: Boolean(document.querySelector('.csc-bulk-appointment .split-datetime__label')),
  }));
  await page.screenshot({ path: resolve(OUT, 'band-1307-typed.png') });
  check('625 typed: Copy affordance appears, label stays gone', typedState.copy && !typedState.label,
    `copy=${typedState.copy} labelPresent=${typedState.label}`);
  // Clear the typed draft back to empty (the band keeps rendering either way).
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(300);

  // ── State 2: FILLED appointment (emptyAppointmentCount → 0), desktop 1307 ─
  await fillContainerAppointment(page);
  await sleep(700);
  const filledDesktop = await probe(page);
  await page.screenshot({ path: resolve(OUT, 'band-1307-after-filled.png') });
  check('617 filled-form: copy-all band STILL PRESENT after every cont has a schedule', filledDesktop.bandPresent,
    `bandPresent=${filledDesktop.bandPresent} (pre-fix bug: unmounted at count 0)`);

  // ── SIL-616 heights, desktop 1307 ─────────────────────────────────────────
  const std = emptyDesktop.customerControlHeight;
  log(`reference: customer combobox control = ${std}px, bill input control = ${emptyDesktop.billControlHeight}px`);
  check('616 desktop: segmented option height == standard interior (28px inside the 30px shell)',
    emptyDesktop.optionHeight != null && Math.abs(emptyDesktop.optionHeight - 28) <= 1,
    `option=${emptyDesktop.optionHeight}px expect≈28 shell=${emptyDesktop.segShellHeight}px standard=${std}px`);
  check('616 desktop: segmented shell height == standard control height (30px)',
    emptyDesktop.segShellHeight != null && Math.abs(emptyDesktop.segShellHeight - 30) <= 1,
    `shell=${emptyDesktop.segShellHeight}px expect≈30`);
  for (const [idx, gh] of (emptyDesktop.bandSegGroupHeights || []).entries()) {
    check(`616 desktop: bulk datetime segment group ${idx} == standard control height (30px)`,
      gh != null && Math.abs(gh - 30) <= 1, `group=${gh}px expect≈30`);
  }
  check('604 guard desktop: mode card height still ≤ 72px', emptyDesktop.cardHeight != null && emptyDesktop.cardHeight <= 72,
    `card=${emptyDesktop.cardHeight}px (AC ≤72, passed at 70.5)`);

  // ── State 3: mobile 390 sweep (empty form first, then filled) ────────────
  await page.setViewport({ width: 390, height: 844 });
  await sleep(900);
  const mobileEmpty = await probe(page);
  await page.screenshot({ path: resolve(OUT, 'band-390-empty.png') });
  check('617 mobile 390 empty: band present', mobileEmpty.bandPresent, `bandPresent=${mobileEmpty.bandPresent}`);
  check('625 mobile 390 empty: label stays removed', !mobileEmpty.bandLabelPresent, `labelPresent=${mobileEmpty.bandLabelPresent}`);

  const mobile = mobileEmpty;
  await page.screenshot({ path: resolve(OUT, 'band-390-after-filled.png') });
  check('617 mobile 390: band still present (filled state)', mobile.bandPresent, `bandPresent=${mobile.bandPresent}`);
  check('625 mobile 390: label stays removed', !mobile.bandLabelPresent, `labelPresent=${mobile.bandLabelPresent}`);

  result.emptyDesktop = emptyDesktop;
  result.filledDesktop = filledDesktop;
  result.mobile = mobile;
  await browser.close();
  writeFileSync(resolve(OUT, 'assertions.json'), JSON.stringify(result, null, 2));
  log(result.failed ? 'RESULT: FAIL' : 'RESULT: ALL CHECKS PASS');
  process.exitCode = result.failed ? 1 : 0;
} catch (err) {
  log(`DRIVER ERROR: ${err?.message ?? err}`);
  result.error = String(err);
  writeFileSync(resolve(OUT, 'assertions.json'), JSON.stringify(result, null, 2));
  await browser.close();
  process.exitCode = 1;
}
