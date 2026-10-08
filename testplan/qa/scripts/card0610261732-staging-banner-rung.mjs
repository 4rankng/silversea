// Card 0610261732 — staging rung on build 74585c2a: a REFUSED Phát lệnh must
// show the backend's real reason in the page banner, not 'Dữ liệu đã thay
// đổi. Vui lòng tải lại.' Fixture: one self-marked LCL lot at 90.000 kg —
// heavier than any truck, so the issue genuinely 409s with the weight reason.
// The row is plated via API first; the rung taps Phát lệnh for real.
import puppeteer from 'puppeteer';
import crypto from 'node:crypto';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-06_kb1732-refusal-banner';
const BL = `QA-LCL1732-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 12)}`;
const TRUCK_ID = Number(process.env.QA_TRUCK_ID || 18); // capacity arms via truck.trailerType (20FT/40FT)

const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const api = async (method, path, body) => {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: '74585c2a' });
if (!String(health.buildHash || '').startsWith('74585c2a')) { log('build-currency-FAIL'); process.exit(2); }

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
const token = (await login.json()).token;

// ── Fixture: 90t LCL lot, plated with a real truck via the plan PATCH ──────
const day = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
const created = await api('POST', '/shipments', {
  customerId: 1, cargoMode: 'LCL', tradeDirection: 'IMPORT', blNumber: BL,
  shippingLineName: 'QA Line', routeId: 6, cargoWeightKg: 90000,
  customerNotes: `QAFIXTURE card0610261732 banner rung ${BL}. Xoa duoc sau QA.`,
});
if (![200, 201].includes(created.status)) throw new Error(`create ${created.status}`);
const sid = created.body.id;
log('lot-created', { shipmentId: sid, bl: BL, weightKg: 90000 });
await api('PUT', `/shipments/${sid}`, { expectedVersion: created.body.version ?? 1, closingAt: `${day}T03:00:00.000Z`, expectedDeliveryDate: day });
let handoff = await api('GET', `/shipments/${sid}/dispatch-handoff`);
let row = handoff.body?.id ? handoff.body : handoff.body?.handoff;
if (!row) { const nh = await api('POST', `/shipments/${sid}/dispatch-handoffs`, {}); row = nh.body?.handoff ?? nh.body; }
if (row.status !== 'ACCEPTED') {
  await api('POST', `/shipments/${sid}/dispatch-handoffs/${row.id}/resolve`, { resolution: 'ACCEPTED', expectedVersion: row.handoffVersion ?? row.version });
}
log('handoff-accepted', { id: row.id });
const rows = await api('GET', `/shipments/dispatch-detail-plan-rows?q=${BL}&limit=5`);
const item = rows.body.items[0];
log('plan-row', { fulfillmentId: item.fulfillmentId, version: item.version });
const patched = await api('PATCH', `/shipments/dispatch-detail-plan-rows/${item.fulfillmentId}/plan`, {
  expectedFulfillmentVersion: item.version, expectedShipmentVersion: 2,
  carrierType: 'OWN', truckId: TRUCK_ID, plannedRevenue: null, plannedCarrierCost: null,
});
log('plate-patch', { status: patched.status, body: JSON.stringify(patched.body).slice(0, 120) });
if (patched.status >= 300) throw new Error(`plate patch ${patched.status}`);

// ── UI rung: Phát lệnh for real, assert the banner reason ──────────────────
const loginD = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'dungnv', password: 'Abc123' }) });
const dungnvToken = (await loginD.json()).token;
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1100 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), dungnvToken);
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(4500);

  const tapPoint = async (pt, label) => {
    const got = await page.evaluate((p) => document.elementFromPoint(p.x, p.y)?.textContent?.trim().slice(0, 60), pt);
    if (!got || !got.includes(label)) throw new Error(`hit-test missed (${label}): ${got}`);
    await page.mouse.move(pt.x, pt.y); await page.mouse.down(); await page.mouse.up();
  };

  await page.evaluate((bl) => {
    const el = [...document.querySelectorAll('input')].find((i) => i.offsetParent !== null && /Bill, Cont/.test(i.placeholder || ''));
    if (el) el.focus();
  }, BL);
  await page.keyboard.type(BL, { delay: 50 });
  await sleep(2500);

  let target = null;
  for (let i = 0; i < 6; i += 1) {
    target = await page.evaluate((bl) => {
      const r = [...document.querySelectorAll('tr')].find((x) => (x.textContent || '').includes(bl) && x.querySelector('button') && !x.querySelector('tr'));
      if (!r) return null;
      const btn = [...r.querySelectorAll('button')].find((b) => /Sửa|Gán xe|Phân xe/.test(b.textContent || '')) ?? r.querySelector('button');
      btn.scrollIntoView({ block: 'center' });
      const rc = btn.getBoundingClientRect();
      return (rc.y > 60 && rc.y < window.innerHeight - 60) ? { x: rc.x + rc.width / 2, y: rc.y + rc.height / 2, label: (btn.textContent || '').trim() } : null;
    }, BL);
    if (target) break;
    await sleep(900);
  }
  if (!target) throw new Error('row not found');
  await tapPoint(target, 'Sửa');
  log('editor-opened');
  await sleep(2500);
  await page.waitForSelector('.dispatch-assignment-dialog', { timeout: 20000 });
  await sleep(1500);

  const issueBtn = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.dispatch-assignment-dialog__issue-btn')].filter((x) => x.offsetParent !== null)[0]
      ?? [...document.querySelectorAll('.dispatch-assignment-dialog__issue button')].find((x) => /Phát lệnh/.test(x.textContent || ''));
    if (!b) return null;
    b.scrollIntoView({ block: 'nearest' });
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, enabled: !b.disabled };
  });
  if (!issueBtn?.enabled) throw new Error(`issue button missing/disabled: ${JSON.stringify(issueBtn)}`);
  await tapPoint(issueBtn, 'Phát lệnh');
  log('issue-clicked');

  // Banner assertion: poll for the page-level alert.
  let banner = null;
  for (let i = 0; i < 20; i += 1) {
    await sleep(500);
    banner = await page.evaluate(() => {
      const el = document.querySelector('.dispatch-plan-page__error[role="alert"]');
      return el ? (el.textContent || '').trim() : null;
    });
    if (banner) break;
  }
  log('banner', { text: banner });
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-banner.png` });
  const dlgErr = await page.evaluate(() => document.querySelector('.dispatch-assignment-dialog [role="alert"]')?.textContent?.trim() ?? null);
  log('dialog-error', { text: dlgErr });

  if (banner && banner.includes('tải trọng') && !banner.includes('Dữ liệu đã thay đổi')) {
    log('GREEN-banner-shows-real-reason', { banner });
  } else {
    log('FAIL-banner-wrong', { banner });
    exitCode = 1;
  }
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
