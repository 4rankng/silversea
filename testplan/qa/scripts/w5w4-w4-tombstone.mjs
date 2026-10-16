// W4 card 161026121500 — bảng giá tombstone uniqueness, staging UI drive.
// Per surface (pricing_tables / road_allowances / lift_pricing):
//   create → delete (soft) → RE-CREATE THE SAME SELECTOR (must SUCCEED — the
//   fix under test) → live duplicate must still be blocked → cleanup delete.
// House pattern from qa/2026-10-16_bang-gia-tombstone_ui-drive.mjs, this run
// against staging with the Idempotency-Key fetch wrapper on every write.
import {
  assertBuild, login, launch, makeLogger, installIdempotency, sleep,
  clickButtonByText, selectByLabel, waitFor, bodyText,
} from './w5w4-lib.mjs';

const log = makeLogger('2026-10-16_w5w4_w4-tombstone');
const expect = (cond, msg) => { if (!cond) throw new Error(`ASSERT FAIL: ${msg}`); };

const PT_PRICE = '777888001';
const RA_AMOUNT = '777888002';
const LP_PRICE = '777888003';
const DATE_UI = '31/12/2099';
const fmtPrice = (p) => `${p.slice(0, 3)}.${p.slice(3, 6)}.${p.slice(6)}`;

await assertBuild(log);
const token = await login('admin');
log('login admin OK');

