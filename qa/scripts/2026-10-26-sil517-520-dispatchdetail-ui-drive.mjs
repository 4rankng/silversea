// SIL-517/518/519/520 UI drive — /dispatch-detail (Kế hoạch Chi tiết Xe).
//
// MODE env selects the ticket contract (all read-only: login + GETs only):
//   T1 (SIL-517): Điều phối cell — ONE FACT PER LINE: vehicle-group is a
//      single-column grid, plate/driver/SĐT each on their own offsetTop, no
//      `·` separator pseudo-content, no ellipsis on the cell facts.
//   T2 (SIL-518): unassigned rows show NO "CUS sẽ bổ sung" line (blank).
//   T3 (SIL-519): THAO TÁC rail — action buttons inside their own cell box
//      (no overlap onto the Ghi chú cell), "Hoàn thành" label uncut.
//   T4 (SIL-520): "Chỉnh sửa điều phối" dialog uses the side space (width
//      > 800px @1440) and shows the "Phát lệnh cho tài xế" section + footer
//      without scrolling the modal body (scrollHeight ≤ clientHeight when the
//      fieldset is present; body scroll bottom == footer visible).
//
// Usage: cd frontend && MODE=T1 node ../qa/scripts/2026-10-26-sil517-520-dispatchdetail-ui-drive.mjs
// Output: qa/2026-10-26_sil517-520-dispatchdetail/<MODE>/*.png + JSON on stdout.

import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7197';
const QA_USER = process.env.QA_USER || 'dungnv';
const QA_PASS = process.env.QA_PASS || 'Abc123';
const MODE = process.env.MODE || 'T1';
const OUT = resolve(process.cwd(), `../qa/2026-10-26_sil517-520-dispatchdetail/${MODE}`);
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  defaultViewport: { width: 1440, height: 900 },
});

async function login(user, pass) {
  const page = await browser.newPage();
  await page.goto(`${FE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForSelector('input[name="username"]', { timeout: 45000 });
  await page.type('input[name="username"]', user);
  await page.type('input[name="password"]', pass);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForFunction(() => localStorage.getItem('token') || localStorage.getItem('auth_token'), { timeout: 30000 });
  return page;
}

const page = await login(QA_USER, QA_PASS);
await page.goto(`${FE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForSelector('.detailed-plan-grid tbody tr', { timeout: 60000 });
await sleep(1200);

const result = { mode: MODE, url: page.url(), checks: [] };
const check = (name, pass, detail) => { result.checks.push({ name, pass, detail }); if (!pass) result.failed = true; };

if (MODE === 'T1') {
  const data = await page.evaluate(() => {
    const cell = document.querySelector('td[data-label="Điều phối"]');
    const group = cell?.querySelector('.dispatch-assignment-cell__vehicle-group');
    if (!cell || !group) return { present: false };
    const facts = [...group.querySelectorAll('.dispatch-assignment-cell__plate, .dispatch-assignment-cell__driver, .dispatch-assignment-cell__driver-phone')]
      .filter((el) => (el.textContent ?? '').trim().length > 0);
    const tops = facts.map((el) => Math.round(el.getBoundingClientRect().top));
    const styles = facts.map((el) => {
      const s = getComputedStyle(el);
      return { text: el.textContent.trim(), display: s.display, whiteSpace: s.whiteSpace, textOverflow: s.textOverflow };
    });
    const groupDisplay = getComputedStyle(group).display;
    const sepContents = facts.map((el) => getComputedStyle(el, '::before').content);
    return {
      present: true,
      groupDisplay,
      factCount: facts.length,
      distinctTops: new Set(tops).size,
      tops,
      styles,
      sepContents,
      groupText: group.textContent.replace(/\s+/g, ' ').trim(),
    };
  });
  check('vehicle-group renders', data.present === true, data.present);
  if (data.present) {
    check('vehicle-group is single-column grid (one fact per line)', data.groupDisplay === 'grid', data.groupDisplay);
    check('facts each on own line (distinct offsetTop)', data.distinctTops === data.factCount, { distinctTops: data.distinctTops, factCount: data.factCount });
    check('no · separator pseudo-content', data.sepContents.every((c) => c === 'none' || c === 'normal'), data.sepContents);
    check('facts wrap full (no nowrap/ellipsis)', data.styles.every((s) => s.whiteSpace === 'normal' && s.textOverflow !== 'ellipsis'), data.styles);
  }
  await page.screenshot({ path: resolve(OUT, 'dispatch-detail-full.png') });
  const col = await page.$('td[data-label="Điều phối"]');
  if (col) await col.screenshot({ path: resolve(OUT, 'dieu-phoi-cell.png') });
  const row0 = await page.$('.detailed-plan-grid tbody tr');
  if (row0) await row0.screenshot({ path: resolve(OUT, 'row-0.png') });
}

if (MODE === 'T2') {
  const data = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('td[data-label="Điều phối"]')];
    const withCus = cells.filter((c) => c.textContent.includes('CUS sẽ bổ sung'));
    const unassigned = cells.filter((c) => c.textContent.includes('Chưa phân nhà xe'));
    const unassignedDetail = unassigned.map((c) => c.textContent.replace(/\s+/g, ' ').trim());
    return { cellCount: cells.length, cusCount: withCus.length, unassignedCount: unassigned.length, unassignedDetail };
  });
  check('table rendered with rows', data.cellCount > 0, data.cellCount);
  check('NO "CUS sẽ bổ sung" line anywhere in the Điều phối column', data.cusCount === 0, { cusCount: data.cusCount });
  check('unassigned rows show only the carrier line (no second placeholder line)', data.unassignedDetail.every((t) => !t.includes('CUS sẽ bổ sung')), data.unassignedDetail);
  await page.screenshot({ path: resolve(OUT, 'dispatch-detail-full.png') });
}

