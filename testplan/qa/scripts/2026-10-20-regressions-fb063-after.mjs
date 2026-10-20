// FB-063 card 201026101500 — AFTER-fix verification: every header label on
// /shipments/new must be exactly ONE line at 1440/1366/1280, and no label may
// overflow its cell (nowrap must not shear text out of the column).
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.QA_BASE || 'http://localhost:7175';
const API = process.env.QA_API || 'http://localhost:3002/api';
const OUT = path.resolve(import.meta.dirname, '../../../qa/2026-10-20-regressions');
fs.mkdirSync(OUT, { recursive: true });
const LOG = [];
const log = (step, obj = {}) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
const { token } = await res.json();

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  let allOneLine = true;
  for (const width of [1440, 1366, 1280]) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 900 });
    await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
    await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 45000 });
    await sleep(1500);
    const headers = await page.evaluate(() => {
      const ths = [...document.querySelectorAll('.csc-container-table thead th')];
      return ths.filter((th) => !th.querySelector('.sr-only')).map((th) => {
        const range = document.createRange();
        range.selectNodeContents(th);
        const rects = [...range.getClientRects()].filter((r) => r.height > 1);
        const lines = [];
        for (const r of rects) {
          const hit = lines.find((l) => Math.abs(l.top - r.top) < r.height * 0.6);
          if (hit) hit.width += r.width; else lines.push({ top: r.top, width: r.width });
        }
        return { label: th.textContent.trim(), lineCount: lines.length, textW: Math.ceil(Math.max(0, ...lines.map((l) => l.width), 0)), cellW: Math.round(th.getBoundingClientRect().width) };
      });
    });
    const wrapped = headers.filter((h) => h.lineCount > 1);
    const sheared = headers.filter((h) => h.textW > h.cellW);
    if (wrapped.length || sheared.length) allOneLine = false;
    log('fb063-after', { width, headers, wrappedLabels: wrapped.map((w) => w.label), shearedLabels: sheared.map((s) => s.label) });
    if (width === 1440) await page.screenshot({ path: path.join(OUT, 'fb063-after-header-1440.png'), fullPage: false });
    await page.close();
  }
  log('verdict', { allOneLine, pass: allOneLine });
  if (!allOneLine) process.exitCode = 1;
} catch (err) {
  log('driver-error', { message: err.message });
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(OUT, 'fb063-after-driver.log'), LOG.map((l) => JSON.stringify(l)).join('\n') + '\n');
  await browser.close();
}
