/**
 * Lane F3 — SIL-719 (id 839) + SIL-702 (id 822) UI DRIVEN probes.
 *
 * A) SIL-719 — the LCL create form ("Tạo lô hàng" → tab Hàng lẻ): CBM = 0 is
 *    a LEGAL volume ("không có thể tích"). The field must not raise
 *    "Nhập thể tích lớn hơn 0." and must not grow the readiness denominator
 *    (the ticket's repro: "đếm 10/11 ... lỗi 'Nhập thể tích lớn hơn 0.'").
 *    The API half proves the whole chain stores 0 (FE payload → shared
 *    contract → DB): a throwaway LCL lot is created with cargoVolumeCbm = 0
 *    and read back.
 *
 * B) SIL-702 — /dispatch-detail, an LCL row → "Chỉnh sửa điều phối": the
 *    "Phân loại" select offers the cargo-mode pair Lẻ + Lấy Lẻ (never a cont
 *    model). The FE half only — the save path needs the lane's backend +
 *    migration 20261107094500 (proved separately in
 *    sil702-constraint-probe.log against the real dev schema).
 *
 * Evidence: 03-lcl-cbm-zero.png · 04-lcl-phan-loai-select.png ·
 * sil719-lcl-lot-cbm-zero.json · driver-sil719-sil702.log
 *
 * Usage: node qa/2026-11-07-lane-f3/driver-sil719-sil702.mjs
 */
import puppeteer from 'puppeteer';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.F3_BASE_URL ?? 'http://localhost:7192';

