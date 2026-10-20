// FB-113 "standing" verdict on staging bf3a0ff9 (card 171026122140).
// READ-ONLY probe: FB-113 v2 (6b93ee94/30ee4ffd) split the ledger documents
// group into 4 headed columns Bill/Booking → Số tờ khai → Nhập/Xuất → Hãng
// tàu. R24+R25 QA still report "standing", so this drive answers, on the
// EXACT staging build QA tests (health.buildHash pinned), three questions:
//   (1) surface — does /shipments-detail (Chi tiết lô hàng, CUS) show the v2
//       header order? (the only ledger surface; popup already fixed v1)
//   (2) regression — did the sweeps after v2 change any document header/cell?
//   (3) data — does the verdict hold across DIFFERENT lots (populated decl,
//       empty decl, LCL lot-level row) instead of only the 18/10 seed lot?
// No mutation: the claim is display-only, so per §9 the side-effect slot is
// the API↔UI data-identity check (unchanged persisted state).
// Usage: node testplan/qa/scripts/2026-10-20-fb113-standing-verdict.mjs
// Env: QA_BASE (default https://vantai.tingting.vip), QA_BUILD (default bf3a0ff9).
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.QA_BASE || 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const EXPECT_BUILD = process.env.QA_BUILD || 'bf3a0ff9';
const OUT = path.resolve(import.meta.dirname, '../../../qa/2026-10-20-fb113-standing');
fs.mkdirSync(OUT, { recursive: true });

