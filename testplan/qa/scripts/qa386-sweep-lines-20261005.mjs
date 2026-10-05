// Card 386 sweep v2 — line-box detector: a money element rendering >1 line box
// is wrapped mid-number (the "17.500.0 0 ₫" class). overflow-wrap:anywhere
// makes width-based detection blind; counting client rects is not.
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
        await sleep(6000);
        reached = await page.evaluate(() => document.querySelectorAll('table').length > 0);
      } catch { reached = false; }
    }
    if (!reached) { results[name] = { error: 'never rendered (hot tree)' }; continue; }
    results[name] = {};
    for (const width of WIDTHS) {
      await setViewport(page, width, 1000);
      const m = await page.evaluate(() => {
        const MONEY = /[\d][\d.,]*\s*₫/;
        const lineBoxes = (el) => {
          const r = document.createRange();
          r.selectNodeContents(el);
          return [...r.getClientRects()].filter((x) => x.width > 2).length;
        };
        const lineHeightOf = (el) => parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.4;
        const out = { moneyEls: 0, wrapped: [] };
        const seen = new Set();
        for (const table of document.querySelectorAll('table')) {
          for (const td of table.querySelectorAll('td')) {
            const walk = (el) => {
              for (const child of el.children) walk(child);
              const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('');
              if (!MONEY.test(own) || seen.has(el)) return;
              seen.add(el);
              out.moneyEls += 1;
              const lines = lineBoxes(el);
              if (lines > 1) {
                out.wrapped.push({
                  text: own.replace(/\s+/g, ' ').slice(0, 28),
                  lines,
                  cls: String(el.className).slice(0, 36),
                  table: String(table.className).slice(0, 36),
                });
              }
            };
            walk(td);
          }
        }
        return out;
      });
      results[name][width] = m;
      log('measure', { name, width, moneyEls: m.moneyEls, wrapped: m.wrapped.length });
    }
    await setViewport(page, 1440, 1000);
    await shot(page, `${EV}/sweep2-${name}-1440.png`, { full: false });
  }
  logEvidence(EV, 'sweep2-results.json', results);
  const total = Object.entries(results).map(([k, v]) => `${k}:${v.error ? 'ERR' : Object.values(v).reduce((s, w) => s + (w?.wrapped?.length ?? 0), 0)}`).join(' ');
  console.log(`DONE wrapped(line-box) per screen: ${total}`);
} finally {
  await browser.close();
}
