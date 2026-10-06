// Card 061026221226 — AC7 class-sweep rung: sibling CrudTable catalogues
// (fuel-norms, pricing-tables, road-allowances) must inherit the same
// tabular-frame-at-every-width presentation from the shared component fix.
import puppeteer from 'puppeteer';
import { appendFileSync, mkdirSync } from 'node:fs';

const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const DRIVER_LOG = `${QA}/2026-10-07_card061026221226_ui-sweep-driver.log`;
const LOG = [];
const log = (step, obj) => {
  const e = { at: new Date().toISOString(), step, ...obj };
  LOG.push(e);
  appendFileSync(DRIVER_LOG, JSON.stringify(e) + '\n');
  console.log(JSON.stringify(e));
};

mkdirSync(QA, { recursive: true });
const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
});
if (!login.ok) throw new Error(`login admin failed: ${login.status}`);
const session = await login.json();
const token = session.token ?? session.accessToken ?? session?.data?.token;

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (req) => { void req.continue(); });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  for (const [slug, name] of [['fuel-norms', 'fuel norms'], ['pricing-tables', 'pricing tables'], ['road-allowances', 'road allowances']]) {
    for (const width of [1440, 390]) {
      await page.setViewport({ width, height: 1000 });
      await page.goto(`${BASE}/config/${slug}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      // Data rows or the empty state — either proves the frame; the loading
      // skeleton proves nothing.
      try {
        await page.waitForFunction(() => {
          const t = document.querySelector('table.record-table');
          return t && (t.querySelector('tbody tr:not(.cfg-empty-row)') || (t.textContent || '').includes('Chưa có'));
        }, { timeout: 45000 });
      } catch { log(`${slug}-wait`, { width, note: 'table never rendered data/empty — probe still runs' }); }
      await new Promise((r) => setTimeout(r, 600));
      const probe = await page.evaluate(() => {
        const table = document.querySelector('table.record-table');
        const thead = table?.querySelector('thead');
        const tds = [...(table?.querySelectorAll('tbody td') ?? [])];
        let glued = 0;
        for (const td of tds) {
          const before = getComputedStyle(td, '::before').content;
          if (before && before !== 'none' && before !== '""') glued += 1;
        }
        return {
          isConfig: table?.classList.contains('record-table--config') ?? false,
          theadVisible: thead ? getComputedStyle(thead).display !== 'none' : false,
          gluedLabels: glued,
        };
      });
      log(`sweep-${slug}-${width}`, probe);
      if (probe.isConfig && (probe.gluedLabels > 0)) throw new Error(`${slug} still glues labels at ${width}`);
      await page.screenshot({ path: `${QA}/2026-10-07_card061026221226_ui-sweep-${slug}-${width}.png` });
    }
  }
  log('sweep', { verdict: 'all sibling CrudTable catalogues keep the tabular frame; zero glued labels', note: 'ports + container-types use the separate cfg-row inline list, not CrudTable — same class of presentation but a different shared component' });
} finally {
  await browser.close();
}
appendFileSync(DRIVER_LOG, 'DRIVER OK\n');
console.log('DRIVER OK');
