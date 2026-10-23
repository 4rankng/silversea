// Gomhang hygiene + grid polish (testplan/2026-10-23-gomhang-polish.md) —
// rung-3 QA driver at 390px. READ-ONLY: the merge-mode ticks and the floating
// bar mutate nothing (bar numbers ride the settlement wire; the card badge
// layout is pure CSS) — DB group state is captured before AND after to prove
// it.
//
// Coverage (AFTER phase only — the wave ships one state):
//   GP-01 CUS floating bar: "Đang chọn N lô: Tổng X tấn | Y CBM" wired from
//         the settlement summary's cargoWeightKg/cargoVolumeCbm.
//   GP-05 ĐV card mobile: status badge 1-line ellipsis + title tooltip,
//         ≥8px gap to the ⋯ menu.
//   GP-06 ⋯/tick touch targets ≥44px on every card, including the compact
//         merge-mode head.
//
// Ports are env-only per dev-port-contract.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import postgres from '../../backend/node_modules/postgres/src/index.js';

const FRONT = process.env.QA_FRONT ?? 'http://localhost:7183';
const API = process.env.QA_API ?? 'http://localhost:3003/api';
const OUT = path.resolve('qa/2026-10-23-gomhang-polish');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'gomhang-polish_ui-driver.log');
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

let failures = 0;
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

// Same-customer ungrouped LCL fixture lots WITH cargo measures (picked from
// the shared dev DB before the run; see the snapshot logged below).
const LOT_A = Number(process.env.QA_LOT_A ?? 106); // 65T0109670 — 1134 kg / 5 CBM
const LOT_B = Number(process.env.QA_LOT_B ?? 107); // CBHKHPG16427 — 1080 kg / 4,002 CBM
const CUSTOMER_ID = Number(process.env.QA_CUSTOMER ?? 2);
// A fulfilled lot whose card carries the green "Đã phát lệnh cho tài xế" chip.
const ISSUED_REF = process.env.QA_ISSUED_REF ?? 'TVREQ-LX-C4';

const sql = postgres('postgres://postgres:postgres@127.0.0.1:5441/silversea');
const fixtureRows = (label) => sql`
  select id, coalesce(bl_number, booking_ref) as ref, customer_id,
         cargo_weight_kg::text as kg, cargo_volume_cbm::text as cbm,
         cost_group_id::text as cg, rev_group_id::text as rg
  from shipments where id in (${LOT_A}, ${LOT_B}) order by id`
  .then((rows) => { log(`${label} ${JSON.stringify(rows)}`); return rows; });

const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log(`front=${FRONT} api=${API} health=${health?.status}`);
if (health?.status !== 'ok') { log('ABORT: local API health not ok'); process.exit(2); }

const login = async (identifier) => {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: process.env.QA_PASS ?? 'Abc123' }),
  });
  if (!res.ok) { log(`ABORT: login ${identifier} failed (${res.status})`); process.exit(2); }
  const { token } = await res.json();
  return token;
};
const dispatcherToken = await login(process.env.QA_USER ?? 'dungnv');
const cusToken = await login(process.env.QA_CUS_USER ?? 'cus');

const before = await fixtureRows('DB before');
const refA = before[0].ref;
const refB = before[1].ref;
// The number the bar MUST print (kg → tấn ÷1000, vi-VN decimal comma).
const expectedTotals = (() => {
  const kg = Number(before[0].kg) + Number(before[1].kg);
  const cbm = Number(before[0].cbm) + Number(before[1].cbm);
  const vi = (n) => n.toLocaleString('vi-VN', { maximumFractionDigits: 3 });
  return `Tổng ${vi(kg / 1000)} tấn | ${vi(cbm)} CBM`;
})();
log(`expected bar clause: ${expectedTotals}`);

