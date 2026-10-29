// SIL-572 round 3 — /dispatch-detail: a trigger's bounding rect ignores the
// bounded pane's overflow clip, so rows parked below the fold report rects
// straight through the pager band at nearly every scroll offset (QA round-2
// evidence on build c2d740c5: kebab ∩ "Trang sau" 30×14/30×5/30×30 at
// 1280/1440/1920 with different rows lighting up per offset). The fix clears
// the rail band horizontally: pager controls are reserved one rail share
// (3.7% of max(1340px, width) + space-sm) of inline-end padding, so no
// trigger rect — visible, clipped or mid-transit — can share pixels with a
// pager control at ANY scroll offset. This driver sweeps the pane's FULL
// scroll range in fine steps (the QA repro condition), measures every
// trigger-vs-pager-control rect pair, proves the band separation
// structurally, keeps the opaque-surface contract, and clicks a visible
// kebab to prove the row menu still opens.
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7175';
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

  // Sweep measurement: EVERY trigger rect vs EVERY pager control rect, plus
  // the structural band proof (rightmost pager control must end left of the
  // actions rail's left edge) and the opaque-surface contract.
  const sweep = () => page.evaluate(() => {
    const triggers = [...document.querySelectorAll('.detailed-plan-grid .dispatch-row-menu__trigger, .detailed-plan-grid .detailed-plan-grid__note-action')];
    const prs = [...document.querySelectorAll('.dispatch-plan-page__workspace > .ds-pagination .ds-pagination__btn')]
      .map((b) => ({ el: b, r: b.getBoundingClientRect() })).filter((p) => p.r.width > 0);
    let worst = null;
    for (const t of triggers) {
      const r = t.getBoundingClientRect();
      for (const { el, r: pr } of prs) {
        const ix = Math.min(r.right, pr.right) - Math.max(r.left, pr.left);
        const iy = Math.min(r.bottom, pr.bottom) - Math.max(r.top, pr.top);
        if (ix > 0.5 && iy > 0.5 && (!worst || ix * iy > worst.area)) {
          worst = { ix: +ix.toFixed(1), iy: +iy.toFixed(1), area: +(ix * iy).toFixed(1), label: (t.getAttribute('aria-label') || t.className).toString().slice(0, 40) };
        }
      }
    }
    const band = document.querySelector('.detailed-plan-grid td.detailed-plan-grid__cell--actions');
    const controls = prs.map((p) => p.r);
    const pagerRight = controls.length ? Math.max(...controls.map((c) => c.right)) : null;
    const railLeft = band ? band.getBoundingClientRect().left : null;
    const pager = document.querySelector('.dispatch-plan-page__workspace > .ds-pagination');
    const pcs = pager ? getComputedStyle(pager) : null;
    return {
      worst,
      bandGap: pagerRight !== null && railLeft !== null ? +(railLeft - pagerRight).toFixed(1) : null,
      pagerSurface: pcs ? { position: pcs.position, zIndex: pcs.zIndex, bg: pcs.backgroundColor, padEnd: pcs.paddingRight } : null,
      triggerCount: triggers.length,
    };
  });

  for (const width of [1280, 1440, 1920, 768]) {
    await page.setViewport({ width, height: 800 });
    await new Promise((r) => setTimeout(r, 900));
    const info = await page.evaluate(() => {
      const w = document.querySelector('.detailed-plan-grid__wrapper');
      return w ? { sh: w.scrollHeight, ch: w.clientHeight } : { sh: 0, ch: 0 };
    });
    const steps = 10;
    let worstAcrossSweep = null;
    let minBandGap = Infinity;
    let r0 = { triggerCount: 0 };
    for (let i = 0; i <= steps; i += 1) {
      await page.evaluate(({ i, steps, sh }) => {
        const w = document.querySelector('.detailed-plan-grid__wrapper');
        if (w) w.scrollTop = Math.round((sh - w.clientHeight) * (i / steps));
        window.scrollTo(0, 0);
      }, { i, steps, sh: info.sh });
      await new Promise((r) => setTimeout(r, 220));
      const r = await sweep();
      if (i === 0) r0 = r;
      if (r.worst && (!worstAcrossSweep || r.worst.area > worstAcrossSweep.area)) worstAcrossSweep = r.worst;
      if (r.bandGap !== null) minBandGap = Math.min(minBandGap, r.bandGap);
    }
    check(`@${width} 0 trigger∩pager-control across 11 scroll offsets (x${info.sh > 0 ? Math.round(info.sh / Math.max(info.ch, 1)) : 1} panes of scroll)`, !worstAcrossSweep, worstAcrossSweep ? JSON.stringify(worstAcrossSweep) : `scanned ${r0.triggerCount} rail triggers per offset`);
    check(`@${width} pager controls clear the actions rail band at every offset (≥4px breathing room after sub-pixel rounding)`, minBandGap !== Infinity && minBandGap >= 4, `min gap ${minBandGap}px`);
  }

  // Opaque elevated surface contract (SIL-572 round 2, unchanged).
  {
    const r = await sweep();
    check('pager is an opaque elevated surface (relative + z>0 + opaque bg)', !!r.pagerSurface && r.pagerSurface.position === 'relative' && Number(r.pagerSurface.zIndex) > 0 && r.pagerSurface.bg !== 'rgba(0, 0, 0, 0)', JSON.stringify(r.pagerSurface));
  }

  // A visible kebab opens its own row menu on click.
  await page.setViewport({ width: 1280, height: 800 });
  await new Promise((r) => setTimeout(r, 700));
  const menuOpened = await page.evaluate(() => {
    const t = [...document.querySelectorAll('.detailed-plan-grid .dispatch-row-menu__trigger')][2];
    if (!t) return { opened: false, note: 'no trigger' };
    t.scrollIntoView({ block: 'center' });
    return new Promise((res) => setTimeout(() => { t.click(); setTimeout(() => res({ opened: !!document.querySelector('.dispatch-row-menu__list') }), 350); }, 250));
  });
  check('row kebab opens its own menu on click', menuOpened.opened, JSON.stringify(menuOpened));
  await page.keyboard.press('Escape');

  // Evidence screenshots: mid-scroll (the QA repro regime) at 1280 + 768.
  await page.setViewport({ width: 1280, height: 800 });
  await new Promise((r) => setTimeout(r, 700));
  await page.evaluate(() => { const w = document.querySelector('.detailed-plan-grid__wrapper'); if (w) w.scrollTop = Math.round((w.scrollHeight - w.clientHeight) * 0.45); window.scrollTo(0, document.body.scrollHeight); });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: `${OUT}/2026-10-30_sil572_ui-dispatch-detail-1280-midscroll.png` });
  say('screenshot qa/2026-10-30_sil572_ui-dispatch-detail-1280-midscroll.png');
  await page.setViewport({ width: 768, height: 800 });
  await new Promise((r) => setTimeout(r, 700));
  await page.evaluate(() => { const w = document.querySelector('.detailed-plan-grid__wrapper'); if (w) w.scrollTop = Math.round((w.scrollHeight - w.clientHeight) * 0.45); window.scrollTo(0, document.body.scrollHeight); });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: `${OUT}/2026-10-30_sil572_ui-dispatch-detail-768-midscroll.png` });
  say('screenshot qa/2026-10-30_sil572_ui-dispatch-detail-768-midscroll.png');
} finally { await browser.close(); }
say(failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`);
writeFileSync(`${OUT}/2026-10-30_sil572_ui-driver-round3.log`, log.join('\n') + '\n');
process.exit(failed === 0 ? 0 : 1);
