// SIL-630 — interaction-matrix probe: which PICK interaction breaks under the
// staging catalog order [1,2,6,3,4,5,7]? The bootstrap response is rewritten
// locally (request interception) — no DB writes, no staging writes.
//   node qa/scripts/tmp-sil630/interactions.mjs [variant]
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const FRONT = 'http://localhost:7175';
const API = 'http://localhost:3003/api';
const VARIANT = process.argv[2] ?? 'all';
const OUT = path.resolve('qa/2026-10-31_sil630/probe');
fs.mkdirSync(OUT, { recursive: true });
const log = (line) => { console.log(line); fs.appendFileSync(path.join(OUT, 'interactions.log'), line + '\n'); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const { token } = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'cus', password: 'Abc123' }),
}).then((r) => r.json());

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

async function withPage(fn) {
  const page = await browser.newPage();
  const VP = (process.env.QA_VP ?? '1440').split('x').map(Number);
  await page.setViewport({ width: VP[0], height: VP[1] ?? 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  // Rewrite the bootstrap: containerTypes in the STAGING array order.
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.url().includes('/catalogs/bootstrap')) {
      req.respond({
        status: 200,
        contentType: 'application/json',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify(STAGING_BOOTSTRAP),
      }).catch(() => {});
    } else {
      req.continue();
    }
  });
  try { await fn(page); } finally { await page.close(); }
}

// Local bootstrap reordered to staging: [1,2,6,3,4,5,7] (+ local 8 stays out — staging has 7 rows).
const STAGING_BOOTSTRAP = await fetch(`${API}/catalogs/bootstrap`, { headers: { Authorization: `Bearer ${token}` } })
  .then((r) => r.json())
  .then((data) => {
    const byId = new Map(data.containerTypes.map((ct) => [ct.id, ct]));
    const order = [1, 2, 6, 3, 4, 5, 7];
    data.containerTypes = order.map((id) => byId.get(id)).filter(Boolean);
    return data;
  });
log(`bootstrap rewritten: ${STAGING_BOOTSTRAP.containerTypes.map((c) => `${c.id}:${c.code}`).join(' ')}`);

const readState = (page) => page.evaluate(() => ({
  input: document.querySelector('input[aria-label="Loại container"]')?.value ?? null,
  ghost: document.querySelector('[data-field-id$="-type"] .csc-fline__value')?.textContent?.trim() ?? null,
  menu: [...(document.querySelector('[role="listbox"]')?.querySelectorAll('[role="option"]') ?? [])]
    .filter((el) => el instanceof HTMLElement && el.offsetParent !== null)
    .map((el) => ({ text: el.textContent?.trim(), dataValue: el.getAttribute('data-value'), focused: el.id ? document.activeElement?.id === el.id : el.getAttribute('aria-selected') === 'true' })),
}));

async function openMenu(page) {
  // The create-form path: type the container number, Tab hands off → editor
  // + menu open (272). Simpler + equivalent for the picker: click the LOẠI
  // line trigger, which opens editor AND menu (SIL-608).
  await page.click('[data-field-id$="-type"] .csc-fline__trigger');
  await sleep(600);
}

const variants = {
  // B: ArrowDown once then Enter on the freshly opened menu.
  async arrowdown_enter(page) {
    await openMenu(page);
    await page.keyboard.press('ArrowDown');
    await sleep(150);
    log('menu before Enter: ' + JSON.stringify((await readState(page)).menu));
    await page.keyboard.press('Enter');
    await sleep(400);
  },
  // C: type the full code, Enter (no mouse).
  async type_full_enter(page) {
    await openMenu(page);
    await page.keyboard.type('20dc');
    await sleep(400);
    await page.keyboard.press('Enter');
    await sleep(400);
  },
  // D: type prefix, ArrowDown once, Enter.
  async type_prefix_arrow_enter(page) {
    await openMenu(page);
    await page.keyboard.type('20');
    await sleep(400);
    await page.keyboard.press('ArrowDown');
    await sleep(150);
    await page.keyboard.press('Enter');
    await sleep(400);
  },
  // E: mouse-pick 20DC, then RE-PICK 40DC from a reopened menu.
  async repick(page) {
    await openMenu(page);
    await page.evaluate(() => {
      const hit = [...document.querySelectorAll('[role="option"]')]
        .find((el) => el.textContent?.trim() === '20DC' && el instanceof HTMLElement && el.offsetParent !== null);
      hit?.click();
    });
    await sleep(400);
    log('after first pick: ' + JSON.stringify(await readState(page)));
    await openMenu(page);
    await page.evaluate(() => {
      const hit = [...document.querySelectorAll('[role="option"]')]
        .find((el) => el.textContent?.trim() === '40DC' && el instanceof HTMLElement && el.offsetParent !== null);
      hit?.click();
    });
    await sleep(400);
  },
  // F: clear (X) then mouse re-pick 20DC.
  async clear_repick(page) {
    await openMenu(page);
    await page.evaluate(() => {
      const hit = [...document.querySelectorAll('[role="option"]')]
        .find((el) => el.textContent?.trim() === '20DC' && el instanceof HTMLElement && el.offsetParent !== null);
      hit?.click();
    });
    await sleep(400);
    const x = await page.$('[data-field-id$="-type"] button[aria-label="Xoá"]');
    if (x) { await x.click(); await sleep(300); }
    else log('no Xoá button (combobox closed?)');
    await openMenu(page);
    await page.evaluate(() => {
      const hit = [...document.querySelectorAll('[role="option"]')]
        .find((el) => el.textContent?.trim() === '20DC' && el instanceof HTMLElement && el.offsetParent !== null);
      hit?.click();
    });
    await sleep(400);
  },
};

const names = VARIANT === 'all' ? Object.keys(variants) : [VARIANT];
for (const name of names) {
  await withPage(async (page) => {
    await page.goto(`${FRONT}/shipments/new`, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('input[aria-label="Số container"]', { timeout: 30000 });
    log(`— variant ${name}`);
    await variants[name](page);
    const state = await readState(page);
    const ok = state.input === '20DC' && state.ghost === '20DC';
    log(`${ok ? 'PASS' : 'FAIL'} ${name}: input=${JSON.stringify(state.input)} ghost=${JSON.stringify(state.ghost)} menu=${JSON.stringify(state.menu)}`);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  });
}
await browser.close();
