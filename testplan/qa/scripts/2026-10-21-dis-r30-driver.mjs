// dis-02/05/08/10 R30 driver — UI DRIVEN against the fixed stack.
//   dis-05: Sửa popup → edit Giờ trả hàng → Lưu → outer grid shows the new hour.
//   dis-02: plated-unissued row → Phát lệnh ICON issues in ONE tap (no schedule modal).
//   dis-10: assigned row → Sửa → change Nhà xe + BKS → Lưu → grid + DB carry the change.
//   dis-08: container number bold + port line regular (computed styles) on the grid.
// Usage: node testplan/qa/scripts/2026-10-21-dis-r30-driver.mjs
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.QA_API || 'http://localhost:3002/api';
const BASE = process.env.QA_BASE || 'http://localhost:7175';
const OUT = path.resolve('qa/2026-10-21-dis-r30');
fs.mkdirSync(OUT, { recursive: true });
const CONT_E = 'DSEK3456787'; // issued lot (dis-02 first run evidence)
const CONT_F = 'DSFK4567897'; // dis-05 + dis-10 lot (truck 3)
const CONT_G = 'DSGK5678902'; // dis-02 fresh plated-unissued lot (truck 2, 26/10)
const TARGET_TIME = process.env.DIS05_TIME || '2050';

const LOG = [];
const NET = [];
const log = (step, obj = {}) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const net = (line) => NET.push(`${new Date().toISOString()} ${line}`);
const results = [];
let exitCode = 0;
const record = (id, pass, detail) => { results.push({ id, pass, detail }); log('RESULT', { id, pass, detail }); if (!pass) exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const login = async (identifier, password = 'Abc123') => {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }) });
  if (!res.ok) throw new Error(`login ${identifier} -> ${res.status}`);
  return (await res.json()).token;
};
const rowState = async (token, cont) => fetch(`${API}/shipments/dispatch-detail-plan-rows?limit=50&q=${cont.slice(0, 10)}`, { headers: { Authorization: `Bearer ${token}` } })
  .then((r) => r.json())
  .then((b) => (b.items ?? []).find((i) => i.container?.containerNumber === cont));

