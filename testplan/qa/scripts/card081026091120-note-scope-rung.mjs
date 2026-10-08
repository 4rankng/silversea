// Card 081026091120 — /dispatch-detail: the assignment dialog's note field
// must state that the note is LOT-shared, not per-container. Opens the first
// row's editor (real click) and asserts the scope hint inside the dialog.
import puppeteer from 'puppeteer';
import { appendFileSync } from 'node:fs';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const CARD = 'card081026091120';
const BASE = 'http://localhost:7175';
const step = (s, o) => { const e = { at: new Date().toISOString(), step: s, ...o }; appendFileSync(`${QA}/2026-10-08_${CARD}_ui-driver.log`, JSON.stringify(e) + '\n'); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const login = await fetch('http://localhost:3002/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'dieuvan', password: 'Abc123' }) });
const session = await login.json();
const token = session.token ?? session.accessToken ?? session?.data?.token;
step('login', { gotToken: Boolean(token), role: session.user?.role ?? null });
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (req) => { void req.continue(); });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  let trigger = null;
  for (let i = 0; i < 15 && !trigger; i++) {
    await sleep(3000);
    trigger = await page.evaluate(() => {
      const btn = document.querySelector('button[aria-label^="Sửa ô điều phối"]');
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), label: btn.getAttribute('aria-label') };
    });
  }
  step('grid', { editorTrigger: trigger });
  if (!trigger) throw new Error('no editor cell found on the detailed plan grid');
  await page.mouse.move(trigger.x, trigger.y); await page.mouse.down(); await page.mouse.up();
  let dialogOpen = false;
  for (let i = 0; i < 10 && !dialogOpen; i++) { await sleep(1500); dialogOpen = await page.evaluate(() => Boolean(document.querySelector('[role="dialog"]'))); }
  step('dialog', { open: dialogOpen });
  if (!dialogOpen) throw new Error('assignment dialog did not open');
  const verdict = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    return {
      hintText: dlg?.innerText.includes('Ghi chú dùng chung cả lô') ?? false,
      noteLabelPresent: dlg?.innerText.includes('Ghi chú thêm') ?? false,
      sample: dlg?.innerText.replace(/\s+/g, ' ').slice(0, 260) ?? null,
    };
  });
  step('dialog-verdict', verdict);
  await page.screenshot({ path: `${QA}/2026-10-08_${CARD}_ui-note-scope.png` });
  if (!verdict.hintText) throw new Error('lot-scope hint missing from the dialog');
  console.log('RUNG EVIDENCE CAPTURED');
} catch (e) {
  step('FAIL', { error: String(e && e.message ? e.message : e) });
  console.log('RUNG FAIL:', e && e.message ? e.message : e);
  process.exitCode = 1;
} finally { await browser.close(); }
