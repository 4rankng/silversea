// Probe v3 — enumerate EVERY dialog reachable on /shipments/new at the
// owner's window size (1000×447 @DPR2 = image 2000×895), screenshot each.
// READ-ONLY: open, screenshot, close. Nothing submitted.
import puppeteer from 'puppeteer';
import { appendFileSync, writeFileSync, mkdirSync } from 'node:fs';

const BASE = 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const OUT = '/Volumes/LexarSSD/projects/silversea-prod/qa/probe-create';
mkdirSync(OUT, { recursive: true });
const LOG = `${OUT}/probe3-driver.log`;
writeFileSync(LOG, '');
const step = (s, o = {}) => {
  const line = JSON.stringify({ at: new Date().toISOString(), step: s, ...o });
  appendFileSync(LOG, line + '\n');
  console.log(line);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'thanhdc', password: 'Abc123' }),
});
const token = (await login.json()).token;

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1000, height: 447, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle0', timeout: 90000 })
    .catch(() => step('goto', { note: 'timeout — continue' }));
  await sleep(2000);

  const capture = async (name) => {
    await sleep(1000);
    const info = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"], .modal__content, [class*="__dialog"]');
      if (!d) return null;
      const r = d.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), text: d.innerText.replace(/\n+/g, ' | ').slice(0, 260) };
    });
    if (info) {
      await page.screenshot({ path: `${OUT}/20-${name}.png` });
      step('dialog', { name, ...info });
      await page.keyboard.press('Escape').catch(() => {});
      await sleep(600);
      // Force-close leftovers via any visible close button.
      await page.evaluate(() => {
        const btn = document.querySelector('[role="dialog"] button[aria-label*="Đóng" i], .modal__close, [class*="dialog"] button:first-of-type');
        btn?.click();
      });
      await sleep(600);
    } else {
      step('dialog', { name, found: false });
    }
  };

  // Always-visible utility buttons.
  for (const label of ['Thêm khách hàng', 'Thêm hãng tàu', 'Thêm nhà máy']) {
    const clicked = await page.evaluate((l) => {
      const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === l);
      if (!b) return false;
      b.scrollIntoView({ block: 'center' });
      b.click();
      return true;
    }, label);
    step('click', { label, clicked });
    await capture(label.replace(/\s+/g, '-').toLowerCase());
  }

  // Route create: focus the route combobox, type, click the create option.
  const routeOk = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input[role="combobox"], input')];
    const el = inputs.find((i) => /tuyến/i.test(i.closest('[class*="field"], label, div')?.innerText || '') || /tuyến/i.test(i.placeholder || ''));
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    el.focus();
    return true;
  });
  if (routeOk) {
    await page.keyboard.type('Hải Phòng', { delay: 30 });
    await sleep(1500);
    await page.evaluate(() => {
      const opt = [...document.querySelectorAll('[role="option"], li, button')]
        .find((x) => /thêm tuyến/i.test(x.innerText || x.textContent || ''));
      opt?.click();
    });
    await capture('route-create');
  }
  step('PROBE3', { verdict: 'DONE' });
} finally {
  await browser.close();
}
