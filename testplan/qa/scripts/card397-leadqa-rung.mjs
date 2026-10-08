// Card 20261007_397 — lead staging QA on cut 22837bc3. Owner ruling 08/10:
// rows WITHOUT an assigned carrier must NOT offer Phát lệnh; entry points are
// data-gated (workflow #359: phát lệnh cần nhà xe, không cần biển số).
// Staging's assigned rows were all frozen (COMPLETED), so this rung seeds its
// own pair: QA397 fixture lot, both containers dated today (API as CUS), one
// container assigned to a SilverSea rig via the real dispatch dialog (UI as
// Điều vận), then verifies: assigned row's editor shows the 'Phát lệnh cho
// tài xế' fieldset, unassigned row's editor does not. Server truth via the
// plan-rows API. Declared staging mutations: 1 fixture lot (2 containers),
// 1 dispatch assignment.
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-08_card397-leadqa';
// v1 of this rung seeded an ad-hoc lot (rawCustomerName) — dead end: the
// dispatch plan INNER-JOINs customers, so customerId-less lots never enter
// plan rows (leftover: ad-hoc lot 409, harmless). v2 seeds with customerId.
const BOOK = 'QA397-PHATLENH-02';
const C1 = 'QALE3970020';
const C2 = 'QALE3970036';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: '22837bc3' });
if (!String(health.buildHash || '').startsWith('22837bc3')) { log('build-currency-FAIL'); process.exit(2); }

const login = async (id) => (await (await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: id, password: 'Abc123' }) })).json()).token;
const cusTok = await login('thanhdc');
const dispTok = await login('dungnv');
if (!cusTok || !dispTok) { log('login-FAIL'); process.exit(2); }

// ── Phase 0: fixture lot, both containers dated today (CUS write path) ──
let lotId = null, v1 = null, v2 = null, c1Id = null, c2Id = null;
{
  const found = await fetch(`${API}/shipments/cus-workspace?searchSuffix=${BOOK}&limit=10`, { headers: { Authorization: `Bearer ${cusTok}` } }).then((r) => r.json());
  const existing = (found.items ?? []).find((i) => i.billOrBookNumber === BOOK);
  if (existing) {
    lotId = existing.id;
    log('fixture-reuse', { lotId });
  } else {
    const cr = await fetch(`${API}/shipments/quick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cusTok}`, 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        customerId: 1,
        bookingRef: BOOK,
        tradeDirection: 'EXPORT',
        cargoMode: 'FCL',
        containers: [
          { containerNumber: C1, containerTypeId: 1 },
          { containerNumber: C2, containerTypeId: 1 },
        ],
      }),
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
    log('fixture-create', { status: cr.status, keys: cr.body ? Object.keys(cr.body).slice(0, 14) : null });
    lotId = cr.body?.shipment?.id ?? cr.body?.id ?? null;
    if (!lotId) { log('fixture-FAIL', { body: JSON.stringify(cr.body).slice(0, 300) }); process.exit(2); }
  }
  // detail → containers; version from the list item (create/detail shapes vary)
  const det = await fetch(`${API}/shipments/cus-workspace/${lotId}`, { headers: { Authorization: `Bearer ${cusTok}` } }).then((r) => r.json());
  const lot = det.shipment ?? det;
  const conts = (det.containers ?? lot.containers ?? []).filter((c) => [C1, C2].includes(c.containerNumber));
  const lst = await fetch(`${API}/shipments/cus-workspace?searchSuffix=${BOOK}&limit=10`, { headers: { Authorization: `Bearer ${cusTok}` } }).then((r) => r.json());
  const listItem = (lst.items ?? []).find((i) => i.billOrBookNumber === BOOK);
  log('fixture-detail', { detKeys: Object.keys(det).slice(0, 18), status: lot.status ?? listItem?.status, version: lot.version ?? listItem?.version, containers: conts.map((c) => ({ id: c.id, n: c.containerNumber })) });
  if (conts.length < 2) { log('fixture-FAIL', { why: 'containers missing' }); process.exit(2); }
  c1Id = conts.find((c) => c.containerNumber === C1).id;
  c2Id = conts.find((c) => c.containerNumber === C2).id;
  let ver = Number(lot.version ?? listItem?.version);
  if (!Number.isFinite(ver)) { log('fixture-FAIL', { why: 'no version' }); process.exit(2); }
  const appt = '2026-10-08T15:00:00.000+07:00';
  for (const cid of [c1Id, c2Id]) {
    const r = await fetch(`${API}/shipments/cus-workspace/${lotId}/containers/${cid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cusTok}`, 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ expectedShipmentVersion: ver, customerAppointmentAt: appt }),
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
    ver = r.body?.shipmentVersion ?? r.body?.version ?? (ver + 1);
    log('fixture-appt', { cid, status: r.status, nowVersion: ver });
    if (r.status !== 200 && r.status !== 201) { log('fixture-appt-FAIL', { body: JSON.stringify(r.body).slice(0, 200) }); process.exit(2); }
  }
  const afterLst = await fetch(`${API}/shipments/cus-workspace?searchSuffix=${BOOK}&limit=10`, { headers: { Authorization: `Bearer ${cusTok}` } }).then((r) => r.json());
  const afterItem = (afterLst.items ?? []).find((i) => i.billOrBookNumber === BOOK);
  log('fixture-status', { status: afterItem?.status, want: 'READY_FOR_DISPATCH' });
  v1 = v2 = afterItem?.version;
}

