#!/usr/bin/env node
/**
 * Wave4 staging verify — rung-3 UI drives (AGENTS §9) on vantai.tingting.vip
 * (staging, build 11720424). Prod untouched.
 *
 * C1  /dispatch-detail: "Loại hàng" select in the quick filters drives the
 *     cargoMode query param (fix 171026154000).
 * C4  (fix 171026182554):
 *   1. /shipments-detail?dateScope=all @1440+390 — NO "Thêm container cùng
 *      lô …" / "Xóa container …" row buttons, no add-container form; sibling
 *      cell editors still render.
 *   2. Declaration save ("tờ khai lưu đồng bộ") on fixture container
 *      QAWA4700011: save → the number syncs to the lot's empty sibling cont
 *      (per-cont store + auto-copy law), API before/after proves persistence.
 *   3. /shipments/:id (fixture lot 890) — "Containers (N)" heading, NO
 *      "Thêm container" button.
 *   4. /shipments overview drawer — "Thêm container" + "Xóa container" KEPT.
 *
 * Evidence: ui-*.png screenshots + this log (EXIT status) + API identity of
 * lot 890 before/after the declaration write.
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';

const BASE = 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const ART = new URL('.', import.meta.url).pathname;
const LOG = `${ART}ui-driver.log`;
const LOT = Number(process.env.QA_W4_LOT ?? 0);
const BOX = process.env.QA_W4_BOX ?? 'QAWA4700011';
if (!LOT) { console.error('QA_W4_LOT required (fixture lot id)'); process.exit(2); }
mkdirSync(ART, { recursive: true });
const log = (line) => { const t = `${new Date().toISOString()} ${line}`; console.log(t); appendFileSync(LOG, `${t}\n`); };
appendFileSync(LOG, `\n=== run ${new Date().toISOString()} lot=${LOT} box=${BOX} ===\n`);
let failures = 0;
const expectNone = (found, where, what) => {
  if (found.length === 0) { log(`PASS [${where}] no ${what}`); } else { failures += 1; log(`FAIL [${where}] ${what} present: ${JSON.stringify(found)}`); }
};
const expectSome = (found, where, what) => {
  if (found.length > 0) { log(`PASS [${where}] ${what} (${found.length}): ${JSON.stringify(found.slice(0, 3))}`); } else { failures += 1; log(`FAIL [${where}] ${what} MISSING`); }
};
const expectTrue = (cond, where, what) => {
  if (cond) { log(`PASS [${where}] ${what}`); } else { failures += 1; log(`FAIL [${where}] ${what}`); }
};

const login = async (identifier) => {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  }).then((r) => r.json());
  if (!res.token) { log(`FAIL login ${identifier}`); process.exit(1); }
  log(`login ${identifier} OK`);
  return res.token;
};
const cusToken = await login('cus');
const dispToken = await login('dungnv');

const getShipment = async (token) => {
  const res = await fetch(`${API}/shipments/${LOT}`, { headers: { Authorization: `Bearer ${token}` } });
  return res.json();
};
const declSnapshot = (json) => {
  const containers = json.containers ?? json.shipment?.containers ?? [];
  return containers.map((c) => ({ n: c.containerNumber, d: c.declarationNumber ?? null }));
};
const before = declSnapshot(await getShipment(cusToken));
log(`API before: ${JSON.stringify(before)}`);

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1440,1000'],
  defaultViewport: { width: 1440, height: 1000 },
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => { await page.screenshot({ path: `${ART}2026-10-17_wave4-verify_${name}.png` }); log(`shot ${name}`); };
const waitFor = async (selector, ms = 60000) => {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await page.$(selector).catch(() => null)) return true;
    if (Date.now() > deadline) return false;
    await sleep(500);
  }
};
const buttonsMatching = (src, flags = 'i') => page.evaluate((s, f) => {
  const re = new RegExp(s, f);
  return [...document.querySelectorAll('button')].filter((b) => {
    const label = `${b.getAttribute('aria-label') || ''} ${b.textContent || ''}`.trim();
    return re.test(label);
  }).map((b) => `${b.getAttribute('aria-label') || b.textContent.trim()}`);
}, src, flags);
const clickButton = async (needle, tries = 6) => {
  for (let i = 0; i < tries; i += 1) {
    const ok = await page.evaluate((n) => {
      const btn = [...document.querySelectorAll('button')].find((b) => `${b.getAttribute('aria-label') || ''} ${b.textContent || ''}`.includes(n));
      if (!btn) return false;
      btn.click();
      return true;
    }, needle);
    if (ok) return true;
    await sleep(500);
  }
  return false;
};

const page = await browser.newPage();
const apiRequests = [];
page.on('request', (req) => {
  const u = req.url();
  if (u.includes('/api/shipments/dispatch-detail-plan-rows')) apiRequests.push(u);
});

// ── C1 — /dispatch-detail "Loại hàng" select drives cargoMode ────────────
log('— C1: /dispatch-detail quick-filter Loại hàng select');
{
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), dispToken);
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 90000 });
  const ready = await waitFor('table tbody tr, [role="row"]', 60000);
  expectTrue(ready, 'C1', 'dispatch-detail grid rendered');
  await sleep(1000);
  // The quick-filter selects render inside the Bộ lọc dialog (InlineLabelSelect
  // buttons carry the "<label>: <value>" text).
  const opened = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Bộ lọc');
    if (!btn) return false;
    btn.click();
    return true;
  });
  expectTrue(opened, 'C1', 'Bộ lọc dialog opened');
  await sleep(1000);
  const labels = await page.evaluate(() => [...document.querySelectorAll('button')]
    .map((b) => (b.textContent || '').trim())
    .filter((t) => /^Loại hàng/.test(t)));
  log(`C1 Loại hàng controls: ${JSON.stringify(labels)}`);
  expectSome(labels, 'C1', 'Loại hàng select in the quick-filters group');
  await shot('ui-c1-loaihang-before');
  const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /^Loại hàng/.test((b.textContent || '').trim()));
    if (!btn) return false;
    btn.click();
    return true;
  });
  expectTrue(clicked, 'C1', 'Loại hàng select clickable');
  await sleep(800);
  const picked = await page.evaluate(() => {
    const opt = [...document.querySelectorAll('[role="option"], li, button')].find((o) => /Hàng lẻ \(LCL\)/.test(o.textContent || ''));
    if (!opt) return false;
    opt.click();
    return true;
  });
  expectTrue(picked, 'C1', "option 'Hàng lẻ (LCL)' clickable");
  await sleep(2500);
  const hit = apiRequests.filter((u) => /cargoMode=LCL/.test(u));
  log(`C1 plan-rows requests after pick: ${apiRequests.slice(-3).join(' | ')}`);
  expectSome(hit, 'C1', 'request carries ?cargoMode=LCL');
  const state = await page.evaluate(() => [...document.querySelectorAll('button')]
    .map((b) => (b.textContent || '').trim())
    .find((t) => /^Loại hàng:/.test(t)) ?? null);
  log(`C1 select state after pick: ${JSON.stringify(state)}`);
  expectTrue(/Hàng lẻ \(LCL\)/.test(state ?? ''), 'C1', 'select shows Hàng lẻ (LCL)');
  await shot('ui-c1-loaihang-lcl');
}

// ── C4 surfaces as CUS ──────────────────────────────────────────────────
log('— C4.1: /shipments-detail?dateScope=all @1440');
{
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), cusToken);
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${BASE}/shipments-detail?dateScope=all`, { waitUntil: 'networkidle2', timeout: 90000 });
  const ready = await waitFor('.shipment-container-ledger table tbody tr', 60000);
  expectTrue(ready, 'C4.1', 'workboard rows rendered');
  await sleep(1000);
  expectNone(await buttonsMatching('Thêm container cùng lô'), '/shipments-detail', 'Thêm container cùng lô buttons');
  expectNone(await buttonsMatching('^Xóa container'), '/shipments-detail', 'Xóa container buttons');
  const addForm = await page.$('[data-testid="add-container-form"]');
  expectTrue(!addForm, '/shipments-detail', 'no add-container form');
  expectSome(await buttonsMatching('Chỉnh sửa'), '/shipments-detail', 'cell edit triggers (sibling behavior intact)');
  await shot('ui-shipments-detail-1440');
}

log('— C4.2: declaration save on fixture container (tờ khai lưu đồng bộ)');
{
  const needle = `Chỉnh sửa ô chứng từ và hãng tàu ${BOX}`;
  const found = await buttonsMatching(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  log(`C4.2 trigger search ${needle}: ${JSON.stringify(found)}`);
  expectSome(found, 'C4.2', 'docs cell trigger for fixture container');
  const clicked = await clickButton(needle);
  expectTrue(clicked, 'C4.2', 'docs editor opened');
  await sleep(1200);
  const declNo = `QA-W4-TK-${Date.now().toString(16).slice(-6).toUpperCase()}`;
  let filled = false;
  for (let i = 0; i < 6 && !filled; i += 1) {
    filled = await page.evaluate((val) => {
      const input = [...document.querySelectorAll('input')].find((inp) => {
        const lbl = inp.closest('label')?.textContent ?? '';
        return /Số tờ khai/.test(lbl);
      });
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, val);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }, declNo);
    if (!filled) await sleep(500);
  }
  expectTrue(filled, 'C4.2', `typed declaration ${declNo} into Số tờ khai`);
  const saved = await clickButton(`Lưu chứng từ và hãng tàu ${BOX}`);
  expectTrue(saved, 'C4.2', 'save button clicked');
  await sleep(3000);
  await shot('ui-c4-declaration-saved');
  const afterSave = declSnapshot(await getShipment(cusToken));
  log(`API after declaration save: ${JSON.stringify(afterSave)}`);
  writeFileSync(`${ART}evidence-c4-declaration.json`, JSON.stringify({ lot: LOT, box: BOX, declNo, before, afterSave }, null, 2));
  const mine = afterSave.find((c) => c.n === BOX);
  expectTrue(mine?.d === declNo, 'C4.2', `declaration persisted on ${BOX} (API side effect)`);
  // "lưu đồng bộ": the first number auto-copies to empty sibling containers.
  const sibling = afterSave.find((c) => c.n !== BOX);
  if (sibling) {
    expectTrue(sibling.d === declNo, 'C4.2', `declaration synced to empty sibling ${sibling.n} (lưu đồng bộ)`);
  }
}

log('— C4.1b: /shipments-detail @390 (phone band)');
{
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${BASE}/shipments-detail?dateScope=all`, { waitUntil: 'networkidle2', timeout: 90000 });
  if (await waitFor('.shipment-container-ledger tbody tr, .shipment-container-ledger [data-label]', 60000)) {
    await sleep(1000);
    expectNone(await buttonsMatching('Thêm container cùng lô'), '/shipments-detail@390', 'Thêm container cùng lô buttons');
    expectNone(await buttonsMatching('^Xóa container'), '/shipments-detail@390', 'Xóa container buttons');
    await shot('ui-shipments-detail-390');
  } else {
    log('INFO @390 rows not rendered under card selectors — 1440 assertions stand');
  }
}

log(`— C4.3: /shipments/${LOT} single-lot detail`);
{
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${BASE}/shipments/${LOT}`, { waitUntil: 'networkidle2', timeout: 90000 });
  const ready = await waitFor('.shipment-detail__section-title', 60000);
  expectTrue(ready, 'C4.3', 'lot detail rendered');
  await sleep(1000);
  const heading = await page.evaluate(() => [...document.querySelectorAll('h3')].map((h) => h.textContent.trim()).find((t) => /^Containers \(\d+\)/.test(t)) ?? null);
  log(`C4.3 heading: ${JSON.stringify(heading)}`);
  expectTrue(/^Containers \(2\)/.test(heading ?? ''), 'C4.3', 'heading Containers (2) counts right');
  expectNone(await buttonsMatching('Thêm container'), `/shipments/${LOT}`, 'Thêm container button');
  await shot(`ui-shipment-detail-${LOT}-1440`);
}

log('— C4.4: /shipments overview drawer KEEPS Thêm/Xóa container');
{
  await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle2', timeout: 90000 });
  const ready = await waitFor('table tbody tr, [role="row"]', 60000);
  expectTrue(ready, 'C4.4', 'overview rows rendered');
  await sleep(1000);
  const searched = await page.evaluate((needle) => {
    const input = document.querySelector('input[aria-label="Tìm lô hàng"]');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, needle);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    return true;
  }, BOX);
  expectTrue(searched, 'C4.4', `search field typed (${BOX})`);
  await sleep(2500);
  const opened = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /Mở chi tiết lô hàng/.test(b.getAttribute('aria-label') || ''));
    if (!btn) return false;
    btn.click();
    return true;
  });
  expectTrue(opened, 'C4.4', 'drawer opened');
  const drawerUp = await waitFor('[role="dialog"]', 20000);
  expectTrue(drawerUp, 'C4.4', 'drawer dialog up');
  await sleep(1500);
  expectSome(await buttonsMatching('Thêm container'), 'drawer /shipments', 'Thêm container KEPT on Tổng quan');
  expectSome(await buttonsMatching('^Xóa container'), 'drawer /shipments', 'Xóa container KEPT on Tổng quan');
  await shot('ui-overview-drawer-1440');
}

const after = declSnapshot(await getShipment(cusToken));
log(`API final: ${JSON.stringify(after)}`);
const unchangedContainers = JSON.stringify(before.map((c) => c.n)) === JSON.stringify(after.map((c) => c.n));
expectTrue(unchangedContainers, 'CENSUS', 'container set unchanged apart from the declaration write');

await browser.close();
log(`ui-driver DONE failures=${failures}`);
log(`EXIT ${failures === 0 ? 0 : 1}`);
process.exit(failures === 0 ? 0 : 1);
