// quick debug — where does the page land?
import { login, launch, makeLogger, sleep, BASE } from './2026-10-19_chiphi2b-lib.mjs';
const log = makeLogger('2026-10-19_chiphi2-b_repro/debug');
const token = await login('ketoan');
const browser = await launch();
try {
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') log(`console.error: ${m.text().slice(0, 300)}`); });
  page.on('pageerror', (e) => log(`pageerror: ${e.message.slice(0, 300)}`));
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/accounting/debit-close`, { waitUntil: 'networkidle2', timeout: 45000 });
  await sleep(3000);
  log(`URL now: ${page.url()}`);
  const info = await page.evaluate(() => ({
    title: document.title,
    bodyLen: document.body.innerText.length,
    rootHtmlLen: document.getElementById('root')?.innerHTML.length ?? -1,
    bodyHead: document.body.innerText.slice(0, 500),
  }));
  log(JSON.stringify(info, null, 1));
} finally { await browser.close(); }