const browser = await puppeteer.launch({ headless: 'true' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newPage(token) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  await page.evaluateOnNewDocument((t) => {
    if (location.origin.startsWith('http://localhost')) localStorage.setItem('token', t);
  }, token);
  page.on('pageerror', (err) => log(`PAGEERROR ${err.message}`));
  return page;
}

const clickText = (page, text, scope = 'button') => page.evaluate(
  (t, sel) => {
    const el = [...document.querySelectorAll(sel)].find((b) => b.textContent?.trim() === t);
    if (!el) return false;
    el.click();
    return true;
  },
  text, scope,
);
const textVisible = (page, re) => page.evaluate(
  (r) => new RegExp(r, 'i').test(document.body.innerText || ''), re,
);

// ══════════════════════════════════════════════════════════════════════════
// GP-01 — CUS Chi phí – Quyết toán floating bar: Tổng X tấn | Y CBM
// ══════════════════════════════════════════════════════════════════════════
{
  const page = await newPage(cusToken);
  // The phone record list pages client-side (PAGE_SIZE 20) over 76 lots for
  // the fixture customer — narrow to the fixtures' delivery-date window and
  // page forward as a fallback so both refs are on screen.
  const eddFrom = process.env.QA_FROM ?? '2026-10-09';
  const eddTo = process.env.QA_TO ?? '2026-10-13';
  await page.goto(`${FRONT}/shipments-debit?customer=${CUSTOMER_ID}&from=${eddFrom}&to=${eddTo}`, { waitUntil: 'networkidle2', timeout: 45_000 });
  await sleep(1500);
  for (let i = 0; i < 10; i += 1) {
    const both = await page.evaluate((a, b) => document.body.innerText.includes(a) && document.body.innerText.includes(b), refA, refB);
    if (both) break;
    const next = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('nav[aria-label="Trang bản ghi"] button')].find((x) => /Trang sau/.test(x.textContent ?? ''));
      if (!btn || btn.disabled) return false;
      btn.click();
      return true;
    });
    if (!next) break;
    await sleep(600);
  }
  const visible = await page.evaluate((a, b) => ({
    a: document.body.innerText.includes(a),
    b: document.body.innerText.includes(b),
  }), refA, refB);
  check('GP-01 fixture lots on screen', visible.a && visible.b, JSON.stringify(visible));
  await sleep(400);

  const toggle = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === '📦 Gộp hàng');
    if (!b) return false;
    b.click();
    return true;
  });
  check('GP-01 [📦 Gộp hàng] toggle found + clicked', toggle);
  await sleep(500);

  for (const ref of [refA, refB]) {
    const ticked = await page.evaluate((label) => {
      const el = document.querySelector(`input[type="checkbox"][aria-label="Chọn ${label}"]`);
      if (!el) return false;
      el.click();
      return true;
    }, ref);
    check(`GP-01 tick ${ref}`, ticked);
    await sleep(300);
  }

  await page.waitForSelector('.lcl-selection-bar', { timeout: 10_000 });
  const bar = await page.evaluate(() => {
    const totals = document.querySelector('.lcl-selection-bar__totals');
    const first = document.querySelector('.lcl-selection-bar__first');
    return { totals: totals?.textContent ?? '', first: first?.textContent ?? '' };
  });
  log(`GP-01 bar totals DOM: "${bar.totals}" | first: "${bar.first}"`);
  check('GP-01 bar states the lot count', /^Đang chọn 2 lô/.test(bar.totals), bar.totals);
  check('GP-01 bar wires Tổng tấn | CBM', bar.totals.includes(expectedTotals), `expected ${expectedTotals}`);
  await shot(page, 'gp01-cus-bar-390');
  log('shot gp01-cus-bar-390.png (post-click screenshot)');
  await page.close();
}

