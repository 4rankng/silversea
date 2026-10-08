// Card 061026172803 — staging rung on 715dde82: clicking the GIỜ segment of
// 'Giờ trả hàng' places the caret (no 'Chọn giờ (24h)' picker opens), and
// typing '08' fills the hour then auto-advances focus to the PHÚT segment.
// Fixture: one self-marked LCL lot plated via the plan PATCH (truck 18).
import puppeteer from 'puppeteer';
import crypto from 'node:crypto';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-07_kb172803-time-segment';
const TRUCK_ID = Number(process.env.QA_TRUCK_ID || 1); // free 07/10 window
const BL = `QA-TIMESEG-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 12)}`;

const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: '715dde82' });
if (!String(health.buildHash || '').startsWith('715dde82')) { log('build-currency-FAIL'); process.exit(2); }

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

// Fixture: LCL lot + handoff + plate.
const day = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
const created = await api('POST', '/shipments', { customerId: 1, cargoMode: 'LCL', tradeDirection: 'IMPORT', blNumber: BL, shippingLineName: 'QA Line', routeId: 6, customerNotes: `QAFIXTURE card061026172803 rung ${BL}. Xoa duoc sau QA.` }, token);
if (![200, 201].includes(created.status)) throw new Error(`create ${created.status} ${JSON.stringify(created.body).slice(0, 160)}`);
const sid = created.body.id;
log('lot-created', { shipmentId: sid, bl: BL });
await api('PUT', `/shipments/${sid}`, { expectedVersion: created.body.version ?? 1, closingAt: `${day}T03:00:00.000Z`, expectedDeliveryDate: day }, token);
let h = await api('GET', `/shipments/${sid}/dispatch-handoff`, undefined, token);
let row = h.body?.id ? h.body : h.body?.handoff;
if (!row) { const nh = await api('POST', `/shipments/${sid}/dispatch-handoffs`, {}, token); row = nh.body?.handoff ?? nh.body; }
if (row.status !== 'ACCEPTED') await api('POST', `/shipments/${sid}/dispatch-handoffs/${row.id}/resolve`, { resolution: 'ACCEPTED', expectedVersion: row.handoffVersion ?? row.version }, token);
const rows = await api('GET', `/shipments/dispatch-detail-plan-rows?q=${BL}&limit=5`, undefined, token);
const item = rows.body.items[0];
const patched = await api('PATCH', `/shipments/dispatch-detail-plan-rows/${item.fulfillmentId}/plan`, { expectedFulfillmentVersion: item.version, expectedShipmentVersion: item.shipmentVersion, carrierType: 'OWN', truckId: TRUCK_ID, plannedRevenue: null, plannedCarrierCost: null }, token);
log('plated', { status: patched.status, fulfillmentId: item.fulfillmentId });

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

  await page.evaluate(() => { const el = [...document.querySelectorAll('input')].find((i) => i.offsetParent !== null && /Bill, Cont/.test(i.placeholder || '')); if (el) el.focus(); }, );
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

  // Scope to the 'Giờ trả hàng' field: the segment inputs inside its wrapper.
  const hourSeg = await page.evaluate(() => {
    const lab = [...document.querySelectorAll('label,legend,.dispatch-assignment-dialog label')].find((l) => /Giờ trả hàng/.test(l.textContent || ''));
    const scope = lab?.closest('div')?.parentElement ?? document.querySelector('.dispatch-assignment-dialog');
    const el = [...scope.querySelectorAll('input')].find((x) => (x.getAttribute('aria-label') || '') === 'Giờ — Giờ trả hàng' && x.offsetParent !== null)
      ?? [...document.querySelectorAll('.dispatch-assignment-dialog input')].find((x) => (x.getAttribute('aria-label') || '') === 'Giờ — Giờ trả hàng' && x.offsetParent !== null);
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!hourSeg) throw new Error('hour segment not found');
  await tap(hourSeg);
  await sleep(800);

  // Old bug: picker dialog opens. Assert it did NOT.
  const pickerOpen = await page.evaluate(() => {
    const t = document.body.textContent || '';
    const dialogs = [...document.querySelectorAll('[role="dialog"],.time-picker-surface')].filter((x) => x.offsetParent !== null);
    return { pickerText: t.includes('Chọn giờ (24h)'), extraDialogs: dialogs.length };
  });
  log('after-segment-click', pickerOpen);

  await page.keyboard.type('08', { delay: 120 });
  await sleep(700);
  const after = await page.evaluate(() => {
    const segs = [...document.querySelectorAll('.dispatch-assignment-dialog input')].filter((x) => x.offsetParent !== null);
    const hour = segs.find((x) => (x.getAttribute('aria-label') || '') === 'Giờ — Giờ trả hàng');
    const minute = segs.find((x) => (x.getAttribute('aria-label') || '') === 'Phút — Giờ trả hàng');
    return {
      hourValue: hour?.value ?? null,
      minuteValue: minute?.value ?? null,
      activeIsMinute: document.activeElement === minute,
      activeAria: document.activeElement?.getAttribute?.('aria-label') ?? null,
    };
  });
  log('after-typing', after);
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-segments.png`, fullPage: false });

  const ok = !pickerOpen.pickerText && pickerOpen.extraDialogs <= 1 && after.hourValue === '08' && after.activeIsMinute;
  log('verdict', { ok });
  if (!ok) exitCode = 1;
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
