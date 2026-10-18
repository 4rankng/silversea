// Debug probe: where do keystrokes land after triple-click on a prefilled Giờ?
import puppeteer from 'puppeteer';

const API = 'http://localhost:3002/api';
const BASE = 'http://localhost:7179';
const login = async () => {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'cus', password: 'Abc123' }) });
  return (await res.json()).token;
};
const token = await login();
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
await page.goto(`${BASE}/shipments?transportDateFrom=2026-10-20&transportDateTo=2026-10-20`, { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForSelector('#cus-inline-schedule-130022', { timeout: 20000 });
const btn = await page.$('#cus-inline-schedule-130022');
await btn.click();
await page.waitForFunction(() => Array.from(document.querySelectorAll('.modal__title')).some((el) => (el.textContent || '').trim() === 'Chỉnh sửa Lịch trình'), { timeout: 10000 });
await new Promise((r) => setTimeout(r, 400));
const dump = (tag) => page.evaluate((t) => {
  const a = document.activeElement;
  const input = document.querySelector('[role="dialog"] .time-input input');
  return { tag: t, activeTag: a?.tagName, activeLabel: a?.getAttribute('aria-label'), activeSeg: a?.getAttribute('data-seg'),
    value: input?.value, selStart: input?.selectionStart, selEnd: input?.selectionEnd,
    activeIsTimeInput: a === input, activeValue: a?.value ?? null, popup: Boolean(document.querySelector('.time-picker__popup')) };
}, tag).then((r) => console.log(JSON.stringify(r)));
await dump('open');
const ti = await page.$('[role="dialog"] .time-input input');
await ti.click();
await new Promise((r) => setTimeout(r, 300));
await dump('single-click');
await page.keyboard.down('Meta'); await page.keyboard.press('a'); await page.keyboard.up('Meta');
await new Promise((r) => setTimeout(r, 200));
await dump('cmd-a');
await page.keyboard.press('ArrowLeft');
await new Promise((r) => setTimeout(r, 150));
await dump('arrow-left');
await page.keyboard.type('9', { delay: 120 });
await new Promise((r) => setTimeout(r, 200));
await dump('typed-9');
await page.keyboard.type('15', { delay: 120 });
await new Promise((r) => setTimeout(r, 200));
await dump('typed-15');
await page.keyboard.type('45', { delay: 120 });
await new Promise((r) => setTimeout(r, 200));
await dump('typed-1545');
await page.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 1200));
await dump('after-enter');
await browser.close();
