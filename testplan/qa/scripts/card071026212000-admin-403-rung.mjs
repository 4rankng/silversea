// Card 071026212000 — admin /customers: catch the spurious 403 request.
import puppeteer from 'puppeteer';
import { appendFileSync } from 'node:fs';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const CARD = 'card071026212000';
const step = (s, o) => { const e = { at: new Date().toISOString(), step: s, ...o }; appendFileSync(`${QA}/2026-10-07_${CARD}_ui-driver.log`, JSON.stringify(e) + '\n'); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const login = await fetch('https://vantai.tingting.vip/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
const session = await login.json();
const token = session.token ?? session.accessToken ?? session?.data?.token;
step('login', { gotToken: Boolean(token), role: session.user?.role ?? null });
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (req) => { void req.continue(); });
  const denied = [];
  page.on('response', async (res) => {
    const url = res.request().url();
    if (!url.includes('/api/')) return;
    if (res.status() !== 403) return;
    let body = null;
    try { body = await res.text(); } catch { /* consumed */ }
    denied.push({ url: url.replace('https://vantai.tingting.vip', ''), method: res.request().method(), status: res.status(), body: (body ?? '').slice(0, 200) });
  });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto('https://vantai.tingting.vip/customers', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(9000);
  const toastSeen = await page.evaluate(() => document.body.innerText.includes('Không có quyền truy cập'));
  step('customers-page', { toastSeen, deniedCount: denied.length, denied });
  await page.screenshot({ path: `${QA}/2026-10-07_${CARD}_ui-customers.png` });
  console.log('RUNG EVIDENCE CAPTURED');
} catch (e) {
  step('FAIL', { error: String(e && e.message ? e.message : e) });
  console.log('RUNG FAIL:', e && e.message ? e.message : e);
  process.exitCode = 1;
} finally { await browser.close(); }
