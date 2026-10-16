// FB-009 (card 131026233500) + FB-048 (card 141026003600) — staging UI drive.
// One CUS session on /shipments/new: clipboard copy surfaces (FB-009), then
// the partial-date red-border paint (FB-048). No lot is created — no fixture.
import {
  API, BASE, EXPECTED_BUILD, assertBuild, login, launch, makeLogger,
  installIdempotency, sleep, bodyText,
} from './w5w4-lib.mjs';

const log = makeLogger('2026-10-16_w5w4_fb009-fb048');
const expect = (cond, msg) => { if (!cond) throw new Error(`ASSERT FAIL: ${msg}`); };

await assertBuild(log);
const token = await login('cus');
log('login cus OK');

const browser = await launch();
try {
  await browser.defaultBrowserContext().overridePermissions(BASE, [
    'clipboard-read', 'clipboard-write', 'clipboard-sanitized-write',
  ]);
  const page = await browser.newPage();
  installIdempotency(page);
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  const setSeg = (rowIndex, seg, value) => page.evaluate((ri, s, v) => {
    const row = document.querySelectorAll('.csc-container-row')[ri];
    if (!row) return false;
    const input = row.querySelector(`input[data-seg="${s}"]`);
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, rowIndex, seg, value);

  const fillCombined = (suffix, value) => page.evaluate((sf, v) => {
    const input = document.querySelector(`input[id$="${sf}"]`);
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, suffix, value);

  const clickAria = async (label) => {
    const ok = await page.evaluate((lb) => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === lb && !b.disabled);
      if (!btn) return false;
      btn.click();
      return true;
    }, label);
    if (!ok) throw new Error(`aria-button not found: ${label}`);
    await sleep(300);
  };

  const readClipboard = async () => {
    try { return await page.evaluate(() => navigator.clipboard.readText()); }
    catch (e) { return `<<clipboard unreadable: ${String(e).slice(0, 80)}>>`; }
  };

  // ─── FB-009a: row copy-time button ─────────────────────────────────────────
  log('FB-009a: fill row 0 appointment 09:30 25/12/2026 via segments');
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForSelector('.csc-container-row', { timeout: 20000 });
  await sleep(600);
  // Add the empty destination row FIRST — pin-test law: clones added after a
  // fill inherit the source draft and stop being empty destinations.
  {
    const modeNow = await page.evaluate(() => {
      const radios = [...document.querySelectorAll('input[type="radio"], [role="radio"]')];
      const checked = radios.find((r) => r.checked || r.getAttribute('aria-checked') === 'true');
      return checked ? (checked.getAttribute('value') || 'checked') : 'none';
    });
    log(`FB-009a: cargo mode at load = ${modeNow}`);
    expect(modeNow === 'FCL', 'form loads in FCL mode');
    const rowsBefore = await page.evaluate(() => document.querySelectorAll('.csc-container-row').length);
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Thêm container');
      if (!btn) throw new Error('Thêm container button not found');
      btn.click();
    });
    await sleep(500);
    const rowsAfter = await page.evaluate(() => document.querySelectorAll('.csc-container-row').length);
    log(`FB-009a: container rows ${rowsBefore} → ${rowsAfter}`);
    expect(rowsAfter === rowsBefore + 1, `Thêm container actually added a row (${rowsBefore}→${rowsAfter})`);
  }
  for (const [seg, v] of [['hh', '09'], ['mm', '30'], ['dd', '25'], ['mm2', '12'], ['yyyy', '2026']]) {
    expect(await setSeg(0, seg, v), `segment ${seg} set`);
  }
  await page.waitForFunction(() => !![...document.querySelectorAll('button')]
    .find((b) => b.getAttribute('aria-label') === 'Copy Giờ hẹn đóng trả'), { timeout: 8000, polling: 120 });
  const inRightCell = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Copy Giờ hẹn đóng trả');
    const td = btn && btn.closest('td');
    return td ? td.dataset.label : null;
  });
  log(`FB-009a: row copy button present, inside td[data-label="${inRightCell}"]`);
  expect(inRightCell === 'Ngày giờ đóng trả *', 'copy-time button lives in the appointment cell');
  await clickAria('Copy Giờ hẹn đóng trả');
  const clip1 = await readClipboard();
  const text1 = await bodyText(page);
  log(`FB-009a: clipboard="${clip1}"`);
  expect(text1.includes('Đã copy giờ hẹn 09:30 25/12/2026'), 'toast Đã copy giờ hẹn 09:30 25/12/2026 shown');
  expect(clip1 === '09:30 25/12/2026', `clipboard equals "09:30 25/12/2026" (got "${clip1}")`);
  await log.shot(page, 'ui-01-row-copy-time-toast');

  // ─── FB-009b: Lịch & ghi chú section group copy ────────────────────────────
  log('FB-009b: section group shipment-bulk-appointment');
  const group = await page.evaluate(() => !!document.querySelector('[data-field-id="shipment-bulk-appointment"]'));
  expect(group, 'Lịch & ghi chú bulk appointment group present (FCL mode, ≥1 empty row)');
  expect(await fillCombined('-bulk-appointment-date', '26/12/2026'), 'bulk date set');
  expect(await fillCombined('-bulk-appointment-time', '14:15'), 'bulk time set');
  await page.waitForFunction(() => !![...document.querySelectorAll('button')]
    .find((b) => b.getAttribute('aria-label') === 'Copy giờ hẹn đóng trả'), { timeout: 8000, polling: 120 });
  await clickAria('Copy giờ hẹn đóng trả');
  const clip2 = await readClipboard();
  const text2 = await bodyText(page);
  log(`FB-009b: clipboard="${clip2}"`);
  expect(text2.includes('Đã copy giờ hẹn 14:15 26/12/2026'), 'toast Đã copy giờ hẹn 14:15 26/12/2026 shown');
  expect(clip2 === '14:15 26/12/2026', `section clipboard equals "14:15 26/12/2026" (got "${clip2}")`);
  await log.shot(page, 'ui-02-section-copy-toast');

  // ─── FB-009c: Chọn ngày giờ dialog header copy ─────────────────────────────
  log('FB-009c: open Chọn ngày giờ dialog from row 0 appointment cell');
  // combinedPicker hosts open the picker on a click anywhere on the field
  // wrapper (SplitDateTimeField contract) — click the td's field, not the copy button.
  const opened = await page.evaluate(() => {
    const row = document.querySelectorAll('.csc-container-row')[0];
    if (!row) return false;
    const td = row.querySelector('td[data-label="Ngày giờ đóng trả *"]');
    if (!td) return false;
    const field = td.querySelector('.split-datetime, .combined-datetime, [data-date-input], input');
    if (!field) return false;
    field.click();
    return true;
  });
  expect(opened, 'appointment field clicked');
  await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"]')]
    .some((d) => d.textContent.includes('Chọn ngày giờ')), { timeout: 8000, polling: 120 });
  await sleep(400);
  const dlgHeader = await page.evaluate(() => {
    const dlg = [...document.querySelectorAll('[role="dialog"]')].find((d) => d.textContent.includes('Chọn ngày giờ'));
    if (!dlg) return null;
    const closeBtn = dlg.querySelector('button[aria-label="Đóng lịch"]');
    const copyBtn = [...dlg.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '').startsWith('Copy giờ hẹn'));
    return { close: !!closeBtn, copyLabel: copyBtn ? copyBtn.getAttribute('aria-label') : null };
  });
  log(`FB-009c: dialog header — Đóng lịch=${dlgHeader?.close}, copy button="${dlgHeader?.copyLabel}"`);
  expect(dlgHeader && dlgHeader.close, 'dialog header carries Đóng lịch');
  expect(dlgHeader && dlgHeader.copyLabel, 'dialog header carries the copy button (draft complete)');
  await page.evaluate(() => {
    const dlg = [...document.querySelectorAll('[role="dialog"]')].find((d) => d.textContent.includes('Chọn ngày giờ'));
    const copyBtn = [...dlg.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '').startsWith('Copy giờ hẹn'));
    copyBtn.click();
  });
  await sleep(400);
  const clip3 = await readClipboard();
  const text3 = await bodyText(page);
  log(`FB-009c: clipboard="${clip3}"`);
  expect(text3.includes('Đã copy giờ hẹn 09:30 25/12/2026'), 'toast confirms dialog copy');
  expect(clip3 === '09:30 25/12/2026', `dialog clipboard equals "09:30 25/12/2026" (got "${clip3}")`);
  await log.shot(page, 'ui-03-dialog-copy-toast');
  await clickAria('Đóng lịch');

  // ─── FB-048a: all-empty submit paints every required field ─────────────────
  log('FB-048a: all-empty submit');
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForSelector('.csc-container-row', { timeout: 20000 });
  await sleep(500);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Tạo lô hàng' && !b.disabled);
    if (!btn) throw new Error('submit not enabled');
    btn.click();
  });
  await page.waitForFunction(() => document.body.innerText.includes('Cần bổ sung'), { timeout: 8000, polling: 120 });
  const painted1 = await page.evaluate(() => {
    const bad = (sel) => {
      const f = document.querySelector(sel);
      return !!f && f.querySelector('[aria-invalid="true"], [data-invalid="true"]') != null;
    };
    const typeCell = [...document.querySelectorAll('[data-field-id$="-type"]')][0];
    return {
      customer: bad('[data-field-id="shipment-customer"]'),
      trade: bad('[data-field-id="shipment-trade-direction"]'),
      containerType: !!typeCell && typeCell.querySelector('[aria-invalid="true"], [data-invalid="true"]') != null,
    };
  });
  log(`FB-048a: painted=${JSON.stringify(painted1)}`);
  expect(painted1.customer && painted1.trade && painted1.containerType, 'customer + trade-direction + container type all red at rest');
  await log.shot(page, 'ui-04-empty-submit-red-borders');

  // ─── FB-048b: partial date draft must not starve the other fields ──────────
  log('FB-048b: partial time-only draft, then submit');
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForSelector('.csc-container-row', { timeout: 20000 });
  await sleep(500);
  expect(await fillCombined('-customer-appointment-time', '09:00'), 'partial time set (no date)');
  await sleep(200);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Tạo lô hàng' && !b.disabled);
    if (!btn) throw new Error('submit not enabled');
    btn.click();
  });
  await page.waitForFunction(() => document.body.innerText.includes('Cần bổ sung'), { timeout: 8000, polling: 120 });
  const painted2 = await page.evaluate(() => {
    const bad = (sel) => {
      const f = document.querySelector(sel);
      return !!f && f.querySelector('[aria-invalid="true"], [data-invalid="true"]') != null;
    };
    const typeCell = [...document.querySelectorAll('[data-field-id$="-type"]')][0];
    const err = document.querySelector('.split-datetime__error');
    return {
      customer: bad('[data-field-id="shipment-customer"]'),
      trade: bad('[data-field-id="shipment-trade-direction"]'),
      containerType: !!typeCell && typeCell.querySelector('[aria-invalid="true"], [data-invalid="true"]') != null,
      draftError: err ? err.textContent : null,
    };
  });
  log(`FB-048b: painted=${JSON.stringify(painted2)}`);
  expect(painted2.customer && painted2.trade && painted2.containerType, 'other required fields still paint with a partial draft');
  expect(painted2.draftError === 'Nhập đủ giờ và ngày hợp lệ.', `draft keeps its own message (got "${painted2.draftError}")`);
  await log.shot(page, 'ui-05-partial-date-others-still-red');

  const writes = await page.evaluate(() => window.__w5w4Writes || []);
  log(`writes issued through the SPA this session: ${JSON.stringify(writes)}`);
  expect(writes.length === 0, 'no write request was issued (form never saved)');

  await browser.close();
  log('FB-009 + FB-048 ALL ASSERTIONS PASS');
  process.exit(0);
} catch (e) {
  log(`FAIL: ${e.message}`);
  try { await log.shot((await browser.pages()).slice(-1)[0], 'FAIL-last-state'); } catch {}
  await browser.close().catch(() => {});
  process.exit(1);
}
