// SIL-476 — 768px footer defect evidence on /debt + /payables (LOCAL ONLY).
// Captures the pm-summary footer band ("Tổng cộng theo báo cáo kỳ") at the
// reported viewport (768px, role admin) BEFORE and AFTER the CSS fix, plus a
// computed-style dump of the tfoot cells so the diagnosis is mechanical, not
// guesswork. The --label flag names the capture phase (before/after).
// Run: node qa/scripts/2026-10-25-sil476-footer-768-shots.mjs --label before
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const label = process.argv.includes('--label')
  ? process.argv[process.argv.indexOf('--label') + 1]
  : 'before';
const FRONT = process.env.FRONT_URL ?? 'http://localhost:7175';
const API = process.env.API_URL ?? 'http://localhost:3002/api';
const WIDTH = Number(process.env.WIDTH ?? 768);
const OUT = path.resolve('qa/2026-10-25-sil476');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, `driver-${label}.log`);
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log(`HEALTH status=${health?.status} api=${API} front=${FRONT}`);
if (health?.status !== 'ok') { log('ABORT: local API health not ok'); process.exit(2); }

const loginRes = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
});
if (!loginRes.ok) { log(`ABORT: login failed (${loginRes.status})`); process.exit(2); }
const { token } = await loginRes.json();
log('LOGIN ok role=admin');

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: WIDTH, height: 1024 });
await page.evaluateOnNewDocument((t) => { if (location.origin.startsWith('http://localhost')) localStorage.setItem('token', t); }, token);

for (const route of ['debt', 'payables']) {
  await page.goto(`${FRONT}/${route}`, { waitUntil: 'networkidle2', timeout: 60000 });
  try {
    await page.waitForSelector('.pm-summary__table tfoot td', { timeout: 30000 });
  } catch {
    log(`WARN /${route}: no pm-summary tfoot rendered (empty period?) — capturing viewport anyway`);
  }
  // Scroll the totals band into view, then let layout/sticky settle.
  await page.evaluate(() => {
    document.querySelector('.pm-summary__table tfoot')?.scrollIntoView({ block: 'center' });
  });
  await sleep(800);
  await page.screenshot({ path: path.join(OUT, `${route}-${WIDTH}-${label}-viewport.png`) });

  // Zoom: the tfoot band alone, plus the whole summary section for context.
  const tfoot = await page.$('.pm-summary__table tfoot');
  if (tfoot) await tfoot.screenshot({ path: path.join(OUT, `${route}-${WIDTH}-${label}-tfoot.png`) });
  const section = await page.$('.pm-summary');
  if (section) await section.screenshot({ path: path.join(OUT, `${route}-${WIDTH}-${label}-section.png`) });

  // Mechanical diagnosis: which display modes and paddings actually apply.
  const probe = await page.evaluate(() => {
    const pick = (el) => {
      if (!el) return null;
      const s = getComputedStyle(el);
      return { display: s.display, padding: s.padding, whiteSpace: s.whiteSpace, overflowWrap: s.overflowWrap, width: el.getBoundingClientRect().width };
    };
    const table = document.querySelector('.pm-summary__table');
    return {
      route: location.pathname,
      table: table ? { display: getComputedStyle(table).display, width: table.getBoundingClientRect().width, scrollWidth: table.scrollWidth } : null,
      wrap: pick(document.querySelector('.pm-summary__scroll')),
      tfoot: pick(document.querySelector('.pm-summary__table tfoot')),
      tfootTr: pick(document.querySelector('.pm-summary__table tfoot tr')),
      tfootLabelTd: pick(document.querySelector('.pm-summary__table tfoot td')),
      tfootNumTd: pick(document.querySelector('.pm-summary__table tfoot td.num')),
      tbodyTdSample: pick(document.querySelector('.pm-summary__table tbody td')),
      labelCellText: document.querySelector('.pm-summary__table tfoot td')?.textContent?.slice(0, 40) ?? null,
    };
  });
  log(`PROBE /${route}: ${JSON.stringify(probe)}`);
  fs.writeFileSync(path.join(OUT, `${route}-${WIDTH}-${label}-probe.json`), JSON.stringify(probe, null, 2));
}

await browser.close();
log(`DONE label=${label}`);
