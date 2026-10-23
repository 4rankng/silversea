// Issue #13 (card 3-dòng, owner screenshots + Gemini consult 23/10 tối) —
// rung-3 driver: the /dispatch-detail phone card (<640px) serves a 3-dòng
// info hierarchy (BKS · Tên/SĐT không truncate · Loại lô/tuyến) and a
// dynamic action slot (≤1 visible button per state). Runs BOTH phases:
//   BEFORE = trunk checkout FE (:7187)  — the joined-line defect evidence
//   AFTER  = this worktree FE  (:7186)  — the spec asserts (hard gates)
// Read-only UI change: persisted-state proof = API row identity + DB select
// snapshot across the run (rows untouched).
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import postgres from '../../backend/node_modules/postgres/src/index.js';

const OUT = path.resolve('qa/2026-10-24-card-3lines');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'card-3lines_ui-driver.log');
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
let failures = 0;
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const API = process.env.QA_API ?? 'http://localhost:3002/api';
const PHASES = [
  { label: 'before', front: process.env.QA_FRONT_BEFORE ?? 'http://localhost:7187' },
  { label: 'after', front: process.env.QA_FRONT_AFTER ?? 'http://localhost:7186' },
];

// Specimen lots (local dev-seed DB, page 1 of the unfiltered detail plan) —
// one per lifecycle state, each with plate + driver + SĐT so the 3-dòng
// asserts have full data. Deep-link ?q=&date= scopes the board to the lot.
const STATES = [
  { key: 'card-thuong', bill: 'ASKVH0B6353674', date: '2026-10-15', fid: 170, plate: '15H-021.39', phone: '0985246985', phoneGrouped: '0985 246 985' },
  { key: 'da-phat-lenh', bill: '20SEA26092001', date: '2026-09-15', fid: 41, plate: '15H-087.19', phone: '0964496330', phoneGrouped: '0964 496 330' },
  { key: 'hoan-thanh', bill: 'EGLV149607019409', date: '2026-09-07', fid: 12, plate: '15H-021.39', phone: '0985246985', phoneGrouped: '0985 246 985' },
];

const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log(`api=${API} health=${health?.status}`);
if (health?.status !== 'ok') { log('ABORT: API health not ok'); process.exit(2); }
const { token } = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  // testplan/testaccounts.txt — local dev DISPATCHER (dungnv / Abc123).
  body: JSON.stringify({ identifier: 'dungnv', password: 'Abc123' }),
}).then((r) => r.json());
if (!token) { log('ABORT: login failed'); process.exit(2); }

