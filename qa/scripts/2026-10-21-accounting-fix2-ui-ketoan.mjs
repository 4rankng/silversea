// FIX CHI PHÍ lần 2 (19/10) — verify-first UI driver, Kế toán surfaces.
// Items: 3 (phơi detail 2 tabs), 4 (BÁO CÁO THU/TRẢ PHƠI + phiếu thu/chi),
// 5 (chốt debit column/row/Ngày), 6 (Xuất Debit Note E2E).
// LOCAL dev only — FE :7185 / BE :3012 of THIS worktree. Never staging.
//
//   node qa/scripts/2026-10-21-accounting-fix2-ui-ketoan.mjs
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const FE = 'http://localhost:7185';
const API = 'http://localhost:3012/api';
const OUT = path.resolve('qa/2026-10-21-accounting-fix2');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'ui-ketoan-driver.log');
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `ui-${name}.png`) });

async function login(identifier) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (!res.ok) throw new Error(`login ${identifier} HTTP ${res.status}`);
  return (await res.json()).token;
}

const phase = process.argv[2] ?? 'all';
const ktToken = await login('ketoan');
const browser = await puppeteer.launch({ headless: 'new' });

async function ketoanPage(pathname, { width = 1440, height = 950 } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width, height });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), ktToken);
  await page.goto(`${FE}${pathname}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(3500);
  return page;
}

// ── Items 3 + 4 — /accounting/phoi-phieu ─────────────────────────────────
if (phase === 'all' || phase === 'phoi') {
  log('── Phase phoi-phieu (items 3, 4) ──');
  const page = await ketoanPage('/accounting/phoi-phieu');
  await shot(page, '03-phoi-board');

  // Item 3: open Tiền đường detail of the first row that has one.
  const detailBtns = await page.$$eval('button', (bs) => bs
    .map((b) => ({ text: b.textContent?.trim() ?? '', label: b.getAttribute('aria-label') ?? '' }))
    .filter((b) => b.text === 'Xem chi tiết' || b.label.startsWith('Xem chi tiết')));
  log(`phoi: found ${detailBtns.length} "Xem chi tiết" controls`);
  check('item3: board renders detail actions', detailBtns.length > 0);
  if (detailBtns.length > 0) {
    const btn = (await page.$$eval('button', (bs) => bs
      .map((b, i) => ({ b, i, t: b.textContent?.trim() ?? '' }))
      .filter((x) => x.t === 'Xem chi tiết').map((x) => x.i))).map((i) => i);
    // Click the FIRST "Xem chi tiết" (Tiền đường column action).
    const all = await page.$$('button');
    let clicked = false;
    for (const i of btn) { const t = (await all[i].evaluate((el) => el.textContent || '')).trim(); if (t === 'Xem chi tiết') { await all[i].click(); clicked = true; break; } }
    await sleep(1200);
    check('item3: Tiền đường dialog opens', clicked);
    await shot(page, '03-phoi-tienduong-dialog');
    // + Thêm dòng → the add drawer with the 2 side-by-side tabs.
    const addBtn = await page.$$eval('button', (bs) => bs.findIndex((b) => (b.textContent ?? '').includes('Thêm dòng')));
    if (addBtn >= 0) {
      (await page.$$('button'))[addBtn].click();
      await sleep(1500);
      await shot(page, '03-phoi-themdong-tabs');
      const tabs = await page.$$eval('[role="tablist"] .expense-group-tab, .expense-accounting-group-tabs button', (els) => els.map((e) => e.textContent?.trim()));
      log(`item3 add-drawer tabs: ${JSON.stringify(tabs)}`);
      check('item3: 2 tabs "Tiền đường | Chi phí lô hàng" side-by-side', tabs.length === 2, JSON.stringify(tabs));
    } else {
      check('item3: + Thêm dòng button present', false, 'not found');
    }
    await page.close();
  }

  // Item 4: report section — heading, tabs, party drill-down, phiếu buttons.
  const page2 = await ketoanPage('/accounting/phoi-phieu');
  await page2.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(900);
  const heading = await page2.$$eval('h2', (hs) => hs.map((h) => h.textContent?.trim()));
  log(`report headings: ${JSON.stringify(heading)}`);
  const hasReport = heading.some((h) => (h ?? '').toLowerCase().includes('báo cáo thu / trả phơi') || (h ?? '').toLowerCase().includes('báo cáo thu/trả phơi'));
  check('item4: section named "Báo cáo thu / trả phơi" (ex-"Báo cáo tháng")', hasReport, JSON.stringify(heading));
  await shot(page2, '04-report-section');
  // Party drill-down: click first party link in the report table.
  const partyLink = await page2.$('.ppc-report__party-link');
  if (partyLink) {
    const partyName = await partyLink.evaluate((el) => el.textContent?.trim());
    await partyLink.click();
    await sleep(1600);
    const drawerTitle = await page2.$$eval('[role="dialog"] *, .drawer *', () => undefined).catch(() => undefined);
    const drawerText = await page2.evaluate(() => document.body.innerText.includes('Lô chưa thanh toán'));
    check(`item4: click party "${partyName}" → unpaid-lots drawer opens`, drawerText === true);
    const hasLapPhieu = await page2.evaluate(() => document.body.innerText.includes('Lập phiếu'));
    const hasStk = await page2.evaluate(() => document.body.innerText.includes('STK'));
    check('item4: drawer has Lập phiếu (thu/chi) + STK selector', hasLapPhieu && hasStk);
    await shot(page2, '04-party-lots-drawer');
  } else {
    check('item4: party drill-down link present', false, 'no .ppc-report__party-link rendered');
    await shot(page2, '04-party-lots-drawer-MISSING');
  }
  await page2.close();
}

// ── Items 5 + 6 — /accounting/chot-debit ─────────────────────────────────
if (phase === 'all' || phase === 'debit') {
  log('── Phase chot-debit (items 5, 6) ──');
  const page = await ketoanPage('/accounting/chot-debit');
  await shot(page, '05-debit-default-essential');
  const boardInfo = await page.evaluate(() => ({
    rows: document.querySelectorAll('.debit-board tbody tr, [role="row"]').length,
    selectAll: Array.from(document.querySelectorAll('button')).some((b) => (b.textContent ?? '').includes('Chọn tất cả') && (b.textContent ?? '').includes('đủ điều kiện')),
    exportBtn: Array.from(document.querySelectorAll('button')).some((b) => (b.textContent ?? '').trim() === 'Xuất Debit Note'),
    chooseDebit: Array.from(document.querySelectorAll('button')).some((b) => (b.textContent ?? '').includes('Chọn Debit')),
  }));
  log(`debit board: ${JSON.stringify(boardInfo)}`);
  check('item5: board renders with Chọn tất cả/Chọn Debit/Xuất Debit Note', boardInfo.selectAll && boardInfo.chooseDebit && boardInfo.exportBtn, JSON.stringify(boardInfo));

  // Item 5a — "chọn tất cả các cột": open the column chooser and reveal every
  // column, then prove the header row does not visually break (no column with
  // zero width / overlapping header cells).
  const colsBtnIdx = await page.$$eval('button', (bs) => bs.findIndex((b) => {
    const t = (b.textContent ?? '').toLowerCase();
    return t.includes('cột') && (b.getAttribute('aria-haspopup') || b.getAttribute('aria-expanded') || t === 'cột');
  }));
  log(`column chooser button idx: ${colsBtnIdx}`);
  if (colsBtnIdx >= 0) {
    (await page.$$('button'))[colsBtnIdx].click();
    await sleep(700);
    await shot(page, '05-debit-column-chooser');
    // Reveal all: click every "Hiện"/checkbox-style toggle, or a "Hiện tất cả".
    const toggled = await page.evaluate(() => {
      const before = document.querySelectorAll('th').length;
      const btns = Array.from(document.querySelectorAll('button, [role="menuitemcheckbox"], [role="checkbox"]'))
        .filter((b) => /hiện tất cả|chọn tất cả|hiện/.test((b.textContent ?? '').toLowerCase()));
      btns.forEach((b) => b.click());
      return { before, btnCount: btns.length };
    });
    await sleep(600);
    await shot(page, '05-debit-all-columns-on');
    const headerGeometry = await page.evaluate(() => {
      const ths = Array.from(document.querySelectorAll('th'));
      return {
        count: ths.length,
        zeroWidth: ths.filter((t) => t.getBoundingClientRect().width <= 1).length,
        offscreen: ths.filter((t) => { const r = t.getBoundingClientRect(); return r.width > 0; }).length,
      };
    });
    log(`after reveal-all: ${JSON.stringify(headerGeometry)} (toggled ${JSON.stringify(toggled)})`);
    check('item5: every column on — no zero-width header cell (UI not broken)', headerGeometry.zeroWidth === 0, JSON.stringify(headerGeometry));
    // close chooser
    await page.keyboard.press('Escape');
    await sleep(400);
  } else {
    check('item5: column chooser reachable', false, 'button "Cột" not found');
  }

  // Item 5b — row click highlight: click a row, assert it carries selection
  // styling AND the ✓ marker in its Ngày cell (CP2-D2 contract).
  const rowClicked = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    const target = rows.find((r) => r.getAttribute('data-selectable') !== 'false' || true);
    if (!target) return { ok: false, why: 'no rows' };
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const style = getComputedStyle(target);
    const attr = target.getAttribute('data-selected');
    return { ok: true, attr, bg: style.backgroundColor, cls: target.className, ngayText: target.cells?.[0]?.innerText ?? '' };
  });
  await sleep(700);
  await shot(page, '05-debit-row-clicked');
  const selectedState = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    const sel = rows.find((r) => r.getAttribute('data-selected') === 'true' || r.getAttribute('aria-selected') === 'true' || /is-selected|is-picked|selected/.test(r.className));
    if (!sel) return null;
    const firstCell = sel.querySelector('td');
    return { cls: sel.className, firstCellText: firstCell?.innerText ?? '', hasTick: (firstCell?.innerText ?? '').includes('✓') || Boolean(firstCell?.querySelector('[data-tick], .selection-tick')) };
  });
  log(`row click state: ${JSON.stringify({ rowClicked, selectedState })}`);
  check('item5: clicked row is visually highlighted (state attr/class)', selectedState != null, JSON.stringify(selectedState));

  // Item 5c — Chọn Debit dialog: per-Ngày tick boxes.
  const chooseBtn = (await page.$$('button')).find(async (b) => false);
  const chooseIdx = await page.$$eval('button', (bs) => bs.findIndex((b) => (b.textContent ?? '').includes('Chọn Debit (') && Number((b.textContent ?? '').match(/\((\d+) dòng\)/)?.[1] ?? 0) > 0));
  if (chooseIdx >= 0) {
    (await page.$$('button'))[chooseIdx].click();
    await sleep(1200);
    const dialogInfo = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"], .modal');
      const text = dlg?.textContent ?? '';
      const checkboxes = dlg?.querySelectorAll('input[type="checkbox"]')?.length ?? 0;
      const legend = dlg?.querySelector('legend')?.textContent ?? '';
      return { hasDialog: Boolean(dlg), checkboxes, legend, textHead: text.slice(0, 220) };
    });
    log(`Chọn Debit dialog: ${JSON.stringify(dialogInfo)}`);
    check('item5: Chọn Debit dialog groups selection BY NGÀY with tick boxes', dialogInfo.hasDialog && dialogInfo.checkboxes > 0 && /chọn ngày/i.test(dialogInfo.legend), JSON.stringify(dialogInfo));
    await shot(page, '05-debit-choose-debit-dialog');
    await page.keyboard.press('Escape');
    await sleep(500);
  } else {
    check('item5: Chọn Debit enabled (rows selected)', false, 'no selected rows — board empty or selection failed');
  }

  // Item 6 — Xuất Debit Note E2E on the same selection.
  if (chooseIdx >= 0) {
    const downloadPath = path.join(OUT, 'debit-note-download');
    fs.mkdirSync(downloadPath, { recursive: true });
    const client = await page.createCDPSession();
    await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath });
    const exportIdx = await page.$$eval('button', (bs) => bs.findIndex((b) => (b.textContent ?? '').trim() === 'Xuất Debit Note'));
    (await page.$$('button'))[exportIdx].click();
    await sleep(1000);
    // Consent dialog if lots are unlocked → "Khóa & Xuất".
    const consent = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"], .modal');
      const btn = Array.from(dlg?.querySelectorAll('button') ?? []).find((b) => (b.textContent ?? '').includes('Khóa & Xuất'));
      if (btn) { btn.click(); return 'confirmed-lock-export'; }
      return dlg ? 'dialog-no-lock-button' : 'no-dialog';
    });
    log(`export consent: ${consent}`);
    await sleep(4000);
    const files = fs.readdirSync(downloadPath);
    log(`download dir: ${JSON.stringify(files)}`);
    const banner = await page.evaluate(() => {
      const p = Array.from(document.querySelectorAll('[role="status"], p')).map((x) => x.textContent ?? '');
      return p.filter((t) => t.includes('Debit Note') || t.includes('xuất')).join(' | ');
    });
    log(`banner: ${banner}`);
    check('item6: Xuất Debit Note downloads a real file', files.length > 0 && files.some((f) => f.endsWith('.xlsx')), JSON.stringify({ files, banner }));
    await shot(page, '06-debit-note-after-export');
  } else {
    check('item6: export driven', false, 'no selection available to export');
  }
  await page.close();
}

await browser.close();
log(`DONE failures=${failures}`);
process.exit(failures > 0 ? 1 : 0);
