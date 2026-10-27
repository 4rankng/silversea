// SIL-524 (owner 27/10) — rung-3 UI drive (AGENTS §9), Thao tác rail stack.
// Owner spec: the pinned THAO TÁC column of the detailed-plan board stacks
// its actions VERTICALLY (send quick-issue icon on top, ⋯ under it, gap 4-6,
// centered in the column) and shrinks to ONE button wide (~44-48px); the
// wide inline "Hoàn thành" pill is gone — the verb rides the ⋯ menu. This
// drive measures the real column width at 1440, proves both stack states
// (with send / without send share the same centered ⋯ X — no layout jump),
// opens the ⋯ menu on an external DISPATCHED row and clicks "Hoàn thành"
// down to the page's confirm dialog (cancelled — no mutation; persisted
// identity via GET /api/shipments/dispatch-detail-plan-rows before/after).
// Usage: node qa/scripts/2026-10-27-sil524-thaotac-stack-ui-drive.mjs <label>
// Stack: frontend :7175 → backend :3002 → dev DB :5441.
import puppeteer from 'puppeteer-core';
import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';

const LABEL = process.argv[2] ?? 'after';
const INTERACTIVE = process.argv[3] === '--interactive';
const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const ART = 'qa/2026-10-27_sil524-thaotac-stack';
const LOG = `${ART}/2026-10-27_sil524-thaotac-stack_ui-driver.log`;
mkdirSync(ART, { recursive: true });
const log = (line) => { const text = `${new Date().toISOString()} ${line}`; console.log(text); appendFileSync(LOG, `${text}\n`); };
appendFileSync(LOG, `\n=== run label=${LABEL} interactive=${INTERACTIVE} ${new Date().toISOString()} ===\n`);

const login = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
});
const { token } = await login.json();
log(`login admin: ${token ? 'OK' : 'FAIL'} (http ${login.status})`);
if (!token) process.exit(1);

