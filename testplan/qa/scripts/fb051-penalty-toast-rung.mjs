// Card 101026163020 (FB-051) — LOCAL UI rung: edit a penalty reason's default amount on
// /config/penalty-reasons and observe the toast log ([role="log"]) right after
// save. Expectation per round 12: success toast "Đã cập nhật cấu hình."
import puppeteer from 'puppeteer';
import { appendFileSync, writeFileSync } from 'node:fs';

const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const DRIVER_LOG = `${QA}/2026-10-10_fb051-penalty-toast_repro-driver.log`;
writeFileSync(DRIVER_LOG, '');
const step = (s, o) => {
  const e = { at: new Date().toISOString(), step: s, ...o };
  appendFileSync(DRIVER_LOG, JSON.stringify(e) + '\n');
  console.log(JSON.stringify(e));
};

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
});
if (!login.ok) throw new Error(`login admin failed: ${login.status}`);
const session = await login.json();
const token = session.token ?? session.accessToken ?? session?.data?.token;
step('login', { user: 'admin', gotToken: Boolean(token) });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });

  await page.goto(`${BASE}/config/penalty-reasons`, { waitUntil: 'networkidle0', timeout: 90000 }).catch(() => step('goto', { note: 'networkidle timeout — continue' }));
  await page.waitForFunction(() => document.body.innerText.includes('Danh mục lỗi vi phạm'), { timeout: 90000 });
  step('page-loaded');

  // Grab the first card's current amount, then open its edit modal
  const before = await page.evaluate(() => {
    const card = document.querySelector('.pr-card');
    return {
      title: card?.querySelector('.pr-card-title')?.textContent ?? null,
      amount: card?.querySelector('.pr-fine .v')?.textContent ?? null,
    };
  });
  step('first-card', before);

  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.pr-card .pr-act')].find((b) => (b.getAttribute('aria-label') || b.title || '').toLowerCase().includes('sửa'));
    (btn ?? document.querySelector('.pr-card .pr-act'))?.click();
  });
  await page.waitForSelector('[role="dialog"] input[type="number"]', { timeout: 15000 });
  const modalState = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    return { dialogTitle: dlg?.querySelector('h2, h3, [class*="title"]')?.textContent ?? null, dialogText: (dlg?.textContent || '').slice(0, 150) };
  });
  step('edit-modal-open', modalState);

  // Edit the amount: current value + 1 (mirrors the QA flow 1.000.000 → 1.000.001)
  const amountInput = await page.$('[role="dialog"] input[type="number"]');
  await amountInput.click({ clickCount: 3 });
  const newAmount = await page.evaluate(() => {
    const input = document.querySelector('[role="dialog"] input[type="number"]');
    const current = Number(input.value);
    const next = Number.isFinite(current) ? current + 1 : 1000001;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, String(next));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return { current, next };
  });
  step('amount-edited', newAmount);

  // Save
  await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    const btn = [...dlg.querySelectorAll('button')].find((b) => /lưu thay đổi/i.test(b.textContent || ''));
    btn?.click();
  });
  step('save-clicked');

  // Probe the toast log IMMEDIATELY and over time (entering animation + 4.5s life)
  for (const delay of [400, 1200, 2500]) {
    await new Promise((r) => setTimeout(r, delay === 400 ? 400 : delay - 400));
    const probe = await page.evaluate(() => {
      const log = document.querySelector('.toast-container[role="log"]');
      const toasts = [...document.querySelectorAll('.toast')].map((t) => {
        const cs = getComputedStyle(t);
        return { text: t.textContent?.slice(0, 80), opacity: cs.opacity, display: cs.display, className: t.className };
      });
      return { logExists: Boolean(log), logInBody: log ? log.parentElement === document.body : null, toasts };
    });
    step(`toast-probe@${delay}ms`, probe);
  }
  await page.screenshot({ path: `${QA}/2026-10-10_fb051-penalty-toast_after-save.png` });

  // Was the card updated? And did the modal close?
  const after = await page.evaluate(() => ({
    modalOpen: Boolean(document.querySelector('[role="dialog"]')),
    firstCardAmount: document.querySelector('.pr-card .pr-fine .v')?.textContent ?? null,
  }));
  step('after-save', after);
  step('console-errors', { errors: consoleErrors.slice(0, 5) });
  step('done');
} finally { await browser.close(); }
appendFileSync(DRIVER_LOG, 'DRIVER OK\n');
console.log('DRIVER OK');
