// R25 staging repro (read-only): FB-011 "{" search on /dispatch, FB-036 driver
// phone on /dispatch-detail, FB-045 "Chi tiết container" dialog column clip.
// Verifies staging build hash first (must be 16f0e51a).
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.QA_BASE || 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const OUT = path.resolve(import.meta.dirname, '../../../qa/2026-10-20-r25-regressions');
fs.mkdirSync(OUT, { recursive: true });
const PASSWORD = 'Abc123';
const LOG = [];
const log = (step, obj = {}) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const health = await (await fetch(`${API}/health`)).json();
// 2026-10-20: staging re-cut after A.1 (9b3ca298) — ab0a9138 = 16f0e51a +
// container-copy, does not touch FB-011/036/045 surfaces. Both pins accepted.
log('build_gate', { buildHash: health.buildHash, ok: ['16f0e51a', 'ab0a9138'].includes(health.buildHash) });

async function login(identifier) {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password: PASSWORD }) });
  const body = await res.json();
  if (!res.ok) throw new Error(`login ${identifier}: ${res.status}`);
  return body.token;
}
async function openAuthed(browser, identifier, url, viewport) {
  const token = await login(identifier);
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  return page;
}

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  // ── FB-011: "{" search on /dispatch (staging) ────────────────────────────
  {
    const token = await login('dieuvan');
    for (const q of ['{', 'QKV']) {
      const r = await fetch(`${API}/shipments?status=READY_FOR_DISPATCH,DISPATCHED,IN_TRANSIT,COMPLETED&limit=20&page=1&includeDispatchSummary=true&q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${token}` } });
      let j = null; try { j = await r.json(); } catch { /* */ }
      log('stg-fb011-api', { q, status: r.status, total: j?.total ?? null, message: j?.message ?? null });
    }
    const page = await openAuthed(browser, 'dieuvan', '/dispatch', { width: 1440, height: 1000 });
    await sleep(3500);
    const input = await page.$('input[aria-label="Tìm kiếm lô hàng"]');
    log('stg-fb011-input-found', { found: Boolean(input) });
    if (input) {
      await input.click({ clickCount: 3 });
      await input.type('{', { delay: 50 });
      await sleep(1800);
      const state = await page.evaluate(() => ({
        inputValue: document.querySelector('input[aria-label="Tìm kiếm lô hàng"]')?.value ?? null,
        alerts: [...document.querySelectorAll('[role="alert"]')].map((n) => n.textContent.trim()).filter(Boolean),
        searchError: document.querySelector('.filter-bar__search-error')?.textContent ?? null,
        toasts: [...document.querySelectorAll('[class*="toast"]')].map((n) => n.textContent.trim().slice(0, 120)).filter(Boolean),
        emptyText: [...document.querySelectorAll('[class*="empty"]')].map((n) => n.textContent.trim().slice(0, 120)).filter(Boolean).slice(0, 4),
        notices: document.body.innerText.split('\n').filter((l) => /không thể tải|lỗi|thất bại|không hợp lệ|ký tự|vui lòng/i.test(l)).slice(0, 6),
      }));
      log('stg-fb011-brace', state);
      await page.screenshot({ path: path.join(OUT, 'stg-before-fb011-dispatch-search-brace.png') });
    }
    await page.close();
  }

  // ── FB-036: Điều phối block on /dispatch-detail (staging) ────────────────
  {
    const page = await openAuthed(browser, 'dieuvan', '/dispatch-detail', { width: 1440, height: 1000 });
    await sleep(3500);
    const cells = await page.evaluate(() =>
      [...document.querySelectorAll('.dispatch-assignment-cell')].slice(0, 14).map((c) => ({
        text: c.textContent.replace(/\s+/g, ' ').trim().slice(0, 150),
        hasPhone: /(\d[\s.-]?){9,}/.test(c.textContent),
      })));
    log('stg-fb036-cells', { count: cells.length, withPhone: cells.filter((c) => c.hasPhone).length, cells: cells.slice(0, 10) });
    await page.screenshot({ path: path.join(OUT, 'stg-before-fb036-dispatch-detail.png'), fullPage: false });
    await page.close();
  }

  // ── FB-045: Chi tiết container dialog (staging) ──────────────────────────
  for (const width of [1440, 1366, 1280, 1024]) {
    const page = await openAuthed(browser, 'dieuvan', '/dispatch', { width, height: 950 });
    await sleep(3000);
    const clicked = await page.evaluate(() => {
      const el = [...document.querySelectorAll('button, a, [role="button"]')].find((b) => /chi tiết container/i.test((b.getAttribute('title') || '') + ' ' + (b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '')));
      if (!el) return false;
      el.click();
      return true;
    });
    await sleep(2200);
    const measure = await page.evaluate(() => {
      const drawer = document.querySelector('.dispatch-container-detail-drawer, [role="dialog"]');
      if (!drawer) return { drawer: false };
      const lineInfo = (el) => {
        if (!el) return null;
        const r = document.createRange();
        r.selectNodeContents(el);
        const rects = [...r.getClientRects()].filter((x) => x.height > 1);
        const lines = [];
        for (const x of rects) {
          const hit = lines.find((l) => Math.abs(l.top - x.top) < x.height * 0.6);
          if (hit) hit.width += x.width; else lines.push({ top: x.top, width: x.width });
        }
        return { lines: lines.length };
      };
      const ths = [...drawer.querySelectorAll('thead th')];
      const td = drawer.querySelector('tbody tr td[data-label="Giờ hẹn đóng/trả"]');
      return {
        drawer: true,
        headers: ths.map((th) => ({ label: th.textContent.trim(), w: Math.round(th.getBoundingClientRect().width), lines: lineInfo(th)?.lines, sheared: th.scrollWidth > th.clientWidth + 1 })),
        lastCells: [...drawer.querySelectorAll('tbody tr td[data-label="Giờ hẹn đóng/trả"]')].slice(0, 6).map((c) => ({ text: c.textContent.trim(), w: Math.round(c.getBoundingClientRect().width), lines: lineInfo(c)?.lines })),
        overflowing: (() => {
          const scroller = drawer.querySelector('.dispatch-container-detail__table-scroll');
          return scroller ? { scrollW: scroller.scrollWidth, clientW: scroller.clientWidth } : null;
        })(),
      };
    });
    log(`stg-fb045-w${width}`, { clicked, ...measure });
    if (width === 1440 || width === 1024) {
      await page.screenshot({ path: path.join(OUT, `stg-before-fb045-container-detail-w${width}.png`) });
    }
    await page.close();
  }
  log('run-complete');
} catch (err) {
  log('driver-error', { message: err.message, stack: String(err.stack).slice(0, 300) });
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(OUT, 'stg-before-driver.log'), LOG.map((l) => JSON.stringify(l)).join('\n') + '\n');
  await browser.close();
}
