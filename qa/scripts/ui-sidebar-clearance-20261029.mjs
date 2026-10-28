// SIL-570 verify — collapsed sidebar nav can no longer park beneath the pinned
// user footer: the scroller carries one footer-height of bottom reserve, the
// footer paints opaque, and a scrolled-to-bottom last item keeps clear of the
// .sidebar-user rect at 1280×800 and 1024×768.
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7285';
const OUT = resolve('qa');
const log = [];
const say = (l) => { log.push(l); console.log(l); };

mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ headless: 'new' });
const results = {};
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle2' });
  await page.type('input[name="username"]', 'admin');
  await page.type('input[name="password"]', 'Abc123');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
  await new Promise((r) => setTimeout(r, 1200));
  await page.goto(`${FE}/shipments`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1500));

  const measure = (label) => page.evaluate((lbl) => {
    const nav = document.querySelector('.sidebar-nav');
    const user = document.querySelector('.sidebar-user');
    const footer = document.querySelector('.sidebar-footer');
    const items = [...document.querySelectorAll('.sidebar-item')];
    const last = items[items.length - 1];
    nav.scrollTop = nav.scrollHeight;
    return new Promise((res) => setTimeout(() => {
      const u = user.getBoundingClientRect();
      const b = last.getBoundingClientRect();
      const f = footer.getBoundingClientRect();
      // interactive reachability at the footer's center: must be the footer (or its content), never a nav item
      const hit = document.elementFromPoint(f.x + f.width / 2, f.y + f.height / 2);
      res({
        label: lbl,
        lastItemY: +b.y.toFixed(1), lastItemBottom: +(b.y + b.height).toFixed(1),
        userY: +u.y.toFixed(1),
        clearOfUser: b.y + b.height <= u.y + 0.5,
        footerBackground: getComputedStyle(footer).backgroundColor,
        navPaddingBottom: getComputedStyle(nav).paddingBottom,
        footerHitBy: hit ? `${hit.tagName}.${String(hit.className).slice(0, 36)}` : 'none',
        scrollBottomGap: +(f.y - (b.y + b.height)).toFixed(1),
      });
    }, 350));
  }, label);

  results.at1280 = await measure('collapsed-1280x800');
  say(`@1280: ${JSON.stringify(results.at1280)}`);
  await page.screenshot({ path: `${OUT}/2026-10-29_sil570_ui-sidebar-1280.png` });
  say('screenshot qa/2026-10-29_sil570_ui-sidebar-1280.png');

  await page.setViewport({ width: 1024, height: 768 });
  await new Promise((r) => setTimeout(r, 600));
  results.at1024 = await measure('collapsed-1024x768');
  say(`@1024: ${JSON.stringify(results.at1024)}`);
  await page.screenshot({ path: `${OUT}/2026-10-29_sil570_ui-sidebar-1024.png` });
  say('screenshot qa/2026-10-29_sil570_ui-sidebar-1024.png');
} finally { await browser.close(); }

const checks = [
  ['@1280 scrolled-to-bottom item clear of .sidebar-user', results.at1280?.clearOfUser === true],
  ['@1280 footer paints opaque (sb gradient end)', results.at1280?.footerBackground === 'rgb(7, 55, 44)' || /rgb\(\d+, \d+, \d+\)/.test(results.at1280?.footerBackground ?? '')],
  ['@1280 nav carries the reserve padding (collapsed rail: reserve+8)', (results.at1280?.navPaddingBottom ?? '').startsWith('80px')],
  ['@1280 footer center hit-test is footer content, not a nav item', !/sidebar-item/.test(results.at1280?.footerHitBy ?? 'sidebar-item')],
  ['@1024 scrolled-to-bottom item clear of .sidebar-user', results.at1024?.clearOfUser === true],
  ['@1024 nav carries the reserve padding', (results.at1024?.navPaddingBottom ?? '').startsWith('80px')],
  ['@1024 footer center hit-test is footer content, not a nav item', !/sidebar-item/.test(results.at1024?.footerHitBy ?? 'sidebar-item')],
];
let failed = 0;
for (const [name, ok] of checks) { say(`${ok ? 'PASS' : 'FAIL'} — ${name}`); if (!ok) failed += 1; }
say(failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`);
writeFileSync(`${OUT}/2026-10-29_sil570_ui-driver.log`, log.join('\n') + '\n');
process.exit(failed === 0 ? 0 : 1);
