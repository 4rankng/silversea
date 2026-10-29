// SIL-571/578 + 572 + 582 probe — measure the LIVE geometry of the three
// QA-failed defects on this branch before fixing:
//  A. /shipments sort-button pair intersections + per-column button-vs-th widths
//  B. /dispatch-detail trigger rects vs the pager "Trang sau" button
//  C. /shipments-debit @390 meta-line scrollWidth vs clientWidth
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7291';
const OUT = resolve('qa');
const log = [];
const say = (l) => { log.push(l); console.log(l); };

mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ headless: 'new' });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle2' });
  await page.type('input[name="username"]', 'admin');
  await page.type('input[name="password"]', 'Abc123');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
  await new Promise((r) => setTimeout(r, 1200));
  say(`login → ${new URL(page.url()).pathname}`);

  // ── A. /shipments sort buttons ──────────────────────────────────────────
  await page.goto(`${FE}/shipments`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1600));
  const shipSweep = () => page.evaluate(() => {
    const ths = [...document.querySelectorAll('.cus-dashboard-table thead th')];
    const btns = [...document.querySelectorAll('.cus-dashboard-table thead .table-sort-button')];
    const rects = btns.map((b) => b.getBoundingClientRect());
    const pairs = [];
    for (let i = 0; i < rects.length - 1; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i]; const b = rects[j];
        const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ix > 0.5 && iy > 0.5) pairs.push({ ix: +ix.toFixed(1), iy: +iy.toFixed(1), i: btns[i].textContent.trim().slice(0, 30), j: btns[j].textContent.trim().slice(0, 30) });
      }
    }
    const viewport = document.querySelector('.cus-dashboard-viewport');
    return {
      pairs,
      colWidths: ths.map((th) => ({ label: th.textContent.trim().slice(0, 24), w: +th.getBoundingClientRect().width.toFixed(1) })),
      btnWidths: btns.map((b) => ({ label: b.textContent.trim().slice(0, 24), w: +b.getBoundingClientRect().width.toFixed(1) })),
      overflowX: viewport ? getComputedStyle(viewport).overflowX : null,
      hScroll: viewport ? viewport.scrollWidth > viewport.clientWidth : null,
      tableW: +(document.querySelector('.cus-dashboard-table')?.getBoundingClientRect().width ?? 0).toFixed(1),
    };
  });
  for (const width of [1024, 1280, 1366, 1440, 1920]) {
    await page.setViewport({ width, height: 800 });
    await new Promise((r) => setTimeout(r, 900));
    say(`A /shipments @${width}: ${JSON.stringify(await shipSweep())}`);
  }

  // ── B. /dispatch-detail trigger vs pager ────────────────────────────────
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`${FE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1800));
  const dispProbe = () => page.evaluate(() => {
    const triggers = [...document.querySelectorAll('.detailed-plan-grid .dispatch-row-menu__trigger')];
    const pager = [...document.querySelectorAll('.ds-pagination__btn')].find((b) => b.getAttribute('aria-label') === 'Trang sau');
    const pr = pager?.getBoundingClientRect();
    const wrapper = document.querySelector('.detailed-plan-grid__wrapper');
    const wr = wrapper?.getBoundingClientRect();
    const hits = [];
    for (const t of triggers) {
      const r = t.getBoundingClientRect();
      const ix = Math.min(r.right, pr?.right ?? -1) - Math.max(r.left, pr?.left ?? -1);
      const iy = Math.min(r.bottom, pr?.bottom ?? -1) - Math.max(r.top, pr?.top ?? -1);
      if (pr && ix > 0.5 && iy > 0.5) {
        const row = t.closest('tr');
        hits.push({ ix: +ix.toFixed(1), iy: +iy.toFixed(1), rowLabel: row?.cells[1]?.textContent.trim().slice(0, 26), trigTop: +r.top.toFixed(1), trigBottom: +r.bottom.toFixed(1) });
      }
    }
    const lastRow = document.querySelector('.detailed-plan-grid tbody tr:last-child');
    const lr = lastRow?.getBoundingClientRect();
    return {
      paneBottom: wr ? +wr.bottom.toFixed(1) : null,
      paneScrollTop: wrapper?.scrollTop ?? null,
      paneScrollH: wrapper?.scrollHeight ?? null,
      paneClientH: wrapper?.clientHeight ?? null,
      pagerTop: pr ? +pr.top.toFixed(1) : null,
      pagerBottom: pr ? +pr.bottom.toFixed(1) : null,
      lastRowBottom: lr ? +lr.bottom.toFixed(1) : null,
      hits,
      triggerCount: triggers.length,
    };
  });
  for (const width of [1280, 1440, 768]) {
    await page.setViewport({ width, height: 800 });
    await new Promise((r) => setTimeout(r, 900));
    // vertical pane scroll to the bottom (QA: "cuộn hết")
    await page.evaluate(() => { const w = document.querySelector('.detailed-plan-grid__wrapper'); if (w) w.scrollTop = w.scrollHeight; });
    await new Promise((r) => setTimeout(r, 400));
    say(`B /dispatch-detail @${width} pane-fullscroll: ${JSON.stringify(await dispProbe())}`);
    await page.evaluate(() => { const w = document.querySelector('.detailed-plan-grid__wrapper'); if (w) w.scrollTop = 0; });
    await new Promise((r) => setTimeout(r, 300));
    say(`B /dispatch-detail @${width} pane-rest: ${JSON.stringify(await dispProbe())}`);
  }

  // ── C. /shipments-debit @390 meta lines ─────────────────────────────────
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${FE}/shipments-debit`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1800));
  const metaProbe = () => page.evaluate(() => {
    const metas = [...document.querySelectorAll('.ledger-glist__meta')];
    return metas.map((m) => {
      const cs = getComputedStyle(m);
      return {
        text: m.textContent.trim().slice(0, 44),
        sw: m.scrollWidth, cw: m.clientWidth,
        whiteSpace: cs.whiteSpace, overflow: cs.overflow, tlo: cs.textOverflow,
        clipped: m.scrollWidth > m.clientWidth,
      };
    });
  });
  say(`C /shipments-debit @390 metas: ${JSON.stringify(await metaProbe(), null, 1)}`);
} finally { await browser.close(); }
writeFileSync(`${OUT}/2026-10-29_sil-overlap2_probe.log`, log.join('\n') + '\n');
say('probe log → qa/2026-10-29_sil-overlap2_probe.log');
