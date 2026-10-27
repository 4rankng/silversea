// SIL-523 (owner ruling 27/10) — rung-3 UI drive (AGENTS §9), sage-global reversal.
// Owner 27/10: sage #E3E8E5 is the GLOBAL page canvas again (--bg/--bg-1 at
// the tokens.css source), reversing the SIL-496 white ruling (ticket
// canceled). Cards/insets stay white on --surface. This drive proves the
// computed canvas (html, body, .app-main, .app-body) is rgb(227, 232, 229)
// while the content card (.customers-page / .cfg-page--customers
// .record-table-wrap) stays rgb(255, 255, 255) on /customers and
// /config/customers, at 1440 and 390. Read-only change: persisted-state
// identity = the customers API payload the pages render from (GET 200 + row
// count), no DB mutation.
// Stack: frontend http://localhost:7197 (this worktree) → backend :3002 → dev DB :5441.
import puppeteer from 'puppeteer-core';
import { mkdirSync, appendFileSync } from 'node:fs';

const BASE = 'http://localhost:7197';
const API = 'http://localhost:3002/api';
const ART = 'qa/2026-10-27_sil523-sage';
const LOG = `${ART}/2026-10-27_sil523-sage_ui-driver.log`;
mkdirSync(ART, { recursive: true });
const log = (line) => { const text = `${new Date().toISOString()} ${line}`; console.log(text); appendFileSync(LOG, `${text}\n`); };
appendFileSync(LOG, `\n=== run ${new Date().toISOString()} ===\n`);

const login = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
});
const { token } = await login.json();
log(`login admin: ${token ? 'OK' : 'FAIL'}`);
if (!token) process.exit(1);

// Read-only identity proof: the payload both pages render from.
const list = await fetch(`${API}/customers`, { headers: { Authorization: `Bearer ${token}` } });
const listBody = await list.json().catch(() => null);
log(`GET /api/customers: ${list.status} rows=${Array.isArray(listBody?.items) ? listBody.items.length : 'n/a'} total=${listBody?.total ?? 'n/a'}`);
if (list.status !== 200) process.exit(1);

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox'],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SAGE = 'rgb(227, 232, 229)';
const WHITE = 'rgb(255, 255, 255)';
const ROUTES = [
  { path: '/customers', canvas: '.customers-page', canvasLabel: '.customers-page (card)', name: 'customers' },
  { path: '/config/customers', canvas: '.cfg-page--customers .record-table-wrap', canvasLabel: '.record-table-wrap (card)', name: 'cfg-customers' },
];
const WIDTHS = [[1440, 900], [390, 844]];

let failures = 0;
try {
  for (const [width, height] of WIDTHS) {
    for (const route of ROUTES) {
      const page = await browser.newPage();
      await page.setViewport({ width, height });
      await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
      await page.goto(`${BASE}${route.path}`, { waitUntil: 'networkidle2', timeout: 30000 });
      await page.waitForSelector(route.canvas, { timeout: 20000 });
      await sleep(600);

      const probe = await page.evaluate((cardSel) => {
        const pick = (sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          return getComputedStyle(el).backgroundColor;
        };
        return {
          html: pick('html'),
          body: pick('body'),
          appMain: pick('.app-main'),
          appBody: pick('.app-body'),
          card: pick(cardSel),
        };
      }, route.canvas);

      const shot = `${ART}/2026-10-27_sil523-sage_ui-${route.name}-${width}.png`;
      await page.screenshot({ path: shot });

      const canvasLayers = { html: probe.html, body: probe.body, '.app-main': probe.appMain, '.app-body': probe.appBody };
      const badCanvas = Object.entries(canvasLayers).filter(([, v]) => v !== SAGE);
      const cardBad = probe.card !== WHITE;
      if (badCanvas.length > 0 || cardBad) failures += 1;
      log(`${route.path} @${width}: canvas ${badCanvas.length === 0 ? 'ALL SAGE' : 'FAIL'} ${JSON.stringify(canvasLayers)} | ${route.canvasLabel}=${probe.card} ${cardBad ? 'FAIL (want white)' : 'WHITE OK'} shot=${shot}`);
      if (badCanvas.length > 0) log(`  non-sage canvas: ${JSON.stringify(badCanvas)}`);
      await page.close();
    }
  }
} catch (err) {
  failures += 1;
  log(`DRIVER ERROR: ${err.message}`);
} finally {
  await browser.close();
}
log(failures === 0 ? 'RESULT: PASS — canvas rgb(227,232,229) on every ladder layer + white card, both routes, 1440+390' : `RESULT: FAIL — ${failures} probe(s) wrong`);
process.exit(failures === 0 ? 0 : 1);