const log = [];
function step(name, detail) {
  const line = `${new Date().toISOString()} ${name}${detail ? ` — ${JSON.stringify(detail)}` : ''}`;
  log.push(line);
  console.log(line);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(page, user, pass) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input', { timeout: 20000 });
  const inputs = await page.$$('input');
  await inputs[0].type(user);
  await inputs[1].type(pass);
  await Promise.all([
    page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 30000 }),
    page.evaluate(() => {
      [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Đăng nhập')?.click();
    }),
  ]);
  step('login', { user, url: page.url() });
}

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
let exitCode = 0;
let lclLotId = null;

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  // ── A. SIL-719 — the LCL create form with CBM = 0 ────────────────────────
  await login(page, process.env.F3_USER ?? 'cus', process.env.F3_PASS ?? 'Abc123');
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input', { timeout: 20000 });
  // The Hàng lẻ tab (the radio group the create form opens on).
  await page.evaluate(() => {
    const radio = [...document.querySelectorAll('input[type="radio"]')].find((r) => /Hàng lẻ/.test(r.getAttribute('aria-label') || r.value || '') || /Hàng lẻ/.test(r.closest('label')?.textContent || ''));
    radio?.click();
  });
  await sleep(1200);
  const cbmInput = await page.$('[data-field-id="shipment-cargo-volume"] input');
  if (!cbmInput) throw new Error('the LCL CBM field did not render');
  await cbmInput.click({ clickCount: 3 });
  await cbmInput.type('0');
  await sleep(900);
  const cbmState = await page.evaluate(() => {
    const cell = document.querySelector('[data-field-id="shipment-cargo-volume"]');
    const input = cell?.querySelector('input');
    return {
      value: input?.value ?? null,
      cellText: cell?.innerText?.replace(/\s+/g, ' ').trim() ?? null,
      invalid: input?.getAttribute('aria-invalid') ?? null,
      pageHasOldError: document.body.innerText.includes('Nhập thể tích lớn hơn 0.'),
      denominator: (document.body.innerText.match(/đủ\s*\d+\s*\/\s*\d+/i) ?? [])[0] ?? null,
    };
  });
  step('sil719-cbm-zero', cbmState);
  if (cbmState.value !== '0') throw new Error(`the CBM field did not keep the 0: ${JSON.stringify(cbmState)}`);
  if (cbmState.pageHasOldError) throw new Error('the old "Nhập thể tích lớn hơn 0." error is still raised');
  if (cbmState.invalid === 'true') throw new Error('the CBM field is still marked invalid');
  await page.screenshot({ path: path.join(HERE, '03-lcl-cbm-zero.png') });

  // The API half: the whole chain stores a 0 volume (FE payload → shared
  // contract → DB). A throwaway LCL lot, then read it back.
  const lcl = await page.evaluate(async () => {
    const token = localStorage.getItem('token');
    const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    const list = await (await fetch('/api/shipments?limit=40', { headers: h })).json();
    const first = (list.items ?? []).find((i) => i.cargoMode === 'LCL');
    const detail = await (await fetch(`/api/shipments/${first.id}`, { headers: h })).json();
    const ship = detail.shipment ?? {};
    const res = await fetch('/api/shipments/quick', {
      method: 'POST',
      headers: { ...h, 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        customerId: ship.customerId,
        bookingRef: `R4B-F3-CBM0-${Date.now().toString().slice(-9)}`,
        tradeDirection: 'EXPORT',
        cargoMode: 'LCL',
        operationalSiteId: ship.operationalSiteId,
        packageType: 'Pallet',
        packageCount: 10,
        cargoWeightKg: 5000,
        cargoVolumeCbm: 0,
      }),
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, id: body?.id ?? body?.shipment?.id ?? null, error: body?.error ?? null };
  });
  if (lcl.status !== 201 || !lcl.id) throw new Error(`the LCL lot with CBM = 0 was refused: ${JSON.stringify(lcl)}`);
  lclLotId = lcl.id;
  const cbmStored = await page.evaluate(async (id) => {
    const token = localStorage.getItem('token');
    const detail = await (await fetch(`/api/shipments/${id}`, { headers: { Authorization: `Bearer ${token}` } })).json();
    return { cargoVolumeCbm: detail.shipment?.cargoVolumeCbm ?? null, packageCount: detail.shipment?.packageCount ?? null };
  }, lclLotId);
  step('sil719-lcl-lot', { id: lclLotId, stored: cbmStored });
  await writeFile(path.join(HERE, 'sil719-lcl-lot-cbm-zero.json'), JSON.stringify({ shipmentId: lclLotId, ...cbmStored }, null, 2));
  if (cbmStored.cargoVolumeCbm === null || Number(cbmStored.cargoVolumeCbm) !== 0) {
    throw new Error(`the 0 volume was not stored: ${JSON.stringify(cbmStored)}`);
  }
  // clean up the throwaway LCL lot
  const deleted = await page.evaluate(async (id) => {
    const token = localStorage.getItem('token');
    const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    const detail = await (await fetch(`/api/shipments/${id}`, { headers: h })).json();
    const res = await fetch(`/api/shipments/cus-workspace/${id}`, {
      method: 'DELETE',
      headers: { ...h, 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ version: detail.shipment.version, reason: 'lane F3 probe — throwaway lot' }),
    });
    return res.status;
  }, lclLotId);
  step('sil719-cleanup', { id: lclLotId, deleteStatus: deleted });
  lclLotId = null;

  // ── B. SIL-702 — the LCL row's "Phân loại" select ───────────────────────
  await page.evaluate(() => localStorage.removeItem('token'));
  await login(page, process.env.F3_DV_USER ?? 'dieuvan', process.env.F3_PASS ?? 'Abc123');
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => /PHÂN LOẠI/i.test(document.body.innerText), { timeout: 30000 });
  // Filter the board to the hàng lẻ rows: Bộ lọc → "Loại hàng" → Hàng lẻ.
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Bộ lọc')?.click();
  });
  await page.waitForSelector('[role="dialog"]', { timeout: 15000 });
  await sleep(600);
  await page.evaluate(() => {
    [...document.querySelectorAll('[role="dialog"] button')].find((b) => /Loại hàng/.test(b.textContent || ''))?.click();
  });
  await sleep(600);
  await page.evaluate(() => {
    const option = [...document.querySelectorAll('[role="option"]')].find((o) => /Hàng lẻ/i.test(o.textContent || ''));
    option?.click();
  });
  await sleep(400);
  await page.evaluate(() => {
    [...document.querySelectorAll('[role="dialog"] button')].find((b) => (b.textContent || '').trim() === 'Áp dụng')?.click();
  });
  await sleep(2500);
  const rowInfo = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('tbody tr')];
    const lclRow = rows.find((tr) => /Lẻ/.test(tr.innerText || '') && /Chưa phân nhà xe|Chưa gán xe|Chưa có nhà xe/i.test(tr.innerText || ''))
      ?? rows.find((tr) => /Lẻ/.test(tr.innerText || ''));
    const cell = lclRow ? [...lclRow.querySelectorAll('td')].find((td) => /Chưa phân nhà xe|Chưa gán xe|Chưa có nhà xe/i.test(td.innerText || '')) : null;
    const trigger = cell?.querySelector('button') ?? cell;
    trigger?.click();
    return {
      found: !!lclRow,
      rowText: lclRow?.innerText?.replace(/\s+/g, ' ').slice(0, 140) ?? null,
      rowCount: rows.length,
    };
  });
  step('sil702-lcl-row', rowInfo);
  await page.waitForSelector('[role="dialog"]', { timeout: 20000 });
  await page.waitForFunction(() => {
    const d = document.querySelector('[role="dialog"]');
    return !!d && /Phân loại/i.test(d.innerText);
  }, { timeout: 20000 });
  await sleep(800);
  const selectState = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const trigger = [...(dialog?.querySelectorAll('button') ?? [])].find((b) => (b.textContent || '').trim() === 'Lẻ');
    trigger?.click();
    return {
      dialogTitle: dialog?.querySelector('h1,h2,h3')?.textContent?.trim() ?? null,
      triggerFound: !!trigger,
      dialogText: dialog?.innerText?.replace(/\s+/g, ' ').slice(0, 220) ?? null,
    };
  });
  await sleep(900);
  const options = await page.evaluate(() => [...document.querySelectorAll('[role="option"]')]
    .map((o) => o.textContent?.replace(/\s+/g, ' ').trim() ?? '')
    .filter(Boolean));
  step('sil702-options', { ...selectState, options });
  await page.screenshot({ path: path.join(HERE, '04-lcl-phan-loai-select.png') });
  if (!options.includes('Lấy Lẻ')) throw new Error(`the LCL select does not offer "Lấy Lẻ": ${JSON.stringify(options)}`);
  if (!options.includes('Lẻ')) throw new Error(`the LCL select lost "Lẻ": ${JSON.stringify(options)}`);
  for (const cont of ['Đơn', 'Kẹp', 'Kết hợp']) {
    if (options.includes(cont)) throw new Error(`a cont model leaked onto the LCL row: ${cont}`);
  }

  step('VERDICT', 'PASS — SIL-719 (CBM = 0 legal) + SIL-702 (LCL row offers Lẻ + Lấy Lẻ)');
} catch (error) {
  exitCode = 1;
  step('VERDICT', `FAIL — ${error instanceof Error ? error.message : String(error)}`);
} finally {
  if (lclLotId) log.push(`${new Date().toISOString()} throwaway lot ${lclLotId} may still exist — delete it (reason: lane F3 probe).`);
  log.push(`EXIT ${exitCode}`);
  await writeFile(path.join(HERE, 'driver-sil719-sil702.log'), `${log.join('\n')}\n`);
  await browser.close();
}
process.exit(exitCode);
