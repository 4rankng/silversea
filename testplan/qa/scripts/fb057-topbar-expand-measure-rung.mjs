// Card 121026185560 (FB-057 round-16 verify-fail) — MEASUREMENT rung, read-only.
// Owner ruling 2026-10-11: topbar search 360px at rest, expands on focus
// (≈480–560px), all role topbars. Round 16 says it stays 360 on staging.
// This measures the LOCAL HEAD state machine: rest → focus → typing → blur,
// at 390/768/1440, checking no clip and no layout jump (topbar height).
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { appendFileSync, writeFileSync } from 'node:fs';

const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const QA = '/Volumes/LexarSSD/projects/silversea/qa';
const DRIVER_LOG = `${QA}/2026-10-12_fb057-topbar-expand_ui-driver.log`;
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

const WIDTHS = [1920, 1536, 1366, 1280, 1024, 768];
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/trips`, { waitUntil: 'networkidle0', timeout: 90000 })
    .catch(() => step('goto', { note: 'networkidle timeout — continue' }));
  await page.waitForSelector('.topbar__search input', { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1000));

  const results = {};
  for (const vw of WIDTHS) {
    await page.setViewport({ width: vw, height: 900 });
    await new Promise((r) => setTimeout(r, 700));
    const measure = () =>
      page.evaluate(() => {
        const box = document.querySelector('.topbar__search');
        const input = box?.querySelector('input');
        const topbar = box?.closest('.topbar, header') || document.querySelector('header');
        const r = box.getBoundingClientRect();
        const tb = topbar ? topbar.getBoundingClientRect() : null;
        return {
          width: Math.round(r.width),
          left: Math.round(r.left),
          right: Math.round(r.right),
          viewport: window.innerWidth,
          topbarHeight: tb ? Math.round(tb.height) : null,
          clippedRight: r.right > window.innerWidth + 1,
          clippedLeft: r.left < -1,
        };
      });

    const rest = await measure();
    await page.focus('.topbar__search input');
    await new Promise((r) => setTimeout(r, 500)); // > 0.18s transition
    const focus = await measure();
    await page.type('.topbar__search input', 'chuyến', { delay: 10 });
    await new Promise((r) => setTimeout(r, 300));
    const typing = await measure();
    const topbarHeightStable = focus.topbarHeight === rest.topbarHeight;
    await page.evaluate(() => {
      const input = document.querySelector('.topbar__search input');
      input.value = '';
      input.blur();
    });
    await new Promise((r) => setTimeout(r, 400));
    const blurred = await measure();
    results[vw] = { rest, focus, typing, blurred, topbarHeightStable };
    step('measure', { vw, rest: rest.width, focus: focus.width, typing: typing.width, blurred: blurred.width, topbarHeightStable, clipped: { r: focus.clippedRight, l: focus.clippedLeft } });
  }

  // Ruling contract: 360 at rest (desktop), expands materially on focus,
  // returns to rest on blur; no clipping; topbar height never moves.
  const w1920 = results[1920];
  assert.equal(w1920.rest.width, 360, '1920 rest width pinned at 360');
  assert.ok(
    w1920.focus.width >= 480 && w1920.focus.width <= 560,
    `1920 focus width in the 480-560 ruling band (got ${w1920.focus.width})`,
  );
  assert.equal(w1920.typing.width, w1920.focus.width, 'typing keeps the focus width');
  assert.equal(w1920.blurred.width, 360, 'blur returns to the 360 rest cap');
  assert.ok(!w1920.focus.clippedRight && !w1920.focus.clippedLeft, 'no clipping at 1920 focus');
  assert.ok(w1920.topbarHeightStable, 'topbar height does not jump on focus');

  const stuckAt360 = Object.entries(results)
    .filter(([, v]) => v.rest.width === 360 && v.focus.width === 360)
    .map(([k]) => k);
  step('stuck-at-360', { widths: stuckAt360 });

  for (const vw of [1024, 768]) {
    const w = results[vw];
    assert.ok(!w.focus.clippedRight && !w.focus.clippedLeft, `no clipping at ${vw} focus`);
    assert.ok(w.focus.width >= w.rest.width, `${vw}: focus never narrower than rest`);
    assert.equal(w.focus.topbarHeight, w.rest.topbarHeight, `${vw}: topbar height stable`);
  }

  // Screenshots: rest vs focus at 1440.
  await page.setViewport({ width: 1440, height: 900 });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: `${QA}/2026-10-12_fb057-topbar_1440-rest.png` });
  await page.focus('.topbar__search input');
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: `${QA}/2026-10-12_fb057-topbar_1440-focus.png` });
  await page.evaluate(() => document.querySelector('.topbar__search input')?.blur());
  step('screenshots', { rest: '1440-rest.png', focus: '1440-focus.png' });

  step('RUNG PASS', { results: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, { rest: v.rest.width, focus: v.focus.width }])) });
} finally {
  await browser.close();
}