const planFetch = await fetch(`${API}/shipments/dispatch-detail-plan-rows?month=2026-10&limit=50`, { headers: { Authorization: `Bearer ${token}` } });
const planBody = await planFetch.json().catch(() => null);
const rows = Array.isArray(planBody?.rows) ? planBody.rows : (Array.isArray(planBody?.items) ? planBody.items : []);
log(`GET /api/shipments/dispatch-detail-plan-rows: ${planFetch.status} rows=${rows.length}`);
if (planFetch.status !== 200) process.exit(1);
const sendCandidates = rows.filter((r) => r.taskStatus !== 'COMPLETED' && r.dispatch?.assignedPlate != null && !(r.taskStatus === 'DISPATCHED' && r.dispatch?.tripId != null));
// The "Hoàn thành" verb needs an external live trip; the dev board keeps
// those beyond page 1, so scan pages for the first candidate (the UI pager
// jumps straight to its page).
let completeCandidates = rows.filter((r) => r.dispatch?.carrierType === 'EXTERNAL' && r.taskStatus === 'DISPATCHED' && r.dispatch?.tripId != null).map((r) => ({ ...r, _page: 1 }));
for (let p = 2; p <= 8 && completeCandidates.length === 0; p += 1) {
  const pageRes = await fetch(`${API}/shipments/dispatch-detail-plan-rows?limit=50&page=${p}`, { headers: { Authorization: `Bearer ${token}` } });
  const pageBody = await pageRes.json().catch(() => null);
  const pageRows = Array.isArray(pageBody?.items) ? pageBody.items : [];
  completeCandidates = pageRows.filter((r) => r.dispatch?.carrierType === 'EXTERNAL' && r.taskStatus === 'DISPATCHED' && r.dispatch?.tripId != null).map((r) => ({ ...r, _page: p }));
}
log(`candidates: send-rows=${sendCandidates.length} hoàn-thành-rows=${completeCandidates.length}${completeCandidates[0] ? ` (trip ${completeCandidates[0].dispatch?.tripId} on api page ${completeCandidates[0]._page})` : ''}`);
writeFileSync(`${ART}/2026-10-27_sil524-thaotac-stack_api-before-${LABEL}.json`, JSON.stringify({ status: planFetch.status, count: rows.length, rows: rows.map((r) => ({ shipmentId: r.shipmentId, container: r.container?.containerNumber ?? null, bill: r.docs?.billNumber ?? null, taskStatus: r.taskStatus, carrierType: r.dispatch?.carrierType ?? null, tripId: r.dispatch?.tripId ?? null })) }, null, 2));

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox'],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (ok, name, detail) => { log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) failures += 1; };

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForSelector('.detailed-plan-grid', { timeout: 30000 });
  await page.waitForSelector('.detailed-plan-grid__cell--actions', { timeout: 30000 });
  await sleep(800);

  // Width + stack measurements straight from the live DOM.
  const measure = await page.evaluate(() => {
    const rect = (el) => el.getBoundingClientRect();
    const cs = (el) => getComputedStyle(el);
    const th = document.querySelector('.detailed-plan-grid__th--actions');
    const tds = [...document.querySelectorAll('.detailed-plan-grid__cell--actions')];
    const rail = document.querySelector('.detailed-plan-grid__row-actions');
    const railCs = rail ? cs(rail) : null;
    const rowsInfo = [...document.querySelectorAll('.detailed-plan-grid tbody tr')].map((tr) => {
      const td = tr.querySelector('.detailed-plan-grid__cell--actions');
      if (!td) return null;
      const send = tr.querySelector('.detailed-plan-grid__note-action--icon');
      const kebab = tr.querySelector('.dispatch-row-menu__trigger');
      if (!kebab) return null;
      const s = send ? rect(send) : null;
      const k = rect(kebab);
      return {
        hasSend: Boolean(send),
        sendCenterX: s ? +(s.left + s.width / 2).toFixed(1) : null,
        kebabCenterX: +(k.left + k.width / 2).toFixed(1),
        rowText: (tr.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
      };
    }).filter(Boolean);
    return {
      thWidth: th ? +rect(th).width.toFixed(1) : null,
      tdWidths: tds.slice(0, 6).map((td) => +rect(td).width.toFixed(1)),
      railFlexDirection: railCs?.flexDirection ?? null,
      railAlignItems: railCs?.alignItems ?? null,
      railGap: railCs?.gap ?? null,
      rowCount: rowsInfo.length,
      rowsWithSend: rowsInfo.filter((r) => r.hasSend),
      rowsWithoutSend: rowsInfo.filter((r) => !r.hasSend),
    };
  });
  log(`measure[${LABEL}]: th=${measure.thWidth} td=${JSON.stringify(measure.tdWidths)} flex=${measure.railFlexDirection} align=${measure.railAlignItems} gap=${measure.railGap} rows=${measure.rowCount} withSend=${measure.rowsWithSend.length} withoutSend=${measure.rowsWithoutSend.length}`);

  const shotGrid = `${ART}/2026-10-27_sil524-thaotac-stack_ui-grid-${LABEL}-1440.png`;
  await page.screenshot({ path: shotGrid });

  // The rail shot zooms the pinned column for the artifact record.
  const firstActions = await page.$('.detailed-plan-grid__cell--actions');
  if (firstActions) {
    const box = await firstActions.boundingBox();
    if (box) {
      await page.screenshot({ path: `${ART}/2026-10-27_sil524-thaotac-stack_ui-rail-${LABEL}-1440.png`, clip: { x: Math.max(0, box.x - 130), y: Math.max(0, box.y - 60), width: Math.min(220, box.width + 130), height: 320 } });
    }
  }

  check(measure.thWidth != null && measure.thWidth >= 44 && measure.thWidth <= 48, 'THAO TÁC column width 44-48px', `th=${measure.thWidth}px`);
  check(measure.railFlexDirection === 'column', 'row-actions rail stacks vertically', `flex-direction=${measure.railFlexDirection}`);
  check(measure.railAlignItems === 'center', 'row-actions rail centered', `align-items=${measure.railAlignItems}`);
  const gapNum = measure.railGap == null ? NaN : parseFloat(measure.railGap);
  check(gapNum >= 4 && gapNum <= 6, 'stack gap 4-6px', `gap=${measure.railGap}`);

  if (measure.rowsWithSend.length > 0 && measure.rowsWithoutSend.length > 0) {
    const sendX = measure.rowsWithSend[0].kebabCenterX;
    const noSendX = measure.rowsWithoutSend[0].kebabCenterX;
    const drift = Math.abs(sendX - noSendX);
    check(drift <= 1.5, 'not-yet-sent row keeps the same centered ⋯ slot (no layout jump)', `kebabX send-row=${sendX} no-send-row=${noSendX} drift=${drift}px`);
    const sendTop = measure.rowsWithSend[0];
    check(sendTop.sendCenterX != null && Math.abs(sendTop.sendCenterX - sendTop.kebabCenterX) <= 1.5, 'send icon centered above ⋯', `sendX=${sendTop.sendCenterX} kebabX=${sendTop.kebabCenterX}`);
  } else {
    log(`WARN stack-state pair unavailable — withSend=${measure.rowsWithSend.length} withoutSend=${measure.rowsWithoutSend.length} (layout-jump check needs both states on the board)`);
  }

  if (INTERACTIVE) {
    // Rung-3 click: open ⋯ on an external DISPATCHED row and take "Hoàn thành"
    // down to the confirm dialog — then cancel (no persisted mutation).
    const target = completeCandidates[0];
    if (!target) {
      log('WARN no external DISPATCHED row on the board — menu click-through skipped');
    } else {
      const targetToken = (target.container?.containerNumber || target.docs?.billNumber || '').trim();
      log(`menu drive target: ${targetToken} tripId=${target.dispatch.tripId} (filtering via the board's search box)`);
      // The board's pagination set follows its own query — the deterministic
      // way to surface one row is the board's own search ("Bill, Cont, Tờ
      // khai..."), which is exactly how a dispatcher finds the row.
      await page.type('input[placeholder="Bill, Cont, Tờ khai..."]', targetToken);
      let rowFound = false;
      for (let attempt = 0; attempt < 20 && !rowFound; attempt += 1) {
        await sleep(500);
        rowFound = await page.evaluate((needle) => [...document.querySelectorAll('.detailed-plan-grid tbody tr')].some((el) => el.textContent?.includes(needle)), targetToken);
      }
      const searchInfo = await page.evaluate(() => document.querySelector('.ds-pagination__summary')?.textContent?.replace(/\s+/g, ' ').trim() ?? null);
      log(`after search: rowInDom=${rowFound} summary="${searchInfo}"`);
      check(rowFound, 'target row surfaces via the board search', `row="${targetToken}"`);
      await sleep(600);
      await page.waitForSelector('.detailed-plan-grid', { timeout: 30000 });
      await sleep(600);
      const clicked = await page.evaluate((needle) => {
        const trs = [...document.querySelectorAll('.detailed-plan-grid tbody tr')];
        const tr = trs.find((el) => needle && el.textContent?.includes(needle) && el.querySelector('.dispatch-row-menu__trigger'));
        if (!tr) return false;
        tr.querySelector('.dispatch-row-menu__trigger').click();
        return true;
      }, targetToken);
      check(clicked, '⋯ trigger clicked on the target row', `row="${targetToken}"`);
      if (clicked) {
        await page.waitForSelector('[role="menu"][aria-label^="Thao tác dòng"]', { timeout: 8000 });
        const menuInfo = await page.evaluate(() => {
          const menu = document.querySelector('[role="menu"][aria-label^="Thao tác dòng"]');
          const items = [...(menu?.querySelectorAll('[role="menuitem"]') ?? [])].map((b) => b.textContent?.trim());
          return { label: menu?.getAttribute('aria-label'), items };
        });
        log(`menu open: label="${menuInfo.label}" items=${JSON.stringify(menuInfo.items)}`);
        check(menuInfo.items.includes('Hoàn thành'), '"Hoàn thành" lives INSIDE the ⋯ menu', `items=${JSON.stringify(menuInfo.items)}`);
        await page.screenshot({ path: `${ART}/2026-10-27_sil524-thaotac-stack_ui-menu-${LABEL}-1440.png` });

        await page.evaluate(() => {
          const menu = document.querySelector('[role="menu"][aria-label^="Thao tác dòng"]');
          const item = [...(menu?.querySelectorAll('[role="menuitem"]') ?? [])].find((b) => b.textContent?.trim() === 'Hoàn thành');
          item?.click();
        });
        await sleep(700);
        const dialogOpen = await page.evaluate(() => Boolean(document.querySelector('[role="dialog"], .modal, [class*="modal"]')));
        check(dialogOpen, 'menu "Hoàn thành" opens the page confirm dialog', `dialogOpen=${dialogOpen}`);
        const shotDialog = `${ART}/2026-10-27_sil524-thaotac-stack_ui-confirm-${LABEL}-1440.png`;
        await page.screenshot({ path: shotDialog });
        // Cancel — Escape closes the dialog; no trip mutation.
        await page.keyboard.press('Escape');
        await sleep(500);
        const dialogClosed = await page.evaluate(() => !document.querySelector('[role="dialog"]'));
        check(dialogClosed, 'dialog cancelled cleanly (no mutation)', `closed=${dialogClosed}`);
      }
    }

    // Persisted-state identity: the row is still DISPATCHED after the
    // cancelled drive (the row may sit beyond page 1 — walk the pages).
    let twin = null;
    for (let p = 1; p <= 8 && !twin; p += 1) {
      const after = await fetch(`${API}/shipments/dispatch-detail-plan-rows?limit=50&page=${p}`, { headers: { Authorization: `Bearer ${token}` } });
      const afterBody = await after.json().catch(() => null);
      const afterRows = Array.isArray(afterBody?.items) ? afterBody.items : [];
      if (afterRows.length === 0) break;
      twin = afterRows.find((r) => r.dispatch?.tripId === completeCandidates[0]?.dispatch?.tripId) ?? null;
    }
    writeFileSync(`${ART}/2026-10-27_sil524-thaotac-stack_api-after-${LABEL}.json`, JSON.stringify({ tripId: completeCandidates[0]?.dispatch?.tripId ?? null, taskStatus: twin?.taskStatus ?? null, carrierType: twin?.dispatch?.carrierType ?? null }, null, 2));
    check(twin && twin.taskStatus === 'DISPATCHED', 'persisted state unchanged — target row still DISPATCHED', `tripId=${completeCandidates[0]?.dispatch?.tripId} taskStatus=${twin?.taskStatus}`);
  }
} catch (err) {
  log(`DRIVER ERROR: ${err?.message ?? err}`);
  failures += 1;
} finally {
  await browser.close();
}

log(`RESULT[${LABEL}]: ${failures === 0 ? 'ALL PASS' : `${failures} FAILURES`}`);
process.exit(failures === 0 ? 0 : 1);
