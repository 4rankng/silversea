// Card 376 — with-data rung on the LOCAL stack (HEAD, seeded fixture rows
// 105/106). Staging has zero invoice-tracking rows across 2025–2026, so the
// populated table state only exists here. Read-only: no mutations.
import { launch, shot, setViewport, logEvidence, sleep } from './qa-20261005-lib.mjs';

const EV = '/Volumes/LexarSSD/projects/silversea-prod/testplan/qa/evidence/2026-10-05_card376-invoice-tracking-spec-audit';
const BASE = 'http://localhost:7175';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };

const login = await fetch('http://localhost:3002/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
});
const token = (await login.json()).token;
if (!token) throw new Error('local login failed');

const { browser, page } = await launch({ width: 1440, height: 1000 });
try {
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/accounting/invoice-tracking`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(3000);
  log('nav', { url: page.url() });

  const contract = await page.evaluate(() => {
    const text = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ');
    return {
      h1: text(document.querySelector('h1')),
      headers: [...document.querySelectorAll('.record-table thead th')].map(text),
      rowCount: document.querySelectorAll('.record-table tbody tr').length,
      firstRow: [...(document.querySelectorAll('.record-table tbody tr')[0]?.querySelectorAll('td') ?? [])].map((td) => ({
        label: td.getAttribute('data-label'), text: text(td).slice(0, 70),
      })),
      rail: [...document.querySelectorAll('[aria-label="Tổng cộng theo kỳ"] .summary-item, [aria-label="Tổng cộng theo kỳ"] [class*="summary"]')].map(text).slice(0, 6),
      railText: text(document.querySelector('[aria-label="Tổng cộng theo kỳ"]')),
      progressOptions: [...document.querySelectorAll('.invoice-tracking-progress select option')].map((o) => text(o)),
      progressCells: [...document.querySelectorAll('[data-label="Tiến độ"]')].slice(0, 3).map(text),
    };
  });
  log('contract', contract);

  for (const width of [1280, 1440, 1920, 2560]) {
    await setViewport(page, width, 1000);
    const path = `${EV}/376-invoice-tracking-local-data-${width}-full.png`;
    await shot(page, path, { full: true });
    log('shot', { path: path.replace(EV + '/', ''), width });
  }

  logEvidence(EV, 'driver-local-contract.json', { contract, log: LOG });
  console.log(`DONE rows=${contract.rowCount} headers=${contract.headers.length}`);
} finally {
  await browser.close();
}
