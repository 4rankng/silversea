// Card 374 — audit rung: confirm the phoi-phieu transport view has NO thu/trả
// summary sub-table at the deployed build (before-state), and record the
// register's period/filter contract. Read-only; trusted taps only.
import {
  loginApi, launch, auth, shot, setViewport, logEvidence, sleep, probe,
} from './qa-20261005-lib.mjs';

const EV = '/Volumes/LexarSSD/projects/silversea-prod/testplan/qa/evidence/2026-10-05_card374-thu-tra-subtable-audit';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };

const health = await fetch('https://vantai.tingting.vip/api/health').then((r) => r.json());
log('health', { buildHash: health.buildHash });

const session = await loginApi('admin', 'Abc123');
const token = session.token ?? session.accessToken ?? session?.data?.token;

const { browser, page } = await launch({ width: 1440, height: 1000 });
try {
  await auth(page, token, '/accounting/phoi-phieu');
  log('nav', { url: page.url() });

  // Give the register's data queries time to settle before measuring.
  await sleep(3000);
  const contract = await page.evaluate(() => {
    const text = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ');
    const tables = [...document.querySelectorAll('table')];
    return {
      h1: text(document.querySelector('h1')),
      tabs: [...document.querySelectorAll('[role="tab"]')].map(text),
      period: text(document.querySelector('.accounting-period')) || '',
      tableCount: tables.length,
      tableSummaries: tables.map((t) => ({
        aria: t.getAttribute('aria-label') || '',
        headers: [...t.querySelectorAll('thead th')].map(text).slice(0, 12),
        rows: t.querySelectorAll('tbody tr').length,
      })),
      summarySections: [...document.querySelectorAll('[aria-label*="ổng"], section[class*="summary"]')].map((s) => ({
        aria: s.getAttribute('aria-label') || s.className.slice(0, 60),
        text: text(s).slice(0, 120),
      })),
      registerRows: document.querySelectorAll('.record-table tbody tr').length,
    };
  });
  log('contract', contract);

  for (const width of [1440, 1920]) {
    await setViewport(page, width, 1000);
    await shot(page, `${EV}/374-phoiphieu-before-${width}-full.png`, { full: true });
    log('shot', { width });
  }
  logEvidence(EV, 'driver-before.json', { health, contract, log: LOG });
  console.log(`DONE tables=${contract.tableCount} registerRows=${contract.registerRows}`);
} finally {
  await browser.close();
}