const browser = await launch();
try {
  const page = await browser.newPage();
  installIdempotency(page);
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  const alertText = () => page.evaluate(() => [...document.querySelectorAll('[role="alert"], .alert')]
    .map((a) => a.textContent.trim()).join(' | '));
  const hasDupError = async () => (await alertText()).includes('đã tồn tại');
  const rowWithPriceVisible = (price) => page.evaluate((p) => document.body.innerText.includes(p), price);

  const fillByLabel = async (labelText, value, type = 'text') => {
    const ok = await page.evaluate((lt, val, typ) => {
      const lbl = [...document.querySelectorAll('label')].find((l) => l.textContent.trim() === lt);
      if (!lbl) return 'no label';
      let el = lbl;
      let guard = 0;
      while (el && guard++ < 8) {
        const parent = el.parentElement;
        if (!parent) break;
        el = parent;
        if (el.querySelector('input, textarea') && [...el.querySelectorAll('label')].length === 1) break;
        if (el.parentElement === null) break;
      }
      const inputs = [...(el ? el.querySelectorAll('input, textarea') : [])];
      const input = inputs.find((i) => (i.type === typ || (typ === 'text' && !i.type)) && !i.disabled && !i.readOnly);
      if (!input) return `no input under ${lt}`;
      const proto = input instanceof window.HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(input, val);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('blur', { bubbles: true }));
      return true;
    }, labelText, value, type);
    if (ok !== true) throw new Error(`fillByLabel ${labelText}: ${ok}`);
    await sleep(150);
  };

  const pickNthRealOption = async (labelText, idx) => {
    const r = await page.evaluate((lt, i) => {
      const lbl = [...document.querySelectorAll('label')].find((l) => l.textContent.trim() === lt);
      if (!lbl) return 'no label';
      let el = lbl;
      let guard = 0;
      while (el && guard++ < 6 && !el.querySelector('select')) el = el.parentElement;
      const sel = el && el.querySelector('select');
      if (!sel) return 'no select';
      const real = [...sel.options].filter((o) => o.value !== '' && o.value !== '0'
        && !/^(--|—|Đang tải|Lỗi)/.test(o.textContent.trim()));
      if (!real[i]) return `no option #${i}`;
      const proto = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      proto.call(sel, real[i].value);
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return `picked ${real[i].textContent.trim()}`;
    }, labelText, idx);
    if (typeof r === 'string' && !r.startsWith('picked')) throw new Error(`pick ${labelText}: ${r}`);
    await sleep(200);
    return r;
  };

  const confirmDelete = async () => {
    await clickButtonByText(page, /Xóa cấu hình này/);
    await page.waitForFunction(
      () => !!document.querySelector('[role="alertdialog"], .confirm-dialog, [data-confirm], [role="dialog"]'),
      { timeout: 6000, polling: 120 },
    ).catch(() => null);
    await sleep(400);
    await clickButtonByText(page, /^Xóa$/);
    await sleep(1100);
  };

  const openAddForm = async (markerText) => {
    await clickButtonByText(page, /^Thêm mới$/);
    // CrudTable dialog pages render [role=dialog]; InlineForm pages (road
    // allowances / lift pricing) render no wrapper — wait for the form's own
    // field marker instead.
    await waitFor(page, () => document.querySelectorAll('[role="dialog"]').length > 0
      || [...document.querySelectorAll('label')].some((l) => l.textContent.trim() === markerText), 10000);
    await sleep(600);
  };

  // UuiSelectField is React-Aria (combobox ≥5 options, plain listbox below).
  // Controls are addressed by DOM ORDER; commit is VERIFIED on the trigger,
  // with a real-mouse fallback for the silent-noop click trap (W3a lesson).
  const pickReactAria = async (nth, optionMatcher, pickIdx = 0) => {
    const source = optionMatcher instanceof RegExp ? optionMatcher.source : String(optionMatcher);
    const flags = optionMatcher instanceof RegExp ? optionMatcher.flags : 'i';
    const has = await page.evaluate((n) => {
      const ctrls = [...document.querySelectorAll('input[role="combobox"], button[aria-haspopup="listbox"]')]
        .filter((c) => !c.disabled);
      if (!ctrls[n]) return false;
      ctrls[n].click();
      if (ctrls[n].focus) ctrls[n].focus();
      return true;
    }, nth);
    if (!has) throw new Error(`pickReactAria: control #${nth} not found`);
    await sleep(600);
    const chosen = await page.evaluate((src, fl, i) => {
      const re2 = new RegExp(src, fl);
      const opts = [...document.querySelectorAll('[role="option"]')]
        .filter((o) => o.textContent.trim() && !/^(--|—|Đang tải|Lỗi|Gõ để tìm)/.test(o.textContent.trim()) && re2.test(o.textContent.trim()));
      if (!opts[i]) return null;
      opts[i].click();
      return opts[i].textContent.trim();
    }, source, flags, pickIdx);
    await sleep(400);
    if (!chosen) throw new Error(`pickReactAria #${nth}: no option matching /${source}/ #${pickIdx}`);
    const committed = await page.evaluate((n, label) => {
      const ctrls = [...document.querySelectorAll('input[role="combobox"], button[aria-haspopup="listbox"]')]
        .filter((c) => !c.disabled);
      const c = ctrls[n];
      if (!c) return false;
      const text = c.value || c.textContent || '';
      return text.includes(label);
    }, nth, chosen);
    if (!committed) {
      // Silent-noop fallback: real mouse click on the option's coordinates.
      const box = await page.evaluate((src, fl, i) => {
        const re2 = new RegExp(src, fl);
        const opts = [...document.querySelectorAll('[role="option"]')]
          .filter((o) => o.textContent.trim() && !/^(--|—|Đang tải|Lỗi|Gõ để tìm)/.test(o.textContent.trim()) && re2.test(o.textContent.trim()));
        const o = opts[i];
        if (!o) return null;
        const r = o.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }, source, flags, pickIdx);
      if (!box) throw new Error(`pickReactAria #${nth}: fallback option gone`);
      await page.mouse.click(box.x, box.y);
      await sleep(400);
    }
    log(`pickReactAria #${nth} → "${chosen}"${committed ? '' : ' (via real-mouse fallback)'}`);
    return chosen;
  };

  const cancelForm = async () => {
    const ok = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('[role="dialog"] button, form button, .inline-form button')]
        .find((b) => /^Hủy$/.test(b.textContent.trim()) && !b.disabled);
      if (!btn) return false;
      btn.click();
      return true;
    });
    if (ok) { await sleep(400); return; }
    await page.keyboard.press('Escape');
    await sleep(400);
  };

  const saveInline = async () => {
    const ok = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => /^Thêm$/.test(b.textContent.trim()) && !b.disabled);
      if (!btn) return false;
      btn.click();
      return true;
    });
    if (!ok) throw new Error('Thêm button not found');
    await sleep(1200);
  };

  // ─── Surface A: /config/pricing-tables (react-aria comboboxes in a dialog) ──
  log('=== Surface A: pricing_tables (Bảng giá cước) ===');
  await page.goto('https://vantai.tingting.vip/config/pricing-tables', { waitUntil: 'networkidle2', timeout: 45000 });
  await waitFor(page, () => !!document.querySelector('table'), 20000);
  await sleep(800);

  const comboPick = async (nth, idx) => {
    await page.evaluate((n) => {
      const combos = [...document.querySelectorAll('[role="dialog"] input[role="combobox"]')];
      if (!combos[n]) throw new Error(`combobox #${n} not found`);
      combos[n].click();
      combos[n].focus();
    }, nth);
    await sleep(500);
    const chosen = await page.evaluate((i) => {
      const opts = [...document.querySelectorAll('[role="option"]')]
        .filter((o) => o.textContent.trim() && !/^(--\s*Chọn|--|—\s*Không áp dụng)/.test(o.textContent.trim()));
      if (!opts[i]) return null;
      opts[i].click();
      return opts[i].textContent.trim();
    }, idx);
    if (!chosen) throw new Error(`no combobox option #${idx}`);
    await sleep(300);
    return chosen;
  };

  const fillPricingForm = async (comboIdx) => {
    const cust = await comboPick(0, comboIdx);
    const route = await comboPick(1, comboIdx);
    await fillByLabel('Cước thu khách (đ)', PT_PRICE, 'number');
    await fillByLabel('Hiệu lực từ', DATE_UI, 'text');
    log(`selector: customer="${cust}" route="${route}" date=${DATE_UI} price=${PT_PRICE}`);
    return `${cust} × ${route}`;
  };

  const saveDialog = async () => {
    const ok = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('[role="dialog"] button')]
        .find((b) => /^(Thêm|Cập nhật)$/.test(b.textContent.trim()) && !b.disabled);
      if (!btn) return false;
      btn.click();
      return true;
    });
    if (!ok) throw new Error('save button not found in dialog');
    await sleep(1200);
  };

  const deleteSentinelRow = async (priceFmt) => {
    const opened = await page.evaluate((pf) => {
      const row = [...document.querySelectorAll('tr')].find((r) => r.textContent.includes(pf));
      if (!row) return false;
      row.click();
      return true;
    }, priceFmt);
    if (!opened) throw new Error(`sentinel row ${priceFmt} not found`);
    await waitFor(page, () => /Xóa cấu hình này/.test(document.body.innerText), 8000);
    await sleep(400);
    await confirmDelete();
  };

  let comboIdx = 0;
  for (;;) {
    await openAddForm('Cước thu khách (đ)');
    await fillPricingForm(comboIdx);
    await saveDialog();
    if (await rowWithPriceVisible(fmtPrice(PT_PRICE))) break;
    log(`A create attempt (combo idx ${comboIdx}) hit a live duplicate or failed — retrying with another selector`);
    await cancelForm();
    comboIdx += 1;
    if (comboIdx > 4) throw new Error('no free customer×route selector after 5 tries');
  }
  expect(await rowWithPriceVisible(fmtPrice(PT_PRICE)), 'pricing row created');
  log('A1 create: sentinel row visible');
  await log.shot(page, 'ui-01-pt-created');

  await deleteSentinelRow(fmtPrice(PT_PRICE));
  expect(!(await rowWithPriceVisible(fmtPrice(PT_PRICE))), 'pricing row gone after delete');
  log('A2 delete (soft): row removed');
  await log.shot(page, 'ui-02-pt-deleted');

  await openAddForm();
  await fillPricingForm(comboIdx);
  await saveDialog();
  await sleep(400);
  expect(!(await hasDupError()), `no phantom duplicate error (alerts: "${await alertText()}")`);
  expect(await rowWithPriceVisible(fmtPrice(PT_PRICE)), 're-created SAME selector — SUCCESS');
  log('A3 re-create same selector: SUCCESS — tombstone released the unique slot');
  await log.shot(page, 'ui-03-pt-recreated-same-selector');

  await openAddForm();
  await fillPricingForm(comboIdx);
  await saveDialog();
  await sleep(400);
  expect(await hasDupError(), `live duplicate still blocked (alerts: "${await alertText()}")`);
  log(`A4 live duplicate blocked: "${await alertText()}"`);
  await log.shot(page, 'ui-04-pt-live-duplicate-blocked');
  await cancelForm();
  await deleteSentinelRow(fmtPrice(PT_PRICE));
  expect(!(await rowWithPriceVisible(fmtPrice(PT_PRICE))), 'cleanup: sentinel row deleted');
  log('A5 cleanup: pricing sentinel deleted via UI (tombstone remains — sanctioned, slot-reusable)');
  await log.shot(page, 'ui-05-pt-cleaned-up');

  // ─── Surface B: /config/road-allowances (native selects, inline form) ───────
  log('=== Surface B: road_allowances (Tiền đi đường) ===');
  await page.goto('https://vantai.tingting.vip/config/road-allowances', { waitUntil: 'networkidle2', timeout: 45000 });
  await sleep(1500);

  const raTry = async (routeIdx, trailerRe) => {
    await openAddForm('Mức cơ bản (đ)');
    await pickReactAria(0, /.*/, routeIdx);              // Tuyến đường (combobox)
    await pickReactAria(1, trailerRe);                   // Loại rơ-moóc (listbox)
    await fillByLabel('Mức cơ bản (đ)', RA_AMOUNT, 'number');
    log(`B selector: route option #${routeIdx} × ${trailerRe}, amount=${RA_AMOUNT}`);
    await saveInline();
    return true;
  };

  // Staging is a prod mirror: both routes may already carry live 20ft rows —
  // sweep (route × trailer) slots until one is free.
  const raSlots = [[0, '^20ft$'], [1, '^20ft$'], [0, '^40ft$'], [1, '^40ft$']];
  let raSlot = null;
  for (const [ri, tr] of raSlots) {
    await raTry(ri, tr);
    if (await rowWithPriceVisible(fmtPrice(RA_AMOUNT))) { raSlot = [ri, tr]; break; }
    log(`B create attempt (route #${ri} × ${tr}) hit a live duplicate — next slot`);
    await cancelForm();
  }
  if (!raSlot) throw new Error('no free route×trailer slot on staging (all 4 live)');
  const [raRouteIdx, raTrailer] = raSlot;
  const raRedo = () => raTry(raRouteIdx, raTrailer);
  expect(await rowWithPriceVisible(fmtPrice(RA_AMOUNT)), 'road-allowance row created');
  log('B1 create: sentinel row visible');
  await log.shot(page, 'ui-06-ra-created');

  await deleteSentinelRow(fmtPrice(RA_AMOUNT));
  expect(!(await rowWithPriceVisible(fmtPrice(RA_AMOUNT))), 'road-allowance row gone');
  log('B2 delete (soft): row removed');

  await raRedo();
  await sleep(400);
  expect(!(await hasDupError()), `no phantom duplicate on re-add (alerts: "${await alertText()}")`);
  expect(await rowWithPriceVisible(fmtPrice(RA_AMOUNT)), 're-created SAME route×20ft selector — SUCCESS');
  log('B3 re-create same selector: SUCCESS');
  await log.shot(page, 'ui-07-ra-recreated');

  await raRedo();
  await sleep(400);
  expect(await hasDupError(), `live duplicate still blocked (alerts: "${await alertText()}")`);
  log(`B4 live duplicate blocked: "${await alertText()}"`);
  await log.shot(page, 'ui-08-ra-live-duplicate-blocked');
  await cancelForm();
  await deleteSentinelRow(fmtPrice(RA_AMOUNT));
  expect(!(await rowWithPriceVisible(fmtPrice(RA_AMOUNT))), 'cleanup: road-allowance sentinel deleted');
  log('B5 cleanup: road-allowance sentinel deleted via UI');
  await log.shot(page, 'ui-09-ra-cleaned-up');

  // ─── Surface C: /config/lift-pricing (native selects, inline form) ──────────
  log('=== Surface C: lift_pricing (Bảng giá nâng/hạ) ===');
  await page.goto('https://vantai.tingting.vip/config/lift-pricing', { waitUntil: 'networkidle2', timeout: 45000 });
  await sleep(1500);

  const lpTry = async (pickIdx) => {
    await openAddForm('Đơn giá (₫)');
    const portPick = await pickReactAria(0, /.*/, pickIdx);        // Cảng / bãi
    const contPick = await pickReactAria(1, /.*/, pickIdx);        // Loại container
    await pickReactAria(2, '^Nâng$');                              // Chiều
    await pickReactAria(3, '^Hàng$');                              // Trạng thái hàng
    await fillByLabel('Đơn giá (₫)', LP_PRICE, 'text');
    log(`C selector: ${portPick} × ${contPick} × Nâng × Hàng (effectiveDate = today)`);
    await saveInline();
    return `${portPick} × ${contPick}`;
  };

  let lpIdx = 0;
  for (;;) {
    await lpTry(lpIdx);
    if (await rowWithPriceVisible(fmtPrice(LP_PRICE))) break;
    log(`C create attempt (pick #${lpIdx}) hit a live duplicate — next port×container pair`);
    await cancelForm();
    lpIdx += 1;
    if (lpIdx > 4) throw new Error('no free port×container slot after 5 tries');
  }
  expect(await rowWithPriceVisible(fmtPrice(LP_PRICE)), 'lift-pricing row created');
  log('C1 create: sentinel row visible');
  await log.shot(page, 'ui-10-lp-created');

  await deleteSentinelRow(fmtPrice(LP_PRICE));
  expect(!(await rowWithPriceVisible(fmtPrice(LP_PRICE))), 'lift-pricing row gone');
  log('C2 delete (soft): row removed');

  await lpTry(lpIdx);
  await sleep(400);
  expect(!(await hasDupError()), `no phantom duplicate on re-add (alerts: "${await alertText()}")`);
  expect(await rowWithPriceVisible(fmtPrice(LP_PRICE)), 're-created SAME port×cont×Nâng×Hàng selector — SUCCESS');
  log('C3 re-create same selector: SUCCESS');
  await log.shot(page, 'ui-11-lp-recreated');

  await lpTry(lpIdx);
  await sleep(400);
  expect(await hasDupError(), `live duplicate still blocked (alerts: "${await alertText()}")`);
  log(`C4 live duplicate blocked: "${await alertText()}")`);
  await log.shot(page, 'ui-12-lp-live-duplicate-blocked');
  await cancelForm();
  await deleteSentinelRow(fmtPrice(LP_PRICE));
  expect(!(await rowWithPriceVisible(fmtPrice(LP_PRICE))), 'cleanup: lift-pricing sentinel deleted');
  log('C5 cleanup: lift-pricing sentinel deleted via UI');
  await log.shot(page, 'ui-13-lp-cleaned-up');

  const writes = await page.evaluate(() => window.__w5w4Writes || []);
  log(`writes issued through the SPA (Idempotency-Key on each): ${writes.length}`);
  for (const w of writes) log(`  ${w.method} ${w.url} key=${w.key}`);

  await browser.close();
  log('W4 TOMBSTONE DRIVE ALL SURFACES PASS');
  process.exit(0);
} catch (e) {
  log(`FAIL: ${e.message}`);
  try { await log.shot((await browser.pages()).slice(-1)[0], 'FAIL-last-state'); } catch {}
  await browser.close().catch(() => {});
  process.exit(1);
}
