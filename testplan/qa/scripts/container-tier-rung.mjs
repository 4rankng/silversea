// Card 111026195000 — LOCAL UI rung: the container table keeps its dense
// spreadsheet row at mid widths (owner idea reference 11/10); the stacked
// record stays a phone tier. READ-ONLY.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { appendFileSync, writeFileSync } from 'node:fs';

const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const DRIVER_LOG = `${QA}/2026-10-11_card111026195000_ui-driver.log`;
writeFileSync(DRIVER_LOG, '');
const step = (s, o = {}) => {
  const line = JSON.stringify({ at: new Date().toISOString(), step: s, ...o });
  appendFileSync(DRIVER_LOG, line + '\n');
  console.log(line);
};

const login = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'thanhdc', password: 'Abc123' }),
});
assert.ok(login.ok, `login failed: ${login.status}`);
const token = (await login.json()).token;
step('login', { user: 'thanhdc (CUS)', gotToken: true });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  for (const [w, h] of [[1000, 407], [768, 900], [390, 844]]) {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 2 });
    await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle0', timeout: 90000 })
      .catch(() => step('goto', { note: 'networkidle timeout — continue' }));
    await new Promise((r) => setTimeout(r, 1800));
    if (!(await page.$('.csc-container-row'))) {
      const added = await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find((x) => /thêm container/i.test(x.innerText || ''));
        b?.click();
        return Boolean(b);
      });
      await new Promise((r) => setTimeout(r, 1000));
      step('add-container-row', { w, clicked: added });
    }
    const tier = await page.evaluate(() => {
      const row = document.querySelector('.csc-container-row');
      const scroll = document.querySelector('.csc-container-table-scroll');
      const head = document.querySelector('.csc-container-table thead th');
      if (!row || !scroll) return null;
      const r = row.getBoundingClientRect();
      return {
        display: getComputedStyle(row).display,
        rowH: Math.round(r.height),
        headVisible: head ? getComputedStyle(head).display !== 'none' && head.getBoundingClientRect().width > 0 : false,
        scrollsX: scroll.scrollWidth > scroll.clientWidth,
        scrollW: Math.round(scroll.clientWidth),
        tableW: Math.round(scroll.scrollWidth),
        reach: scroll.scrollWidth - scroll.clientWidth,
      };
    });
    step(`tier-${w}`, tier);
    assert.ok(tier, `container row rendered at ${w}`);
    if (w >= 768) {
      assert.equal(tier.display, 'table-row', `${w}px rides the dense table row`);
      assert.ok(tier.rowH <= 48, `${w}px row stays dense (${tier.rowH}px)`);
      assert.ok(tier.headVisible, `${w}px keeps the shared header`);
      assert.ok(tier.scrollsX && tier.reach > 50, `${w}px table scrolls its overflow internally`);
    } else {
      assert.equal(tier.display, 'grid', 'phone keeps the record card tier');
      assert.equal(tier.headVisible, false, 'phone hides the table header');
    }

    // Action bar: fixed, opaque, bottom-anchored with its own safe-area strip.
    const bar = await page.evaluate(() => {
      const b = document.querySelector('.csc-action-bar');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return {
        fixed: getComputedStyle(b).position,
        bottom: Math.round(innerHeight - r.bottom),
        h: Math.round(r.height),
        status: b.querySelector('.csc-action-bar__status')?.innerText?.slice(0, 60) ?? null,
        hasCreate: Boolean([...b.querySelectorAll('button')].find((x) => /tạo lô hàng/i.test(x.innerText))),
      };
    });
    step(`action-bar-${w}`, bar);
    assert.ok(bar, `action bar rendered at ${w}`);
    assert.equal(bar.fixed, 'fixed');
    assert.equal(bar.bottom, 0);
    assert.ok(bar.hasCreate, 'primary create action in the bar');

    const anchor = await page.$('.csc-container-table-scroll, .csc-container-row');
    await anchor?.scrollIntoView({ block: 'center' });
    await page.screenshot({ path: `${QA}/2026-10-11_card111026195000_ui-tier-${w}.png` });
  }

  // ── Review-driven additions: desktop rail offset + landscape cutouts ──
  {
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
    await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle0', timeout: 90000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1800));
    const rail = await page.evaluate(() => {
      const b = document.querySelector('.csc-action-bar');
      const bar = document.querySelector('.app');
      if (!b || !bar) return null;
      const r = b.getBoundingClientRect();
      return {
        barLeft: Math.round(r.left),
        sidebarW: Math.round(bar.querySelector('.sidebar')?.getBoundingClientRect().width ?? 0),
        varH: getComputedStyle(document.documentElement).getPropertyValue('--csc-action-bar-h').trim(),
        scrollPaddingBottom: getComputedStyle(document.querySelector('.app-body')).scrollPaddingBottom,
      };
    });
    step('rail-1440', rail);
    assert.ok(rail, 'bar rendered at 1440');
    assert.ok(rail.barLeft >= rail.sidebarW - 1, `bar starts at/after the sidebar rail (left ${rail.barLeft} vs rail ${rail.sidebarW})`);
    assert.ok(parseFloat(rail.varH) > 0, 'useFixedActionClearance published the measured bar height');
    assert.ok(parseFloat(rail.scrollPaddingBottom) > 0, 'scroller scroll-padding carries the clearance');
    await page.screenshot({ path: `${QA}/2026-10-11_card111026195000_ui-rail-1440.png` });

    await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2 });
    await new Promise((r) => setTimeout(r, 800));
    const land = await page.evaluate(() => {
      const b = document.querySelector('.csc-action-bar');
      const r = b.getBoundingClientRect();
      return { left: Math.round(r.left), bottom: Math.round(innerHeight - r.bottom) };
    });
    step('landscape-844', land);
    assert.equal(land.bottom, 0, 'bar anchored at the physical bottom in landscape');
    await page.screenshot({ path: `${QA}/2026-10-11_card111026195000_ui-landscape-844.png` });
  }
  step('RUNG', { verdict: 'PASS' });
} finally {
  await browser.close();
}
// ── Appended: fixed action bar (owner mock 11/10) at all four widths ──