const LOG = [];
const log = (step, obj = {}) => {
  const e = { at: new Date().toISOString(), step, ...obj };
  LOG.push(e);
  console.log(JSON.stringify(e));
};
const results = [];
let exitCode = 0;
const record = (id, pass, detail) => {
  results.push({ id, pass, detail });
  if (!pass) exitCode = 1;
  log('RESULT', { id, pass, detail });
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // ── 0. Build pin: the verdict is only valid on the build QA tests. ──
  const health = await (await fetch(`${API}/health`)).json();
  log('health', health);
  record(`staging build is ${EXPECT_BUILD}`, health.buildHash === EXPECT_BUILD, `buildHash=${health.buildHash}`);

  const loginRes = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'cus', password: 'Abc123' }),
  });
  if (!loginRes.ok) throw new Error(`login cus -> ${loginRes.status}`);
  const { token, user } = await loginRes.json();
  log('login', { user: user?.username ?? user?.name ?? 'cus', role: user?.role });
  const call = async (p) => (await fetch(`${API}${p}`, { headers: { Authorization: `Bearer ${token}` } })).json();

  // ── 1. Enumerate staging lots from the SAME endpoint the page reads, and
  //      pick lots with different data shapes (data-dependency check). ──
  const flat = await call('/shipments/cus-workspace/containers?page=1&limit=200');
  const rows = flat.items ?? [];
  log('workspace rows', { total: flat.total ?? rows.length, received: rows.length });
  const byLot = new Map();
  for (const r of rows) {
    if (r.isLotLevel) continue; // lot-level flat rows repeat the container rows' data
    const key = r.shipmentId ?? r.billOrBookNumber;
    if (!byLot.has(key)) byLot.set(key, []);
    byLot.get(key).push(r);
  }
  const lots = [...byLot.entries()].map(([id, list]) => ({
    id,
    bill: list.find((c) => c.billOrBookNumber)?.billOrBookNumber ?? '',
    containerCount: list.length,
    withDecl: list.filter((c) => (c.declarationNumber ?? '').trim()).length,
  }));
  const pick = [];
  const populated = lots.find((l) => l.withDecl > 0);
  if (populated) pick.push({ ...populated, shape: 'populated-declaration' });
  const empty = lots.find((l) => l.withDecl === 0 && l.containerCount > 0);
  if (empty) pick.push({ ...empty, shape: 'empty-declaration' });
  const lotLevel = rows.find((r) => r.isLotLevel);
  if (lotLevel) pick.push({ id: lotLevel.shipmentId, bill: lotLevel.billOrBookNumber ?? '', shape: 'lcl-lot-level-row', containerCount: 0, withDecl: 0 });
  log('lot pick', pick.map((p) => `${p.shape}:${p.bill || p.id}`));
  record('staging has lots to probe', pick.length > 0, `${lots.length} lots, picked ${pick.map((p) => p.shape).join(',')}`);

  // ── 2. Drive the REAL QA flow per lot: login → Chi tiết lô hàng → ledger. ──
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  const HEADER_SEQUENCE = ['Khách hàng & lộ trình', 'Bill/Booking', 'Số tờ khai', 'Nhập/Xuất', 'Hãng tàu', 'Thông số container'];
  const DOC_LABELS = ['Bill/Booking', 'Số tờ khai', 'Nhập/Xuất', 'Hãng tàu'];

  let probed = 0;
  for (const lot of pick) {
    probed += 1;
    const suffix = lot.bill ? lot.bill : '';
    const url = `${BASE}/shipments-detail?dateScope=all${suffix ? `&searchSuffix=${encodeURIComponent(suffix)}` : ''}`;
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    try {
      await page.waitForSelector('.shipment-container-ledger table', { timeout: 30000 });
      await page.waitForFunction(() => document.querySelectorAll('.shipment-container-ledger tbody tr').length >= 1, { timeout: 30000 });
    } catch {
      record(`[${lot.shape}] ledger renders for "${suffix || '(all)'}"`, false, 'table/rows never appeared');
      continue;
    }
    await sleep(500);
    const tag = `[${lot.shape}${suffix ? ` ${suffix}` : ''}]`;

    // FB-113 A1 — thead order + exactly-one Số tờ khai.
    const headers = await page.evaluate(() => Array.from(document.querySelectorAll('.shipment-container-ledger thead th')).map((th) => th.textContent.trim()));
    log('headers', { lot: lot.shape, headers });
    const idx = (name) => headers.indexOf(name);
    const orderOk = HEADER_SEQUENCE.every((h, i, arr) => idx(h) >= 0 && (i === 0 || idx(h) > idx(arr[i - 1])));
    const declCount = headers.filter((h) => h === 'Số tờ khai').length;
    record(`${tag} FB113 header order (4 cột, Số tờ khai có mặt)`, orderOk && declCount === 1, `declHeaders=${declCount} headers=${JSON.stringify(headers)}`);

    // FB-113 A2 — per-row documents cells carry the 4 data-labels in order.
    const cellProbe = await page.evaluate((docLabels) => {
      const trs = Array.from(document.querySelectorAll('.shipment-container-ledger tbody tr'));
      return trs.slice(0, 6).map((tr) => {
        const tds = Array.from(tr.querySelectorAll('td[data-label]'));
        const declCell = tr.querySelector('td[data-label="Số tờ khai"]');
        const sua = declCell?.querySelector('button[aria-label^="Sửa tờ khai container"]');
        // The td also carries a visually-hidden "Chỉnh sửa ô …: <value>" label
        // and the Sửa button text — the VISIBLE value lives in the __code span.
        const visible = (cell) => cell?.querySelector('.shipment-container-ledger__code')?.textContent.trim() ?? cell?.textContent.trim() ?? null;
        return {
          labels: tds.map((td) => td.getAttribute('data-label')).filter((l) => docLabels.includes(l)),
          decl: visible(declCell),
          bill: visible(tr.querySelector('td[data-label="Bill/Booking"]')),
          containerNumber: sua?.getAttribute('aria-label')?.replace(/^Sửa tờ khai container\s*/, '') ?? null,
          isLotLevel: tds.some((td) => td.textContent.includes('Tổng quan lô hàng')),
        };
      });
    }, DOC_LABELS);
    log('cells', { lot: lot.shape, rows: cellProbe });
    const firstRow = cellProbe[0];
    const docOrderOk = Boolean(firstRow) && DOC_LABELS.every((l, i) => firstRow.labels[i] === l);
    record(`${tag} documents cells in DOM order`, docOrderOk, JSON.stringify(firstRow?.labels ?? []));

    // §9 data-identity slot — UI declaration text equals the API value.
    if (firstRow && firstRow.bill && !firstRow.isLotLevel) {
      const uiDecl = firstRow.decl?.replace(/Sửa$/, '').trim() ?? '';
      const apiList = byLot.get(lot.id) ?? [];
      const apiRow = firstRow.containerNumber
        ? apiList.find((c) => c.containerNumber === firstRow.containerNumber)
        : apiList[0];
      const expected = apiRow?.declarationNumber ?? null;
      const uiNormalized = uiDecl === 'Chưa có tờ khai' || uiDecl === '' ? null : uiDecl;
      record(`${tag} UI↔API declaration identity ("${firstRow.bill}"${firstRow.containerNumber ? ` / ${firstRow.containerNumber}` : ''})`, uiNormalized === expected, `ui=${JSON.stringify(uiNormalized)} api=${JSON.stringify(expected)}`);
    }

    // Screenshot the ledger surface exactly as QA sees it.
    const ledger = await page.$('.shipment-container-ledger');
    const clip = await ledger.boundingBox();
    await page.screenshot({ path: path.join(OUT, `ui-${probed}-ledger-${lot.shape}.png`), clip, fullPage: false });
  }

  // ── 3. Card-mode (≤760px) sanity on the first lot: cells keep data-labels. ──
  if (pick[0]) {
    const suffix = pick[0].bill ? `&searchSuffix=${encodeURIComponent(pick[0].bill)}` : '';
    await page.setViewport({ width: 390, height: 844 });
    await page.goto(`${BASE}/shipments-detail?dateScope=all${suffix}`, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('.shipment-container-ledger', { timeout: 30000 });
    await sleep(600);
    const cardLabels = await page.evaluate(() => {
      const tds = Array.from(document.querySelectorAll('.shipment-container-ledger [data-label]'));
      return [...new Set(tds.map((td) => td.getAttribute('data-label')))];
    });
    log('card-mode labels', cardLabels);
    record('card mode keeps documents labels', ['Bill/Booking', 'Số tờ khai', 'Nhập/Xuất', 'Hãng tàu'].every((l) => cardLabels.includes(l)), JSON.stringify(cardLabels));
    await page.screenshot({ path: path.join(OUT, `ui-card-390-${pick[0].shape}.png`), fullPage: false });
    await page.setViewport({ width: 1440, height: 900 });
  }

  await browser.close();

  // ── 4. Evidence files. ──
  fs.writeFileSync(path.join(OUT, 'ui-driver.log'), LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ build: health.buildHash, results, exitCode }, null, 2));
  const identity = [];
  for (const [id, list] of byLot) {
    for (const c of list.slice(0, 3)) {
      identity.push(`lot=${c.shipmentId ?? id} cont=${c.containerNumber} bill=${c.billOrBookNumber} decl=${JSON.stringify(c.declarationNumber ?? null)}`);
    }
  }
  fs.writeFileSync(path.join(OUT, 'db-api-identity.txt'), `GET /api/shipments/cus-workspace/containers?page=1&limit=200 — build ${health.buildHash} — ${rows.length} rows\n` + identity.join('\n') + '\n');

  const failed = results.filter((r) => !r.pass);
  log('SUMMARY', { pass: results.length - failed.length, fail: failed.length, failed: failed.map((f) => f.id) });
  process.exit(exitCode);
}

main().catch((err) => {
  log('FATAL', { error: String(err?.stack ?? err) });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'ui-driver.log'), LOG.map((e) => JSON.stringify(e)).join('\n') + `\nFATAL ${String(err?.stack ?? err)}\n`);
  process.exit(1);
});
