// W3b — R20 batch1 verification re-run on staging (build must equal main HEAD ae419e3d).
// Source card: 141026140500-r20-batch1-cus-3fixes-regression-build-c7dcc286 (role CUS tiepvv).
//   TCs: FB-084 (CBM optional), FB-079 (packaging suggestions), FB-086 (workboard
//   add container), R1 (FCL 2-cont create), R2 (workboard search), R3 (detail match).
// Usage: node w3b-r20-batch1-verify.mjs <phase>
//   phases: lcl | fcl | wb-add | regression | cleanup
// Hardening (w3a lessons): uppercase fixture BL, BL-on-board guard before any row
// interaction, NEVER click "Xóa bộ lọc", Idempotency-Key on every write.
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
// puppeteer is installed in the main checkout's store; resolve from there so the
// script also runs from fresh worktrees.
const require2 = createRequire('/Volumes/LexarSSD/projects/silversea/package.json');
const puppeteer = require2('puppeteer');

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
// staging re-cut mid-wave: ae419e3d → 7dcdcf33 (W1 ketoan merge; 1876eb9d +
// aa3e7ba3 above it are records/docs-only — zero src delta vs origin/main,
// zero shipments delta vs ae419e3d, so earlier phase verdicts carry over)
const EXPECT_BUILD = process.env.QA_EXPECT_BUILD || '7dcdcf33';
const OUT = path.resolve(import.meta.dirname, '../../../qa/2026-10-16_w3b-r20-verify');
fs.mkdirSync(OUT, { recursive: true });

const PHASE = process.argv[2] || '';
const USER = { lcl: 'tiepvv', fcl: 'tiepvv', 'wb-add': 'tiepvv', regression: 'tiepvv', cleanup: 'admin' }[PHASE];
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(2, 12);
const BL_LCL = `QAW3B${stamp}A`;   // FB-084/FB-079 lot
const BL_FCL = `QAW3B${stamp}B`;   // R1/R3 lot
const BL_WB = `QAW3B${stamp}C`;    // FB-086 lot

// ISO 6346 per shared/src/calculations/iso6346.ts (app's own letter map — the
// source of truth; Wikipedia's mapping is NOT what the app validates).
const LETTER_MAP = { A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 17, H: 18, I: 19, J: 20, K: 21, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29, S: 30, T: 31, U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38 };
const POWERS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];
const contNumber = (prefix4, serial6) => {
  const ten = prefix4 + serial6;
  let total = 0;
  for (let i = 0; i < 10; i++) total += (i < 4 ? LETTER_MAP[ten[i]] : Number(ten[i])) * POWERS[i];
  const check = total % 11 === 10 ? 0 : total % 11;
  return ten + check;
};

