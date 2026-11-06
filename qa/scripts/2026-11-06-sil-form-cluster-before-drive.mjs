// SIL form cluster (681 r2 / 688 / 690 / 691 / 692) — BEFORE baseline drive.
// Documents the five reported defects on the untouched HEAD build (local:
// vite FRONT_PORT → backend :3002, dev DB ss-prod-db silversea). Read-only
// bookends: no lot is created, edited or deleted here; the only write is the
// in-form draft state (never submitted).
//
//  681 r2 — tab Hàng lẻ has no Hãng tàu field at all (0 elements).
//  690    — FCL container table: no 'Áp dụng cho N container' bulk affordance
//           (only the copy-down-to-empty button when a source exists).
//  691    — LCL Nhà máy suggestion options carry no SĐT (supportingText);
//           ASKEY sites in DB have contact_phone='' (SQL bookend logged).
//  692    — the GroupFloatingLine save button: elementFromPoint at its center
//           (rest + open states) and the card's computed paint/hit state.
//  688    — /shipments/:id has no 'Xóa lô' action; debit row menu has none.
//
// Run: FRONT_PORT=7185 node qa/scripts/2026-11-06-sil-form-cluster-before-drive.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const FRONT = `http://localhost:${process.env.FRONT_PORT ?? 7185}`;
const API = `http://localhost:${process.env.API_PORT ?? 3002}/api`;
const OUT = path.resolve('qa/2026-11-06-lane-form/before');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'ui-driver.log');
fs.writeFileSync(LOG, '');
const log = (l) => { console.log(l); fs.appendFileSync(LOG, l + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log(`HEALTH status=${health?.status} api=${API} front=${FRONT}`);
if (health?.status !== 'ok') { log('ABORT: API health not ok'); process.exit(2); }

let token = null; let who = null;
for (const identifier of ['tiepvv', 'cus']) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (res.ok) { token = (await res.json()).token; who = identifier; break; }
}
if (!token) { log('ABORT: login failed'); process.exit(2); }
log(`LOGIN ok account=${who}`);

const db = (sql) => execSync(`docker exec ss-prod-db psql -U postgres -d silversea -qtAX -c "${sql}"`).toString().trim();
const countsBefore = {
  shipments: db('select count(*) from shipments'),
  shipmentContainers: db('select count(*) from shipment_containers'),
  trips: db('select count(*) from trips'),
};
log(`BOOKEND before shipments=${countsBefore.shipments} containers=${countsBefore.shipmentContainers} trips=${countsBefore.trips}`);
const askeySql = `select coalesce(string_agg(short_name || '=' || coalesce(contact_phone, 'NULL'), ';'), '') from operational_sites where short_name ilike '%ASKEY%'`;
log(`DBFACT askey-contact-phone=${db(askeySql)}`);

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--window-size=1440,900', '--no-sandbox'],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
page.on('pageerror', (e) => log(`PAGEERROR ${e.message}`));
const shot = async (name) => { const p = path.join(OUT, name); await page.screenshot({ path: p, fullPage: false }); log(`SHOT ${name}`); };

await page.goto(`${FRONT}/shipments/new`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(1500);

// ─── 681 r2: LCL tab — Hãng tàu field missing ────────────────────────────
const clickLcl = await page.evaluate(() => {
  const opt = [...document.querySelectorAll('.csc-mode__option, [role="radio"], label')]
    .find((el) => /Hàng lẻ/i.test(el.textContent || ''));
  if (!opt) return { ok: false };
  (opt.querySelector('input[type="radio"]') ?? opt).click();
  return { ok: true, text: opt.textContent.trim().slice(0, 40) };
});
log(`681R2 switch-lcl ${JSON.stringify(clickLcl)}`);
await sleep(1200);
const hangTauScan = await page.evaluate(() => ({
  bodyMentions: (document.body.innerText.match(/Hãng tàu/g) ?? []).length,
  fieldIdCells: document.querySelectorAll('[data-field-id="shipment-shipping-line"]').length,
}));
log(`681R2 hangtau-scan ${JSON.stringify(hangTauScan)}  ← BUG if bodyMentions=0`);
await shot('before-681r2-lcl-no-hang-tau.png');

// ─── 691: LCL Nhà máy picker — no SĐT in options ─────────────────────────
const customerPick = await page.evaluate(() => {
  const input = document.querySelector('#shipment-customer');
  return { ok: Boolean(input), value: input?.value ?? null };
});
log(`691 customer-field ${JSON.stringify(customerPick)}`);
await page.click('[data-field-id="shipment-customer"] input', { clickCount: 3 });
await page.type('[data-field-id="shipment-customer"] input', 'LONG MINH', { delay: 30 });
await sleep(900);
const pickedCustomer = await page.evaluate(() => {
  const opt = [...document.querySelectorAll('[role="option"]')]
    .find((el) => /LONG MINH/i.test(el.textContent || ''));
  if (!opt) return { ok: false };
  opt.click();
  return { ok: true };
});
log(`691 pick-customer ${JSON.stringify(pickedCustomer)}`);
await sleep(1200);
await page.click('[data-field-id="shipment-operational-site"] input', { clickCount: 3 }).catch(() => {});
await page.type('[data-field-id="shipment-operational-site"] input', 'ASKEY', { delay: 30 });
await sleep(1100);
const optionScan = await page.evaluate(() => {
  const opts = [...document.querySelectorAll('[role="option"]')].slice(0, 6)
    .map((el) => (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80));
  const anyPhone = opts.some((t) => /\d{8,}/.test(t));
  return { options: opts, anyPhone };
});
log(`691 option-scan ${JSON.stringify(optionScan)}  ← BUG if anyPhone=false`);
await shot('before-691-askey-options-no-phone.png');
await page.keyboard.press('Escape');
await sleep(400);

// ─── 690: FCL — no bulk apply ────────────────────────────────────────────
const clickFcl = await page.evaluate(() => {
  const opt = [...document.querySelectorAll('.csc-mode__option, [role="radio"], label')]
    .find((el) => /Hàng FCL/i.test(el.textContent || ''));
  if (!opt) return { ok: false };
  (opt.querySelector('input[type="radio"]') ?? opt).click();
  return { ok: true };
});
log(`690 switch-fcl ${JSON.stringify(clickFcl)}`);
await sleep(600);
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => /Chuyển và xóa dữ liệu/.test(b.textContent || ''));
  if (btn) btn.click();
});
await sleep(900);
// direction EXPORT so the booking field enables without XNK first
await page.click('[data-field-id="shipment-trade-direction"] button').catch(async () => {
  await page.click('[data-field-id="shipment-trade-direction"]');
});
await sleep(500);
await page.evaluate(() => {
  const opt = [...document.querySelectorAll('[role="option"]')].find((el) => /Xuất khẩu/.test(el.textContent || ''));
  if (opt) opt.click();
});
await sleep(400);
await page.type('[data-field-id="shipment-booking-ref"] input', 'BEFORE-DRIVE-690', { delay: 10 });
const addRow = await page.evaluate(() => {
  const btn = document.querySelector('.csc-add-container, .csc-container-add-control button');
  if (!btn) return { ok: false };
  btn.click();
  return { ok: true };
});
log(`690 add-row ${JSON.stringify(addRow)}`);
await sleep(700);
const apptFill = await page.evaluate(() => {
  const input = document.querySelector('[data-field-id$="-customer-appointment"] input, input[id$="-customer-appointment"]');
  if (!input) return { ok: false };
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, '2026-11-10T08:30');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true, id: input.id };
});
log(`690 fill-row1-appointment ${JSON.stringify(apptFill)}`);
await sleep(800);
const bulkScan = await page.evaluate(() => ({
  applyAllButtons: [...document.querySelectorAll('button')].filter((b) => /Áp dụng cho/i.test(b.textContent || '')).length,
  copyDownButtons: [...document.querySelectorAll('button')].filter((b) => /Copy giờ hẹn xuống cont trống/i.test(b.textContent || '')).length,
}));
log(`690 bulk-scan ${JSON.stringify(bulkScan)}  ← BUG if applyAllButtons=0`);
await shot('before-690-fcl-no-bulk-apply.png');

