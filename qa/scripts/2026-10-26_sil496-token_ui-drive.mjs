// SIL-496 (QA round 2 FAIL) — rung-3 UI drive (AGENTS §9), token-source fix.
// Root cause round 2: the GLOBAL tokens --bg/--bg-1 stayed sage #E3E8E5 in
// src/styles/tokens.css, so every page-scoped override measured
// rgb(227,232,229) on the whole customers ladder of BOTH routes. Fix: the
// tokens are #FFFFFF at the source. This drive proves the computed
// background of every ladder layer (html, body, .app-main, .app-body, page
// root) is rgb(255, 255, 255) on /customers and /config/customers, at 1440
// and 390. Read-only change: persisted-state identity = the customers API
// payload the pages render from (GET 200 + row count), no DB mutation.
// Stack: frontend http://localhost:7197 (this worktree) → backend :3002 → dev DB :5441.
import puppeteer from 'puppeteer-core';
import { mkdirSync, appendFileSync } from 'node:fs';

const BASE = 'http://localhost:7197';
const API = 'http://localhost:3002/api';
const ART = 'qa/2026-10-26_sil496-token';
const LOG = `${ART}/2026-10-26_sil496-token_ui-driver.log`;
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

const WHITE = 'rgb(255, 255, 255)';
const ROUTES = [
  { path: '/customers', root: '.customers-page', name: 'customers' },
  { path: '/config/customers', root: '.cfg-page--customers', name: 'cfg-customers' },
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
      await page.waitForSelector(route.root, { timeout: 20000 });
      await sleep(600);

      const probe = await page.evaluate((rootSel) => {
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
          pageRoot: pick(rootSel),
          overscrollBand: getComputedStyle(document.documentElement).backgroundColor,
        };
      }, route.root);

      const shot = `${ART}/2026-10-26_sil496-token_ui-${route.name}-${width}.png`;
      await page.screenshot({ path: shot });

      const layers = { html: probe.html, body: probe.body, '.app-main': probe.appMain, '.app-body': probe.appBody, [route.root]: probe.pageRoot };
      const bad = Object.entries(layers).filter(([, v]) => v !== WHITE);
      if (bad.length > 0) failures += 1;
      log(`${route.path} @${width}: ${bad.length === 0 ? 'ALL LAYERS WHITE' : 'FAIL'} ${JSON.stringify(layers)} shot=${shot}`);
      if (bad.length > 0) log(`  non-white: ${JSON.stringify(bad)}`);
      await page.close();
    }
  }
} catch (err) {
  failures += 1;
  log(`DRIVER ERROR: ${err.message}`);
} finally {
  await browser.close();
}
log(failures === 0 ? 'RESULT: PASS — computed bg rgb(255,255,255) on every ladder layer, both routes, 1440+390' : `RESULT: FAIL — ${failures} probe(s) not white`);
process.exit(failures === 0 ? 0 : 1);
