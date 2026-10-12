// Card 121026185560 — follow-up probe: (1) what the topbar search does at 390
// (computed style — width measured 0 there), (2) focus expansion on a second
// role (dungnv / Điều vận) at 1440 + 1366. Read-only.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { appendFileSync, writeFileSync } from 'node:fs';

const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const QA = '/Volumes/LexarSSD/projects/silversea/qa';
const DRIVER_LOG = `${QA}/2026-10-12_fb057-topbar-probe_ui-driver.log`;
writeFileSync(DRIVER_LOG, '');
const step = (s, o = {}) => {
  const line = JSON.stringify({ at: new Date().toISOString(), step: s, ...o });
  appendFileSync(DRIVER_LOG, line + '\n');
  console.log(line);
};

async function loginAs(identifier) {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (!r.ok) throw new Error(`login ${identifier} failed: ${r.status}`);
  return (await r.json()).token;
}

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  // ── Part 1: admin at 390 — computed style of the search ──
  const tokenAdmin = await loginAs('admin');
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), tokenAdmin);
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${BASE}/trips`, { waitUntil: 'networkidle0', timeout: 90000 })
    .catch(() => step('goto', { note: 'networkidle timeout — continue' }));
  await page.waitForSelector('.topbar, header', { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1200));
  const probe390 = await page.evaluate(() => {
    const el = document.querySelector('.topbar__search');
    if (!el) return { present: false };
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const parentCs = el.parentElement ? getComputedStyle(el.parentElement) : null;
    return {
      present: true,
      display: cs.display,
      visibility: cs.visibility,
      minWidth: cs.minWidth,
      maxWidth: cs.maxWidth,
      rectWidth: Math.round(r.width),
      parentDisplay: parentCs ? parentCs.display : null,
      parentOverflow: parentCs ? parentCs.overflow : null,
      topbarWidth: Math.round((el.closest('.topbar')?.getBoundingClientRect().width) ?? -1),
    };
  });
  step('admin-390-probe', probe390);
  await page.close();

  // ── Part 2: dungnv (Điều vận) expansion at 1440 + 1366 ──
  const tokenOps = await loginAs('dungnv');
  const page2 = await browser.newPage();
  await page2.evaluateOnNewDocument((t) => localStorage.setItem('token', t), tokenOps);
  await page2.setViewport({ width: 1440, height: 900 });
  await page2.goto(`${BASE}/dispatch`, { waitUntil: 'networkidle0', timeout: 90000 })
    .catch(() => step('goto-ops', { note: 'networkidle timeout — continue' }));
  await page2.waitForSelector('.topbar__search input', { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1200));

  for (const vw of [1440, 1366]) {
    await page2.setViewport({ width: vw, height: 900 });
    await new Promise((r) => setTimeout(r, 700));
    const rest = await page2.evaluate(() => Math.round(document.querySelector('.topbar__search').getBoundingClientRect().width));
    await page2.focus('.topbar__search input');
    await new Promise((r) => setTimeout(r, 450));
    const focus = await page2.evaluate(() => {
      const r = document.querySelector('.topbar__search').getBoundingClientRect();
      return { width: Math.round(r.width), clipped: r.right > window.innerWidth + 1 };
    });
    await page2.evaluate(() => document.querySelector('.topbar__search input')?.blur());
    await new Promise((r) => setTimeout(r, 400));
    const blurred = await page2.evaluate(() => Math.round(document.querySelector('.topbar__search').getBoundingClientRect().width));
    step('ops-measure', { role: 'dungnv (Điều vận)', vw, rest, focus: focus.width, clipped: focus.clipped, blurred });
    if (vw === 1440) {
      assert.ok(focus.width >= 480 && focus.width <= 560, `ops 1440 focus in 480-560 band (got ${focus.width})`);
    }
  }
  step('PROBE PASS', {});
} finally {
  await browser.close();
}