// ─── 692: GroupFloatingLine save hit-test (rest + open states) ───────────
const flineProbe = await page.evaluate(() => {
  const trigger = [...document.querySelectorAll('.csc-fline__trigger')]
    .find((el) => /Chỉnh sửa trọng lượng/.test(el.getAttribute('aria-label') || ''));
  if (!trigger) return { ok: false };
  const card = trigger.closest('.csc-fline')?.querySelector('.csc-fline__card');
  const saveBtn = card?.querySelector('.csc-fline__save');
  const probe = () => {
    const r = saveBtn.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    const cs = getComputedStyle(card);
    return {
      btnRect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      hit: hit ? `${hit.tagName}.${[...hit.classList].join('.')} "${(hit.textContent || '').trim().slice(0, 24)}"` : null,
      card: { position: cs.position, opacity: cs.opacity, pointerEvents: cs.pointerEvents, visibility: cs.visibility, zIndex: cs.zIndex },
    };
  };
  const rest = probe();
  trigger.scrollIntoView({ block: 'center' });
  return { ok: true, rest, doOpen: () => trigger.click() };
});
log(`692 fline-rest ${JSON.stringify(flineProbe.rest ?? flineProbe)}`);
if (flineProbe.ok) {
  await page.evaluate(() => {
    const trigger = [...document.querySelectorAll('.csc-fline__trigger')]
      .find((el) => /Chỉnh sửa trọng lượng/.test(el.getAttribute('aria-label') || ''));
    trigger.click();
  });
  await sleep(900);
  const openProbe = await page.evaluate(() => {
    const trigger = [...document.querySelectorAll('.csc-fline__trigger')]
      .find((el) => /Chỉnh sửa trọng lượng/.test(el.getAttribute('aria-label') || ''));
    const card = trigger.closest('.csc-fline').querySelector('.csc-fline__card');
    const saveBtn = card.querySelector('.csc-fline__save');
    const r = saveBtn.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    const cs = getComputedStyle(card);
    return {
      isOpenClass: card.classList.contains('is-open'),
      inlineStyle: card.getAttribute('style'),
      card: { position: cs.position, opacity: cs.opacity, pointerEvents: cs.pointerEvents, zIndex: cs.zIndex },
      btnRect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      hit: hit ? `${hit.tagName}.${[...hit.classList].join('.')} "${(hit.textContent || '').trim().slice(0, 24)}"` : null,
      notesHeadingNearby: Boolean(document.querySelector('#shipment-section-notes .csc-section__heading')),
    };
  });
  log(`692 fline-open ${JSON.stringify(openProbe)}  ← BUG if hit is not the save button while open`);
  await shot('before-692-fline-save-state.png');
  await page.keyboard.press('Escape');
}

