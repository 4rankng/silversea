// FB-001 probe v2 — real pointer taps on the container row's NGÀY GIỜ ĐÓNG TRẢ.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const EV = '/Volumes/LexarSSD/projects/silversea-prod/qa/evidence/2026-10-08_fb038-fb001-minimax';
const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002';
const log = (m) => { console.log(`[probe] ${m}`); fs.appendFileSync(`${EV}/fb001_ui-driver.log`, `[probe] ${m}\n`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const loginRes = await fetch(`${API}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'thanhdc', password: 'Abc123' }),
});
const { token } = await loginRes.json();
const browser = await puppeteer.launch({ headless: true, defaultViewport: { width: 1440, height: 1200 } });
try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('[data-seg-part]', { timeout: 30000 });
  await sleep(1000);

  // locate the container-row appointment field (id container-*-customer-appointment-<part>-segments)
  const field = await page.evaluate(() => {
    const seg = document.querySelector('[id*="customer-appointment"][data-seg-part]');
    if (!seg) return null;
    const r = seg.getBoundingClientRect();
    return { id: seg.id, part: seg.getAttribute('data-seg-part'), x: r.x, y: r.y, w: r.width, h: r.height };
  });
  if (!field) throw new Error('appointment segments not found');
  log(`appointment field: ${JSON.stringify(field)}`);
  await page.evaluate(() => document.querySelector('[id*="customer-appointment"][data-seg-part]').scrollIntoView({ block: 'center' }));
  await sleep(600);

  const rect = async () => page.evaluate(() => {
    const time = document.querySelector('[id*="customer-appointment"][data-seg-part="time"]');
    const date = document.querySelector('[id*="customer-appointment"][data-seg-part="date"]');
    const rt = time.getBoundingClientRect(); const rd = date.getBoundingClientRect();
    return { time: { x: rt.x, y: rt.y, w: rt.width, h: rt.height }, date: { x: rd.x, y: rd.y, w: rd.width, h: rd.height } };
  });
  const box = await rect();
  log(`rects: ${JSON.stringify(box)}`);

  const dialogOpen = async () => page.evaluate(() => {
    const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => x.textContent.includes('Chọn ngày giờ'));
    return d ? { open: true, header: d.querySelector('header')?.textContent?.trim() ?? '', date: Boolean(d.querySelector('.combined-datetime__date')), time: Boolean(d.querySelector('.combined-datetime__time')) } : { open: false };
  });
  const tap = async (x, y) => { await page.mouse.move(x, y, { steps: 5 }); await page.mouse.down(); await page.mouse.up(); };

  // PATH 1: click ON a segment input (hh) — per card 061026172803 ruling: caret only, no picker
  await tap(box.time.x + 12, box.time.y + box.time.h / 2);
  await sleep(800);
  log(`PATH1 segment-click → ${JSON.stringify(await dialogOpen())}`);
  await page.screenshot({ path: `${EV}/fb001_ui-probe-path1-segment-click.png` });

  // close if open (Escape) for the next path
  await page.keyboard.press('Escape'); await sleep(400);

  // PATH 2: click the group frame — the gap right of the last yyyy input inside the date group
  const gap = await page.evaluate(() => {
    const date = document.querySelector('[id*="customer-appointment"][data-seg-part="date"]');
    const inputs = [...date.querySelectorAll('input')];
    const last = inputs[inputs.length - 1].getBoundingClientRect();
    const g = date.getBoundingClientRect();
    return { x: last.x + last.width + (g.x + g.width - (last.x + last.width)) / 2, y: g.y + g.height / 2, slack: g.x + g.width - (last.x + last.width) };
  });
  log(`date-group right slack: ${JSON.stringify(gap)}`);
  await tap(gap.x, gap.y);
  await sleep(800);
  log(`PATH2 frame-click (slack ${gap.slack}px) → ${JSON.stringify(await dialogOpen())}`);
  await page.screenshot({ path: `${EV}/fb001_ui-probe-path2-frame-click.png` });
  await page.keyboard.press('Escape'); await sleep(400);

  // PATH 3: double-click on a segment (the reporter's đơn/đúp)
  await tap(box.time.x + 12, box.time.y + box.time.h / 2);
  await sleep(200);
  await tap(box.time.x + 12, box.time.y + box.time.h / 2);
  await sleep(800);
  log(`PATH3 dblclick segment → ${JSON.stringify(await dialogOpen())}`);
  await page.screenshot({ path: `${EV}/fb001_ui-probe-path3-dblclick.png` });
} finally { await browser.close(); }
