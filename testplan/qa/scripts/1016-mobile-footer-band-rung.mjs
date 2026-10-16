// Rung driver — mobile grey footer band on /shipments (owner report 2026-10-16 21:07 SGT).
// Reproduce at 375x812 against LOCAL dev (vite :7175 + backend :3002), then
// identify the element that paints the band below the last lot card.
//
// Usage: node testplan/qa/scripts/1016-mobile-footer-band-rung.mjs [--after]
// Artifacts -> qa/1016-mobile-footer/
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const FRONT = process.env.QA_BASE || 'http://localhost:7175';
const API = process.env.QA_API || new URL('/api', FRONT).toString().replace(/\/$/, '');
const USER = process.env.QA_USER || 'cus';
const PASS = process.env.QA_PASS || 'Abc123';
const OUT = path.resolve('qa/1016-mobile-footer');
const TAG = process.argv.includes('--after') ? 'after' : 'before';
const PATH = process.env.QA_PATH || '/shipments';
const WIDTH = Number(process.env.QA_W || 393);
const HEIGHT = Number(process.env.QA_H || 853);
const MOBILE = !process.env.QA_DESKTOP;

fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login() {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: USER, password: PASS }),
  });
  if (!res.ok) throw new Error(`login ${USER} -> ${res.status}: ${await res.text()}`);
  const body = await res.json();
  return body.token || body.accessToken || body.data?.token;
}

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
if (MOBILE) {
  await page.setViewport({ width: WIDTH, height: HEIGHT, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
} else {
  await page.setViewport({ width: WIDTH, height: HEIGHT });
}
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text().slice(0, 300)); });

const token = await login();
await page.evaluateOnNewDocument((t, origin) => {
  if (location.origin === origin) localStorage.setItem('token', t);
}, token, new URL(FRONT).origin);

await page.goto(`${FRONT}${PATH}`, { waitUntil: 'networkidle2', timeout: 60000 });
// Wait for the lot rows to actually render (cards or table rows).
await page.waitForSelector('.cus-workspace', { timeout: 30000 }).catch(() => {});
await sleep(3000);

const title = await page.evaluate(() => document.title);
if (/đăng nhập|login/i.test(title)) throw new Error('landed on login — token injection failed');

// Scroll the app scrollport (main.app-body) fully to the bottom, re-pinning
// until the scroller is measurably AT the bottom — late content growth
// (font wrap, HMR re-render) can extend max scroll after a single set.
await page.evaluate(() => {
  const scroller = document.querySelector('main.app-body') || document.scrollingElement;
  scroller.scrollTop = scroller.scrollHeight;
});
await sleep(400);
for (let attempt = 0; attempt < 5; attempt++) {
  const atBottom = await page.evaluate(() => {
    const scroller = document.querySelector('main.app-body') || document.scrollingElement;
    if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1) return true;
    scroller.scrollTop = scroller.scrollHeight;
    return false;
  });
  if (atBottom) break;
  await sleep(400);
}
await sleep(400);

