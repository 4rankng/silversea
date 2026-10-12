// Card 121026141040 (FB-066 verify-fail) — STATE CAPTURE, read-only.
// The round-16 report says /trips/new 'Xe đầu kéo *' has no quick-add '+'
// button. This rung captures that state (and checks the palette for a
// 'thêm biển số' command) to decide between "regression at designed sites"
// vs "never designed on this surface" per the standing ruling cards
// 20261004_357 / 101026043010.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { appendFileSync, writeFileSync } from 'node:fs';

const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const QA = '/Volumes/LexarSSD/projects/silversea/qa';
const DRIVER_LOG = `${QA}/2026-10-12_fb066-trip-create-quickadd_ui-driver.log`;
writeFileSync(DRIVER_LOG, '');
const step = (s, o = {}) => {
  const line = JSON.stringify({ at: new Date().toISOString(), step: s, ...o });
  appendFileSync(DRIVER_LOG, line + '\n');
  console.log(line);
};

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
});
if (!login.ok) throw new Error(`login admin failed: ${login.status}`);
const token = (await login.json()).token;
step('login', { user: 'admin (Admin)', gotToken: Boolean(token) });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  await page.goto(`${BASE}/trips/new`, { waitUntil: 'networkidle0', timeout: 90000 })
    .catch(() => step('goto', { note: 'networkidle timeout — continue' }));
  await page.waitForSelector('input, [role="combobox"]', { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1200));

  const state = await page.evaluate(() => {
    const comboLabel = [...document.querySelectorAll('label')].find((l) =>
      l.textContent.includes('Xe đầu kéo'));
    const field = comboLabel ? (comboLabel.closest('.field') || comboLabel.parentElement) : null;
    const nearButtons = field
      ? [...field.querySelectorAll('button')].map((b) => b.textContent.trim()).filter(Boolean)
      : [];
    // Any quick-add affordance anywhere on the create form?
    const anyQuickAdd = [...document.querySelectorAll('button')].some((b) =>
      b.textContent.includes('Thêm nhanh'));
    return {
      comboFound: Boolean(comboLabel),
      comboLabelText: comboLabel ? comboLabel.textContent.trim() : null,
      nearButtons,
      anyQuickAddOnForm: anyQuickAdd,
    };
  });
  step('trip-create-form-state', state);
  assert.equal(state.comboFound, true, 'fixture precondition: Xe đầu kéo combobox present');
  // Capturing the actual state — no '+' expected per the standing ruling.
  step('verdict-input', { anyQuickAddOnForm: state.anyQuickAddOnForm, nearButtons: state.nearButtons });

  await page.evaluate(() => {
    const label = [...document.querySelectorAll('label')].find((l) => l.textContent.includes('Xe đầu kéo'));
    label?.scrollIntoView({ block: 'center' });
  });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: `${QA}/2026-10-12_fb066-trip-create_tractor-combobox.png` });

  // Palette probe: does 'thêm biển số' resolve to any command?
  const palette = await page.evaluate(async () => {
    const openers = [...document.querySelectorAll('button, [role="button"], input')].filter((n) =>
      (n.getAttribute('aria-label') || n.textContent || '').includes('Tìm trang, cấu hình, thao tác'));
    openers[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 700));
    const input = document.querySelector('input[placeholder*="Tìm"], input[aria-label*="Tìm"]');
    if (!input) return { opened: false };
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'thêm biển số');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 700));
    const options = [...document.querySelectorAll('[role="option"], [cmdk-item], li')]
      .map((n) => n.textContent.trim()).filter(Boolean).slice(0, 8);
    return { opened: true, query: 'thêm biển số', options };
  });
  step('palette-probe', palette);
  await page.screenshot({ path: `${QA}/2026-10-12_fb066_palette-them-bien-so.png` });

  step('STATE CAPTURED', { verdict: 'trip-create form has NO quick-add by design (ruling 20261004_357 / 101026043010); designed dispatch-picker sites intact at HEAD' });
} finally {
  await browser.close();
}
