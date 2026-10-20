// Measure single-line widths of the create-page header labels under nowrap.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const OUT = path.resolve(import.meta.dirname, '../../../qa/2026-10-20-regressions');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
const { token } = await res.json();
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 45000 });
  await sleep(1500);
  const measure = await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = '.csc-container-table thead th { white-space: nowrap !important; overflow: visible !important; }';
    document.head.appendChild(style);
    const ths = [...document.querySelectorAll('.csc-container-table thead th')];
    return ths.map((th) => {
      const range = document.createRange();
      range.selectNodeContents(th);
      const rect = range.getBoundingClientRect();
      const cs = getComputedStyle(th);
      return {
        label: th.textContent.trim(),
        textW: Math.ceil(rect.width),
        padH: parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight),
        borderR: parseFloat(cs.borderRightWidth) || 0,
        neededColW: Math.ceil(rect.width + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + (parseFloat(cs.borderRightWidth) || 0)),
        currentColW: Math.round(th.getBoundingClientRect().width),
      };
    });
  });
  console.log(JSON.stringify(measure, null, 1));
  fs.writeFileSync(path.join(OUT, 'fb063-label-widths.json'), JSON.stringify(measure, null, 1));
} finally {
  await browser.close();
}