const slug = PATH === '/shipments' ? '' : '-' + PATH.replace(/\//g, '_').replace(/[^a-z0-9_-]/gi, '').slice(1, 24);
const shot = path.join(OUT, `${TAG}${slug}-ui-${WIDTH}x${HEIGHT}-bottom.png`);
await page.screenshot({ path: shot });

const probe = await page.evaluate(() => {
  const cs = (el, props) => {
    const c = getComputedStyle(el);
    return Object.fromEntries(props.map((p) => [p, c[p]]));
  };
  const out = { viewport: { w: innerWidth, h: innerHeight } };

  const body = document.querySelector('main.app-body');
  if (body) {
    out.appBody = {
      clientHeight: body.clientHeight,
      scrollHeight: body.scrollHeight,
      scrollTop: body.scrollTop,
      rect: body.getBoundingClientRect().toJSON(),
      ...cs(body, ['paddingTop', 'paddingBottom', 'backgroundColor', 'overflowY', 'minHeight']),
    };
  }
  out.docScroll = {
    scrollHeight: document.documentElement.scrollHeight,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  };

  const pageEl = document.querySelector('.shipments-page');
  if (pageEl) {
    out.shipmentsPage = {
      rect: pageEl.getBoundingClientRect().toJSON(),
      offsetHeight: pageEl.offsetHeight,
      ...cs(pageEl, ['minHeight', 'paddingBottom', 'backgroundColor', 'gridTemplateRows']),
    };
    out.shipmentsPageChildren = [...pageEl.children].map((c) => ({
      selector: c.tagName.toLowerCase() + (c.className && typeof c.className === 'string' ? '.' + c.className.trim().split(/\s+/).join('.') : ''),
      rect: c.getBoundingClientRect().toJSON(),
      height: c.getBoundingClientRect().height,
      background: cs(c, ['backgroundColor']).backgroundColor,
    }));
  }

  // The workspace + its tail (pagination, empty blocks).
  const wsEl = document.querySelector('.cus-workspace');
  if (wsEl) {
    out.cusWorkspace = {
      rect: wsEl.getBoundingClientRect().toJSON(),
      ...cs(wsEl, ['backgroundColor', 'minHeight', 'paddingBottom']),
    };
    const kids = [...wsEl.children].map((c) => ({
      selector: c.tagName.toLowerCase() + (c.className && typeof c.className === 'string' ? '.' + c.className.trim().split(/\s+/).join('.') : ''),
      rect: c.getBoundingClientRect().toJSON(),
      height: c.getBoundingClientRect().height,
      background: cs(c, ['backgroundColor']).backgroundColor,
    }));
    out.cusWorkspaceChildren = kids;
    out.cusWorkspaceLastChildren = [...wsEl.querySelectorAll(':scope > * > :last-child')].slice(-6).map((c) => ({
      selector: c.tagName.toLowerCase() + (c.className && typeof c.className === 'string' ? '.' + c.className.trim().split(/\s+/).join('.') : ''),
      rect: c.getBoundingClientRect().toJSON(),
    }));
  }

  // Last lot row/card — the anchor the owner sees the band below.
  const rowSel = ['.cus-dashboard-table tbody tr:last-child', '.cus-lot-card:last-of-type', '[class*="lot-card"]:last-of-type', '.cus-dashboard-row:last-of-type'].join(',');
  const lastRow = document.querySelector(rowSel);
  if (lastRow) {
    out.lastRow = {
      selector: lastRow.tagName.toLowerCase() + '.' + String(lastRow.className).trim().split(/\s+/).join('.'),
      rect: lastRow.getBoundingClientRect().toJSON(),
    };
  }

  // What paints the region below the last row: probe the stack at points down the viewport.
  const anchors = [];
  const startY = (out.lastRow ? out.lastRow.rect.bottom : out.appBody ? out.appBody.rect.bottom - 200 : innerHeight - 220) + 12;
  for (let y = Math.round(startY); y < innerHeight - 4; y += 16) {
    const x = Math.round(innerWidth / 2);
    const stack = document.elementsFromPoint(x, y).slice(0, 4).map((el) => ({
      selector: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 4).join('.') : ''),
      background: getComputedStyle(el).backgroundColor,
      minHeight: getComputedStyle(el).minHeight,
      height: Math.round(el.getBoundingClientRect().height),
      rectTop: Math.round(el.getBoundingClientRect().top),
      rectBottom: Math.round(el.getBoundingClientRect().bottom),
    }));
    anchors.push({ y, stack });
  }
  out.bandProbe = anchors;

  // Any element whose box is tall + spans full width + starts below the last row.
  const fullWidthBlocks = [];
  if (out.lastRow) {
    document.querySelectorAll('.app-body *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.height > 60 && r.width > innerWidth * 0.9 && r.top >= out.lastRow.rect.bottom - 8) {
        fullWidthBlocks.push({
          selector: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 4).join('.') : ''),
          rect: r.toJSON(),
          background: getComputedStyle(el).backgroundColor,
          text: (el.textContent || '').trim().slice(0, 60),
        });
      }
    });
  }
  out.fullWidthBlocksBelowLastRow = fullWidthBlocks;

  out.rowCount = document.querySelectorAll('.cus-dashboard-table tbody tr, [class*="lot-card"]').length;
  out.paginationPresent = !!document.querySelector('.ds-pagination, .pagination');
  const pag = document.querySelector('.ds-pagination');
  if (pag) {
    out.pagination = { rect: pag.getBoundingClientRect().toJSON(), text: pag.textContent.trim().slice(0, 120) };
    // Computed bottom padding of the terminal surface — catches a dead
    // override when env() insets are emulated (headless env()=0 resolves
    // both 12px and the calc to the same value; on-device they differ).
    out.paginationPaddingBottom = getComputedStyle(pag).paddingBottom;
    // The owner metric: trailing grey space between the pagination block's
    // bottom edge and the scrollport bottom edge (app-body padding paints --bg).
    const scroller2 = document.querySelector('main.app-body');
    if (scroller2) {
      out.trailingGrey = Math.round(scroller2.getBoundingClientRect().bottom - pag.getBoundingClientRect().bottom);
      out.scrollerBottomViewport = Math.round(scroller2.getBoundingClientRect().bottom);
    }
  }
  // Pixel truth at the bottom of the scrollport: sample the computed
  // background of whatever element paints the last rows of the viewport.
  const bottomPaint = [];
  const scroller3 = document.querySelector('main.app-body');
  if (scroller3) {
    const sb = scroller3.getBoundingClientRect().bottom;
    for (let i = 1; i <= 5; i++) {
      const y = Math.round(sb - i * 10);
      const el = document.elementsFromPoint(Math.round(innerWidth / 2), y)[0];
      bottomPaint.push({ y, tag: el ? el.tagName + '.' + String(el.className).slice(0, 40) : null, bg: el ? getComputedStyle(el).backgroundColor : null });
    }
  }
  out.bottomPaint = bottomPaint;
  return out;
},);

const jsonPath = path.join(OUT, `${TAG}${slug}-ui-${WIDTH}x${HEIGHT}-dom-probe.json`);
fs.writeFileSync(jsonPath, JSON.stringify(probe, null, 2));

const log = {
  tag: TAG, url: page.url(), title, user: USER, viewport: `${WIDTH}x${HEIGHT}`,
  screenshot: shot, probe: jsonPath, errors,
  rowCount: probe.rowCount,
  trailingGrey: probe.trailingGrey ?? null,
  pagination: probe.pagination ? { bottom: Math.round(probe.pagination.rect.bottom), height: Math.round(probe.pagination.rect.height), paddingBottom: probe.paginationPaddingBottom ?? null } : null,
  appBody: probe.appBody ? { clientHeight: probe.appBody.clientHeight, scrollHeight: probe.appBody.scrollHeight, scrollTop: probe.appBody.scrollTop, atBottom: probe.appBody.scrollTop + probe.appBody.clientHeight >= probe.appBody.scrollHeight - 1, paddingBottom: probe.appBody.paddingBottom } : null,
  lastRow: probe.lastRow ? { bottom: Math.round(probe.lastRow.rect.bottom), height: Math.round(probe.lastRow.rect.height) } : null,
};
fs.writeFileSync(path.join(OUT, `${TAG}${slug}-ui-${WIDTH}x${HEIGHT}-summary.json`), JSON.stringify(log, null, 2));
console.log(JSON.stringify(log, null, 2));
await browser.close();
