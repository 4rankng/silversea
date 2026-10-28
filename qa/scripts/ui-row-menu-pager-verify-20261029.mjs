// SIL-584 verify — /dispatch-detail @768 (also 390/1280): after scrolling the
// board's pane to its very end AND the page to its end, no
// .dispatch-row-menu__trigger rect intersects any .ds-pagination__btn, and
// BOTH controls are actually clickable (hit-test at each centre returns the
// control itself, not the other layer).
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7199';
const OUT = resolve('qa');
const log = [];
const say = (l) => { log.push(l); console.log(l); };
let checks = 0; const fails = [];
const check = (name, ok, detail = '') => {
  checks += 1;
  say(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};

mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 120000 });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 768, height: 1024 });
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle2' });
  await page.type('input[name="username"]', 'dungnv');
  await page.type('input[name="password"]', 'Abc123');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
  await new Promise((r) => setTimeout(r, 1200));
  say(`login → ${new URL(page.url()).pathname}`);

  for (const width of [768, 390, 1280]) {
    say(`step viewport ${width}`);
    await page.setViewport({ width, height: 1024 });
    say(`step goto ${width}`);
    await page.goto(`${FE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 2500));
    say(`step zero-scroll ${width}`);
    await page.evaluate(() => { const p = document.querySelector('.detailed-plan-grid__wrapper'); if (p) p.scrollTop = 0; });
    await new Promise((r) => setTimeout(r, 400));
    say(`step probe ${width}`);
    // Progressive card render grows the page after a single scroll — repeat
    // until the last trigger is actually inside the viewport (max 6 rounds).
    for (let round = 0; round < 6; round += 1) {
      await page.evaluate(() => {
        const pane = document.querySelector('.detailed-plan-grid__wrapper:not(.detailed-plan-grid__wrapper--cards)')
          ?? document.querySelector('.detailed-plan-grid__wrapper');
        if (pane) pane.scrollTop = pane.scrollHeight;
        const appBody = document.querySelector('.app-body');
        if (appBody) appBody.scrollTop = appBody.scrollHeight;
      });
      await new Promise((r) => setTimeout(r, 500));
      const done = await page.evaluate(() => {
        const trig = [...document.querySelectorAll('.dispatch-row-menu__trigger')].map((t) => t.getBoundingClientRect()).filter((r) => r.width > 0);
        const last = trig[trig.length - 1];
        return last ? last.bottom <= innerHeight && last.top >= 0 : true;
      });
      if (done) break;
    }
    await new Promise((r) => setTimeout(r, 400));
    const res = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('.ds-pagination__btn')].map((b) => ({ el: b, r: b.getBoundingClientRect() })).filter((x) => x.r.width > 0);
      const trig = [...document.querySelectorAll('.dispatch-row-menu__trigger')].map((t) => ({ el: t, r: t.getBoundingClientRect() })).filter((x) => x.r.width > 0);
      let worst = null;
      for (const { r } of trig) for (const b of btns) {
        const ix = Math.min(r.right, b.right) - Math.max(r.x, b.x);
        const iy = Math.min(r.bottom, b.bottom) - Math.max(r.y, b.y);
        if (ix > 0.5 && iy > 0.5 && (!worst || ix * iy > worst.ix * worst.iy)) worst = { ix: +ix.toFixed(1), iy: +iy.toFixed(1) };
      }
      // hit-test: the last trigger and a pagination button each answer for themselves
      const hitOf = (pair) => {
        if (!pair) return null;
        const c = pair.r;
        const el = document.elementFromPoint(c.x + c.width / 2, Math.min(c.y + c.height / 2, innerHeight - 1));
        return el ? { hitSelf: pair.el === el || pair.el.contains(el) || el.contains(pair.el), tag: `${el.tagName}.${String(el.className).slice(0, 30)}` } : null;
      };
      const pagBtn = btns[btns.length - 1] ?? null;
      return {
        trigCount: trig.length, btnCount: btns.length, worst,
        lastTriggerHit: hitOf(trig[trig.length - 1] ?? null),
        pagBtnHit: hitOf(pagBtn),
      };
    });
    say(`@${width}: triggers=${res.trigCount} pagBtns=${res.btnCount}`);
    check(`@${width} no trigger×pagination intersection`, res.worst == null, JSON.stringify(res.worst));
    if (res.trigCount > 0) check(`@${width} last row trigger clickable`, res.lastTriggerHit?.hitSelf === true, JSON.stringify(res.lastTriggerHit));
    if (res.btnCount > 0) check(`@${width} pagination button clickable`, res.pagBtnHit?.hitSelf === true, JSON.stringify(res.pagBtnHit));
    if (width === 768) await page.screenshot({ path: resolve(OUT, '2026-10-29_sil584_ui-detail-768-end.png') });
    if (width === 390) await page.screenshot({ path: resolve(OUT, '2026-10-29_sil584_ui-detail-390-end.png') });
    if (width === 1280) await page.screenshot({ path: resolve(OUT, '2026-10-29_sil584_ui-detail-1280-end.png') });
  }
} finally {
  await browser.close();
  writeFileSync(resolve(OUT, '2026-10-29_sil584_ui-driver.log'), log.join('\n'));
  say(`TOTAL ${checks - fails.length}/${checks} PASS`);
  if (fails.length) process.exit(1);
}
