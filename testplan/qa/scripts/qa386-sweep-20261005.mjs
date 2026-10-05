// Card 386 — money-column wrap sweep: for every screen with money columns,
// measure each money-pattern cell at 1280/1440/1920/2560 and flag any that
// would wrap mid-number (nowrap width exceeds current client width).
// Read-only: transient style tweaks are restored within the same evaluate.
import { loginApi, launch, shot, setViewport, logEvidence, sleep } from './qa-20261005-lib.mjs';

const EV = '/Volumes/LexarSSD/projects/silversea-prod/testplan/qa/evidence/2026-10-05_card386-money-wrap-sweep';
const BASE = 'http://localhost:7175';
const SCREENS = [
  ['invoice-tracking', '/accounting/invoice-tracking'],
  ['phoi-phieu', '/accounting/phoi-phieu'],
  ['chot-debit', '/accounting/chot-debit'],
  ['debt', '/debt'],
  ['payables', '/payables'],
  ['deposit-tracker', '/accounting/deposit-tracker'],
  ['hoan-ung', '/accounting/hoan-ung'],
];
const WIDTHS = [1280, 1440, 1920, 2560];
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };

const login = async () => {
  const r = await fetch('http://localhost:3002/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
  return (await r.json()).token;
};

const { browser, page } = await launch({ width: 1440, height: 1000 });
const results = {};
try {
  for (const [name, path] of SCREENS) {
    let reached = false;
    for (let i = 1; i <= 3 && !reached; i++) {
      const t = await login();
      if (!t) { await sleep(3500); continue; }
      await page.evaluateOnNewDocument((x) => { localStorage.setItem('token', x); }, t);
      try {
        await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await sleep(5000);
        reached = await page.evaluate(() => document.querySelectorAll('table').length > 0);
      } catch { reached = false; }
      log('nav', { name, attempt: i, reached });
    }
    if (!reached) { results[name] = { error: 'never rendered (hot tree)' }; continue; }
    results[name] = {};
    for (const width of WIDTHS) {
      await setViewport(page, width, 1000);
      const m = await page.evaluate(() => {
        const MONEY = /[\d.,]{3,}\s*₫/;
        const out = { moneyCells: 0, wrapped: [] };
        for (const table of document.querySelectorAll('table')) {
          for (const td of table.querySelectorAll('td')) {
            const txt = (td.innerText || '').trim();
            if (!MONEY.test(txt)) continue;
            out.moneyCells += 1;
            const prevWs = td.style.whiteSpace;
            const prevH = td.style.height;
            td.style.whiteSpace = 'nowrap';
            td.style.height = 'auto';
            const nowrapW = td.scrollWidth;
            const fits = nowrapW <= td.clientWidth + 1;
            td.style.whiteSpace = prevWs;
            td.style.height = prevH;
            if (!fits) {
              out.wrapped.push({
                text: txt.replace(/\s+/g, ' ').slice(0, 30),
                clientW: td.clientWidth, nowrapW,
                cls: String(td.className).slice(0, 40),
                table: String(table.className).slice(0, 40),
              });
            }
          }
        }
        return out;
      });
      results[name][width] = m;
      log('measure', { name, width, moneyCells: m.moneyCells, wrapped: m.wrapped.length });
    }
    await setViewport(page, 1440, 1000);
    await shot(page, `${EV}/sweep-${name}-1440.png`, { full: false });
  }
  logEvidence(EV, 'sweep-results.json', results);
  const total = Object.entries(results).map(([k, v]) => `${k}:${v.error ? 'ERR' : Object.values(v).reduce((s, w) => s + (w?.wrapped?.length ?? 0), 0)}`).join(' ');
  console.log(`DONE wrapped per screen: ${total}`);
} finally {
  await browser.close();
}