// Server truth pre-assignment: neither row assigned.
const rowsNow = await fetch(`${API}/shipments/dispatch-detail-plan-rows?limit=50`, { headers: { Authorization: `Bearer ${dispTok}` } }).then((r) => r.json());
const rowOf = (cont) => (rowsNow.items ?? rowsNow).find((x) => (x?.container?.containerNumber ?? x?.containerNumber) === cont);
log('plan-rows-pre', { c1: { found: Boolean(rowOf(C1)), plate: rowOf(C1)?.dispatch?.assignedPlate ?? null }, c2: { found: Boolean(rowOf(C2)), plate: rowOf(C2)?.dispatch?.assignedPlate ?? null } });

// ── Phase 1: assign C1 via the real dispatch editor dialog ──
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1100 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), dispTok);
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 90000 });
  let nrows = 0;
  for (let i = 0; i < 18 && !nrows; i++) { await sleep(3000); nrows = await page.evaluate(() => document.querySelectorAll('tbody tr').length); }
  log('list', { rows: nrows });

  const openCell = async (cont) => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const pt = await page.evaluate((c) => {
        const btn = [...document.querySelectorAll('button')].filter((e) => e.offsetParent !== null)
          .find((b) => new RegExp(`Sửa ô điều phối ${c}`).test(b.getAttribute('aria-label') || ''));
        if (!btn) return { notMounted: true };
        btn.scrollIntoView({ block: 'center', inline: 'center' });
        const r = btn.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), vh: window.innerHeight, top: Math.round(r.top), disabled: btn.disabled };
      }, cont);
      if (pt.notMounted) {
        await page.mouse.move(960, 600);
        await page.mouse.wheel({ deltaY: attempt % 4 < 2 ? 700 : -700 });
        await sleep(900);
        continue;
      }
      if (pt.disabled) return { err: 'trigger disabled (frozen row)' };
      // grid repaint beats the pointer path — activate the real control via DOM
      await page.evaluate((c) => {
        const btn = [...document.querySelectorAll('button')].find((b) => new RegExp(`Sửa ô điều phối ${c}`).test(b.getAttribute('aria-label') || ''));
        btn?.click();
      }, cont);
      for (let i = 0; i < 8; i++) { await sleep(1000); if (await page.evaluate(() => document.querySelectorAll('[role="dialog"]').length)) return { ok: true, via: 'dom-click' }; }
      return { err: 'dialog never opened' };
    }
    return { err: 'row not found in grid' };
  };

  // dialog helpers (ported from card081026091100)
  const clickDialogButton = async (matcher) => {
    const pt = await page.evaluate((m) => {
      const re = new RegExp(m.source, m.flags);
      const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
      const b = [...dlg.querySelectorAll('button')].filter((e) => e.offsetParent !== null).find((x) => re.test((x.textContent || '').trim()) || re.test(x.id || ''));
      if (!b) return { err: 'no button for ' + m.describe };
      b.scrollIntoView({ block: 'center' });
      const r = b.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    }, matcher);
    if (pt.err) return pt;
    await page.mouse.move(pt.x, pt.y); await page.mouse.down(); await page.mouse.up();
    await sleep(900);
    return { ok: true };
  };
  const pickOption = async (query) => {
    await sleep(400);
    const opt = await page.evaluate((q) => {
      const o = [...document.querySelectorAll('[role="option"], li')].filter((e) => e.offsetParent !== null).find((x) => (x.textContent || '').includes(q));
      if (!o) return { err: 'no option ' + q, sample: [...document.querySelectorAll('[role="option"], li')].filter((e) => e.offsetParent !== null).map((x) => (x.textContent || '').trim().slice(0, 26)).slice(0, 8) };
      o.scrollIntoView({ block: 'nearest' });
      const r = o.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), text: (o.textContent || '').trim().slice(0, 40) };
    }, query);
    if (opt.err) return opt;
    await page.mouse.move(opt.x, opt.y); await page.mouse.down(); await page.mouse.up();
    await sleep(800);
    return { ok: true, picked: opt.text };
  };
  const saveDialog = async () => {
    const pt = await page.evaluate(() => {
      const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
      if (!dlg) return { err: 'no dialog' };
      const btns = [...dlg.querySelectorAll('button')].filter((e) => e.offsetParent !== null);
      const b = btns.find((x) => /^Lưu/.test((x.textContent || '').trim()));
      if (!b) return { err: 'no save' };
      const r = b.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), disabled: b.disabled };
    });
    if (pt.err || pt.disabled) return { err: 'save unavailable', ...pt };
    await page.mouse.move(pt.x, pt.y); await page.mouse.down(); await page.mouse.up();
    await sleep(2500);
    return { ok: true };
  };
  const closeDialog = async () => {
    await page.evaluate(() => {
      const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
      const b = dlg ? [...dlg.querySelectorAll('button')].find((x) => /^(Hủy|Đóng|Huỷ)$/i.test((x.textContent || '').trim())) : null;
      if (b) b.click();
    });
    await sleep(1200);
    if (await page.evaluate(() => Boolean(document.querySelector('[role="dialog"]')))) { await page.keyboard.press('Escape'); await sleep(900); }
  };

  // assign C1: carrier SilverSea, vehicle picked from the live list (NOT
  // 15H-118.47 — that rig already carries the QATU DOUBLE pair today and the
  // overlap guard would refuse a single on the same window), tag Đơn.
  const opened = await openCell(C1);
  log('assign-cell-open', opened);
  if (opened.err) throw new Error('C1 editor did not open: ' + opened.err);
  await sleep(1500);
  const c = await clickDialogButton({ source: 'Chọn nhà xe', flags: '', describe: 'carrier' });
  log('carrier-trigger', c);
  const cp = await pickOption('SilverSea');
  log('carrier-pick', cp);
  const v = await clickDialogButton({ source: 'Chọn biển số xe', flags: '', describe: 'vehicle' });
  log('vehicle-trigger', v);
  // vehicle list may need a first-page dump; pick the first NON-15H-118.47 option
  const vehPick = await page.evaluate(() => {
    const opts = [...document.querySelectorAll('[role="option"], li')].filter((e) => e.offsetParent !== null && /\d{2}[A-Z]-\d/.test(e.textContent || ''));
    const o = opts.find((x) => !/15H-118\.47/.test(x.textContent || '')) ?? opts[0];
    if (!o) return { err: 'no vehicle options' };
    const r = o.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), text: (o.textContent || '').trim().slice(0, 30) };
  });
  log('vehicle-candidates', vehPick);
  if (vehPick.err) throw new Error(vehPick.err);
  await page.mouse.move(vehPick.x, vehPick.y); await page.mouse.down(); await page.mouse.up();
  await sleep(900);
  const tag = await page.evaluate(() => {
    const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
    const label = [...dlg.querySelectorAll('label')].find((l) => /Kẹp/.test(l.textContent || ''));
    const sel = label?.querySelector('select');
    if (!sel) return { err: 'no tag select' };
    const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    desc.set.call(sel, 'SINGLE');
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, setTo: 'SINGLE' };
  });
  log('tag', tag);
  // dismiss a leftover listbox ONLY if one is open — a bare Escape would
  // close the whole Modal
  const hasListbox = await page.evaluate(() => Boolean(document.querySelector('[role="listbox"]')));
  if (hasListbox) { await page.keyboard.press('Escape'); await sleep(700); }
  let saved = await saveDialog();
  for (let i = 0; i < 8 && saved.err; i++) { await sleep(800); saved = await saveDialog(); }
  const closed = !(await page.evaluate(() => Boolean(document.querySelector('[role="dialog"]'))));
  log('assign-save', { saved, closed });
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-assign-save.png` });
  if (!closed) await closeDialog();

  // server truth post-assignment
  const rowsPost = await fetch(`${API}/shipments/dispatch-detail-plan-rows?limit=50`, { headers: { Authorization: `Bearer ${dispTok}` } }).then((r) => r.json());
  const rC1 = (rowsPost.items ?? rowsPost).find((x) => (x?.container?.containerNumber ?? x?.containerNumber) === C1);
  const rC2 = (rowsPost.items ?? rowsPost).find((x) => (x?.container?.containerNumber ?? x?.containerNumber) === C2);
  log('plan-rows-post', { c1Plate: rC1?.dispatch?.assignedPlate ?? null, c1Carrier: rC1?.dispatch?.carrierName ?? null, c2Plate: rC2?.dispatch?.assignedPlate ?? null });
  if (!rC1?.dispatch?.assignedPlate || rC2?.dispatch?.assignedPlate) { log('FAIL-assignment-state', {}); exitCode = 1; }

  // ── Phase 2: verify the fieldset gates on assignment ──
  const scanDialog = () => page.evaluate(() => {
    const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
    if (!dlg) return null;
    const text = (dlg.textContent || '').replace(/\s+/g, ' ');
    return { hasPhatLenhFieldset: /Phát lệnh cho tài xế/.test(text), hasPhatLenhAny: /Phát lệnh/.test(text), snippet: text.slice(0, 160) };
  });
  const leg = async (cont, label) => {
    const o = await openCell(cont);
    log(`${label}-open`, { cont, o });
    if (o.err) return { err: o.err };
    await sleep(1200);
    const st = await scanDialog();
    log(`${label}-dialog`, st);
    await page.screenshot({ path: `${QA}/${SCOPE}_ui-${label}.png` });
    await closeDialog();
    return st;
  };
  const stA = await leg(C1, 'assigned');
  const stU = await leg(C2, 'unassigned');

  if (stA?.hasPhatLenhFieldset && stU && !stU.hasPhatLenhAny) log('PASS-gating-verified', { assigned: C1, unassigned: C2, plate: rC1?.dispatch?.assignedPlate });
  else { log('FAIL', { stA, stU }); exitCode = 1; }
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
