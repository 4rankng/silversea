// SIL-484 official UI drive: /shipments-detail NHẬP/XUẤT column — the XNK
// direction pill must read the table's data typography (12-13px, pill
// height 20-22px) instead of the 11px caption scale. Read-only style change:
// probe = computed font/line-height/pill height + adjacent-cell font-size,
// zoomed screenshot of the pill beside its neighbor, API identity probe.
// Usage: node qa/2026-10-25_sil484_ui-drive.mjs <before|after>
// Exit 0 = PASS (probe JSON + zoom PNG + driver log saved).
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const LABEL = process.argv[2] || 'before';
const BASE = process.env.SIL484_BASE || 'http://localhost:7186';
const API = 'http://localhost:3002/api';
const DATE = '2026-10-25';
const log = [];
function say(line) { log.push(line); console.log(line); }

const loginRes = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'cus', password: 'Abc123' }),
});
if (!loginRes.ok) throw new Error(`login ${loginRes.status}`);
const { token } = await loginRes.json();
say(`LOGIN ok role=cus`);

// API identity probe (read-only change): the shipments list the page reads.
const apiRes = await fetch(`${API}/shipments?page=1&pageSize=5`, { headers: { Authorization: `Bearer ${token}` } });
const apiBody = await apiRes.json().catch(() => ({}));
say(`[api] GET /api/shipments => ${apiRes.status}, items: ${apiBody.items?.length ?? apiBody.data?.items?.length ?? 'n/a'} (read-only identity probe)`);

const browser = await puppeteer.launch({ headless: true, args: ['--window-size=1440,900'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 3 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  page.on('pageerror', (e) => say(`[pageerror] ${String(e).slice(0, 200)}`));
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) say(`[http] ${r.status()} ${r.url().slice(0, 140)}`); });

  await page.goto(`${BASE}/shipments-detail`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('.shipment-container-ledger__direction', { timeout: 30000 });
  say(`[nav] /shipments-detail loaded, direction pill found (title: ${await page.title()})`);

  // Zoomed region: the pill's own cell + the adjacent Hãng tàu cell.
  const region = await page.evaluate(() => {
    const pill = document.querySelector('.shipment-container-ledger__direction');
    const td = pill.closest('td');
    const next = td.nextElementSibling;
    const tr = td.closest('tr');
    const r = td.getBoundingClientRect();
    const n = next.getBoundingClientRect();
    const row = tr.getBoundingClientRect();
    // keep the table horizontally scrolled to the pill (the 12-col table
    // overflows on 1440): scroll the wrapper so the clip lands on-screen.
    const wrap = td.closest('.shipment-container-ledger__scroll, table').parentElement;
    if (r.right > window.innerWidth || r.left < 0) {
      wrap.scrollLeft += r.left - 24;
    }
    const r2 = td.getBoundingClientRect();
    const n2 = next.getBoundingClientRect();
    return {
      pillText: pill.textContent.trim(),
      pill: (({ x, y, width, height }) => ({ x, y, width, height }))(pill.getBoundingClientRect()),
      td: { x: r2.x, y: r2.y, width: r2.width, height: r2.height },
      next: { x: n2.x, y: n2.y, width: n2.width, height: n2.height },
      rowTop: row.y, rowBottom: row.bottom,
    };
  });
  say(`[region] pill="${region.pillText}" td=${JSON.stringify(region.td)} next=${JSON.stringify(region.next)}`);

  const metrics = await page.evaluate(() => {
    const pill = document.querySelector('.shipment-container-ledger__direction');
    const cs = getComputedStyle(pill);
    const td = pill.closest('td');
    const next = td.nextElementSibling;
    const nextText = next.querySelector('span:not([class*="multiline"]) , .shipment-container-ledger__multiline > span, .shipment-container-ledger__code');
    const label = td.getAttribute('data-label');
    const nextLabel = next.getAttribute('data-label');
    const rect = pill.getBoundingClientRect();
    return {
      label, nextLabel,
      pillFontSize: cs.fontSize, pillLineHeight: cs.lineHeight, pillWeight: cs.fontWeight,
      pillPadding: cs.padding, pillRect: { w: +rect.width.toFixed(1), h: +rect.height.toFixed(1) },
      nextText: nextText?.textContent?.trim()?.slice(0, 40) ?? null,
      nextFontSize: nextText ? getComputedStyle(nextText).fontSize : null,
    };
  });
  say(`[metrics] ${JSON.stringify(metrics)}`);

  // Zoomed screenshot: clip td + next cell, 3x deviceScaleFactor already set.
  const clip = {
    x: Math.max(0, region.td.x - 8),
    y: Math.max(0, region.rowTop - 14),
    width: Math.min(1440 - Math.max(0, region.td.x - 8), region.td.width + region.next.width + 16),
    height: (region.rowBottom - region.rowTop) + 28,
  };
  await page.screenshot({ path: `qa/${DATE}_sil484_ui-pill-${LABEL}-zoom.png`, clip });
  say(`[shot] qa/${DATE}_sil484_ui-pill-${LABEL}-zoom.png (clip=${JSON.stringify(clip)})`);

  // Context screenshot: the full NHẬP/XUẤT + Hãng tàu neighborhood.
  await page.evaluate(() => {
    const pill = document.querySelector('.shipment-container-ledger__direction');
    const tr = pill.closest('tr');
    tr.scrollIntoView({ block: 'center' });
  });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: `qa/${DATE}_sil484_ui-ledger-${LABEL}.png` });
  say(`[shot] qa/${DATE}_sil484_ui-ledger-${LABEL}.png`);

  fs.writeFileSync(`qa/${DATE}_sil484_probe_${LABEL}.json`, JSON.stringify({ label: LABEL, metrics, region }, null, 2) + '\n');
  fs.writeFileSync(`qa/${DATE}_sil484_ui-driver-${LABEL}.log`, log.join('\n') + '\n');
  say(`DONE label=${LABEL}`);
  process.exitCode = 0;
} catch (err) {
  say(`FAIL: ${err.message}`);
  fs.writeFileSync(`qa/${DATE}_sil484_ui-driver-${LABEL}.log`, log.join('\n') + '\n');
  process.exitCode = 1;
} finally {
  await browser.close();
}
