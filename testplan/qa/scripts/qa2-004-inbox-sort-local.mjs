// QA2-004 rung-3 driver — drives the real sort controls on /my-orders (OPS).
// Ports follow the dev-port contract by default (7175 FE / 3002 API); export
// QA_LOCAL_FRONTEND_PORT / QA_LOCAL_API_PORT to point at an isolated stack
// (the 2026-10-14 run used 7176/3003 so a concurrently-running dev stack
// could not desync the evidence).
import puppeteer from 'puppeteer';
import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';

const BASE = `http://localhost:${process.env.QA_LOCAL_FRONTEND_PORT ?? 7175}`;
const dir = 'qa/evidence/2026-10-14_qa2-004-sort';
mkdirSync(dir, { recursive: true });
const log = `${dir}/driver.log`;
appendFileSync(log, '');
const step = (entry) => { const line = JSON.stringify({ at: new Date().toISOString(), ...entry }); appendFileSync(log, line + '\n'); console.log(line); };
const shot = (page, name) => page.screenshot({ path: `${dir}/${name}.png`, fullPage: false });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const apiCalls = [];
page.on('request', (req) => { if (req.url().includes('/work-inbox')) apiCalls.push(req.url()); });

try {
  // Real UI login as the local OPS seed account.
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.type('input[name="username"]', 'giaonhan', { delay: 8 });
  await page.type('input[name="password"]', 'Abc123', { delay: 8 });
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {}), page.click('button[type="submit"]')]);
  await new Promise((r) => setTimeout(r, 2500));
  step({ step: 'login', url: page.url() });

  await page.goto(`${BASE}/my-orders`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('table.role-work-inbox__table, [class*="work-inbox"] table', { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1200));
  await shot(page, '01-my-orders-initial');
  step({ step: 'initial', url: page.url() });

  const headerSort = async (label) => {
    const clicked = await page.evaluate((lbl) => {
      const ths = [...document.querySelectorAll('th[aria-sort]')];
      const th = ths.find((el) => (el.textContent || '').trim().startsWith(lbl));
      if (!th) return null;
      const btn = th.querySelector('button');
      if (!btn) return null;
      btn.click();
      return { before: th.getAttribute('aria-sort'), label: (th.textContent || '').trim() };
    }, label);
    return clicked;
  };
  const ariaState = () => page.evaluate(() => [...document.querySelectorAll('th[aria-sort]')].map((el) => ({ label: (el.textContent || '').trim().slice(0, 12), sort: el.getAttribute('aria-sort') })));

  // 1) Công việc (title): asc → desc
  step({ step: 'click-title', result: await headerSort('Công việc') });
  await new Promise((r) => setTimeout(r, 1500));
  step({ step: 'after-title-asc', aria: await ariaState(), url: page.url() });
  await shot(page, '02-after-title-asc');

  await headerSort('Công việc');
  await new Promise((r) => setTimeout(r, 1500));
  step({ step: 'after-title-desc', aria: await ariaState(), url: page.url() });
  await shot(page, '03-after-title-desc');

  // 2) Cập nhật (freshness)
  await headerSort('Cập nhật');
  await new Promise((r) => setTimeout(r, 1500));
  step({ step: 'after-freshness-asc', aria: await ariaState(), url: page.url() });
  await shot(page, '04-after-freshness-asc');

  // 3) Trạng thái (state)
  await headerSort('Trạng thái');
  await new Promise((r) => setTimeout(r, 1500));
  step({ step: 'after-state-asc', aria: await ariaState(), url: page.url() });
  await shot(page, '05-after-state-asc');

  // Reload restores the ordering from the URL (back-link contract).
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1500));
  step({ step: 'after-reload', aria: await ariaState(), url: page.url() });
  await shot(page, '06-after-reload-restores-sort');

  writeFileSync(`${dir}/api-calls.json`, JSON.stringify(apiCalls, null, 2));
  step({ step: 'api-calls', count: apiCalls.length });
  step({ step: 'DONE', ok: true });
} catch (error) {
  await shot(page, '99-failure');
  step({ step: 'FAIL', error: String(error), stack: error?.stack?.slice(0, 500) });
  process.exitCode = 1;
} finally {
  await browser.close();
}
