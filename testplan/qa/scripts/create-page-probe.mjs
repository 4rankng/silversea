// Owner reports (11/10 17:2x): /shipments/new on staging — (1) a dialog that
// reads like a message instead of dense data, (2) ballooned font somewhere,
// (3) general UI/UX review. READ-ONLY probe: opens the page and its dialogs,
// screenshots everything, measures computed font sizes. Nothing is submitted.
import puppeteer from 'puppeteer';
import { appendFileSync, writeFileSync, mkdirSync } from 'node:fs';

const BASE = 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const OUT = '/Volumes/LexarSSD/projects/silversea-prod/qa/probe-create';
mkdirSync(OUT, { recursive: true });
const LOG = `${OUT}/probe-driver.log`;
writeFileSync(LOG, '');
const step = (s, o = {}) => {
  const line = JSON.stringify({ at: new Date().toISOString(), step: s, ...o });
  appendFileSync(LOG, line + '\n');
  console.log(line);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'thanhdc', password: 'Abc123' }),
});
if (!login.ok) throw new Error(`login failed: ${login.status}`);
const token = (await login.json()).token;
step('login', { user: 'thanhdc (CUS)', ok: true });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle0', timeout: 90000 })
    .catch(() => step('goto', { note: 'networkidle timeout — continue' }));
  await sleep(2500);
  await page.screenshot({ path: `${OUT}/01-create-1440.png`, fullPage: true });
  step('page-loaded', { url: page.url() });

  // Font-size census: every visible element with direct text, largest first.
  const census = await page.evaluate(() => {
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let n;
    while ((n = walker.nextNode())) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const ownText = [...n.childNodes]
        .filter((c) => c.nodeType === 3 && c.textContent.trim())
        .map((c) => c.textContent.trim())
        .join(' ')
        .slice(0, 60);
      if (!ownText) continue;
      const fs = parseFloat(cs.fontSize);
      out.push({ fs, sel: `${n.tagName.toLowerCase()}.${[...n.classList].slice(0, 3).join('.')}`, text: ownText });
    }
    return out.sort((a, b) => b.fs - a.fs).slice(0, 30);
  });
  step('font-census-top30', { top: census.slice(0, 12) });

  // Open every candidate dialog trigger and screenshot what appears.
  const triggers = [
    { name: 'factory-detail', q: '[aria-label*="nhà máy" i], [aria-label*="factory" i], .csc-site-chip, .factory-row__detail' },
    { name: 'container-type-create', q: '.csc-container-cell__editor button, [class*="cell-picker"] button' },
    { name: 'port-create', q: 'button, [role="option"], [role="button"]' },
  ];
  // Generic sweep: click elements whose accessible name suggests dialog openers.
  const opened = await page.evaluate(() => {
    const names = [];
    for (const b of document.querySelectorAll('button, [role="button"], a[href]')) {
      const t = (b.getAttribute('aria-label') || b.innerText || '').trim();
      if (/thêm|tạo|mới|chi tiết|Thêm|Tạo/i.test(t) && t.length < 40) {
        names.push({ t: t.slice(0, 40), cls: (b.className || '').toString().slice(0, 60) });
      }
    }
    return names.slice(0, 40);
  });
  step('dialog-trigger-candidates', { count: opened.length, sample: opened.slice(0, 20) });

  let shotIdx = 2;
  for (const cand of opened.slice(0, 14)) {
    const sel = cand.cls ? `button.${cand.cls.split(/\s+/)[0]}` : null;
    if (!sel) continue;
    const found = await page.$$(sel);
    const el = [...found].find((e) => /thêm|tạo|mới|chi tiết|Thêm|Tạo/i.test((e.innerText || '')));
    if (!el) continue;
    await el.scrollIntoView({ block: 'center' });
    await el.click().catch(() => {});
    await sleep(1200);
    const dlg = await page.$('[role="dialog"], .modal__content, .confirm-box, [class*="dialog"], [class*="drawer"]');
    if (dlg) {
      const name = cand.t.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 24);
      await page.screenshot({ path: `${OUT}/0${shotIdx++}-dialog-${name}.png` });
      const info = await page.evaluate(() => {
        const d = document.querySelector('[role="dialog"], .modal__content, .confirm-box');
        return d ? { w: d.getBoundingClientRect().width, text: d.innerText.slice(0, 300) } : null;
      });
      step('dialog-open', { trigger: cand.t, info });
      await page.keyboard.press('Escape');
      await sleep(500);
      // Dismiss any leftover overlay
      await page.evaluate(() => document.querySelector('.modal, [class*="overlay"]')?.click?.());
      await sleep(400);
    }
  }

  // Mobile pass
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await sleep(800);
  await page.screenshot({ path: `${OUT}/99-create-390.png`, fullPage: true });
  step('mobile-shot', { done: true });
  step('PROBE', { verdict: 'DONE' });
} finally {
  await browser.close();
}
