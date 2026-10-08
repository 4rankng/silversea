// Card 20261003_313 discriminator — raw-puppeteer input probe (NO agent-browser
// daemon). For each page × width: fresh load, capture-phase listeners installed
// at document start, then REAL trusted input (mouse click at the hit-tested
// control + keyboard into a field). Records per page:
//   - capture-phase counts for pointerdown/click/keydown (trusted events only
//     ever reach these; synthetic dispatch would, so ALL input here is CDP)
//   - what elementFromPoint returns at the click target (overlay check, AC2)
//   - whether the focused input received the typed characters.
// Usage: BASE=https://vantai.tingting.vip node input-probe-dispatch-20261003.mjs
import puppeteer from 'puppeteer';

const BASE = process.env.BASE || 'https://vantai.tingting.vip';
const IDENTIFIER = process.env.IDENTIFIER || 'admin';
const PASSWORD = process.env.PASSWORD || 'Abc123';
const WIDTHS = [1280, 1440];

const PAGES = [
  { name: 'dispatch', path: '/dispatch', inputSelector: 'input[type="search"], .filter-bar input:not([type="date"])' },
  { name: 'dispatch-detail', path: '/dispatch-detail', inputSelector: 'input[type="search"], .filter-bar input:not([type="date"])' },
  { name: 'accounting-control', path: '/accounting/invoice-tracking', inputSelector: 'input[type="search"], .filter-bar input:not([type="date"])' },
];

const browser = await puppeteer.launch({ headless: 'new' });
const results = [];

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  // Login once per origin (the SPA stores the token; every probe load reuses it).
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForSelector('input', { timeout: 20000 });
  await page.type('input', IDENTIFIER);
  const passwordField = await page.$('input[type="password"]');
  await passwordField.type(PASSWORD);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {}),
    page.keyboard.press('Enter'),
  ]);
  await new Promise(r => setTimeout(r, 2500));
  const loggedIn = (page.url()).includes('login') === false;
  if (!loggedIn) throw new Error('login did not stick');

  for (const width of WIDTHS) {
    for (const target of PAGES) {
      await page.setViewport({ width, height: 900 });
      // Fresh load; capture-phase recorder installs at document start.
      await page.evaluateOnNewDocument(() => {
        window.__probe = { pointerdown: 0, click: 0, keydown: 0 };
        for (const type of ['pointerdown', 'click', 'keydown']) {
          document.addEventListener(type, (event) => {
            if (event.isTrusted) window.__probe[type] += 1;
          }, { capture: true, passive: true });
        }
      });
      await page.goto(`${BASE}${target.path}`, { waitUntil: 'networkidle2', timeout: 60000 });
      await new Promise(r => setTimeout(r, 4000)); // mount + lazy chunks settle

      const probe = await page.evaluate((selector) => {
        const input = document.querySelector(selector);
        if (!input) return { found: false };
        const r = input.getBoundingClientRect();
        return {
          found: true,
          x: Math.round(r.x + r.width / 2),
          y: Math.round(r.y + r.height / 2),
          hit: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
            ? (() => { const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return `${el.tagName}.${String(el.className).split(' ').slice(0, 2).join('.')}`; })()
            : 'null',
        };
      }, target.inputSelector);

      let clicked = 'input-not-found';
      let typedEcho = '';
      if (probe.found) {
        // Real trusted input at the hit-tested coordinates.
        await page.mouse.move(probe.x, probe.y);
        await page.mouse.down();
        await page.mouse.up();
        await new Promise(r => setTimeout(r, 400));
        await page.keyboard.type('probe', { delay: 40 });
        await new Promise(r => setTimeout(r, 600));
        typedEcho = await page.evaluate((selector) => {
          const input = document.querySelector(selector);
          return input ? input.value : '(gone)';
        }, target.inputSelector);
        clicked = `clicked@${probe.x},${probe.y}`;
      }

      const counts = await page.evaluate(() => window.__probe);
      results.push({
        width, page: target.name, url: page.url().replace(BASE, ''),
        hit: probe.found ? probe.hit : 'input-not-found',
        clicked, typedEcho,
        capture: counts,
        verdict: counts.pointerdown > 0 && counts.keydown > 0 ? 'FIRES' : 'DEAD',
      });
      console.log(JSON.stringify(results[results.length - 1]));
    }
  }
} finally {
  const { writeFileSync } = await import('fs');
  writeFileSync('qa/2026-10-03_card313/probe-results.json', JSON.stringify(results, null, 2));
  await browser.close();
}
console.log('DONE');
