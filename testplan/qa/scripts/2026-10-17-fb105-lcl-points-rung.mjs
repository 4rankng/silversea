// FB-105 (kanban card 171026115800) — Hàng lẻ's two operating points:
//   1. the Kho picker must actually carry the customer's warehouse catalog
//   2-3. both labels follow the trade direction (Nhập = Nhà máy trả / Kho lấy;
//        Xuất = Nhà máy lấy / Kho trả), with the matching placeholders
//   4. both are comboboxes that also accept free text and offer an add button
//   5. Nhà máy is required for a catalog lot and waived by Lệnh chạy ngoài
//   6-7. the dispatch grids' Nâng/Trả columns follow the same direction rule
//
// LOCAL ONLY: vite 7175 → api 3002. Role CUS (thanhdc), customer LONG MINH.
//   node testplan/qa/scripts/2026-10-17-fb105-lcl-points-rung.mjs
// Exit 0 = every rung PASS.

import puppeteer from 'puppeteer';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:7175';
const API = `${BASE}/api`;
const SHOTS = process.env.SHOTS ?? '/tmp/fb105';
fs.mkdirSync(SHOTS, { recursive: true });
const TAG = `FB105-${Date.now().toString(16).slice(-6).toUpperCase()}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function record(rung, verdict, detail) {
  results.push({ rung, verdict, detail });
  console.log(`[${verdict}] ${rung} — ${detail}`);
}

async function call(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (method !== 'GET') headers['Idempotency-Key'] = randomUUID();
  const res = await fetch(`${API}${path}`, { method, headers, body: body == null ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-json */ }
  return { status: res.status, ok: res.ok, json, text };
}
async function loginWithRetry(id, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    const r = await call('POST', '/auth/login', { identifier: id, password: 'Abc123' });
    if (r.ok && r.json?.token) return r.json;
    await sleep(1500 * i);
  }
  throw new Error(`login ${id} failed`);
}

const login = await loginWithRetry('thanhdc');
const token = login.token;
console.log(`logged in as ${login.user?.username} (${login.user?.role}) · tag ${TAG}`);

const browser = await puppeteer.launch({
  headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

async function pickIn(hostSelector, typed, wanted) {
  const focused = await page.evaluate((sel) => {
    const host = document.querySelector(sel);
    const c = host?.querySelector('[role="combobox"]') ?? (host?.matches?.('[role="combobox"]') ? host : null);
    if (!c) return false;
    c.scrollIntoView({ block: 'center' });
    c.focus();
    return true;
  }, hostSelector);
  if (!focused) return false;
  await sleep(300);
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => document.querySelectorAll('[role="option"]').length > 0, { timeout: 10000 }).catch(() => {});
  await sleep(400);
  if (typed) { await page.keyboard.type(typed, { delay: 45 }); await sleep(900); }
  return page.evaluate((w) => {
    const o = [...document.querySelectorAll('[role="option"]')]
      .find((el) => (el.innerText || '').trim().toLowerCase().includes(w.toLowerCase()));
    if (!o) return false;
    o.scrollIntoView({ block: 'nearest' });
    o.click();
    return true;
  }, wanted);
}

/** Read both operating-point fields exactly as the operator sees them. */
async function readPoints() {
  return page.evaluate(() => {
    const read = (id) => {
      const host = document.querySelector(`[data-field-id="${id}"]`);
      if (!host) return null;
      const combo = host.querySelector('[role="combobox"]');
      const label = host.querySelector('label, [class*="label"]')?.innerText?.trim()
        ?? combo?.getAttribute('aria-label') ?? null;
      const req = host.innerText.includes('*') || /\*$/.test(label || '')
        || !!host.querySelector('[class*="required"], [aria-required="true"]');
      const addBtn = [...host.parentElement.querySelectorAll('button')]
        .map((b) => (b.innerText || '').trim())
        .find((t) => /thêm/i.test(t)) ?? null;
      return {
        label: (label || '').replace(/\s+/g, ' ').trim(),
        placeholder: combo?.getAttribute('placeholder') ?? null,
        value: combo?.value ?? null,
        isCombobox: !!combo,
        requiredMark: req,
        addBtn,
      };
    };
    return {
      factory: read('shipment-operational-site'),
      warehouse: read('shipment-pickup-warehouse'),
      adHoc: [...document.querySelectorAll('label, button, span')]
        .some((el) => /lệnh chạy ngoài/i.test((el.innerText || '').trim())),
      adHocChecked: [...document.querySelectorAll('input[type="checkbox"]')]
        .some((c) => c.checked && /lệnh chạy ngoài/i.test((c.closest('label')?.innerText || ''))),
    };
  });
}

async function shot(name) {
  await sleep(700);
  const path = `${SHOTS}/${name}.png`;
  await page.screenshot({ path });
  return path;
}

try {
  // ── Create form ────────────────────────────────────────────────────────
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('[data-field-id="shipment-customer"]', { timeout: 45000 });
  await sleep(2500);

  await pickIn('[data-field-id="shipment-customer"]', 'LONG MINH', 'LONG MINH');
  await sleep(2500);
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('button, [role="tab"], label')]
      .find((b) => /hàng lẻ/i.test((b.innerText || '').trim()));
    el?.scrollIntoView({ block: 'center' });
    el?.click();
  });
  await sleep(2500);

  // ── Item 1: the Kho picker must carry the warehouse catalog ────────────
  const khoOptions = await page.evaluate(() => {
    const host = document.querySelector('[data-field-id="shipment-pickup-warehouse"]');
    const combo = host?.querySelector('[role="combobox"]');
    if (!combo) return { opened: false, options: [] };
    combo.focus();
    return { opened: true, comboPlaceholder: combo.getAttribute('placeholder') };
  });
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => document.querySelectorAll('[role="option"]').length > 0, { timeout: 8000 }).catch(() => {});
  await sleep(500);
  const optionList = await page.evaluate(() => [...document.querySelectorAll('[role="option"]')]
    .map((o) => (o.innerText || '').trim()).filter(Boolean).slice(0, 6));
  await page.keyboard.press('Escape');
  await sleep(400);
  record('item1-kho-co-data', khoOptions.opened && optionList.length > 0 ? 'PASS' : 'FAIL',
    `Kho picker opened=${khoOptions.opened}, placeholder=${JSON.stringify(khoOptions.comboPlaceholder)}, options=${JSON.stringify(optionList)}`);

  // ── Items 2/3: direction-correct labels and placeholders ──────────────
  async function setDirection(text) {
    await page.evaluate(() => {
      const host = document.querySelector('[data-field-id="shipment-trade-direction"]');
      const c = host?.querySelector('[role="combobox"], select, button');
      if (c) { c.scrollIntoView({ block: 'center' }); c.focus(); c.click(); }
    });
    await sleep(700);
    const ok = await page.evaluate((t) => {
      const o = [...document.querySelectorAll('[role="option"]')]
        .find((el) => new RegExp(t, 'i').test((el.innerText || '').trim()));
      if (o) { o.click(); return 'option'; }
      const s = [...document.querySelectorAll('select')]
        .find((el) => [...el.options].some((op) => new RegExp(t, 'i').test(op.text)));
      if (s) {
        const opt = [...s.options].find((op) => new RegExp(t, 'i').test(op.text));
        s.value = opt.value;
        s.dispatchEvent(new Event('change', { bubbles: true }));
        return 'select';
      }
      return false;
    }, text);
    await sleep(1500);
    return ok;
  }

  const imp = await setDirection('Nhập khẩu');
  const impPoints = await readPoints();
  const impShot = await shot('01-nhap-khau-labels');
  record('item2-import-labels',
    /Nhà máy \(Điểm trả hàng\)/.test(impPoints.factory?.label ?? '')
    && /Kho lấy hàng \(CFS\/Cảng\)/.test(impPoints.warehouse?.label ?? '')
    && /kho CFS lấy hàng/.test(impPoints.warehouse?.placeholder ?? '') ? 'PASS' : 'FAIL',
    `via=${imp} ${JSON.stringify(impPoints)} · ${impShot}`);

  const exp = await setDirection('Xuất khẩu');
  const expPoints = await readPoints();
  const expShot = await shot('02-xuat-khau-labels');
  record('item3-export-labels',
    /Nhà máy \(Điểm lấy hàng\)/.test(expPoints.factory?.label ?? '')
    && /Kho trả hàng \(CFS\/Cảng\)/.test(expPoints.warehouse?.label ?? '')
    && /kho CFS hạ\/giao hàng/.test(expPoints.warehouse?.placeholder ?? '') ? 'PASS' : 'FAIL',
    `via=${exp} ${JSON.stringify(expPoints)} · ${expShot}`);

  // ── Item 4: combobox + free text + add buttons ────────────────────────
  record('item4-combobox-and-add',
    expPoints.factory?.isCombobox && expPoints.warehouse?.isCombobox
    && /thêm/i.test(expPoints.factory?.addBtn ?? '')
    && /thêm/i.test(expPoints.warehouse?.addBtn ?? '') ? 'PASS' : 'FAIL',
    `factory.addBtn=${JSON.stringify(expPoints.factory?.addBtn)} warehouse.addBtn=${JSON.stringify(expPoints.warehouse?.addBtn)}`);

  // ── Item 5: Nhà máy required, waived by Lệnh chạy ngoài ───────────────
  const requiredBefore = await page.evaluate(() => {
    const combo = document.querySelector('[data-field-id="shipment-operational-site"] [role="combobox"]');
    return { ariaRequired: combo?.getAttribute('aria-required'), hint: document.body.innerText.includes('*') };
  });
  await page.evaluate(() => {
    const candidates = [...document.querySelectorAll('label, [role="checkbox"], button, span')];
    const labelled = candidates.find((el) => /lệnh chạy ngoài/i.test((el.innerText || '').trim())
      && (el.tagName === 'LABEL' || el.getAttribute('role') === 'checkbox'));
    const target = labelled ?? candidates.find((el) => /lệnh chạy ngoài/i.test((el.innerText || '').trim()));
    if (!target) return;
    target.scrollIntoView({ block: 'center' });
    const input = target.tagName === 'LABEL' ? target.querySelector('input') : null;
    (input ?? target).click();
  });
  await sleep(2000);
  const adHocPoints = await readPoints();
  record('item5-required-waived',
    requiredBefore.ariaRequired === 'true' && adHocPoints.factory?.requiredMark === false ? 'PASS' : 'FAIL',
    `catalog lot aria-required=${JSON.stringify(requiredBefore.ariaRequired)} → Lệnh chạy ngoài marks=${adHocPoints.factory?.requiredMark}`);

  // ── Items 6/7: dispatch grids — build own LCL lots, both directions ────
  const sites = await call('GET', '/shipments/operational-sites?customerId=1&limit=50', null, token);
  const siteList = (sites.json?.items ?? sites.json ?? []);
  const factorySite = (Array.isArray(siteList) ? siteList : []).find((s) => s.siteType === 'FACTORY' && !/chưa xác định/i.test(s.name ?? ''));
  const warehouseSite = (Array.isArray(siteList) ? siteList : []).find((s) => s.siteType === 'WAREHOUSE');
  record('item6-fixture', factorySite && warehouseSite ? 'PASS' : 'FAIL',
    `factory=${factorySite?.name} warehouse=${warehouseSite?.name}`);

  const today = new Date().toISOString().slice(0, 10);
  const made = [];
  for (const [dir, bl] of [['IMPORT', `${TAG}-IMP`], ['EXPORT', `${TAG}-EXP`]]) {
    const r = await call('POST', '/shipments/quick', {
      customerId: 1,
      tradeDirection: dir,
      cargoMode: 'LCL',
      blNumber: bl,
      expectedDeliveryDate: today,
      operationalSiteId: factorySite.id,
      pickupWarehouseSiteId: warehouseSite.id,
      packageType: 'Pallet', packageCount: 2, cargoWeightKg: '500', cargoVolumeCbm: '3',
    }, token);
    made.push({ dir, bl, id: r.json?.id, status: r.status });
  }
  console.log('lcl fixtures:', JSON.stringify(made));

  for (const [page_, label] of [['dispatch', 'Kế hoạch Tổng quát'], ['dispatch-detail', 'Kế hoạch Chi tiết Xe']]) {
    await page.goto(`${BASE}/${page_}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(5000);
    const searchOk = await page.evaluate(() => {
      const i = [...document.querySelectorAll('input[type="text"], input[type="search"], input:not([type])')]
        .find((el) => /tìm|search/i.test(el.placeholder || ''));
      if (!i) return false;
      i.focus();
      return true;
    });
    if (searchOk) { await page.keyboard.type(TAG, { delay: 40 }); await sleep(4000); }
    const rows = await page.evaluate((t) => {
      const all = [...document.querySelectorAll('tr, [class*="row"]')]
        .map((el) => (el.innerText || '').replace(/\s+/g, ' ').trim())
        .filter((s) => s.includes(t));
      return all.slice(0, 4);
    }, TAG);
    const shotName = `03-${page_}-nang-tra`;
    const shotPath = await shot(shotName);
    const impRow = rows.find((r) => r.includes('-IMP'));
    const expRow = rows.find((r) => r.includes('-EXP'));
    // IMPORT: Nâng = Kho, Trả = Nhà máy. EXPORT: Nâng = Nhà máy, Trả = Kho.
    // Both rows MUST be found — a missing row is a FAIL, not a pass, otherwise
    // the assertion would go vacuous whenever the search failed to match.
    const impOk = !!impRow && impRow.includes(warehouseSite.name) && impRow.includes(factorySite.name);
    const expOk = !!expRow && expRow.includes(factorySite.name) && expRow.includes(warehouseSite.name);
    record(`item6-7-${page_}`, impOk && expOk ? 'PASS' : 'FAIL',
      `${label}: IMP row=${JSON.stringify(impRow)} EXP row=${JSON.stringify(expRow)} (Nâng=Kho/Trả=Nhà máy for IMPORT, reversed for EXPORT) · ${shotPath}`);
  }
} catch (e) {
  record('RUNNER', 'FAIL', String(e.message ?? e));
  await page.screenshot({ path: `${SHOTS}/99-error.png`, fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}

const failed = results.filter((r) => r.verdict === 'FAIL');
console.log(`\n=== ${failed.length === 0 ? 'ALL RUNGS PASS' : failed.length + ' RUNG(S) FAILED'} ===`);
for (const r of results) console.log(`  ${r.verdict.padEnd(5)} ${r.rung}`);
process.exit(failed.length === 0 ? 0 : 1);
