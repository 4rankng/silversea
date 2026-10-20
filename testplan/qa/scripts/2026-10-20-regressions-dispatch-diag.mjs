// Console/network diagnostic for /dispatch-detail as dieuvan.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const OUT = path.resolve(import.meta.dirname, '../../../qa/2026-10-20-regressions');
const log = (step, obj = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), step, ...obj }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'dieuvan', password: 'Abc123' }) });
const { token } = await res.json();

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log('console', { type: m.type(), text: m.text().slice(0, 300) }); });
  page.on('pageerror', (e) => log('pageerror', { message: String(e).slice(0, 300) }));
  page.on('response', (r) => { if (r.status() >= 400) log('http-error', { status: r.status(), url: r.url().slice(0, 160) }); });
  page.on('requestfailed', (r) => log('request-failed', { url: r.url().slice(0, 160), err: r.failure()?.errorText }));
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(10000);
  const state = await page.evaluate(() => ({
    gridRows: document.querySelectorAll('.detailed-plan-grid tbody tr, [class*=detailed-plan] tr').length,
    anyButton: [...document.querySelectorAll('button')].slice(0, 10).map((b) => b.textContent.trim().slice(0, 30)).filter(Boolean),
    bodyTail: document.body.innerText.split('\n').filter(Boolean).slice(-15),
  }));
  log('page-state', state);
  await page.screenshot({ path: path.join(OUT, 'fb066-dispatch-detail-diag.png'), fullPage: false });
} finally {
  await browser.close();
}