// ─── 688: detail page + debit menu — no Xóa lô ───────────────────────────
const detailLot = process.env.BEFORE_LOT_ID ?? '1762';
await page.goto(`${FRONT}/shipments/${detailLot}`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(2000);
const deleteScan = await page.evaluate(() => ({
  xoaLoButtons: [...document.querySelectorAll('button')].filter((b) => /Xóa lô/i.test(b.textContent || '') || /Xóa lô/i.test(b.getAttribute('aria-label') || '')).length,
  viewCluster: [...document.querySelectorAll('.csc-form-actions button')].map((b) => (b.textContent || '').trim()).slice(0, 6),
}));
log(`688 detail-scan ${JSON.stringify(deleteScan)}  ← BUG if xoaLoButtons=0`);
await shot('before-688-detail-no-delete.png');

await page.goto(`${FRONT}/shipments-debit`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(2000);
const debitMenu = await page.evaluate(() => {
  const menuBtn = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '').includes('…') || (b.getAttribute('aria-label') || '').includes('Thao tác'));
  if (!menuBtn) return { ok: false };
  menuBtn.click();
  return { ok: true, label: menuBtn.getAttribute('aria-label') };
});
await sleep(700);
const debitScan = await page.evaluate(() => ({
  menuItems: [...document.querySelectorAll('[role="menuitem"], [role="menu"] button')].map((m) => (m.textContent || '').trim()).slice(0, 8),
  hasXoaLo: [...document.querySelectorAll('[role="menuitem"], [role="menu"] button')].some((m) => /Xóa lô/i.test(m.textContent || '')),
}));
log(`688 debit-menu ${JSON.stringify(debitScan)}  ← BUG if hasXoaLo=false`);
await shot('before-688-debit-menu-no-delete.png');

// read-only bookend
const countsAfter = {
  shipments: db('select count(*) from shipments'),
  shipmentContainers: db('select count(*) from shipment_containers'),
  trips: db('select count(*) from trips'),
};
log(`BOOKEND after shipments=${countsAfter.shipments} containers=${countsAfter.shipmentContainers} trips=${countsAfter.trips} unchanged=${JSON.stringify(countsBefore) === JSON.stringify(countsAfter)}`);

await browser.close();
log(`DONE failures-are-expected-in-before-phase (baseline documentation)`);
process.exit(0);
