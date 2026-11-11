// qa/scripts/2026-11-11-r16b-sil798-driver-accept.mjs — the DRIVER leg only:
// laixe opens the fresh CREATED order (TRP-202611-0232) and presses
// "Nhận lệnh vận chuyển"; two IN_TRANSIT trips hold the rig → 409
// DRIVER_TRIP_BLOCKED → banner must NAME + LINK the blocking trip and the
// button must NOT show a success face.
import { chromium } from '../../frontend/node_modules/@playwright/test/index.mjs';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = 'http://localhost:7175';
const OUT = resolve(process.cwd(), 'qa/2026-11-11_r16b-dispatch-ui');
mkdirSync(OUT, { recursive: true });
const log = (m) => console.log(m);
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const api409 = [];
  page.on('response', async (r) => {
    if (r.status() === 409) {
      let body = '';
      try { body = (await r.text()).slice(0, 300); } catch { /* stream closed */ }
      api409.push(`${r.status()} ${r.url().slice(0, 120)} :: ${body}`);
    }
  });
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="username"]', 'laixe');
  await page.fill('input[name="password"]', 'Abc123');
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !page.url().includes('login'), { timeout: 20000 });
  await page.goto(`${FE}/my-trips`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/sil798-06-driver-board.png` });
  const order = await page.evaluate(() => {
    const links = [...document.querySelectorAll('a[href^="/my-trips/"]')];
    const withLabel = links.map((a) => ({ href: a.getAttribute('href'), text: a.textContent.replace(/\s+/g, ' ').slice(0, 60) }));
    return withLabel;
  });
  log('driver cards: ' + JSON.stringify(order.slice(0, 6)));
  log('board probe: ' + (await page.evaluate(() => {
    const any = document.body.textContent.replace(/\s+/g, ' ').slice(0, 300);
    const rows = [...document.querySelectorAll('[class*="journey"], [class*="trip-card"], [class*="card"]')].slice(0, 6).map((el) => el.className.slice(0, 60) + ' :: ' + el.textContent.replace(/\s+/g, ' ').slice(0, 50));
    return JSON.stringify({ url: location.pathname, head: any, rows });
  })));
  // FB-014: the board's rows are click handlers, not anchors — open the new
  // order by its Số Bill card (the freshly issued SIL676 lot).
  // Dump what the new-order panel actually renders, then click by coordinates
  // of the matched text node (row is a plain div with onClick — FB-014).
  log('panel probe: ' + (await page.evaluate(() => {
    const tab = [...document.querySelectorAll('[role="tab"], .driver-journey__tab')].find((t) => t.textContent.includes('Lệnh mới'));
    return JSON.stringify({
      tabFound: Boolean(tab),
      panelHtml: document.querySelector('[role="tabpanel"], .driver-journey__panel')?.innerHTML.replace(/\s+/g, ' ').slice(0, 400) ?? null,
    });
  })));
  const card = page.locator('article[class*="journey-card"]', { hasText: 'SIL676QA' }).first();
  const cardCount = await page.locator('article[class*="journey-card"]').count();
  log(`cards visible: ${cardCount}`);
  log('card anatomy: ' + (await page.evaluate(() => {
    const card = [...document.querySelectorAll('article[class*="journey-card"]')].find((c) => c.textContent.includes('SIL676QA'));
    if (!card) return 'no card';
    return JSON.stringify({
      tag: card.tagName,
      tabIndex: card.getAttribute('tabindex'),
      buttons: [...card.querySelectorAll('button, a')].map((b) => b.textContent.trim().slice(0, 20) || b.getAttribute('aria-label')),
      cls: card.className.slice(0, 80),
    });
  })));
  await card.locator('button', { hasText: 'Xem chi tiết' }).click({ timeout: 10000 });
  await page.waitForTimeout(1500);
  log('post-click url: ' + page.url());
  if (!/my-trips\/\d+/.test(page.url())) throw new Error('card click did not navigate: ' + page.url());
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/sil798-07-order-idle.png` });
  const idleFace = await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="accept-sticky-bar"] button');
    if (!btn) return null;
    const cs = getComputedStyle(btn);
    return { bg: cs.backgroundColor, label: btn.textContent.trim(), hasSuccessCheck: /M9 12l2 2 4-4|M20 6L9 17l-5-5/.test(btn.innerHTML) };
  });
  log('IDLE FACE ' + JSON.stringify(idleFace));

  await page.locator('[data-testid="accept-sticky-bar"] button').click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/sil798-08-after-accept.png` });
  const banner = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="blocking-trip-banner"]');
    if (!el) return { absent: true };
    return {
      text: el.textContent.replace(/\s+/g, ' ').slice(0, 220),
      links: [...el.querySelectorAll('a')].map((a) => ({ href: a.getAttribute('href'), label: a.textContent.trim() })),
      leaksInternalCode: /TRP-|SHP-2611-00/.test(el.textContent),
    };
  });
  log('BANNER ' + JSON.stringify(banner));
  log('API409 ' + JSON.stringify(api409));
  if (banner.links?.[0]) {
    await page.locator('[data-testid="blocking-trip-banner"] a').first().click();
    await page.waitForTimeout(1500);
    log('banner link lands on: ' + page.url());
    await page.screenshot({ path: `${OUT}/sil798-09-blocking-trip-opened.png` });
  }
} finally {
  await browser.close();
}