// ══════════════════════════════════════════════════════════════════════════
// GP-05 + GP-06 — ĐV Kế hoạch Chi tiết card at 390
// ══════════════════════════════════════════════════════════════════════════
{
  const page = await newPage(dispatcherToken);
  await page.goto(`${FRONT}/dispatch-detail?q=${encodeURIComponent(ISSUED_REF)}`, { waitUntil: 'networkidle2', timeout: 45_000 });
  await page.waitForSelector('.dpcard', { timeout: 25_000 });
  await sleep(800);

  const measureBadge = () => page.evaluate(() => {
    const card = [...document.querySelectorAll('.dpcard')].find(
      (c) => /Đã phát lệnh/.test(c.querySelector('.dpcard__issue')?.textContent ?? ''),
    );
    if (!card) return null;
    const wrap = card.querySelector('.dpcard__issue');
    const chip = wrap.querySelector('.dispatch-assignment-cell__issue');
    const label = chip.querySelector('span:not([aria-hidden])');
    const trigger = card.querySelector('.dispatch-row-menu__trigger');
    const wr = wrap.getBoundingClientRect();
    const tr = trigger.getBoundingClientRect();
    return {
      chipText: wrap.textContent,
      chipTitle: chip.getAttribute('title'),
      gapPx: +(tr.left - wr.right).toFixed(1),
      wrapH: +wr.height.toFixed(1),
      labelH: +label.getBoundingClientRect().height.toFixed(1),
      ellipsized: wrap.scrollWidth > wrap.clientWidth || label.scrollWidth > label.clientWidth,
      triggerW: +tr.width.toFixed(1),
      triggerH: +tr.height.toFixed(1),
    };
  });

  // — GP-05: plain card head.
  const badge = await measureBadge();
  log(`GP-05 badge ${JSON.stringify(badge)}`);
  check('GP-05 green "Đã phát lệnh…" chip present on the card', badge != null);
  if (badge) {
    check('GP-05 chip title = full label (tooltip)', badge.chipTitle === 'Đã phát lệnh cho tài xế', String(badge.chipTitle));
    check('GP-05 chip is ONE line', badge.labelH <= 20 && badge.wrapH <= 24, `labelH=${badge.labelH} wrapH=${badge.wrapH}`);
    check('GP-05 badge ≥8px from ⋯', badge.gapPx >= 8, `gap=${badge.gapPx}px`);
    check('GP-05 ⋯ trigger ≥44px', badge.triggerW >= 44 && badge.triggerH >= 44, `${badge.triggerW}×${badge.triggerH}`);
  }
  await shot(page, 'gp05-card-badge-390');
  log('shot gp05-card-badge-390.png (status badge vs ⋯, 390px)');

  // — GP-06: compact merge-mode head (extra tick) keeps every target ≥44px.
  const toggle = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === '📦 Gộp hàng');
    if (!b) return false;
    b.click();
    return true;
  });
  check('GP-06 merge mode toggled on the board', toggle);
  await sleep(600);

  const compact = await measureBadge();
  log(`GP-06 compact-merge badge ${JSON.stringify(compact)}`);
  if (compact) {
    check('GP-06 compact head: badge ≥8px from ⋯', compact.gapPx >= 8, `gap=${compact.gapPx}px`);
    check('GP-06 compact head: ⋯ trigger ≥44px', compact.triggerW >= 44 && compact.triggerH >= 44, `${compact.triggerW}×${compact.triggerH}`);
    check('GP-06 compact head: badge still ONE line', compact.labelH <= 20, `labelH=${compact.labelH}`);
  }
  const ticks = await page.evaluate(() => [...document.querySelectorAll('.dpcard .ops-lcl-check')].map((el) => {
    const r = el.getBoundingClientRect();
    return { w: +r.width.toFixed(1), h: +r.height.toFixed(1), disabled: el.disabled };
  }));
  log(`GP-06 tick boxes ${JSON.stringify(ticks)}`);
  check('GP-06 every card tick ≥44px', ticks.length > 0 && ticks.every((t) => t.w >= 44 && t.h >= 44), JSON.stringify(ticks));

  // The LCL selectable tick (the merge selection target) — an on-board
  // ungrouped LCL lot (fulfillment-backed, so the detail board lists it).
  const TICK_REF = process.env.QA_TICK_REF ?? 'K04573847543';
  await page.evaluate((value) => {
    const el = document.querySelector('input[aria-label="Tìm nhanh"], input[placeholder*="Bill"]');
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, TICK_REF);
  await sleep(1500);
  const searched = await page.evaluate((ref) => ({
    bodyHasRef: document.body.innerText.includes(ref),
    cards: document.querySelectorAll('.dpcard').length,
  }), TICK_REF);
  log(`GP-06 LCL tick search ${TICK_REF} → ${JSON.stringify(searched)}`);
  const lclTick = await page.evaluate(() => {
    const el = document.querySelector('.dpcard .ops-lcl-check:not(:disabled)');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { w: +r.width.toFixed(1), h: +r.height.toFixed(1), disabled: el.disabled };
  });
  log(`GP-06 LCL enabled tick ${JSON.stringify(lclTick)}`);
  check('GP-06 LCL selectable tick ≥44px', lclTick != null && lclTick.w >= 44 && lclTick.h >= 44, JSON.stringify(lclTick));
  await shot(page, 'gp06-card-touch-390');
  log('shot gp06-card-touch-390.png (merge-mode compact head, tick + ⋯)');
  await page.close();
}

const after = await fixtureRows('DB after');
check(
  'read-only run: cost/rev groups unchanged',
  JSON.stringify(before.map((r) => [r.cg, r.rg])) === JSON.stringify(after.map((r) => [r.cg, r.rg])),
  JSON.stringify(after.map((r) => [r.id, r.cg, r.rg])),
);

await browser.close();
await sql.end();
log(failures === 0 ? 'DRIVER OK — all checks passed' : `DRIVER FAILED — ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
