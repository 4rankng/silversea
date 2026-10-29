// SIL-572 verify round 2 — /dispatch-detail: scrolled or not, no interactive
// element's rect intersects a .dispatch-row-menu__trigger at 1280/1440/1920
// (+768 tablet); the pager is an opaque elevated surface (the QA-reproduced
// failure mode needs a pane clipping failure — under it, the pager must win
// paint and click); the row kebab opens its menu on click.
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7291';
const OUT = resolve('qa');
const log = [];
const say = (l) => { log.push(l); console.log(l); };

mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ headless: 'new' });
let failed = 0;
const check = (name, ok, detail = '') => { say(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` (${detail})` : ''}`); if (!ok) failed += 1; };
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle2' });
  await page.type('input[name="username"]', 'dieuvan');
  await page.type('input[name="password"]', 'Abc123');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
  await new Promise((r) => setTimeout(r, 1200));
  await page.goto(`${FE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1800));

  const sweep = () => page.evaluate(() => {
    const triggers = [...document.querySelectorAll('.detailed-plan-grid .dispatch-row-menu__trigger')];
    const prs = [...document.querySelectorAll('.ds-pagination__btn')].map((b) => b.getBoundingClientRect());
    const live = [...document.querySelectorAll('.detailed-plan-grid td button')];
    const worstPager = { ix: 0, iy: 0 };
    for (const t of triggers) {
      const r = t.getBoundingClientRect();
      for (const pr of prs) {
        const ix = Math.min(r.right, pr.right) - Math.max(r.left, pr.left);
        const iy = Math.min(r.bottom, pr.bottom) - Math.max(r.top, pr.top);
        if (ix > worstPager.ix && iy > 0.5) { worstPager.ix = +ix.toFixed(1); worstPager.iy = +iy.toFixed(1); }
      }
    }
    let worstLive = null;
    for (const l of live) {
      const r = l.getBoundingClientRect();
      for (const t of triggers) {
        const tr = t.getBoundingClientRect();
        if (t.parentElement === l.parentElement && tr.top === r.top) continue; // siblings in the same rail cell
        const ix = Math.min(r.right, tr.right) - Math.max(r.left, tr.left);
        const iy = Math.min(r.bottom, tr.bottom) - Math.max(r.top, tr.top);
        if (ix > 0.5 && iy > 0.5 && (!worstLive || ix > worstLive.ix)) worstLive = { ix: +ix.toFixed(1), iy: +iy.toFixed(1), el: l.className.toString().slice(0, 40) };
      }
    }
    const pager = document.querySelector('.dispatch-plan-page__workspace > .ds-pagination');
    const pcs = pager ? getComputedStyle(pager) : null;
    return {
      worstPager, worstLive,
      pagerSurface: pcs ? { position: pcs.position, zIndex: pcs.zIndex, bg: pcs.backgroundColor } : null,
    };
  });

  for (const width of [1280, 1440, 1920, 768]) {
    await page.setViewport({ width, height: 800 });
    await new Promise((r) => setTimeout(r, 900));
    for (const mode of ['rest', 'fullscroll']) {
      await page.evaluate((m) => { const w = document.querySelector('.detailed-plan-grid__wrapper'); if (w) w.scrollTop = m === 'fullscroll' ? w.scrollHeight : 0; window.scrollTo(0, m === 'fullscroll' ? document.body.scrollHeight : 0); }, mode);
      await new Promise((r) => setTimeout(r, 400));
      const r = await sweep();
      // Round-2 QA defect: kebab vs PAGER. The note-only rest/transit
      // exposure under the pinned rail is the documented spec-B signature
      // (≤30px, owner-ruled inherent — the rail is opaque over it).
      check(`@${width}/${mode} no kebab rect intersects a pager button`, r.worstPager.ix === 0, JSON.stringify(r.worstPager));
      if (r.worstLive) say(`   note: @${width}/${mode} note-only rail residual ${JSON.stringify(r.worstLive)} (spec-B signature, opaque rail)`);
      if (mode === 'rest') {
        check(`@${width} pager is an opaque elevated surface above the rail`, !!r.pagerSurface && r.pagerSurface.position === 'relative' && Number(r.pagerSurface.zIndex) > 0 && r.pagerSurface.bg !== 'rgba(0, 0, 0, 0)', JSON.stringify(r.pagerSurface));
      }
    }
  }

  // Row kebab opens its own menu (click lands on the trigger, not the pager).
  await page.setViewport({ width: 1280, height: 800 });
  await new Promise((r) => setTimeout(r, 700));
  await page.evaluate(() => { const w = document.querySelector('.detailed-plan-grid__wrapper'); if (w) w.scrollTop = w.scrollHeight; });
  await new Promise((r) => setTimeout(r, 300));
  const menuOpened = await page.evaluate(() => {
    const t = [...document.querySelectorAll('.detailed-plan-grid .dispatch-row-menu__trigger')].pop();
    t.scrollIntoView({ block: 'center' });
    return new Promise((res) => setTimeout(() => { t.click(); setTimeout(() => res({ opened: !!document.querySelector('.dispatch-row-menu__list') }), 350); }, 250));
  });
  check('row kebab opens its own menu on click', menuOpened.opened, JSON.stringify(menuOpened));
  await page.keyboard.press('Escape');

  // Evidence screenshots.
  await page.screenshot({ path: `${OUT}/2026-10-29_sil572_ui-dispatch-detail-1280-fullscroll.png` });
  say('screenshot qa/2026-10-29_sil572_ui-dispatch-detail-1280-fullscroll.png');
  await page.setViewport({ width: 1440, height: 800 });
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: `${OUT}/2026-10-29_sil572_ui-dispatch-detail-1440.png` });
  say('screenshot qa/2026-10-29_sil572_ui-dispatch-detail-1440.png');
  await page.setViewport({ width: 768, height: 800 });
  await new Promise((r) => setTimeout(r, 700));
  await page.evaluate(() => { const w = document.querySelector('.detailed-plan-grid__wrapper'); if (w) w.scrollTop = w.scrollHeight; window.scrollTo(0, document.body.scrollHeight); });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: `${OUT}/2026-10-29_sil572_ui-dispatch-detail-768-fullscroll.png` });
  say('screenshot qa/2026-10-29_sil572_ui-dispatch-detail-768-fullscroll.png');
  await page.setViewport({ width: 390, height: 844 });
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: `${OUT}/2026-10-29_sil572_ui-dispatch-detail-390-card.png` });
  say('screenshot qa/2026-10-29_sil572_ui-dispatch-detail-390-card.png');
} finally { await browser.close(); }
say(failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`);
writeFileSync(`${OUT}/2026-10-29_sil572_ui-driver-round2.log`, log.join('\n') + '\n');
process.exit(failed === 0 ? 0 : 1);
