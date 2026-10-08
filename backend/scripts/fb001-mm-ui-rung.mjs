// FB-001 UI rung — real pointer taps on /shipments/new (CUS thanhdc) at HEAD+fix.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const EV = '/Volumes/LexarSSD/projects/silversea-prod/qa/evidence/2026-10-08_fb038-fb001-minimax';
const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002';
const log = (m) => { console.log(`[rung] ${m}`); fs.appendFileSync(`${EV}/fb001_ui-driver.log`, `[rung] ${m}\n`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const loginRes = await fetch(`${API}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'thanhdc', password: 'Abc123' }),
});
const { token } = await loginRes.json();
if (!token) throw new Error('no token');

const browser = await puppeteer.launch({ headless: true, defaultViewport: { width: 1440, height: 1200 } });
try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('[id*="customer-appointment"][data-seg-part]', { timeout: 30000 });
  await page.evaluate(() => document.querySelector('[id*="customer-appointment"][data-seg-part]')?.scrollIntoView({ block: 'center' }));
  await sleep(600);

  const rects = () => page.evaluate(() => {
    const time = document.querySelector('[id*="customer-appointment"][data-seg-part="time"]');
    const date = document.querySelector('[id*="customer-appointment"][data-seg-part="date"]');
    const split = date.closest('[data-split-datetime]');
    const rt = time.getBoundingClientRect(); const rd = date.getBoundingClientRect(); const rs = split.getBoundingClientRect();
    return { time: { x: rt.x, y: rt.y, w: rt.width, h: rt.height }, date: { x: rd.x, y: rd.y, w: rd.width, h: rd.height }, split: { x: rs.x, y: rs.y, w: rs.width, h: rs.height } };
  });
  const dialogState = async () => page.evaluate(() => {
    const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => x.textContent.includes('Chọn ngày giờ'));
    return d ? { open: true, date: Boolean(d.querySelector('.combined-datetime__date')), time: Boolean(d.querySelector('.combined-datetime__time')) } : { open: false };
  });
  const tap = async (x, y) => { await page.mouse.move(x, y, { steps: 5 }); await page.mouse.down(); await page.mouse.up(); };
  const closePicker = async () => { await page.keyboard.press('Escape'); await sleep(500); };

  const box = await rects();
  log(`rects 1440: ${JSON.stringify(box)}`);

  // PATH A — dead-space click right of the date group inside the split field body
  const dead = await page.evaluate(() => {
    const split = document.querySelector('[id*="customer-appointment"][data-seg-part="date"]').closest('[data-split-datetime]');
    const date = document.querySelector('[id*="customer-appointment"][data-seg-part="date"]');
    const rs = split.getBoundingClientRect(); const rd = date.getBoundingClientRect();
    return { x: rd.x + rd.width + (rs.x + rs.width - rd.x - rd.width) / 2, y: rs.y + rs.height / 2, slack: rs.x + rs.width - rd.x - rd.width };
  });
  log(`dead-space slack: ${dead.slack}px`);
  await tap(dead.x, dead.y); await sleep(900);
  const pathA = await dialogState();
  log(`PATH A dead-space click → ${JSON.stringify(pathA)}`);
  await page.screenshot({ path: `${EV}/fb001_ui-1-deadspace-opens-picker-1440.png` });
  await closePicker();

  // PATH B — segment click stays caret (law unchanged)
  await tap(box.time.x + 12, box.time.y + box.time.h / 2); await sleep(800);
  const pathB = await dialogState();
  const focusedSeg = await page.evaluate(() => document.activeElement?.getAttribute('data-seg') ?? 'none');
  log(`PATH B segment click → ${JSON.stringify(pathB)} focused=${focusedSeg}`);
  await page.screenshot({ path: `${EV}/fb001_ui-2-segment-still-caret-1440.png` });
  await closePicker();

  // PATH C — double click on the field body
  await tap(dead.x, dead.y); await sleep(150); await tap(dead.x, dead.y); await sleep(900);
  const pathC = await dialogState();
  log(`PATH C double-click → ${JSON.stringify(pathC)}`);
  await closePicker();

  // pick a date to prove the picker is functional (real tap on a calendar day)
  await tap(dead.x, dead.y); await sleep(800);
  const picked = await page.evaluate(() => {
    const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => x.textContent.includes('Chọn ngày giờ'));
    const days = d ? [...d.querySelectorAll('button')].filter((b) => /^\d{1,2}$/.test(b.textContent.trim()) && !b.disabled) : [];
    const target = days.find((b) => b.textContent.trim() === '15');
    if (!target) return 'no-day-15';
    const r = target.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (typeof picked === 'object') { await tap(picked.x, picked.y); await sleep(600); }
  const segAfterPick = await page.evaluate(() => document.querySelector('[id*="customer-appointment"][data-seg-part="date"]')?.textContent?.replace(/\s+/g, ' ').trim());
  log(`picked day 15 → date segments: ${segAfterPick}`);
  await page.screenshot({ path: `${EV}/fb001_ui-3-picker-picked-day-1440.png` });
  await page.keyboard.press('Escape'); await sleep(400);

  // ---------- 390 viewport ----------
  await page.setViewport({ width: 390, height: 844 });
  await sleep(900);
  await page.evaluate(() => document.querySelector('[id*="customer-appointment"][data-seg-part]')?.scrollIntoView({ block: 'center' }));
  await sleep(600);
  const box390 = await rects();
  log(`rects 390: ${JSON.stringify(box390)}`);
  const dead390 = await page.evaluate(() => {
    const split = document.querySelector('[id*="customer-appointment"][data-seg-part="date"]').closest('[data-split-datetime]');
    const date = document.querySelector('[id*="customer-appointment"][data-seg-part="date"]');
    const rs = split.getBoundingClientRect(); const rd = date.getBoundingClientRect();
    return { x: rd.x + rd.width + (rs.x + rs.width - rd.x - rd.width) / 2, y: rs.y + rs.height / 2, slack: rs.x + rs.width - rd.x - rd.width };
  });
  await tap(dead390.x, dead390.y); await sleep(900);
  const pathA390 = await dialogState();
  log(`PATH A@390 dead-space click → ${JSON.stringify(pathA390)}`);
  await page.screenshot({ path: `${EV}/fb001_ui-4-deadspace-opens-picker-390.png` });

  console.log(JSON.stringify({ pathA, pathB, focusedSeg, pathC, pathA390, segAfterPick }));
} finally { await browser.close(); }
