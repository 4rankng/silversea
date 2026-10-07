// Card 061026172804 — staging rung on 21723617: an assignment overlapping a
// COMPLETED trip of the same tractor now WARNS (house confirm dialog) and the
// confirmed save proceeds. Fixture: LCL lot whose closingAt sits inside trip
// 135's window (truck 39 = 15H-061.14, 10:30–13:52Z 04/10 (trip 117 COMPLETED; siblings CANCELED)). UI flow:
// search → Sửa → pick 15H-117.55 → Lưu thay đổi → confirm dialog → accept →
// row 'Đã điều xe'. Real taps throughout; screenshots per step.
import puppeteer from 'puppeteer';
import crypto from 'node:crypto';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-07_kb172804-rig-overlap';
const BL = `QA-RIG038-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 12)}`;

const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: '21723617' });
if (!String(health.buildHash || '').startsWith('21723617')) { log('build-currency-FAIL'); process.exit(2); }

const api = async (method, path, body, tok) => {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

let login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
let token = (await login.json()).token;

// Fixture: overlap lot, handoff accepted, LEFT UNPLATED (the save happens in the UI).
const created = await api('POST', '/shipments', { customerId: 1, cargoMode: 'LCL', tradeDirection: 'IMPORT', blNumber: BL, shippingLineName: 'QA Line', routeId: 6, customerNotes: `QAFIXTURE card061026172804 rung ${BL}. Xoa duoc sau QA.` }, token);
if (![200, 201].includes(created.status)) throw new Error(`create ${created.status} ${JSON.stringify(created.body).slice(0, 140)}`);
const sid = created.body.id;
log('lot-created', { shipmentId: sid, bl: BL });
await api('PUT', `/shipments/${sid}`, { expectedVersion: created.body.version ?? 1, closingAt: '2026-10-04T12:00:00.000Z', expectedDeliveryDate: '2026-10-04' }, token);
let h = await api('GET', `/shipments/${sid}/dispatch-handoff`, undefined, token);
let row = h.body?.id ? h.body : h.body?.handoff;
if (!row) { const nh = await api('POST', `/shipments/${sid}/dispatch-handoffs`, {}, token); row = nh.body?.handoff ?? nh.body; }
if (row.status !== 'ACCEPTED') await api('POST', `/shipments/${sid}/dispatch-handoffs/${row.id}/resolve`, { resolution: 'ACCEPTED', expectedVersion: row.handoffVersion ?? row.version }, token);
log('handoff-accepted');

login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'dungnv', password: 'Abc123' }) });
const dungnvToken = (await login.json()).token;

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1100 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), dungnvToken);
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(4500);
  const tap = async (pt) => { await page.mouse.move(pt.x, pt.y); await page.mouse.down(); await page.mouse.up(); };
  const tapPoint = async (point, expectText) => {
    const got = await page.evaluate((pt) => document.elementFromPoint(pt.x, pt.y)?.textContent?.trim().slice(0, 60), point);
    if (!got || !got.includes(expectText)) throw new Error(`hit-test missed (${expectText}): ${got}`);
    await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.up();
  };

  await page.evaluate(() => { const el = [...document.querySelectorAll('input')].find((i) => i.offsetParent !== null && /Bill, Cont/.test(i.placeholder || '')); if (el) el.focus(); });
  await page.keyboard.type(BL, { delay: 50 });
  await sleep(2500);
  let tgt = null;
  for (let i = 0; i < 6; i += 1) {
    tgt = await page.evaluate((bl) => {
      const r = [...document.querySelectorAll('tr')].find((x) => (x.textContent || '').includes(bl) && x.querySelector('button') && !x.querySelector('tr'));
      if (!r) return null;
      const btn = [...r.querySelectorAll('button')].find((b) => /Sửa|Gán xe|Phân xe/.test(b.textContent || '')) ?? r.querySelector('button');
      btn.scrollIntoView({ block: 'center' });
      const rc = btn.getBoundingClientRect();
      return (rc.y > 60 && rc.y < window.innerHeight - 60) ? { x: rc.x + rc.width / 2, y: rc.y + rc.height / 2 } : null;
    }, BL);
    if (tgt) break;
    await sleep(900);
  }
  if (!tgt) throw new Error('row not found');
  await tap(tgt);
  await sleep(2500);
  await page.waitForSelector('.dispatch-assignment-dialog', { timeout: 20000 });
  await sleep(1500);

  // Pick truck 15H-117.55 via the vehicle combobox.
  const veh = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.dispatch-assignment-dialog button, .dispatch-assignment-dialog [role="button"], .dispatch-assignment-dialog span')]
      .find((x) => /Chọn biển số xe/.test(x.textContent || '') && x.offsetParent !== null && (x.matches('button, [role="button"], [tabindex]') || x.closest('label')));
    if (!el) return null;
    const t = el.closest('button, [role="button"], [tabindex]') ?? el;
    t.scrollIntoView({ block: 'nearest' });
    const r = t.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!veh) throw new Error('vehicle trigger not found');
  await tapPoint(veh, 'Chọn biển số xe');
  await sleep(700);
  await page.evaluate(() => { const c = [...document.querySelectorAll('input')].filter((i) => i.offsetParent !== null && !i.closest('.dispatch-assignment-dialog')).find((i) => i.type === 'text' || i.type === 'search'); if (c) c.focus(); });
  await page.keyboard.type('15H-061.14', { delay: 70 });
  await sleep(1500);
  let opt = null;
  for (let o = 0; o < 5; o += 1) {
    opt = await page.evaluate(() => {
      const el = [...document.querySelectorAll('[role="option"], [role="listbox"] *')].find((x) => (x.textContent || '').includes('15H-061.14') && x.offsetParent !== null);
      if (!el) return null;
      el.scrollIntoView({ block: 'nearest' });
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      return (r.y > 60 && r.y < vh - 40) ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : { retry: true };
    });
    if (opt && !opt.retry) break;
    await sleep(700);
  }
  if (!opt || opt.retry) throw new Error('truck option not tappable');
  await tapPoint(opt, '15H-061.14');
  log('truck-picked');
  await sleep(800);
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-truck-picked.png`, fullPage: false });

  // Save → the completed-overlap confirm dialog should appear.
  const saveBtn = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].filter((x) => x.offsetParent !== null).find((x) => /Lưu thay đổi/.test(x.textContent || ''));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!saveBtn) throw new Error('save button not found');
  await tapPoint(saveBtn, 'Lưu thay đổi');
  log('save-clicked');

  let confirmBtn = null;
  let confirmText = null;
  for (let i = 0; i < 12; i += 1) {
    await sleep(700);
    const probe = await page.evaluate(() => {
      const t = (document.body.textContent || '');
      const hasWarn = t.includes('đã hoàn thành') && t.includes('Vẫn lưu');
      const btns = [...document.querySelectorAll('button')].filter((b) => b.offsetParent !== null && /Vẫn lưu|Lưu|Xác nhận|Tiếp tục|Đồng ý/.test(b.textContent || '') && !/Lưu thay đổi/.test(b.textContent || ''));
      const target = btns.find((b) => /Vẫn lưu|Xác nhận|Tiếp tục|Đồng ý/.test(b.textContent || '')) ?? null;
      return { hasWarn, btn: target ? (() => { const r = target.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: (target.textContent || '').trim() }; })() : null };
    });
    if (probe.hasWarn && probe.btn) { confirmBtn = probe.btn; confirmText = probe.btn.label; break; }
  }
  log('confirm-dialog', { found: Boolean(confirmBtn), label: confirmText });
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-confirm-dialog.png`, fullPage: false });
  if (!confirmBtn) { log('FAIL-no-confirm-dialog'); exitCode = 1; } else {
    await tapPoint(confirmBtn, confirmText);
    log('confirm-accepted');
    await sleep(3000);
    const after = await page.evaluate((bl) => ({
      dialogOpen: Boolean(document.querySelector('.dispatch-assignment-dialog')),
      rowText: ([...document.querySelectorAll('tr')].find((r) => (r.textContent || '').includes(bl) && !r.querySelector('tr'))?.textContent || '').replace(/\s+/g, ' ').slice(0, 200),
    }), BL);
    log('after-confirm', after);
    await page.screenshot({ path: `${QA}/${SCOPE}_ui-after-save.png`, fullPage: false });
    const saved = !after.dialogOpen || after.rowText.includes('Đã điều xe');
    if (!saved) { log('FAIL-save-not-proceeded', after); exitCode = 1; } else log('GREEN-warn-then-save', { rowText: after.rowText });
  }
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
