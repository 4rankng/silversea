// SIL-171 (FB-147) — rung-3 UI drive (AGENTS §9).
// CUS trên /shipments/300 (fixture riêng của lane, tạo qua API): "Sửa lô"
// mở form Tạo lô hàng ở chế độ edit (pre-fill toàn bộ, kể cả Hình thức XNK)
// → sửa Số Bill → "Lưu thay đổi" = PATCH lô hiện có → về detail. "Sửa nhanh"
// vẫn mở dialog 6 nút cũ. Screenshots 390/768/1440.
// Stack: frontend http://localhost:7199 (worktree này) → backend :3002 → dev DB :5441.
import puppeteer from 'puppeteer-core';
import { mkdirSync, appendFileSync } from 'node:fs';

const BASE = 'http://localhost:7199';
const API = 'http://localhost:3002/api';
const ART = 'qa/2026-10-24-sil171';
const LOG = `${ART}/2026-10-24-sil171_ui-driver.log`;
const SHIPMENT = 300; // SIL171-FB147-BL — fixture do lane này tạo (CSQU3054383, TK-SIL171-FB147)
mkdirSync(ART, { recursive: true });
const log = (line) => { const text = `${new Date().toISOString()} ${line}`; console.log(text); appendFileSync(LOG, `${text}\n`); };
appendFileSync(LOG, `\n=== run ${new Date().toISOString()} ===\n`);

const login = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'cus', password: 'Abc123' }),
});
const { token } = await login.json();
log(`login cus: ${token ? 'OK' : 'FAIL'}`);
if (!token) process.exit(1);

const apiGet = async (path) => (await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } })).json();

const before = await apiGet(`/shipments/${SHIPMENT}`);
log(`before: id=${before.shipment.id} version=${before.shipment.version} bl=${before.shipment.blNumber} dir=${before.shipment.tradeDirection}`);
log(`before containers: ${before.containers.map((c) => `${c.id}:${c.containerNumber}`).join(', ')} decls: ${before.declarations.map((d) => `${d.id}:${d.declarationNumber}`).join(', ')}`);

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox'],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openAt(width, height) {
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  return page;
}
const shot = (page, name) => page.screenshot({ path: `${ART}/${name}.png` });

// assert helpers — trả text DOM thật để ghi log
const formProbe = async (page) => page.evaluate(() => {
  const xnk = document.querySelector('[data-field-id="shipment-trade-direction"]');
  const bill = document.querySelector('[data-field-id="shipment-booking-ref"] input');
  const contInputs = [...document.querySelectorAll('input[aria-label="Số container"]')];
  const declStrip = document.querySelector('[data-field-id="shipment-declarations"]');
  const heading = document.querySelector('.csc-topline__title');
  return {
    heading: heading?.textContent?.trim() ?? null,
    xnk: xnk?.textContent?.trim() ?? null,
    bill: bill?.value ?? null,
    containerNumbers: contInputs.map((i) => i.value),
    declarations: declStrip?.textContent ?? null,
    saveLabel: [...document.querySelectorAll('button')].some((b) => /Lưu thay đổi/.test(b.textContent || '')),
    draftLabel: [...document.querySelectorAll('button')].some((b) => /^Lưu nháp/.test((b.textContent || '').trim())),
  };
});

