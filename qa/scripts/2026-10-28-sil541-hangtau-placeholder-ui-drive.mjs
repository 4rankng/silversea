// SIL-541 UI drive — /shipments/new Hãng tàu placeholder clip.
// Board id 607: placeholder shows 'Gõ chọn hoặc nhập hãng tì' — cut mid-word
// because the input is narrower than the placeholder text, with no ellipsis.
// Expected: full placeholder visible, or a clean ellipsis.
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7175';
const PHASE = process.env.QA_EXPECT || 'before';
const OUT = resolve(process.cwd(), '../qa/2026-10-28_sil541-hangtau-placeholder');
mkdirSync(OUT, { recursive: true });
const LOG = resolve(OUT, `ui-driver-${PHASE}.log`);
const log = (l) => { appendFileSync(LOG, `${new Date().toISOString()} ${l}\n`); console.log(l); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
});
const page = await browser.newPage();
await page.goto(`${FE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
await page.goto(`${FE}/login`, { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForSelector('input[name="username"]', { timeout: 45000 });
await page.type('input[name="username"]', 'admin');
await page.type('input[name="password"]', 'Abc123');
await Promise.all([
  page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
  page.click('button[type="submit"]'),
]);
await page.waitForFunction(() => localStorage.getItem('token') || localStorage.getItem('auth_token'), { timeout: 30000 });
log('login ok admin (ADMIN)');

const result = { phase: PHASE, role: 'ADMIN (admin)', checks: [] };
const check = (name, pass, detail) => { result.checks.push({ name, pass, detail }); if (!pass) result.failed = true; log(`${pass ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}`); };

const WIDTHS = process.env.QA_WIDTHS ? process.env.QA_WIDTHS.split(',').map(Number) : [1440, 1280, 1024];

for (const width of WIDTHS) {
  await page.setViewport({ width, height: 900 });
  await page.goto(`${FE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector("input[placeholder='Gõ chọn hoặc nhập hãng tàu']", { timeout: 60000 });
  await page.evaluate(() => document.fonts?.ready);
  await sleep(500);
  const m = await page.evaluate(() => {
    const input = document.querySelector("input[placeholder='Gõ chọn hoặc nhập hãng tàu']");
    if (!input) return { found: false };
    const r = input.getBoundingClientRect();
    const cs = getComputedStyle(input);
    const csRoot = getComputedStyle(document.querySelector('[data-field-id="shipment-shipping-line"]') ?? input);
    // measure placeholder text width via a canvas with the input's computed font
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const placeholder = input.placeholder || input.getAttribute('placeholder') || '';
    const phWidth = ctx.measureText(placeholder).width;
    return {
      found: true,
      placeholder,
      inputW: +r.width.toFixed(1),
      textW: +phWidth.toFixed(1),
      fits: phWidth <= r.width - 16, // 16px = horizontal padding allowance measured below
      paddingLeft: cs.paddingLeft, paddingRight: cs.paddingRight,
      textOverflow: cs.textOverflow, overflow: cs.overflow,
      fieldClass: csRoot.className,
      fontSize: cs.fontSize,
    };
  });
  if (!m.found) { check(`shipping-line input present @${width}`, false, m); continue; }
  // Board 607 acceptance: the placeholder shows FULLY, or ends in a clean
  // ellipsis — a mid-word clip ('Gõ chọn hoặc nhập hãng tì') is the defect.
  check(`placeholder fits or ends in a clean ellipsis @${width}`, m.fits || m.textOverflow === 'ellipsis', { inputW: m.inputW, textW: m.textW, ph: m.placeholder, textOverflow: m.textOverflow, path: m.fits ? 'fits' : 'ellipsis' });
  check(`input declares a clean overflow treatment (ellipsis) @${width}`, m.textOverflow === 'ellipsis' || m.fits, { textOverflow: m.textOverflow, fits: m.fits });
  await page.screenshot({ path: resolve(OUT, `${PHASE}-form-${width}.png`) });
  const el = await page.$('[data-field-id="shipment-shipping-line"]');
  await el.screenshot({ path: resolve(OUT, `${PHASE}-field-${width}.png`) });
  log(`@${width} field=${JSON.stringify(m)}`);

  // Committed-value ghost layer (SIL-541 review): type a long custom value,
  // blur, and screenshot the ghost — the block `<p>` children must end in a
  // clean ellipsis (not a hard mid-glyph clip).
  if (width === 1440) {
    const LONG = 'CÔNG TY TNHH CÔNG NGHỆ ASKEY VIỆT NAM — Lô C7-2 KCN Quế Võ';
    await page.click("input[placeholder='Gõ chọn hoặc nhập hãng tàu']", { clickCount: 3 });
    await page.type("input[placeholder='Gõ chọn hoặc nhập hãng tàu']", LONG);
    await page.keyboard.press('Escape');
    await page.click('body');
    await sleep(400);
    const ghost = await page.evaluate(() => {
      const ps = [...document.querySelectorAll('[data-uui-control="combobox"] span[aria-hidden="true"] p')];
      return ps.map((p) => ({ text: p.textContent?.slice(0, 50), to: getComputedStyle(p).textOverflow, ws: getComputedStyle(p).whiteSpace, ov: getComputedStyle(p).overflowX }));
    });
    check(`committed long value ghost ellipsizes (not hard-clipped) @${width}`, ghost.length > 0 && ghost.every((p) => p.to === 'ellipsis' && p.ws === 'nowrap'), ghost);
    const el2 = await page.$('[data-field-id="shipment-shipping-line"]');
    await el2.screenshot({ path: resolve(OUT, `${PHASE}-field-value-ghost-${width}.png`) });
  }
}

writeFileSync(resolve(OUT, `assertions-${PHASE}.json`), JSON.stringify(result, null, 2));
log(`EXIT=${result.failed ? 1 : 0}`);
await browser.close();
process.exit(result.failed ? 1 : 0);
