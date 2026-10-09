// Card 091026164530 — lot quick-view dialog: does a 'Tổng quan'/'Chi tiết'
// tablist appear inside the drawer, and does the dialog differ between opens?
// READ-ONLY staging pass as admin: open drawer on TEST-LCL-362, dump roles +
// tablists + dialog text, close, repeat 3 times. No mutations.
import puppeteer from 'puppeteer';
import { appendFileSync } from 'node:fs';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const CARD = 'card091026164530';
const step = (s, o) => { const e = { at: new Date().toISOString(), step: s, ...o }; appendFileSync(`${QA}/2026-10-09_${CARD}_repro-driver.log`, JSON.stringify(e) + '\n'); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const login = await fetch('https://vantai.tingting.vip/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
const session = await login.json();
const token = session.token ?? session.accessToken ?? session?.data?.token;
step('login', { gotToken: Boolean(token), role: session.user?.role ?? null });
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto('https://vantai.tingting.vip/shipments?searchSuffix=TEST-LCL-362', { waitUntil: 'domcontentloaded', timeout: 60000 });
  let ready = false;
  for (let i = 0; i < 15 && !ready; i++) {
    await sleep(3000);
    ready = await page.evaluate(() => document.body.innerText.includes('TEST-LCL-362'));
  }
  step('page', { ready, url: page.url() });
  if (!ready) throw new Error('shipments list did not render TEST-LCL-362');
  for (let i = 1; i <= 3; i++) {
    const clicked = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '').startsWith('Mở chi tiết lô hàng'));
      if (!btn) return false;
      btn.click();
      return true;
    });
    await sleep(2500);
    const dump = await page.evaluate(() => {
      const dialog = document.querySelector('aside[role="dialog"], [role="dialog"]');
      if (!dialog) return { dialog: false };
      const roles = [...dialog.querySelectorAll('[role]')].map((n) => `${n.getAttribute('role')}:${(n.textContent || '').replace(/\s+/g, ' ').slice(0, 40)}`);
      const docTabs = [...document.querySelectorAll('[role="tablist"]')].map((n) => `${n.getAttribute('aria-label')} :: ${(n.textContent || '').replace(/\s+/g, ' ').slice(0, 90)}`);
      return {
        dialog: true,
        title: dialog.querySelector('h2')?.textContent ?? null,
        roles,
        tabCount: dialog.querySelectorAll('[role="tablist"]').length,
        docTabs,
        text: (dialog.textContent || '').replace(/\s+/g, ' ').slice(0, 600),
      };
    });
    step(`open-${i}`, { clicked, ...dump });
    await page.screenshot({ path: `${QA}/2026-10-09_${CARD}_open${i}.png`, fullPage: false });
    const closed = await page.evaluate(() => {
      const close = document.querySelector('aside[role="dialog"] button[aria-label="Đóng"], [role="dialog"] button[aria-label="Đóng"]');
      if (!close) return false;
      close.click();
      return true;
    });
    await sleep(1500);
    step(`close-${i}`, { closed, dialogGone: await page.evaluate(() => !document.querySelector('aside[role="dialog"], [role="dialog"]')) });
  }
  console.log('REPRO EVIDENCE CAPTURED');
} catch (e) {
  step('FAIL', { error: String(e && e.message ? e.message : e) });
  console.log('REPRO FAIL:', e && e.message ? e.message : e);
  process.exitCode = 1;
} finally { await browser.close(); }