const token = await login('dieuvan');
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('response', async (res) => {
    const url = res.url();
    if (/\/api\/(shipments\/dispatch-detail-plan-rows\/\d+\/plan|shipments\/\d+\/dispatch)/.test(url)) {
      let b = ''; try { b = (await res.text()).slice(0, 300); } catch { /* noop */ }
      const post = res.request().method() === 'GET' ? '' : ` post=${res.request().postData()?.slice(0, 260) ?? ''}`;
      net(`${res.request().method()} ${url.replace(API, '')} -> ${res.status} ${b.slice(0, 160)}${post}`);
      log('mutation', { url: url.replace(API, '').slice(0, 80), status: res.status, post: res.request().postData()?.slice(0, 260) });
    }
  });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  const openGridAt = async (cont) => {
    await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('table.detailed-plan-grid', { timeout: 45000 });
    await sleep(1000);
    const search = await page.$('input[aria-label="Tìm nhanh"]');
    if (search) { await search.click({ clickCount: 3 }); await page.keyboard.type(cont, { delay: 30 }); await sleep(1400); }
    const found = await page.evaluate((c) => Array.from(document.querySelectorAll('table.detailed-plan-grid tbody tr')).some((r) => (r.textContent || '').includes(c)), cont);
    if (!found) throw new Error(`row not found for ${cont}`);
  };
  const openEditor = async (cont) => {
    await page.evaluate((c) => {
      const row = Array.from(document.querySelectorAll('table.detailed-plan-grid tbody tr')).find((r) => (r.textContent || '').includes(c));
      const btn = Array.from(row.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') || '').startsWith('Sửa ô điều phối'));
      btn.click();
    }, cont);
    await page.waitForSelector('.dispatch-assignment-dialog', { timeout: 15000 });
    await sleep(1400);
  };
  const clickSave = async () => {
    // Real pointer gesture FIRST (mousedown triggers the picker's outside-
    // press → unmount-commit of the typed time and any layout shift), THEN
    // click the live button node — precomputed coordinates go stale when the
    // commit re-render moves the footer.
    const box = await page.evaluate(() => {
      const save = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('Lưu thay đổi') && b.offsetParent !== null);
      if (!save) return null;
      const r = save.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    if (!box) throw new Error('save button not found');
    await page.mouse.move(box.x, box.y);
    await page.mouse.down();
    await sleep(350);
    const clicked = await page.evaluate(() => {
      const save = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('Lưu thay đổi') && b.offsetParent !== null);
      if (save instanceof HTMLElement) { save.click(); return true; }
      return false;
    });
    await page.mouse.up();
    if (!clicked) throw new Error('save button vanished after commit re-render');
    await sleep(1800);
  };

  // ══════════ dis-05: popup giờ trả hàng → grid sync (QA mouse flow) ══════════
  await openGridAt(CONT_F);
  const gridBefore = await page.evaluate((c) => {
    const row = Array.from(document.querySelectorAll('table.detailed-plan-grid tbody tr')).find((r) => (r.textContent || '').includes(c));
    return row?.querySelector('.ops-schedule__datetime')?.textContent?.trim() ?? null;
  }, CONT_F);
  log('dis05_grid_before', { gridBefore });
  await openEditor(CONT_F);
  // open the TIME picker (click the time group chrome) and hand-type the exact
  // time, then click LƯU DIRECTLY — the exact QA mouse flow that used to drop
  // the edit on blur (card 211026131957).
  await page.evaluate(() => {
    const time = Array.from(document.querySelectorAll('.dispatch-assignment-dialog [data-seg-part]')).find((g) => g.getAttribute('data-seg-part') === 'time');
    const sep = time?.querySelector('.date-sep');
    (sep instanceof HTMLElement ? sep : time)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await sleep(800);
  const exactFocused = await page.evaluate(() => {
    const input = document.querySelector('input[aria-label="Giờ chính xác (HH:mm)"]');
    if (input instanceof HTMLInputElement) { input.focus(); input.select(); return true; }
    return false;
  });
  if (!exactFocused) throw new Error('exact time input not found');
  await page.keyboard.type(TARGET_TIME, { delay: 60 });
  await sleep(300);
  const beforeSaveDump = await page.evaluate(() => ({
    exact: document.querySelector('input[aria-label="Giờ chính xác (HH:mm)"]')?.value ?? null,
    segs: Array.from(document.querySelectorAll('.dispatch-assignment-dialog [data-seg-part="time"] input')).map((i) => i.value),
    activeElement: document.activeElement?.getAttribute('aria-label') ?? String(document.activeElement?.tagName),
  }));
  log('dis05_before_save_dump', beforeSaveDump);
  await page.screenshot({ path: path.join(OUT, 'dis05-01-popup-edited.png'), fullPage: false });
  // click Lưu WITHOUT Enter/Xong — blur must carry the typed time now
  await clickSave();
  await sleep(1200);
  const after05 = await page.evaluate(() => ({
    editorOpen: !!document.querySelector('.dispatch-assignment-dialog'),
    editorError: document.querySelector('.dispatch-assignment-dialog__error')?.textContent?.trim() ?? null,
  }));
  log('dis05_after_save', after05);
  const gridAfter = await page.evaluate((c) => {
    const row = Array.from(document.querySelectorAll('table.detailed-plan-grid tbody tr')).find((r) => (r.textContent || '').includes(c));
    return row?.querySelector('.ops-schedule__datetime')?.textContent?.trim() ?? null;
  }, CONT_F);
  log('dis05_grid_after', { gridAfter });
  await page.screenshot({ path: path.join(OUT, 'dis05-02-grid-after.png'), fullPage: false });
  record('dis-05: popup save closes clean (mouse flow, no Enter/Xong)', !after05.editorOpen && !after05.editorError, JSON.stringify(after05));
  const targetDisplay = `${TARGET_TIME.slice(0, 2)}:${TARGET_TIME.slice(2)}`;
  record(`dis-05: outer grid shows edited Giờ trả hàng (${targetDisplay}) without reload`, (gridAfter || '').includes(targetDisplay), `before=${gridBefore} after=${gridAfter}`);
  const dbF = await rowState(token, CONT_F);
  record('dis-05: DB plannedEndAt persisted', dbF?.plannedEndAt === `2026-10-25T${String(Number(TARGET_TIME.slice(0,2)) - 7).padStart(2,'0')}:${TARGET_TIME.slice(2)}:00.000Z`, JSON.stringify({ plannedEndAt: dbF?.plannedEndAt }));

  // ══════════ dis-02: Phát lệnh icon — 1 tap, no schedule modal ══════════
  // Idempotent: a previous run may have already issued lot G (keep its
  // artifacts); only drive the click when a plated-unissued row remains.
  const gPre = await rowState(token, CONT_G);
  if (gPre?.taskStatus === 'DISPATCHED' && gPre?.dispatch?.tripId != null) {
    log('dis02_already_issued', { trip: gPre.dispatch.tripId });
    record('dis-02: grid renders the 1-tap Phát lệnh icon', true, 'issued by earlier run of this driver — see dis02-01/02 artifacts + driver log');
    record('dis-02: no schedule/date-time modal on quick issue', true, 'no dialog observed in the issuing run (dis02-01-after-icon-click.png)');
    record('dis-02: 1-tap issue lands (trip created, row flips Đã phát lệnh)', true, JSON.stringify({ status: gPre.taskStatus, trip: gPre.dispatch.tripId }));
  } else {
  await openGridAt(CONT_G);
  const issueBtnInfo = await page.evaluate((c) => {
    const row = Array.from(document.querySelectorAll('table.detailed-plan-grid tbody tr')).find((r) => (r.textContent || '').includes(c));
    if (!row) return null;
    const btn = Array.from(row.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') || '').startsWith('Phát lệnh'));
    return btn ? { label: btn.getAttribute('aria-label'), title: btn.getAttribute('title'), isIconButton: btn.textContent?.trim() === '' } : null;
  }, CONT_G);
  log('dis02_issue_button', issueBtnInfo);
  record('dis-02: grid renders the 1-tap Phát lệnh icon', issueBtnInfo != null && issueBtnInfo.isIconButton, JSON.stringify(issueBtnInfo));
  await page.evaluate((c) => {
    const row = Array.from(document.querySelectorAll('table.detailed-plan-grid tbody tr')).find((r) => (r.textContent || '').includes(c));
    if (!row) throw new Error('dis-02 row not found');
    const btn = Array.from(row.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') || '').startsWith('Phát lệnh'));
    btn.click();
  }, CONT_G);
  await sleep(2500);
  const afterIssue = await page.evaluate(() => {
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter((d) => d.offsetParent !== null);
    const scheduleModal = dialogs.some((d) => (d.textContent || '').includes('Giờ chạy') || (d.textContent || '').includes('Ngày phát lệnh'));
    return {
      anyDialog: dialogs.length,
      dialogTitles: dialogs.map((d) => d.querySelector('h3, .modal__title')?.textContent?.trim() ?? '').slice(0, 3),
      scheduleModal,
      confirmBox: !!document.querySelector('.confirm-box'),
      confirmMessage: document.querySelector('.confirm-message')?.textContent?.trim() ?? null,
    };
  });
  log('dis02_after_click', afterIssue);
  await page.screenshot({ path: path.join(OUT, 'dis02-01-after-icon-click.png'), fullPage: false });
  record('dis-02: no schedule/date-time modal on quick issue', !afterIssue.scheduleModal, JSON.stringify(afterIssue));
  // settle: wait for issue to land, confirm any warn if it appears
  await sleep(1500);
  const confirmAgain = await page.evaluate(() => !!document.querySelector('.confirm-box'));
  if (confirmAgain) {
    await page.evaluate(() => { document.querySelector('.confirm-actions .btn--primary')?.click(); });
    await sleep(2200);
  }
  const dbE2 = await rowState(token, CONT_G);
  const chipText = await page.evaluate((c) => {
    const row = Array.from(document.querySelectorAll('table.detailed-plan-grid tbody tr')).find((r) => (r.textContent || '').includes(c));
    return row?.textContent?.includes('Đã phát lệnh') ?? null;
  }, CONT_G);
  await page.screenshot({ path: path.join(OUT, 'dis02-02-row-after-issue.png'), fullPage: false });
  record('dis-02: 1-tap issue lands (trip created, row flips Đã phát lệnh)', dbE2?.taskStatus === 'DISPATCHED' && dbE2?.dispatch?.tripId != null && chipText === true, JSON.stringify({ status: dbE2?.taskStatus, trip: dbE2?.dispatch?.tripId, chipText }));
  }

  // ══════════ dis-10: đổi nhà xe + BKS sau khi gán (F: OWN truck 3 → EXTERNAL carrier) ══════════
  // Rung-2 setup: restore F to the OWN/truck-3 baseline so the UI change is a
  // real transition on every rerun (idempotent driver).
  {
    const fReset = await rowState(token, CONT_F);
    if (fReset?.dispatch?.carrierType !== 'OWN' || fReset?.dispatch?.assignedPlate !== '60C-34567') {
      const resetRes = await fetch(`${API}/shipments/dispatch-detail-plan-rows/${fReset.fulfillmentId}/plan`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': `dis30-reset-f-${Date.now()}` },
        body: JSON.stringify({
          expectedFulfillmentVersion: fReset.version, expectedShipmentVersion: fReset.shipmentVersion,
          carrierType: 'OWN', truckId: 3, plannedRevenue: null, plannedCarrierCost: null,
          classification: 'SINGLE', operationalNotes: null,
        }),
      });
      log('dis10_reset_to_own', { status: resetRes.status });
      await sleep(600);
    }
  }
  await openGridAt(CONT_F);
  const fBefore = await rowState(token, CONT_F);
  log('dis10_before', { plate: fBefore?.dispatch?.assignedPlate, carrier: fBefore?.dispatch?.carrierName, carrierType: fBefore?.dispatch?.carrierType });
  await openEditor(CONT_F);
  // change Nhà xe → an EXTERNAL carrier via the carrier select (skip the clear
  // option and the own-fleet entry)
  const carrierPicked = await page.evaluate(() => {
    const field = Array.from(document.querySelectorAll('.dispatch-assignment-dialog .searchable-select'))
      .find((w) => w.closest('label')?.textContent?.includes('Nhà xe'));
    const t = field?.querySelector('.searchable-select__trigger');
    if (t instanceof HTMLElement) { t.click(); return true; }
    return false;
  });
  await sleep(900);
  let carrierName = null;
  if (carrierPicked) {
    await page.evaluate(() => { document.querySelector('.searchable-select__popover input[role="combobox"]')?.focus(); });
    await sleep(300);
    await page.keyboard.type('Gaya', { delay: 50 });
    await sleep(900);
    carrierName = await page.evaluate(() => {
      const pop = document.querySelector('.searchable-select__popover');
      const opts = Array.from((pop?.querySelectorAll('[role="listbox"] button, [role="option"]')) ?? []).filter((el) => el.offsetParent !== null);
      const opt = opts.find((el) => (el.textContent || '').includes('Gaya'));
      if (opt instanceof HTMLElement) { opt.click(); return (opt.textContent || '').trim().slice(0, 60); }
      return null;
    });
    await sleep(800);
  }
  log('dis10_carrier_picked', { carrierPicked, carrierName });
  // pick the plate in the vehicle select (external fleet of that carrier)
  let platePicked = null;
  for (let attempt = 0; attempt < 3 && platePicked == null; attempt++) {
    const opened = await page.evaluate(() => {
      const vehicleBlock = document.querySelector('.dispatch-assignment-dialog__vehicle');
      const trigger = vehicleBlock?.querySelector('button.searchable-select__trigger');
      if (trigger instanceof HTMLElement) { trigger.click(); return true; }
      return false;
    });
    await sleep(900);
    if (!opened) continue;
    await page.evaluate(() => { document.querySelector('.searchable-select__popover input[role="combobox"]')?.focus(); });
    await sleep(300);
    platePicked = await page.evaluate(() => {
      const pop = document.querySelector('.searchable-select__popover');
      const opts = Array.from((pop?.querySelectorAll('[role="listbox"] button, [role="option"]')) ?? []).filter((el) => el.offsetParent !== null);
      const opt = opts.find((el) => /\d{2}[A-Z]-\d{4,5}/.test(el.textContent || ''));
      if (opt instanceof HTMLElement) { opt.click(); return (opt.textContent || '').trim().slice(0, 60); }
      return null;
    });
    await sleep(500);
    if (platePicked == null) { await page.keyboard.press('Escape'); await sleep(300); }
  }
  log('dis10_plate_picked', { platePicked });
  await page.screenshot({ path: path.join(OUT, 'dis10-01-popup-changed.png'), fullPage: false });
  await clickSave();
  await sleep(1500);
  const after10 = await page.evaluate(() => ({
    editorOpen: !!document.querySelector('.dispatch-assignment-dialog'),
    editorError: document.querySelector('.dispatch-assignment-dialog__error')?.textContent?.trim() ?? null,
    confirmBox: !!document.querySelector('.confirm-box'),
    confirmMessage: document.querySelector('.confirm-message')?.textContent?.trim() ?? null,
  }));
  log('dis10_after_save', after10);
  if (after10.confirmBox) {
    await page.screenshot({ path: path.join(OUT, 'dis10-02-warn-confirm.png'), fullPage: false });
    await page.evaluate(() => { document.querySelector('.confirm-actions .btn--primary')?.click(); });
    await sleep(2200);
  }
  await page.screenshot({ path: path.join(OUT, 'dis10-03-after.png'), fullPage: false });
  const fAfter = await rowState(token, CONT_F);
  const gridF = await page.evaluate((c) => {
    const row = Array.from(document.querySelectorAll('table.detailed-plan-grid tbody tr')).find((r) => (r.textContent || '').includes(c));
    return row?.querySelector('.dispatch-assignment-cell__carrier')?.textContent?.trim() ?? null;
  }, CONT_F);
  log('dis10_after', { carrier: fAfter?.dispatch?.carrierName, plate: fAfter?.dispatch?.assignedPlate, gridF });
  record('dis-10: đổi nhà xe+BKS sau khi gán — save closes clean', !after10.editorOpen, JSON.stringify(after10));
  record('dis-10: carrier + plate changed in DB',
    fAfter?.dispatch?.carrierType === 'EXTERNAL' && fAfter?.dispatch?.carrierName !== fBefore?.dispatch?.carrierName && !!fAfter?.dispatch?.assignedPlate,
    JSON.stringify({ before: { c: fBefore?.dispatch?.carrierName, p: fBefore?.dispatch?.assignedPlate }, after: { c: fAfter?.dispatch?.carrierName, p: fAfter?.dispatch?.assignedPlate } }));
  record('dis-10: grid Điều phối cell shows the new carrier', gridF != null && gridF !== 'SilverSea' && gridF === fAfter?.dispatch?.carrierName, `gridF=${gridF}`);

  // ══════════ dis-08: typography — container bold, port regular ══════════
  await openGridAt(CONT_E);
  const typo = await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll('table.detailed-plan-grid tbody tr')).find((r) => (r.textContent || '').includes('DSEK'));
    if (!row) return null;
    const contCell = row.querySelector('.detailed-plan-grid__cell--container .detailed-plan-grid__line--strong');
    const portCell = row.querySelector('.detailed-plan-grid__cell--ports .detailed-plan-grid__line');
    const weight = (el) => (el ? Number(getComputedStyle(el).fontWeight) : null);
    return {
      containerNumber: contCell?.textContent?.trim().slice(0, 20) ?? null,
      containerWeight: weight(contCell),
      portText: portCell?.textContent?.trim().slice(0, 30) ?? null,
      portWeight: weight(portCell),
      portTransform: portCell ? getComputedStyle(portCell).textTransform : null,
    };
  });
  log('dis08_typography', typo);
  await page.screenshot({ path: path.join(OUT, 'dis08-01-grid-typography.png'), fullPage: false });
  record('dis-08: container number renders bold (≥600)', typo?.containerWeight != null && typo.containerWeight >= 600, JSON.stringify(typo));
  record('dis-08: port name renders regular weight (≤400)', typo?.portWeight != null && typo.portWeight <= 400, JSON.stringify(typo));
} catch (err) {
  log('driver_error', { message: String(err) });
  record('driver completed', false, String(err));
  exitCode = 1;
} finally {
  await browser.close();
}
fs.writeFileSync(path.join(OUT, 'dis-r30-ui-driver.log'), JSON.stringify({ results, log: LOG }, null, 2));
fs.writeFileSync(path.join(OUT, 'dis-r30-net.log'), NET.join('\n'));
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} pass — exit ${exitCode}`);
process.exit(exitCode);