// ── Data identity: API rows + persisted DB state (read-only proof) ─────────
const sql = postgres('postgres://postgres:postgres@127.0.0.1:5441/silversea');
const apiRows = {};
for (const state of STATES) {
  const page = await fetch(`${API}/shipments/dispatch-detail-plan-rows?page=1&limit=50&q=${encodeURIComponent(state.bill)}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  const row = (page.items ?? []).find((r) => r.fulfillmentId === state.fid);
  apiRows[state.key] = row ?? null;
  check(`data: API row fid ${state.fid} (${state.key}) present`, row != null);
  if (row) {
    log(`  API fid ${state.fid}: status=${row.taskStatus} plate=${row.dispatch.assignedPlate} driver=${row.dispatch.assignedDriverName} phone=${row.dispatch.assignedDriverPhone} trip=${row.dispatch.tripId ?? null}`);
  }
}
const dbSnapshot = await sql`
  select f.id as fid, s.bl_number, f.planned_vehicle_plate_number, f.dispatch_classification, t.id as trip_id, t.status as trip_status, t.completed_at
  from shipment_fulfillments f
  join shipments s on s.id = f.shipment_id
  left join trips t on t.fulfillment_id = f.id
  where f.id in (${STATES[0].fid}, ${STATES[1].fid}, ${STATES[2].fid})
  order by f.id`;
fs.writeFileSync(path.join(OUT, 'db-persisted-state.json'), JSON.stringify({ apiRows, dbSnapshot }, null, 2));
log(`db snapshot rows: ${dbSnapshot.length} (fids ${dbSnapshot.map((r) => r.fid).join(', ')})`);
check('data: DB snapshot covers all 3 specimen fids', dbSnapshot.length === 3);

// ── Browser phases ─────────────────────────────────────────────────────────
const browser = await puppeteer.launch({ headless: 'true' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const phase of PHASES) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  page.on('pageerror', (err) => log(`[${phase.label}] PAGEERROR ${err.message}`));

  for (const state of STATES) {
    const url = `${phase.front}/dispatch-detail?q=${encodeURIComponent(state.bill)}&date=${state.date}`;
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60_000 });
    const found = await page.waitForFunction(
      (bill) => [...document.querySelectorAll('li.dpcard')].some((c) => c.textContent?.includes(bill)),
      { timeout: 30_000 },
      state.bill,
    ).then(() => true).catch(() => false);
    check(`[${phase.label}] ${state.key}: card ${state.bill} hiện ở 390px`, found);
    if (!found) { await page.screenshot({ path: path.join(OUT, `${phase}_${state.key}_MISSING.png`) }); continue; }
    await sleep(500);

    if (phase.label === 'before') {
      // BEFORE — the defect class: the joined plate·tên·SĐT one-line run.
      const before = await page.evaluate((bill) => {
        const card = [...document.querySelectorAll('li.dpcard')].find((c) => c.textContent?.includes(bill));
        const vehicle = card?.querySelector('.dpcard__line--vehicle');
        const actionButtons = card ? [...card.querySelectorAll('.dpcard__action button, .dpcard__foot button, .dpcard .dispatch-row-menu__trigger')] : [];
        return {
          joinedLine: vehicle?.textContent ?? null,
          truncated: vehicle ? vehicle.scrollWidth > vehicle.clientWidth : false,
          actionButtonCount: actionButtons.length,
          labels: actionButtons.map((b) => b.getAttribute('aria-label') ?? b.textContent),
        };
      }, state.bill);
      log(`[${phase.label}] ${state.key}: joinedLine=${JSON.stringify(before.joinedLine)} truncated=${before.truncated} actionButtons=${before.actionButtonCount} ${JSON.stringify(before.labels)}`);
      await page.screenshot({ path: path.join(OUT, `before_${state.key}.png`) });
      check(`[${phase.label}] ${state.key}: BEFORE có dòng join BKS·Tên·SĐT (defect class)`, before.joinedLine != null && before.joinedLine.includes('·'));
    } else {
      // AFTER — the spec asserts (C3L-01/02/03).
      const after = await page.evaluate((bill) => {
        const card = [...document.querySelectorAll('li.dpcard')].find((c) => c.textContent?.includes(bill));
        if (!card) return { missing: true };
        const info = card.querySelector('.dpcard__info');
        const infoChildren = info ? [...info.children].map((c) => c.className) : [];
        const plate = info?.querySelector('.dpcard__plate')?.textContent ?? null;
        const phoneEl = info?.querySelector('.dpcard__driver-phone') ?? null;
        const phoneStyle = phoneEl ? getComputedStyle(phoneEl) : null;
        const meta = info?.querySelector('.dpcard__info-meta')?.textContent ?? null;
        const chip = card.querySelector('.dpcard__issue');
        const chipInInfo = chip && info ? info.contains(chip) : false;
        const slot = card.querySelector('.dpcard__action');
        const slotButtons = slot ? [...slot.querySelectorAll('button')] : [];
        const trigger = card.querySelector('.dpcard .dispatch-row-menu__trigger');
        const issueBtn = card.querySelector('.dpcard .detailed-plan-grid__note-action--icon');
        const rects = slotButtons.map((b) => { const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
        return {
          missing: false,
          completedModifier: card.classList.contains('dpcard--completed'),
          infoTag: info?.tagName ?? null,
          infoLineCount: infoChildren.length,
          infoChildren,
          plate,
          phoneText: phoneEl?.textContent ?? null,
          phoneNowrap: phoneStyle?.whiteSpace === 'nowrap',
          phoneNotEllipsized: phoneEl ? phoneEl.scrollWidth <= phoneEl.clientWidth : null,
          meta,
          chipText: chip?.textContent?.trim() ?? null,
          chipInInfo,
          slotPresent: slot != null,
          slotButtonCount: slotButtons.length,
          slotLabels: slotButtons.map((b) => b.getAttribute('aria-label') ?? b.textContent),
          triggerPresent: trigger != null,
          issueBtnPresent: issueBtn != null,
          rects,
        };
      }, state.bill);
      log(`[${phase.label}] ${state.key}: ${JSON.stringify(after)}`);
      await page.screenshot({ path: path.join(OUT, `after_${state.key}.png`) });

      check(`[${phase.label}] ${state.key}: info block đúng 3 dòng`, after.infoLineCount === 3, `${after.infoLineCount} (${after.infoChildren.join(' | ')})`);
      check(`[${phase.label}] ${state.key}: dòng 1 BKS = ${state.plate}`, after.plate === state.plate, String(after.plate));
      check(`[${phase.label}] ${state.key}: SĐT full nhóm 3-4 số '${state.phoneGrouped}' không truncate`, after.phoneText === state.phoneGrouped && after.phoneNowrap && after.phoneNotEllipsized === true, `${after.phoneText} nowrap=${after.phoneNowrap} notEllipsized=${after.phoneNotEllipsized}`);
      check(`[${phase.label}] ${state.key}: dòng 3 Loại lô · tuyến có mặt`, typeof after.meta === 'string' && after.meta.includes('·'), String(after.meta));
      check(`[${phase.label}] ${state.key}: chip ngoài block info`, after.chipInInfo === false && (after.chipText == null || after.chipText.length > 0), String(after.chipText));

      if (state.key === 'card-thuong') {
        check(`[${phase.label}] card-thuong: slot đúng 1 nút paper-plane (Phát lệnh), KHÔNG ⋯`, after.slotButtonCount === 1 && after.issueBtnPresent && !after.triggerPresent, JSON.stringify(after.slotLabels));
      } else if (state.key === 'da-phat-lenh') {
        check(`[${phase.label}] da-phat-lenh: slot đúng 1 nút ⋯, KHÔNG paper-plane`, after.slotButtonCount === 1 && after.triggerPresent && !after.issueBtnPresent, JSON.stringify(after.slotLabels));
      } else {
        check(`[${phase.label}] hoan-thanh: KHÔNG nút action (history đóng băng) + modifier dim`, after.slotPresent === false && after.completedModifier === true && after.infoTag === 'DIV');
      }
      if (after.slotButtonCount >= 1) {
        check(`[${phase.label}] ${state.key}: nút action ≥44px touch target`, after.rects.every((r) => r.w >= 44 && r.h >= 44), JSON.stringify(after.rects));
      }

      // Tap-card → ⋯ menu (unissued cards hide the trigger; spec B).
      if (state.key === 'card-thuong') {
        const tapped = await page.evaluate(() => {
          const card = document.querySelector('li.dpcard');
          const info = card?.querySelector('.dpcard__info');
          if (!(info instanceof HTMLElement)) return false;
          info.click();
          return true;
        });
        await sleep(300);
        const menuText = await page.evaluate(() => document.querySelector('[role="menu"]')?.textContent ?? null);
        await page.screenshot({ path: path.join(OUT, 'after_card-thuong_menu-tap.png') });
        check(`[${phase.label}] card-thuong: tap block info mở ⋯ menu (tác vụ phụ)`, tapped && /Sửa điều phối/.test(menuText ?? ''), String(menuText).slice(0, 80));
        await page.keyboard.press('Escape');
        await sleep(200);
      }
    }
  }
  await page.close();
}
await browser.close();
await sql.end({ timeout: 5 });

log(failures === 0 ? 'ALL CHECKS PASS' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
