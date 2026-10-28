// SIL-581 verify — /dispatch master-plan grid @768: the warning line
// "Cảnh báo: Còn N/M cont chưa chốt ngày đóng trả" renders FULL TEXT (wraps
// inside its cell, scrollWidth == clientWidth, no ellipsis) — and @390 the
// card view keeps showing the full text. 1280 desktop stays one line.
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
const browser = await puppeteer.launch({ headless: 'new' });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle2' });
  await page.type('input[name="username"]', 'dungnv');
  await page.type('input[name="password"]', 'Abc123');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
  await new Promise((r) => setTimeout(r, 1200));
  say(`login → ${new URL(page.url()).pathname}`);

  const probeWarn = () => page.evaluate(() => {
    const warns = [...document.querySelectorAll('.master-plan-grid__line--warning, .mpcard__line--warning, [class*="--warning"]')]
      .filter((el) => (el.textContent || '').includes('chưa chốt'));
    return warns.slice(0, 6).map((el) => {
      const st = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const parent = el.parentElement;
      return {
        cls: el.className.toString().slice(0, 44),
        whiteSpace: st.whiteSpace,
        textOverflow: st.textOverflow,
        sw: el.scrollWidth,
        cw: el.clientWidth,
        parentW: parent ? parent.clientWidth : 0,
        fits: el.scrollWidth <= el.clientWidth,
        visibleText: (el.textContent || '').trim().slice(0, 60),
        rectW: +r.width.toFixed(1),
        rectH: +r.height.toFixed(1),
      };
    });
  });

  for (const width of [768, 390, 1280]) {
    await page.setViewport({ width, height: 1000 });
    await page.goto(`${FE}/dispatch`, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 2000));
    const warns = await probeWarn();
    say(`@${width}: ${warns.length} warning line(s)`);
    if (warns.length === 0) {
      say('  SKIP — no warning rows in current data');
      if (width === 768) await page.screenshot({ path: resolve(OUT, `2026-10-29_sil581_ui-dispatch-768-nowarn.png`) });
      continue;
    }
    for (const [i, w] of warns.entries()) {
      check(`@${width} warn#${i} no truncation (sw<=cw)`, w.fits, `sw=${w.sw} cw=${w.cw} ws=${w.whiteSpace} te=${w.textOverflow}`);
      check(`@${width} warn#${i} full text present`, w.visibleText.includes('chưa chốt ngày đóng trả'), w.visibleText);
    }
    if (width === 768) {
      // scroll the first warning row into view for the screenshot
      await page.evaluate(() => {
        const el = [...document.querySelectorAll('.master-plan-grid__line--warning')][0];
        el?.scrollIntoView({ block: 'center' });
      });
      await new Promise((r) => setTimeout(r, 400));
      await page.screenshot({ path: resolve(OUT, '2026-10-29_sil581_ui-dispatch-768-warn-wrapped.png') });
    }
    if (width === 390) await page.screenshot({ path: resolve(OUT, '2026-10-29_sil581_ui-dispatch-390-card.png') });
    if (width === 1280) await page.screenshot({ path: resolve(OUT, '2026-10-29_sil581_ui-dispatch-1280-grid.png') });
  }
} finally {
  await browser.close();
  writeFileSync(resolve(OUT, '2026-10-29_sil581_ui-driver.log'), log.join('\n'));
  say(`TOTAL ${checks - fails.length}/${checks} PASS`);
  if (fails.length) process.exit(1);
}
