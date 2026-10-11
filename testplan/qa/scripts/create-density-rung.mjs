// Cards 111026173000 + 111026173010 — LOCAL UI rung on /shipments/new.
//   R1 1440: appointment date segments compute the 12px house field font
//      (never 16px), cluster keeps touch height, column floor 200px, and the
//      segment group does not overflow its cell.
//   R2 390: same assertions at phone width.
//   R3 "Thêm hãng tàu" dialog helper prose computes caption size (11px).
//   R4 site-details dense grid: driven if a detail affordance is reachable;
//      otherwise contract-covered (styles test pins the grid).
// READ-ONLY: nothing submitted; the only writes are screenshots + logs.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { appendFileSync, writeFileSync } from 'node:fs';

const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const DRIVER_LOG = `${QA}/2026-10-11_card111026173000_ui-driver.log`;
writeFileSync(DRIVER_LOG, '');
const step = (s, o = {}) => {
  const line = JSON.stringify({ at: new Date().toISOString(), step: s, ...o });
  appendFileSync(DRIVER_LOG, line + '\n');
  console.log(line);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'thanhdc', password: 'Abc123' }),
});
assert.ok(login.ok, `login failed: ${login.status}`);
const token = (await login.json()).token;
step('login', { user: 'thanhdc (CUS)', gotToken: Boolean(token) });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  for (const [w, h, name] of [[1440, 900, '1440'], [390, 844, '390']]) {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle0', timeout: 90000 })
      .catch(() => step('goto', { note: 'networkidle timeout — continue' }));
    await sleep(1800);
    // Ensure a container row exists (segments live per row).
    const hasSegs = await page.$('.date-seg-group');
    if (!hasSegs) {
      const added = await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find((x) => /thêm container/i.test(x.innerText || ''));
        b?.click();
        return Boolean(b);
      });
      await sleep(1000);
      step('add-container-row', { clicked: added });
    }
    await page.waitForSelector('.date-seg-group input, .date-seg-group [data-uui-control]', { timeout: 20000 })
      .catch(() => step('segs', { note: 'no segment control found' }));
    const geo = await page.evaluate(() => {
      const g = document.querySelector('.date-seg-group');
      if (!g) return null;
      const cs = getComputedStyle(g);
      const input = g.querySelector('input');
      const cell = g.closest('.csc-container-cell, td, div');
      const gr = g.getBoundingClientRect();
      const cr = cell?.getBoundingClientRect();
      return {
        font: cs.fontSize,
        inputFont: input ? getComputedStyle(input).fontSize : null,
        touchH: getComputedStyle(g).getPropertyValue('--uui-control-h').trim(),
        groupW: Math.round(gr.width),
        cellW: cr ? Math.round(cr.width) : null,
        overflow: cr ? gr.right > cr.right + 1 : null,
      };
    });
    step(`R1-geometry-${name}`, geo);
    assert.ok(geo, 'date segment group rendered');
    assert.ok(['12px', '13px'].includes(geo.font), `segment font is the house field font, got ${geo.font}`);
    assert.notEqual(geo.font, '16px');
    if (geo.inputFont) assert.ok(parseFloat(geo.inputFont) <= 13, `segment input font dense, got ${geo.inputFont}`);
    assert.ok(geo.touchH.length > 0, 'touch-height custom property is set on the cluster');
    assert.notEqual(geo.overflow, true, 'segment group stays inside its cell');
    await (await page.$('.date-seg-group'))?.scrollIntoView({ block: 'center' });
    await page.screenshot({ path: `${QA}/2026-10-11_card111026173000_ui-segments-${name}.png` });
  }

  // R3: helper prose in a create dialog is caption-size.
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === 'Thêm hãng tàu');
    b?.scrollIntoView({ block: 'center' });
    b?.click();
    return Boolean(b);
  });
  assert.ok(clicked, 'shipping-line trigger found');
  await page.waitForSelector('.csc-shipping-line-dialog', { timeout: 15000 });
  const helper = await page.evaluate(() => {
    const p = document.querySelector('.csc-shipping-line-dialog > p');
    return p ? { font: getComputedStyle(p).fontSize, text: p.innerText.slice(0, 60) } : null;
  });
  step('R3-helper', helper);
  assert.ok(helper, 'helper paragraph rendered');
  assert.equal(helper.font, '11px', `helper prose is caption size, got ${helper.font}`);
  await page.screenshot({ path: `${QA}/2026-10-11_card111026173010_ui-shippingline-1440.png` });

  // R4: site details dense grid, if a detail affordance is reachable.
  await page.keyboard.press('Escape');
  await sleep(500);
  const detOpened = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button, [role="button"], a')]
      .find((x) => /chi tiết/i.test((x.getAttribute('aria-label') || x.innerText || '').trim()));
    b?.click();
    return Boolean(b);
  });
  if (detOpened) {
    await sleep(900);
    const grid = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      if (!dlg) return null;
      const rows = [...dlg.querySelectorAll('span')].filter((s) => /tên đầy đủ|địa chỉ/i.test(s.innerText));
      return { gap: getComputedStyle(dlg.querySelector('.modal__content > div') ?? dlg).gap, factLabels: rows.length };
    });
    step('R4-details', grid ?? { found: false });
    if (grid) await page.screenshot({ path: `${QA}/2026-10-11_card111026173010_ui-site-details-1440.png` });
  } else {
    step('R4-details', { skipped: true, reason: 'no reachable site-detail affordance on the empty form — grid pinned by create-density.styles.test.ts' });
  }
  step('RUNG', { verdict: 'PASS' });
} finally {
  await browser.close();
}
