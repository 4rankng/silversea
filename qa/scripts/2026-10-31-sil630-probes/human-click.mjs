// SIL-630 — human-click probe: open the LOẠI editor at the QA viewport
// (1280x900), find where the listbox PAINTS, click the painted "20DC" row by
// coordinates (like a human), and read what commits.
//   node qa/scripts/tmp-sil630/human-click.mjs [width] [height]
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const FRONT = process.env.QA_FRONT ?? 'http://localhost:7175';
const W = Number(process.argv[2] ?? 1280);
const H = Number(process.argv[3] ?? 900);
const OUT = path.resolve('qa/2026-10-31_sil630/probe');
fs.mkdirSync(OUT, { recursive: true });
const tag = `${W}x${H}`;
const log = (line) => { console.log(line); fs.appendFileSync(path.join(OUT, `human-click-${tag}.log`), line + '\n'); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const API = process.env.QA_API ?? 'http://localhost:3003/api';
const { token } = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'cus', password: 'Abc123' }),
}).then((r) => r.json());

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
const shot = (name) => page.screenshot({ path: path.join(OUT, `human-${tag}-${name}.png`) });

// Reorder the bootstrap to the staging array order.
await page.setRequestInterception(true);
const bootstrap = await fetch(`${API}/catalogs/bootstrap`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
const byId = new Map(bootstrap.containerTypes.map((ct) => [ct.id, ct]));
bootstrap.containerTypes = [1, 2, 6, 3, 4, 5, 7].map((id) => byId.get(id)).filter(Boolean);
page.on('request', (req) => {
  if (req.url().includes('/catalogs/bootstrap')) {
    req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(bootstrap) }).catch(() => {});
  } else req.continue();
});

await page.goto(`${FRONT}/shipments/new`, { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForSelector('[data-field-id$="-type"] .csc-fline__trigger', { timeout: 30000 });

// Geometry BEFORE opening: where is the trigger?
const before = await page.evaluate(() => {
  const trigger = document.querySelector('[data-field-id$="-type"] .csc-fline__trigger');
  const r = trigger.getBoundingClientRect();
  return { trigger: { x: r.x, y: r.y, w: r.width, h: r.height }, scrollY: window.scrollY };
});
log(`trigger rect: ${JSON.stringify(before)}`);

// QA-style approach paths (QA_SEQUENCE env):
//  seq1: click the SỐ line editor first, then the LOẠI line.
//  seq2: open LOẠI, close by outside press, reopen.
//  seq3: type into SỐ input, Tab (the 272 handoff), like an operator.
const SEQ = process.env.QA_SEQUENCE ?? 'seq1';
if (SEQ === 'seq1') {
  await page.click('[data-field-id$="-number"] .csc-fline__trigger').catch(async () => {
    await page.click('input[aria-label="Số container"]').catch(() => {});
  });
  await sleep(500);
  await page.click('[data-field-id$="-type"] .csc-fline__trigger');
  await sleep(700);
} else if (SEQ === 'seq2') {
  await page.click('[data-field-id$="-type"] .csc-fline__trigger');
  await sleep(500);
  await page.mouse.click(1000, 300); // outside press closes
  await sleep(500);
  await page.click('[data-field-id$="-type"] .csc-fline__trigger');
  await sleep(700);
} else {
  await page.click('[data-field-id$="-type"] .csc-fline__trigger');
  await sleep(700);
}
await shot('1-open');

const geom = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.csc-fline__card')].map((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, open: el.classList.contains('is-open'), opacity: getComputedStyle(el).opacity };
  });
  const listboxes = [...document.querySelectorAll('[role="listbox"]')].map((el) => {
    const r = el.getBoundingClientRect();
    const opts = [...el.querySelectorAll('[role="option"]')].filter((o) => o instanceof HTMLElement && o.offsetParent !== null)
      .map((o) => { const or = o.getBoundingClientRect(); return { text: o.textContent?.trim(), y: Math.round(or.y), h: Math.round(or.height) }; });
    return { x: r.x, y: r.y, w: r.width, h: r.height, options: opts };
  });
  const input = document.querySelector('input[aria-label="Loại container"]');
  const ir = input?.getBoundingClientRect();
  return { cards, listboxes, input: ir ? { x: ir.x, y: ir.y } : null };
});
log(`geometry after open: ${JSON.stringify(geom)}`);

// Click the PAINTED "20DC" row by its visual coordinates (human aim).
const target = geom.listboxes
  .flatMap((lb) => lb.options.map((o) => ({ ...o, lbX: lb.x, lbW: lb.w })))
  .find((o) => o.text === '20DC');
if (!target) { log('ABORT: no painted 20DC row'); process.exit(2); }
const cx = Math.round(target.lbX + target.lbW / 2);
const cy = Math.round(target.y + target.h / 2);
log(`human click on painted "20DC" at (${cx}, ${cy})`);
await page.mouse.click(cx, cy);
await sleep(600);
await shot('2-after-click');

const after = await page.evaluate(() => ({
  input: document.querySelector('input[aria-label="Loại container"]')?.value ?? null,
  ghost: document.querySelector('[data-field-id$="-type"] .csc-fline__value')?.textContent?.trim() ?? null,
  menusStillOpen: document.querySelectorAll('[role="listbox"]').length,
}));
log(`after human click: ${JSON.stringify(after)}`);
await browser.close();
