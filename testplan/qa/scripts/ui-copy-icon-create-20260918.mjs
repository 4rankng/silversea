// TC-COPY-PLACE-01/03: the bulk-copy affordance lives in the STT cell as an
// icon button (ruling 2026-09-18) and never covers the appointment controls.
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'fs';

const BASE = 'http://localhost:7174';
const API = 'http://localhost:3001/api';

mkdirSync('qa', { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const LOGFILE = `qa/${ts}_local-copy-icon_ui-driver.log`;
const lines = [];
const log = (s) => { console.log(s); lines.push(s); writeFileSync(LOGFILE, lines.join('\n') + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = {};

log('=== TC-COPY-PLACE-01/03 — create page copy affordance placement ===');
log('timestamp: ' + new Date().toISOString());

const login = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'thanhdc', password: 'Abc123' }),
});
const { token, user } = await login.json();
log(`login ${user.username} role=${user.role}`);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  page.on('pageerror', (e) => log('PAGE ERROR: ' + e.message));
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForFunction(() => document.body.innerText.includes('Tạo lô hàng'));
  await sleep(1000);

  const add = async () => {
    const h = await page.evaluateHandle(() => Array.from(document.querySelectorAll('button')).find((b) => b.innerText.trim() === 'Thêm container') || null);
    await h.asElement().click();
    await sleep(450);
  };
  await add(); await add();

  await page.evaluate(() => {
    const dates = [...document.querySelectorAll('input[id$="-customer-appointment-date"]')];
    const times = [...document.querySelectorAll('input[id$="-customer-appointment-time"]')];
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(dates[0], '20/09/2026'); dates[0].dispatchEvent(new Event('input', { bubbles: true })); dates[0].dispatchEvent(new Event('change', { bubbles: true }));
    setter.call(times[0], '09:00'); times[0].dispatchEvent(new Event('input', { bubbles: true })); times[0].dispatchEvent(new Event('change', { bubbles: true }));
  });
  await sleep(800);

  // hover row 1
  await page.hover('tr.csc-container-row');
  await sleep(400);

  const probe = await page.evaluate(() => {
    const row = document.querySelector('tr.csc-container-row');
    const button = row.querySelector('.csc-container-row__copy');
    const appointmentCell = row.querySelector('input[id$="-customer-appointment-date"]').closest('td');
    const timeInput = row.querySelector('input[id$="-customer-appointment-time"]');
    const dateInput = row.querySelector('input[id$="-customer-appointment-date"]');
    const rect = (n) => { const r = n.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    const topAt = (node) => { const r = node.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); };
    const cs = button ? getComputedStyle(button) : null;
    return {
      hasButton: Boolean(button),
      buttonInIndexCell: button ? Boolean(button.closest('th.csc-container-row__index')) : false,
      buttonText: button ? button.textContent.trim() : null,
      buttonVisible: cs ? cs.visibility : null,
      buttonShape: cs ? { w: cs.width, h: cs.height, radius: cs.borderRadius, border: cs.borderTopWidth + ' ' + cs.borderTopColor, background: cs.backgroundColor } : null,
      buttonRect: button ? rect(button) : null,
      buttonsInAppointmentCell: appointmentCell.querySelectorAll('button').length,
      timeInputValue: timeInput.value, dateInputValue: dateInput.value,
      topElementOnTimeInput: topAt(timeInput)?.tagName + '.' + (topAt(timeInput)?.className || ''),
      topElementOnDateInput: topAt(dateInput)?.tagName + '.' + (topAt(dateInput)?.className || ''),
      timeInputIsTop: topAt(timeInput) === timeInput,
      dateInputIsTop: topAt(dateInput) === dateInput,
    };
  });
  log('hover probe: ' + JSON.stringify(probe, null, 2));
  results.placement = probe;
  await page.screenshot({ path: `qa/${ts}_copy-icon-hover.png` });
  await page.screenshot({ path: `qa/${ts}_copy-icon-hover-clip.png`, clip: { x: 260, y: 530, width: 940, height: 300 } });

  // keyboard: focus-within must reveal it (SIS-ROLE-07)
  await page.evaluate(() => document.querySelector('input[id$="-customer-appointment-time"]').focus());
  await page.mouse.move(10, 10);
  await sleep(300);
  const focusReveal = await page.evaluate(() => {
    const b = document.querySelector('.csc-container-row__copy');
    return { visibility: getComputedStyle(b).visibility, focusable: b.tabIndex >= 0 };
  });
  log('focus-within reveal: ' + JSON.stringify(focusReveal));
  results.focusReveal = focusReveal;

  // click it → fills the empty rows
  await page.hover('tr.csc-container-row');
  await sleep(250);
  const btn = await page.$('.csc-container-row__copy');
  await btn.click();
  await sleep(900);
  const after = await page.evaluate(() => ({
    dates: [...document.querySelectorAll('input[id$="-customer-appointment-date"]')].map((e) => e.value),
    times: [...document.querySelectorAll('input[id$="-customer-appointment-time"]')].map((e) => e.value),
    toast: [...document.querySelectorAll('[role="status"]')].map((e) => e.innerText.trim()).filter(Boolean),
    buttonGone: !document.querySelector('.csc-container-row__copy'),
  }));
  log('after click: ' + JSON.stringify(after, null, 2));
  results.copyBehaviour = after;
  await page.screenshot({ path: `qa/${ts}_copy-icon-after-click.png` });
} finally {
  await browser.close();
}

log('--- results ---');
log(JSON.stringify(results, null, 2));
writeFileSync(LOGFILE, lines.join('\n') + '\n');