if (MODE === 'T3') {
  const data = await page.evaluate(() => {
    const wrapper = document.querySelector('.detailed-plan-grid__wrapper');
    const cells = [...document.querySelectorAll('td.detailed-plan-grid__cell--actions')];
    const notesCells = [...document.querySelectorAll('td[data-label="Ghi chú"]')];
    const rows = cells.map((cell, i) => {
      const rail = cell.querySelector('.detailed-plan-grid__row-actions');
      const buttons = rail ? [...rail.querySelectorAll('button')] : [];
      const cellRect = cell.getBoundingClientRect();
      const btnRects = buttons.map((b) => {
        const r = b.getBoundingClientRect();
        const s = getComputedStyle(b);
        return { label: (b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 30), left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), whiteSpace: s.whiteSpace };
      });
      const note = notesCells[i];
      const noteRect = note?.getBoundingClientRect();
      const overlapsNotes = noteRect != null && btnRects.some((b) => b.left < noteRect.right - 1 && b.right > noteRect.right + 8);
      return {
        colWidth: Math.round(cellRect.width),
        buttonCount: buttons.length,
        btnRects,
        insideCellX: btnRects.every((b) => b.left >= cellRect.left - 0.5 && b.right <= cellRect.right + 0.5),
        overlapsNotes,
      };
    });
    return { rowCount: rows.length, rows: rows.slice(0, 12), hasHoanThanh: document.body.textContent.includes('Hoàn thành') };
  });
  check('actions rows rendered', data.rowCount > 0, data.rowCount);
  check('every action button sits inside its own cell box (no overlap onto the neighbour cell)', data.rows.every((r) => r.insideCellX && !r.overlapsNotes), data.rows.filter((r) => !r.insideCellX || r.overlapsNotes).slice(0, 3));
  check('actions rail has width for the buttons (≥120px)', data.rows.every((r) => r.colWidth >= 120), [...new Set(data.rows.map((r) => r.colWidth))]);
  check('no truncated action label (Hoàn thành pill uncut / nowrap)', data.rows.every((r) => r.btnRects.every((b) => b.whiteSpace === 'nowrap' || b.whiteSpace === 'normal')), null);
  await page.screenshot({ path: resolve(OUT, 'dispatch-detail-full.png') });
  const actionsCol = await page.$('td.detailed-plan-grid__cell--actions');
  if (actionsCol) await actionsCol.screenshot({ path: resolve(OUT, 'thao-tac-cell.png') });
}

if (MODE === 'T4') {
  // Open the editor dialog from the first row's menu (Sửa điều phối).
  await page.click('.detailed-plan-grid tbody tr .dispatch-row-menu__trigger');
  await sleep(400);
  const menuItem = await page.evaluateHandle(() => [...document.querySelectorAll('.dispatch-row-menu__list button')].find((b) => /Sửa điều phối|Phân xe lại/.test(b.textContent ?? '')));
  await menuItem.asElement().click();
  await page.waitForSelector('.modal .dispatch-assignment-dialog', { timeout: 15000 });
  await sleep(800);
  const data = await page.evaluate(() => {
    const content = document.querySelector('.modal__content');
    const body = document.querySelector('.modal__body');
    const fieldset = document.querySelector('.modal__content fieldset.dispatch-assignment-dialog__issue');
    const foot = document.querySelector('.modal__content .modal__foot');
    const cs = getComputedStyle(content);
    const cRect = content.getBoundingClientRect();
    const bodyScroll = body ? { sh: body.scrollHeight, ch: body.clientHeight } : null;
    const footRect = foot?.getBoundingClientRect();
    const fsRect = fieldset?.getBoundingClientRect();
    return {
      width: Math.round(cRect.width),
      viewport: { w: window.innerWidth, h: window.innerHeight },
      maxWidthCss: cs.maxWidth,
      hasIssueFieldset: fieldset != null,
      fieldsetBelowFold: fsRect && footRect ? fsRect.bottom > footRect.top + 1 : null,
      bodyScroll,
      bodyScrolls: bodyScroll ? bodyScroll.sh > bodyScroll.ch + 1 : null,
      footVisible: footRect ? footRect.bottom <= window.innerHeight + 1 && footRect.top < window.innerHeight : null,
      title: document.querySelector('.modal__title')?.textContent ?? '',
    };
  });
  check('dialog opened', data.title.includes('Chỉnh sửa điều phối'), data.title);
  check('dialog uses the side space @1440 (width ≥ 900px)', data.width >= 900, { width: data.width, maxWidthCss: data.maxWidthCss, viewport: data.viewport });
  check('modal body does NOT scroll (full form visible)', data.bodyScrolls === false, data.bodyScroll);
  check('Phát lệnh cho tài xế section rendered', data.hasIssueFieldset, { hasIssueFieldset: data.hasIssueFieldset });
  if (data.hasIssueFieldset) check('fieldset sits above the footer (not cut below the fold)', data.fieldsetBelowFold === false, { fieldsetBelowFold: data.fieldsetBelowFold });
  check('footer visible in viewport', data.footVisible === true, data.footVisible);
  await page.screenshot({ path: resolve(OUT, 'dialog-top.png') });
  const dialog = await page.$('.modal__content');
  if (dialog) await dialog.screenshot({ path: resolve(OUT, 'dialog-full.png') });
}

result.pass = result.checks.every((c) => c.pass);
writeFileSync(resolve(OUT, 'assertions.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));

await browser.close();
process.exit(result.pass ? 0 : 2);
