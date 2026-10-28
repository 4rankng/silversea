/**
 * SIL-552 UI drive — the LOẠI line's FLOATING select.
 *
 * The type picker moved out of the cell into the floating panel, so the
 * react-aria listbox now opens from a fixed-position panel. This drive opens
 * the panel, opens the listbox inside it and captures both — the listbox must
 * render at full size (never clipped by the panel) and must not be cut off by
 * the table's scroll wrapper.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://localhost:7188';
const API = 'http://localhost:3002/api';
const OUT = 'qa/2026-10-28_sil552-tthang';
const WIDTH = Number(process.env.WIDTH ?? 1280);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function tryLogin(username) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: username, password: 'Abc123' }),
  });
  if (!res.ok) return null;
  const body = await res.json();
  return body.token ?? null;
}
let token = await tryLogin('cus') ?? await tryLogin('admin');
if (!token) throw new Error('login failed');
const account = token ? 'ok' : 'ko';

mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
});
const report = { base: BASE, width: WIDTH, account };

try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.setViewport({ width: WIDTH, height: 900, deviceScaleFactor: 2 });
  await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForSelector('button[aria-label*="Mở chi tiết lô hàng"]', { timeout: 30000 });
  const buttons = await page.$$('button[aria-label*="Mở chi tiết lô hàng"]');
  await buttons[0].click();
  await page.waitForSelector('.cus-lot-table', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1500));

  // Open the LOẠI line's floating editor.
  await page.evaluate(() => {
    const trigger = [...document.querySelectorAll('.cus-lot-contgroup button')]
      .find((b) => (b.getAttribute('aria-label') ?? '').startsWith('Chỉnh sửa loại container'));
    trigger?.click();
  });
  await page.waitForSelector('.cus-lot-editor [data-uui-control]', { timeout: 8000 });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: `${OUT}/sil552_type-panel_${WIDTH}.png`, fullPage: false });

  const panel = await page.evaluate(() => {
    const el = document.querySelector('.cus-lot-editor');
    const control = el?.querySelector('[data-uui-control]');
    const r = el?.getBoundingClientRect();
    return {
      hasSelect: Boolean(control),
      controlName: control?.getAttribute('aria-label') ?? null,
      panelWidth: r ? Math.round(r.width) : null,
      panelInsideTable: el ? Boolean(el.closest('.cus-lot-table')) : null,
    };
  });

  // Open the listbox inside the floating panel.
  await page.evaluate(() => {
    document.querySelector('.cus-lot-editor [data-uui-control]')?.click();
  });
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: `${OUT}/sil552_type-listbox_${WIDTH}.png`, fullPage: false });

  const listbox = await page.evaluate(() => {
    const options = [...document.querySelectorAll('[role="option"]')];
    const lb = options[0]?.closest('[role="listbox"]');
    const r = lb?.getBoundingClientRect();
    return {
      optionCount: options.length,
      optionTexts: options.map((o) => o.textContent.trim()).slice(0, 10),
      listboxWidth: r ? Math.round(r.width) : null,
      listboxHeight: r ? Math.round(r.height) : null,
      listboxInViewport: r ? r.top >= 0 && r.bottom <= window.innerHeight : null,
      // The listbox is portalled to the body — never inside the panel (which
      // would clip it) nor inside the table (which clips both axes).
      listboxInsidePanel: Boolean(lb?.closest('.cus-lot-editor')),
      listboxInsideTable: Boolean(lb?.closest('.cus-lot-table')),
    };
  });

  report.panel = panel;
  report.listbox = listbox;
  writeFileSync(`${OUT}/sil552_type_report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