// ── 1) Mỗi width: mở detail → bấm "Sửa lô" → form edit pre-fill ──────────
for (const width of [390, 768, 1440]) {
  const height = width === 390 ? 844 : width === 768 ? 1024 : 900;
  const page = await openAt(width, height);
  await page.goto(`${BASE}/shipments/${SHIPMENT}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1200);
  const hasEdit = await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => /Sửa lô/.test(b.textContent || '') && !/Sửa nhanh/.test(b.textContent || '')));
  log(`w${width}: detail loaded, Sửa lô button=${hasEdit}`);
  await shot(page, `sil171_w${width}_detail`);
  const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /Sửa lô/.test(b.textContent || '') && !/Sửa nhanh/.test(b.textContent || ''));
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (!clicked) { log(`w${width}: FAIL — no Sửa lô button`); await page.close(); continue; }
  await page.waitForFunction(() => document.querySelector('.csc-topline__title')?.textContent?.includes('Sửa lô hàng'), { timeout: 30000 });
  await sleep(1500); // đợi pre-fill + pickers resolve
  const probe = await formProbe(page);
  log(`w${width}: heading="${probe.heading}" xnk="${probe.xnk}" bill="${probe.bill}" containers=${JSON.stringify(probe.containerNumbers)} declChip TK=${probe.declarations?.includes('TK-SIL171-FB147')} save=${probe.saveLabel} draftHidden=${!probe.draftLabel}`);
  await shot(page, `sil171_w${width}_edit-form`);
  await page.close();
}

// ── 2) w1440: sửa Số Bill → Lưu thay đổi = PATCH → về detail; DB proof ────
{
  const page = await openAt(1440, 900);
  await page.goto(`${BASE}/shipments/${SHIPMENT}/edit`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('[data-field-id="shipment-booking-ref"] input')?.value?.length > 0, { timeout: 30000 });
  await sleep(1200);
  await page.evaluate(() => {
    const bill = document.querySelector('[data-field-id="shipment-booking-ref"] input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(bill, 'SIL171-FB147-BL-V2');
    bill.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(300);
  await shot(page, 'sil171_edit_bill-changed');
  const saved = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /Lưu thay đổi/.test(b.textContent || '') && !b.closest('.csc-actions--footer'));
    if (!btn) return false;
    btn.click();
    return true;
  });
  log(`w1440: save clicked=${saved}`);
  await page.waitForFunction(() => /\/shipments\/300$/.test(location.pathname), { timeout: 30000 });
  await sleep(1500);
  await shot(page, 'sil171_after-save_detail');
  const url = page.url();
  log(`w1440: after save url=${url}`);
  await page.close();
}

// ── 3) w1440: "Sửa nhanh" vẫn mở dialog 6 nút cũ (fallback) ───────────────
{
  const page = await openAt(1440, 900);
  await page.goto(`${BASE}/shipments/${SHIPMENT}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1200);
  const opened = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /Sửa nhanh/.test(b.textContent || ''));
    if (!btn) return false;
    btn.click();
    return true;
  });
  await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"], .modal')].some((d) => /Sửa thông tin lô/.test(d.textContent || '')), { timeout: 20000 });
  await sleep(800);
  const groups = await page.evaluate(() => {
    const dlg = [...document.querySelectorAll('[role="dialog"], .modal')].find((d) => /Sửa thông tin lô/.test(d.textContent || ''));
    return [...(dlg?.querySelectorAll('button') ?? [])].map((b) => b.textContent.trim()).filter(Boolean);
  });
  log(`w1440: Sửa nhanh dialog buttons=${JSON.stringify(groups)} opened=${opened}`);
  await shot(page, 'sil171_sua-nhanh_dialog');
  await page.close();
}

await browser.close();

// ── 4) DB/API side-effect proof ───────────────────────────────────────────
const after = await apiGet(`/shipments/${SHIPMENT}`);
log(`after: version=${after.shipment.version} bl=${after.shipment.blNumber} (kỳ vọng SIL171-FB147-BL-V2, version > ${before.shipment.version})`);
log(`after containers: ${after.containers.map((c) => `${c.id}:${c.containerNumber}`).join(', ')} decls: ${after.declarations.map((d) => `${d.id}:${d.declarationNumber}`).join(', ')}`);
const ok = after.shipment.blNumber === 'SIL171-FB147-BL-V2'
  && after.shipment.version > before.shipment.version
  && after.containers.map((c) => c.id).join(',') === before.containers.map((c) => c.id).join(',')
  && after.declarations.map((d) => d.id).join(',') === before.declarations.map((d) => d.id).join(',');
log(ok ? 'RESULT: PASS' : 'RESULT: FAIL');
process.exit(ok ? 0 : 2);
