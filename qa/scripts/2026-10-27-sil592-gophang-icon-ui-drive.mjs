// SIL-592 UI drive — the [Gộp hàng] toggle carries a REAL vector icon
// (lucide Layers; active face X), never the 📦 package emoji — verified on
// both grouping surfaces: /dispatch (Kế hoạch Tổng quát toolbar) and
// /dispatch-detail (filter strip).
//
// Usage: cd frontend && QA_BASE_URL=http://localhost:7185 \
//   node ../qa/scripts/2026-10-27-sil592-gophang-icon-ui-drive.mjs
// Output: qa/2026-10-27_sil592-gophang-icon/*.png + assertions.json.

import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7185';
const QA_USER = process.env.QA_USER || 'dungnv';
const QA_PASS = process.env.QA_PASS || 'Abc123';
const OUT = resolve(process.cwd(), '../qa/2026-10-27_sil592-gophang-icon');
const LOG = resolve(OUT, 'ui-driver.log');
mkdirSync(OUT, { recursive: true });
const log = (line) => { appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`); console.log(line); };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  defaultViewport: { width: 1440, height: 900 },
});

async function login(user, pass) {
  const page = await browser.newPage();
  await page.goto(`${FE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForSelector('input[name="username"]', { timeout: 45000 });
  await page.type('input[name="username"]', user);
  await page.type('input[name="password"]', pass);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForFunction(() => localStorage.getItem('token') || localStorage.getItem('auth_token'), { timeout: 30000 });
  return page;
}

const page = await login(QA_USER, QA_PASS);
log(`login ok user=${QA_USER}`);

const result = { viewport: '1440x900', checks: [] };
const check = (name, pass, detail) => { result.checks.push({ name, pass, detail }); if (!pass) result.failed = true; };

async function assertToggle(route, shotName) {
  await page.goto(`${FE}${route}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1500);
  const data = await page.evaluate(() => {
    const btn = document.querySelector('.lcl-merge-toggle');
    if (!btn) return { present: false };
    const svg = btn.querySelector('svg');
    const svgData = svg ? (svg.innerHTML || '') : '';
    return {
      present: true,
      text: (btn.textContent ?? '').replace(/\s+/g, ' ').trim(),
      hasSvg: svg != null,
      svgIsLucide: svg?.classList?.contains('lucide') ?? false,
      svgPath: svgData.slice(0, 60),
      ariaPressed: btn.getAttribute('aria-pressed'),
      hasEmoji: /[\u{1F4E6}]/u.test(btn.textContent ?? ''),
    };
  });
  if (!data.present) {
    check(`${route}: toggle present`, false, 'no .lcl-merge-toggle on the page');
    return;
  }
  check(`${route}: toggle text is exactly "Gộp hàng" (no emoji)`, data.text === 'Gộp hàng' && !data.hasEmoji, data);
  check(`${route}: vector icon present (lucide svg inside the button)`, data.hasSvg && data.svgIsLucide, data);
  // Flip the mode: the active face swaps to X + "Thoát gộp hàng".
  await page.evaluate(() => document.querySelector('.lcl-merge-toggle').click());
  await sleep(700);
  const active = await page.evaluate(() => {
    const btn = document.querySelector('.lcl-merge-toggle');
    return {
      text: (btn?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      hasSvg: btn?.querySelector('svg') != null,
      ariaPressed: btn?.getAttribute('aria-pressed'),
    };
  });
  check(`${route}: active face = X icon + "Thoát gộp hàng" (aria-pressed)`, active.text === 'Thoát gộp hàng' && active.hasSvg && active.ariaPressed === 'true', active);
  await page.screenshot({ path: resolve(OUT, `${shotName}-active.png`) });
  // Flip back for the resting screenshot.
  await page.evaluate(() => document.querySelector('.lcl-merge-toggle').click());
  await sleep(700);
  await page.screenshot({ path: resolve(OUT, `${shotName}-rest.png`) });
}

await assertToggle('/dispatch', 'master-plan-toolbar');
log('master-plan surface asserted');
await assertToggle('/dispatch-detail', 'detailed-plan-strip');
log('detailed-plan surface asserted');

result.pass = result.checks.every((c) => c.pass);
writeFileSync(resolve(OUT, 'assertions.json'), JSON.stringify(result, null, 2));
log(`EXIT ${result.pass ? 0 : 2} — checks: ${result.checks.map((c) => `${c.pass ? 'PASS' : 'FAIL'}:${c.name}`).join(' | ')}`);
await browser.close();
process.exit(result.pass ? 0 : 2);