const LOG = [];
const log = (step, obj = {}) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const tc = (id, verdict, detail = {}) => log('TC', { id, verdict, ...detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;
const fail = (id, why, detail = {}) => { tc(id, 'FAIL', { why, ...detail }); exitCode = 1; };

const api = async (method, p, body, tok) => {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: {
      Authorization: `Bearer ${tok ?? token}`,
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
const login = async (identifier) => {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  const text = await res.text();
  if (res.status !== 200) throw new Error(`login ${identifier} -> ${res.status}: ${text.slice(0, 120)}`);
  try { return JSON.parse(text).token; } catch { throw new Error(`login ${identifier}: non-JSON ${res.status}: ${text.slice(0, 120)}`); }
};
const adminToken = () => login('admin');

// ── health gate (abort on stale build) ──────────────────────────────────────
const healthRes = await fetch(`${API}/health`);
const healthText = await healthRes.text();
let health;
try { health = JSON.parse(healthText); } catch { console.error(`health ${healthRes.status}: ${healthText.slice(0, 150)}`); process.exit(2); }
log('health', { buildHash: health.buildHash, expect: EXPECT_BUILD });
if (!String(health.buildHash || '').startsWith(EXPECT_BUILD)) {
  console.error('STALE BUILD — aborting phase');
  process.exit(2);
}
let token = await login(USER);
const jwtPayload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
log('identity', { user: USER, jwtUsername: jwtPayload.username || jwtPayload.identifier || jwtPayload.sub });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1500,1000'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 960 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 200)));
await page.evaluateOnNewDocument((t, origin) => {
  if (location.origin === origin) localStorage.setItem('token', t);
}, token, new URL(BASE).origin);

const shot = (name) => page.screenshot({ path: path.join(OUT, `${PHASE}_${name}.png`), fullPage: false });
const goto = async (url, settleMs = 2200) => {
  await page.goto(BASE + url, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(settleMs);
};
const bodyText = () => page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));
const has = async (needle) => (await bodyText()).includes(needle);

// label -> control; keeps the RAW label text so the rendered asterisk is visible
const fieldByLabel = async (labelText, nth = 0) => page.evaluate((lt, n) => {
  const clean = (s) => s.textContent.trim().replace(/\s+/g, ' ').replace(/\*+$/, '').trim();
  const raw = (s) => s.textContent.trim().replace(/\s+/g, ' ');
  const labels = [...document.querySelectorAll('label')].filter((l) => l.offsetParent && (clean(l) === lt || clean(l).startsWith(lt)));
  const label = labels[n];
  if (!label) return { found: false, matching: labels.length };
  const forId = label.getAttribute('for');
  const el = forId ? document.getElementById(forId)
    : (label.querySelector('input,select,textarea') ?? label.parentElement.querySelector('input,select,textarea') ?? label.nextElementSibling?.querySelector('input,select,textarea'));
  if (!el) return { found: false, matching: labels.length, labelText: raw(label) };
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  return { found: true, id: el.id, tag: el.tagName, value: el.value ?? null, disabled: el.disabled ?? false, rawLabelText: raw(label), x: Math.round(r.x), y: Math.round(r.y) };
}, labelText, nth);

// unified lookup: <label> (LCL/identity) → [data-label] cell (FCL container
// cells, QA1-007 asterisk contract) → [aria-label] control. rawLabelText keeps
// the asterisk state whichever way the field renders it.
const fieldByAny = async (labelText, nth = 0) => {
  const byLabel = await fieldByLabel(labelText, nth);
  if (byLabel.found) return byLabel;
  return page.evaluate((lt, n) => {
    const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').replace(/\*+$/, '').trim();
    const cells = [...document.querySelectorAll('[data-label]')].filter((c) => c.offsetParent && norm(c.getAttribute('data-label')) === lt);
    const ctl = cells[n]?.querySelector('input,select,textarea')
      ?? [...document.querySelectorAll('input,select,textarea')].filter((e) => e.offsetParent && norm(e.getAttribute('aria-label')) === lt)[n];
    if (!ctl) return { found: false, matching: cells.length };
    ctl.scrollIntoView({ block: 'center' });
    const r = ctl.getBoundingClientRect();
    return { found: true, id: ctl.id, tag: ctl.tagName, value: ctl.value ?? null, disabled: ctl.disabled ?? false, rawLabelText: cells[n]?.getAttribute('data-label') ?? ctl.getAttribute('aria-label'), x: Math.round(r.x), y: Math.round(r.y) };
  }, labelText, nth);
};

// react-aria combobox: real mouse pick — synthetic .click() on [role=option] no-ops
const pickCombobox = async (labelText, query, nth = 0) => {
  const fld = await fieldByAny(labelText, nth);
  if (!fld.found) throw new Error(`combobox label not found: ${labelText} (#${nth})`);
  await page.click(`[id="${fld.id}"]`);
  await sleep(800);
  if (query) { await page.keyboard.type(query, { delay: 40 }); await sleep(1500); }
  else {
    // openOnType pickers (menuTrigger 'input') never open on bare focus —
    // probe with one char; if nothing matches, delete it to restore the
    // full list and try once more before giving up
    await page.keyboard.type('a', { delay: 40 });
    await sleep(900);
  }
  const located = await page.evaluate((q) => {
    const norm = (t) => (t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const opts = [...document.querySelectorAll('[role="option"]')].filter((o) => o.offsetParent);
    const hit = q
      ? opts.find((o) => norm(o.textContent).includes(norm(q)))
      : opts.find((o) => !/^[+＋]/.test(o.textContent.trim()));
    if (!hit) return { ok: false, count: opts.length, sample: opts.slice(0, 6).map((o) => o.textContent.trim().slice(0, 30)) };
    const r = hit.getBoundingClientRect();
    return { ok: true, text: hit.textContent.trim().slice(0, 60), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  }, query || '');
  if (!located.ok && !query) {
    // probe char filtered everything out — clear it, list reopens unfiltered
    await page.keyboard.press('Backspace');
    await sleep(900);
  }
  const located2 = located.ok ? located : await page.evaluate((q) => {
    const opts = [...document.querySelectorAll('[role="option"]')].filter((o) => o.offsetParent);
    const hit = opts.find((o) => !/^[+＋]/.test(o.textContent.trim()));
    if (!hit) return { ok: false, count: opts.length };
    const r = hit.getBoundingClientRect();
    return { ok: true, text: hit.textContent.trim().slice(0, 60), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  }, null);
  if (!located2.ok) throw new Error(`no option for ${labelText} (${located2.count} visible; ${JSON.stringify(located.sample)})`);
  await page.mouse.move(located2.x, located2.y);
  await page.mouse.down();
  await page.mouse.up();
  await sleep(600);
  return located2.text;
};
// combobox OPTIONS dump without selecting (FB-079)
const dumpOptions = async (labelText) => {
  const fld = await fieldByLabel(labelText);
  if (!fld.found) throw new Error(`label not found: ${labelText}`);
  await page.click(`[id="${fld.id}"]`);
  await sleep(900);
  const opts = await page.evaluate(() => [...document.querySelectorAll('[role="option"]')].filter((o) => o.offsetParent).map((o) => o.textContent.trim()));
  await page.keyboard.press('Escape');
  await sleep(400);
  return opts;
};
const pickSelect = async (optionText) => {
  const sel = await page.evaluate((ot) => {
    const s = [...document.querySelectorAll('select')].find((e) => e.offsetParent && [...e.options].some((o) => o.textContent.trim() === ot));
    if (!s) return null;
    const opt = [...s.options].find((o) => o.textContent.trim() === ot);
    const proto = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value');
    proto.set.call(s, opt.value);
    s.dispatchEvent(new Event('input', { bubbles: true }));
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return { id: s.id, value: opt.value };
  }, optionText);
  if (!sel) throw new Error(`select with option "${optionText}" not found`);
  await sleep(400);
  return sel;
};
const setValue = async (labelText, value, nth = 0) => {
  const fld = await fieldByAny(labelText, nth);
  if (!fld.found) throw new Error(`label not found: ${labelText} (#${nth})`);
  if (fld.id) await page.click(`[id="${fld.id}"]`, { clickCount: 3 });
  else await realClickAt(fld.x, fld.y); // inline add-form inputs carry no id
  await page.keyboard.type(value, { delay: 15 });
  await sleep(200);
};
const realClickAt = async (x, y, count = 1) => {
  await page.mouse.move(x, y);
  await page.mouse.down({ clickCount: count });
  await page.mouse.up({ clickCount: count });
};

// delete a fixture lot via admin API (version-gated), Idempotency-Key always
const adminDeleteShipment = async (sid, aTok) => {
  const g = await api('GET', `/shipments/${sid}`, undefined, aTok);
  const ver = g.body?.shipment?.version ?? g.body?.version;
  const del = await api('DELETE', `/shipments/${sid}?version=${ver}`, undefined, aTok);
  log('cleanup-delete', { sid, deleteStatus: del.status });
  return del.status;
};

try {
  if (PHASE === 'lcl') {
    await goto('/shipments/new');
    await sleep(1500);
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('label,button,[role="radio"],[role="tab"]')]
        .find((e) => e.offsetParent && e.textContent.replace(/\s+/g, ' ').trim().startsWith('Hàng lẻ'));
      if (el) el.click();
    });
    await sleep(1200);
    await shot('01-lcl-top');

    // ── FB-079: packaging combobox carries the 9 factory-style suggestions ──
    const opts = await dumpOptions('Quy cách đóng gói');
    log('FB-079-options', { count: opts.length, opts });
    const expected9 = ['Thùng gỗ', 'Pallet', 'Roll', 'Carton', 'Box', 'Crate', 'Khung', 'Bao', 'Can'];
    const missing = expected9.filter((e2) => !opts.some((o) => o.replace(/\s+/g, ' ').includes(e2)));
    // free text must be accepted (FB-079 guarantee 2026-09-06)
    const customPkg = 'R20 Quy cách riêng W3B';
    await setValue('Quy cách đóng gói', customPkg);
    await page.keyboard.press('Tab');
    await sleep(400);
    const pkgAfter = await fieldByLabel('Quy cách đóng gói');
    log('FB-079-free-text', { kept: pkgAfter.value, wanted: customPkg });
    const freeTextOk = (pkgAfter.value || '').trim() === customPkg;
    if (!missing.length && freeTextOk) tc('FB-079', 'PASS', { options: opts, freeText: customPkg });
    else fail('FB-079', missing.length ? `missing options: ${missing.join(', ')}` : 'free text not kept', { missing, kept: pkgAfter.value });

    // ── FB-084: CBM optional — required set has marks, CBM has none, submit OK ──
    const rawOf = async (lt) => (await fieldByLabel(lt)).rawLabelText ?? null;
    const marks = {};
    for (const lt of ['Kho lấy hàng', 'Quy cách đóng gói', 'Số lượng', 'Trọng lượng (kg)', 'Ngày giao hàng', 'Tuyến đường', 'Thể tích (CBM)']) marks[lt] = await rawOf(lt);
    log('FB-084-labels', marks);
    const cbmClean = !/×|\*/.test(marks['Thể tích (CBM)'] ?? '*');
    await shot('02-cbm-field');

    log('fill', { customer: await pickCombobox('Khách hàng', 'YUAN') });
    log('fill', { trade: await pickSelect('Nhập khẩu') });
    await setValue('Số Bill/Booking', BL_LCL);
    log('fill', { route: await pickCombobox('Tuyến đường', null) });
    log('fill', { warehouse: await pickCombobox('Kho lấy hàng', null) });
    await setValue('Số lượng', '10');
    await setValue('Trọng lượng (kg)', '5000');
    const dg = await fieldByLabel('Ngày giao hàng');
    if (dg.found) {
      await page.click(`[id="${dg.id}"]`);
      await sleep(200);
      await page.keyboard.type('20102026', { delay: 90 });
      await sleep(300);
      log('fill', { deliveryDate: '20/10/2026' });
    }
    await shot('03-filled-blank-cbm');
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.offsetParent && /Tạo lô hàng/.test(b.textContent));
      if (btn) btn.click(); else throw new Error('no submit button');
    });
    await sleep(3500);
    await shot('04-after-submit');
    const afterUrl = page.url();
    const errPanel = await has('Cần bổ sung');
    const errCbm = await has('Nhập thể tích lớn hơn 0');
    log('FB-084-submit', { afterUrl, errPanel, errCbm });
    const m = afterUrl.match(/\/shipments\/(\d+)/);
    if (m && !errPanel && !errCbm && cbmClean) {
      const sid = Number(m[1]);
      const get = await api('GET', `/shipments/${sid}`);
      const s = get.body?.shipment ?? get.body ?? {};
      const persisted = { id: s.id, bl: s.blNumber, cbm: s.cargoVolumeCbm ?? null, packageType: s.packageType ?? s.cargoPackageType ?? null, status: s.status };
      log('FB-084-persisted', persisted);
      const pkgPersisted = (persisted.packageType ?? '') === customPkg;
      if (persisted.cbm === null && pkgPersisted) tc('FB-084', 'PASS', { shipmentId: sid, persisted });
      else tc('FB-084', persisted.cbm === null ? 'PASS' : 'FAIL', { shipmentId: sid, note: persisted.cbm === null ? 'CBM null; packageType mismatch only' : 'CBM not null', persisted });
      if (persisted.cbm !== null) exitCode = 1;
      const aTok = await adminToken();
      await adminDeleteShipment(sid, aTok);
    } else {
      fail('FB-084', 'blank-CBM submit blocked', { afterUrl, errPanel, errCbm, cbmClean });
    }
  }

  if (PHASE === 'fcl') {
    await goto('/shipments/new');
    await sleep(2000);
    const modeRadio = await page.evaluate(() => {
      const r = [...document.querySelectorAll('input[name="cargo-mode"]')].find((x) => x.offsetParent);
      const checked = [...document.querySelectorAll('input[name="cargo-mode"]')].find((x) => x.checked);
      return { fclVisible: !!r, checkedValue: checked?.value ?? null };
    });
    log('mode', modeRadio);
    await shot('01-fcl-top');
    log('fill', { customer: await pickCombobox('Khách hàng', 'YUAN') });
    log('fill', { trade: await pickSelect('Nhập khẩu') });
    await setValue('Số Bill/Booking', BL_FCL);
    // bulk appointment first: applies to every row still without a schedule
    const bulk = await fieldByLabel('Ngày giờ đóng trả cho tất cả cont');
    if (bulk.found) {
      await page.click(`[id="${bulk.id}"]`);
      await sleep(200);
      await page.keyboard.type('1000', { delay: 90 });
      await sleep(250);
      await page.keyboard.type('17102026', { delay: 90 });
      await sleep(300);
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find((x) => x.offsetParent && /Áp dụng cho \d+ container/.test(x.textContent));
        if (b) b.click();
      });
      await sleep(800);
      log('fill', { bulkAppointment: '17/10/2026 10:00' });
    }
    // ensure exactly 2 container rows: count existing, add what's missing
    const countRows = () => page.evaluate(() => [...document.querySelectorAll('[data-label]')].filter((c) => c.offsetParent && /^Loại container/.test(String(c.getAttribute('data-label')))).length);
    let rows = await countRows();
    log('rows-initial', { rows });
    const need = Math.max(0, 2 - rows);
    if (need > 0) {
      await page.evaluate((n) => {
        const inp = document.getElementById('container-add-count');
        if (!inp) throw new Error('container-add-count not found');
        const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
        proto.set.call(inp, String(n));
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
      }, need);
      await sleep(400);
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => b.offsetParent && b.textContent.includes('Thêm container'));
        if (btn) btn.click(); else throw new Error('no add-container button');
      });
      await sleep(1500);
      rows = await countRows();
      log('rows-after-add', { rows });
    }
    const cont1No = contNumber('QAWB', String(Date.now()).slice(-6));
    const cont2No = contNumber('QAWB', String(Number(String(Date.now()).slice(-6)) + 7).padStart(6, '0'));
    for (const [i, cNo] of [[0, cont1No], [1, cont2No]]) {
      log('fill', { row: i + 1, contType: await pickCombobox('Loại container', '20', i) });
      log('fill', { row: i + 1, factory: await pickCombobox('Nhà máy', 'chưa', i) });
      // the factory may pin a fixed route — the picker then disables with the
      // route pre-filled (inherited); only pick when it is still editable
      const rs = await fieldByAny('Tuyến đường', i);
      if ((rs.value ?? '').trim()) log('fill', { row: i + 1, routeInherited: rs.value, disabled: rs.disabled });
      else if (rs.found && !rs.disabled) log('fill', { row: i + 1, route: await pickCombobox('Tuyến đường', 'Thuận', i) });
      else { fail('R1', 'route cell disabled and empty', rs); throw new Error('route stuck'); }
      log('fill', { row: i + 1, liftPort: await pickCombobox('Cảng nâng', 'hải phòng', i) });
      log('fill', { row: i + 1, dropPort: await pickCombobox('Cảng hạ', 'mipec', i) });
      const appt = await fieldByAny('Ngày giờ đóng trả', i);
      if (appt.found && !(appt.value ?? '').trim()) {
        await page.click(`[id="${appt.id}"]`);
        await sleep(200);
        await page.keyboard.type('1000', { delay: 90 });
        await sleep(250);
        await page.keyboard.type('17102026', { delay: 90 });
        await sleep(400);
      }
      await setValue('Số container', cNo, i);
      await setValue('Trọng lượng (kg)', '5000', i);
    }
    // QA1-007 normal-mode FCL marks (context evidence; dedicated phase re-checks)
    const fclMarks = {};
    for (const lt of ['Nhà máy', 'Tuyến đường', 'Cảng nâng', 'Cảng hạ']) fclMarks[lt] = (await fieldByAny(lt, 0)).rawLabelText ?? null;
    log('fcl-labels-normal-mode', fclMarks);
    await shot('02-fcl-filled');
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.offsetParent && /Tạo lô hàng/.test(b.textContent));
      if (btn) btn.click(); else throw new Error('no submit button');
    });
    await sleep(4000);
    await shot('03-after-submit');
    const afterUrl = page.url();
    const errPanel = await has('Cần bổ sung');
    log('R1-submit', { afterUrl, errPanel });
    const m = afterUrl.match(/\/shipments\/(\d+)/);
    if (m && !errPanel) {
      const sid = Number(m[1]);
      const get = await api('GET', `/shipments/${sid}`);
      const s = get.body?.shipment ?? get.body ?? {};
      const conts = (get.body?.containers ?? []).map((c) => ({ no: c.containerNumber, type: c.containerTypeId, appt: c.customerAppointmentAt ?? null }));
      log('R1-persisted', { id: s.id, bl: s.blNumber, conts });
      if (s.blNumber === BL_FCL && conts.length === 2) tc('R1', 'PASS', { shipmentId: sid, bl: s.blNumber, containers: conts.length });
      else fail('R1', 'persisted shape mismatch', { bl: s.blNumber, containers: conts.length });
      fs.writeFileSync(path.join(OUT, 'fcl_sid.json'), JSON.stringify({ sid, bl: BL_FCL }, null, 2));
    } else {
      fail('R1', 'FCL 2-cont submit blocked', { afterUrl, errPanel });
    }
  }

  if (PHASE === 'wb-add') {
    // fixture: 1-cont FCL lot (API setup — the THING UNDER TEST is the UI add-row)
    const tomorrow = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
    const created = await api('POST', '/shipments', {
      customerId: 1, cargoMode: 'FCL', tradeDirection: 'IMPORT', blNumber: BL_WB,
      shippingLineName: 'MAERSK', routeId: 6,
      customerNotes: `QAFIXTURE w3b FB-086 ${BL_WB}. Xoa duoc sau QA.`,
    });
    log('fixture-created', { status: created.status, id: created.body?.id ?? created.body?.shipment?.id });
    if (![200, 201].includes(created.status)) throw new Error(`create ${created.status}: ${JSON.stringify(created.body).slice(0, 250)}`);
    const sid = created.body.id ?? created.body.shipment?.id;
    let ver = created.body.version ?? created.body.shipment?.version ?? 1;
    await api('PUT', `/shipments/${sid}`, { expectedVersion: ver, closingAt: `${tomorrow}T03:00:00.000Z`, expectedDeliveryDate: tomorrow });
    const gv = await api('GET', `/shipments/${sid}`);
    ver = gv.body?.shipment?.version ?? ver + 1;
    const adminLogin = await adminToken();
    const ct = await fetch(`${API}/container-types?limit=1`, { headers: { Authorization: `Bearer ${adminLogin}` } }).then((r) => r.json());
    const ctId = ct.items?.[0]?.id ?? null;
    const c1 = contNumber('QAWB', String(Date.now()).slice(-6));
    const putC = await api('PUT', `/shipments/${sid}/containers`, {
      expectedVersion: ver,
      containers: [{ containerTypeId: ctId, containerNumber: c1, customerAppointmentAt: `${tomorrow}T03:00:00.000Z` }],
    });
    log('fixture-containers', { status: putC.status, ctId, c1, body: typeof putC.body === 'string' ? putC.body.slice(0, 200) : undefined });
    if (![200, 201].includes(putC.status)) throw new Error(`containers PUT ${putC.status}: ${JSON.stringify(putC.body).slice(0, 200)}`);

    // drive the workboard: search our BL, guard, click ＋ Thêm on OUR row
    await goto(`/shipments-detail?searchSuffix=${encodeURIComponent(BL_WB)}&transportDateFrom=2026-10-01&transportDateTo=2026-10-31`);
    await sleep(2500);
    const blOnBoard = await page.evaluate((bl) => (document.body.innerText || '').includes(bl), BL_WB);
    log('guard-bl-on-board', { bl: BL_WB, blOnBoard });
    if (!blOnBoard) throw new Error('fixture lot not on board — ABORT, refusing to touch other rows');
    await shot('01-workboard-our-row');
    const addBtn = await page.evaluate((bl) => {
      const rows = [...document.querySelectorAll('tbody tr')].filter((tr) => tr.textContent.includes(bl));
      const btn = rows.map((tr) => [...tr.querySelectorAll('button')].find((b) => /^＋ Thêm$/.test(b.textContent.trim()))).find(Boolean);
      if (!btn) return { found: false, rows: rows.length };
      btn.scrollIntoView({ block: 'center' });
      const r = btn.getBoundingClientRect();
      return { found: true, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), label: btn.getAttribute('aria-label') };
    }, BL_WB);
    log('add-button', addBtn);
    if (!addBtn.found) { fail('FB-086', '＋ Thêm action not found on our container row', addBtn); throw new Error('no add button'); }
    await realClickAt(addBtn.x, addBtn.y);
    await sleep(1200);
    await shot('02-inline-add-form');
    const formDump = await page.evaluate(() => ({
      labels: [...document.querySelectorAll('label')].filter((l) => l.offsetParent).map((l) => l.textContent.trim().replace(/\s+/g, ' ')).filter((t, i, a) => a.indexOf(t) === i).slice(0, 40),
      buttons: [...document.querySelectorAll('button')].filter((b) => b.offsetParent).map((b) => b.textContent.trim()).filter((t) => t && t.length < 30).slice(0, 40),
    }));
    log('add-form-dump', formDump);
    // fill the inline form: container number + weight (+ close date if present);
    // the container TYPE inherits from the row — the form has no type picker
    const c2 = contNumber('QAWB', String(Number(String(Date.now()).slice(-6)) + 3).padStart(6, '0'));
    await setValue('Số container', c2);
    const wFld = await fieldByAny('Trọng lượng (kg)');
    if (wFld.found) await setValue('Trọng lượng (kg)', '5000');
    // date and time are two separate controls here (AddContainerRowForm);
    // the time segments only expose 'Giờ —/Phút — Giờ đóng/trả' aria-labels
    const dateFld = await fieldByAny('Ngày đóng/trả');
    if (dateFld.found) {
      if (dateFld.id) await page.click(`[id="${dateFld.id}"]`);
      else await realClickAt(dateFld.x, dateFld.y);
      await sleep(200);
      await page.keyboard.type('17102026', { delay: 90 });
      await sleep(300);
      const hourSeg = await page.evaluate(() => {
        const form = document.querySelector('[data-testid="add-container-form"]');
        const h = form ? [...form.querySelectorAll('input')].find((i) => /^Giờ —/.test(i.getAttribute('aria-label') ?? '')) : null;
        if (!h) return null;
        h.scrollIntoView({ block: 'center' });
        const r = h.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
      });
      if (hourSeg) {
        await realClickAt(hourSeg.x, hourSeg.y);
        await sleep(200);
        await page.keyboard.type('1000', { delay: 120 });
        await sleep(300);
      }
      log('fill', { closeAt: '17/10/2026 10:00', timeSegmentFound: !!hourSeg });
    }
    await shot('03-add-form-filled');
    const saveBtn = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.offsetParent && /Lưu dòng mới|Xác nhận/.test(x.textContent));
      if (!b) return { found: false };
      b.scrollIntoView({ block: 'center' });
      const r = b.getBoundingClientRect();
      return { found: true, text: b.textContent.trim(), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), disabled: b.disabled };
    });
    log('save-button', saveBtn);
    if (!saveBtn.found) { fail('FB-086', 'inline form save button not found', formDump); throw new Error('no save button'); }
    await realClickAt(saveBtn.x, saveBtn.y);
    await sleep(3000);
    await shot('04-after-save');
    const saveDiag = await page.evaluate(() => {
      const err = [...document.querySelectorAll('[role="alert"]')].filter((e) => e.offsetParent).map((e) => e.textContent.trim().slice(0, 160));
      const form = document.querySelector('[data-testid="add-container-form"]');
      const inputs = form ? [...form.querySelectorAll('input')].map((i) => ({ al: i.getAttribute('aria-label'), val: i.value })) : null;
      return { alertErrors: err, formInputs: inputs, formStillOpen: !!form?.offsetParent };
    });
    log('save-diag', saveDiag);
    const formClosed = await page.evaluate(() => ![...document.querySelectorAll('button')].some((b) => b.offsetParent && /Lưu dòng mới/.test(b.textContent)));
    // persistence: reload → board shows TWO container rows for our lot; API confirms
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(2500);
    const blRowCount = await page.evaluate((bl) => [...document.querySelectorAll('tbody tr')].filter((tr) => tr.textContent.includes(bl)).length, BL_WB);
    const boardText = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));
    await shot('05-after-reload');
    const g2 = await api('GET', `/shipments/${sid}`);
    const conts2 = (g2.body?.containers ?? []).map((c) => ({ no: c.containerNumber, routeId: c.routeId ?? null, line: c.shippingLineName ?? null, appt: c.customerAppointmentAt ?? null }));
    const sameRoute = conts2.length === 2 && conts2.every((c) => c.routeId === (conts2[0].routeId ?? null));
    log('FB-086-after', { formClosed, blRowCount, conts2, boardHas2x20: /2x20DC|2x20’DC|2 x 20DC/i.test(boardText) });
    if (conts2.length === 2 && formClosed && sameRoute) {
      tc('FB-086', 'PASS', { shipmentId: sid, containers: conts2.map((c) => c.no), inheritedRouteId: conts2[0].routeId, appointment: conts2.map((c) => c.appt) });
    } else {
      fail('FB-086', 'add-row did not persist or inheritance broke', { conts2, formClosed, blRowCount });
    }
    fs.writeFileSync(path.join(OUT, 'wb_sid.json'), JSON.stringify({ sid, bl: BL_WB }, null, 2));
  }

  if (PHASE === 'regression') {
    const sids = JSON.parse(fs.readFileSync(path.join(OUT, 'fcl_sid.json'), 'utf8'));
    // ── R2: workboard search — lot code / customer name / nonsense ───────────
    await goto('/shipments-detail?transportDateFrom=2026-10-01&transportDateTo=2026-10-31', 3000);
    // the BOARD's search input lives in main content — the topbar global
    // search ('Tìm trang, cấu hình…') must not match
    const findBoardSearch = () => page.evaluate(() => {
      const main = document.querySelector('main') ?? document.body;
      const ins = [...main.querySelectorAll('input')].filter((i) => {
        if (!i.offsetParent) return false;
        const t = `${i.placeholder ?? ''} ${i.getAttribute('aria-label') ?? ''}`;
        // board search chrome: "Bill/Book, mã lô, container, tờ khai, khách hàng"
        return /Bill\/Book/i.test(t) || (/tìm|search/i.test(t) && !/trang/i.test(t));
      });
      const i = ins[0];
      if (!i) return null;
      i.scrollIntoView({ block: 'center' });
      const r = i.getBoundingClientRect();
      return { id: i.id, ph: i.placeholder, al: i.getAttribute('aria-label'), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    });
    const drive = await findBoardSearch();
    log('search-inputs', drive);
    if (!drive) { fail('R2', 'search input not found'); throw new Error('no search input'); }
    const doSearch = async (q) => {
      const fld = await findBoardSearch();
      if (!fld) throw new Error('board search input vanished');
      if (fld.id) await page.click(`[id="${fld.id}"]`, { clickCount: 3 });
      else await realClickAt(fld.x, fld.y, 3); // triple-click selects all
      await page.keyboard.press('Backspace');
      await sleep(200);
      await page.keyboard.type(q, { delay: 25 });
      const typed = await page.evaluate(() => {
        const main = document.querySelector('main') ?? document.body;
        const i = [...main.querySelectorAll('input')].find((x) => /Bill\/Book/i.test(`${x.placeholder ?? ''}`));
        return i?.value ?? null;
      });
      await page.keyboard.press('Enter');
      await sleep(2500);
      return typed;
    };
    const q1 = await doSearch('QAW3B');
    await shot('r2-01-search-lot');
    const lotHit = await page.evaluate((bl) => (document.body.innerText || '').includes(bl), sids.bl);
    const q2 = await doSearch('YUANFANG');
    await shot('r2-02-search-customer');
    const custHit = await page.evaluate((bl) => (document.body.innerText || '').includes(bl), sids.bl);
    const q3 = await doSearch('ZZZZQAW3BKHÔNGCÓ');
    await shot('r2-03-search-empty');
    // card recorded 'Không có lô hàng phù hợp'; the container-level workboard
    // rework renamed the empty copy to 'Không có container phù hợp' — the
    // informative empty state + Xóa bộ lọc affordance is the contract
    const emptyText = await has('Không có container phù hợp') || await has('Không có lô hàng phù hợp');
    const boardStateDump = await page.evaluate(() => {
      const main = document.querySelector('main') ?? document.body;
      return (main.innerText || '').replace(/\s+/g, ' ').slice(0, 600);
    });
    log('R2-empty-state', { emptyText, boardStateDump });
    // w3a incident law: assert the button EXISTS — never click it
    const clearBtn = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.offsetParent && x.textContent.trim() === 'Xóa bộ lọc');
      return b ? { found: true } : { found: false };
    });
    log('R2', { lotHit, custHit, emptyText, clearBtn, typedQueries: [q1, q2, q3] });
    if (lotHit && custHit && emptyText && clearBtn.found) tc('R2', 'PASS', { lotHit, custHit, emptyText, clearBtnPresentOnly: true });
    else fail('R2', 'search behavior mismatch', { lotHit, custHit, emptyText, clearBtn });

    // ── R3: detail page matches what was entered (FCL 2-cont fixture) ────────
    await goto(`/shipments/${sids.sid}`, 3000);
    await shot('r3-01-detail');
    const detText = await bodyText();
    const r3 = {
      blShown: detText.includes(sids.bl),
      customerShown: detText.includes('LONG MINH') || detText.includes('YUANFANG'),
      containerRows: await page.evaluate(() => (document.body.innerText.match(/QAWB\d{7}/g) ?? []).filter((v, i, a) => a.indexOf(v) === i)),
    };
    log('R3', r3);
    if (r3.blShown && r3.containerRows.length === 2) tc('R3', 'PASS', r3);
    else fail('R3', 'detail does not match entered data', r3);
  }

  if (PHASE === 'cleanup') {
    const sweep = await api('GET', '/shipments?q=QAW3B&limit=50');
    const items = sweep.body?.items ?? sweep.body?.shipments ?? [];
    log('sweep', { status: sweep.status, count: items.length, bls: items.map((s) => s.blNumber ?? s.billNumber) });
    const aTok = token;
    for (const it of items) {
      const sid = it.id ?? it.shipment?.id;
      if (sid) await adminDeleteShipment(sid, aTok);
    }
    const re = await api('GET', '/shipments?q=QAW3B&limit=50');
    const left = re.body?.items ?? re.body?.shipments ?? [];
    log('sweep-after', { left: left.length });
    if (!left.length) tc('CLEANUP', 'PASS', { removed: items.length });
    else fail('CLEANUP', 'fixtures remain', { left: left.map((s) => s.blNumber ?? s.billNumber) });
  }

  // final flush
  log('phase-done', { phase: PHASE, pageErrors });
} catch (error) {
  await shot('99-failure');
  log('PHASE-ERROR', { phase: PHASE, error: String(error).slice(0, 400), stack: String(error?.stack ?? '').slice(0, 600) });
  exitCode = 1;
} finally {
  fs.writeFileSync(path.join(OUT, `${PHASE}_log.json`), JSON.stringify(LOG, null, 2));
  await browser.close();
  process.exit(exitCode);
}
