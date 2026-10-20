// R25 regressions repro (before fix) — FB-011 "{" search warning, FB-036 driver
// phone on /dispatch-detail, FB-045 "Chi tiết container" dialog GIỜ HẸN ĐÓNG/TRẢ clip.
// Local dev build (HEAD of fix branch), accounts: dieuvan (điều vận), cus.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.QA_BASE || 'http://localhost:7175';
const API = process.env.QA_API || 'http://localhost:3002/api';
const OUT = path.resolve(import.meta.dirname, '../../../qa/2026-10-20-r25-regressions');
fs.mkdirSync(OUT, { recursive: true });
const PASSWORD = 'Abc123';
const LOG = [];
const log = (step, obj = {}) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  return page;
}

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  // ── FB-011: search "{" on /dispatch ─────────────────────────────────────
  {
    const token = await login('dieuvan');
    // Direct API probe: what does the shipments list do with q="{"?
    for (const q of ['{', 'abc']) {
      const r = await fetch(`${API}/shipments?status=READY_FOR_DISPATCH,DISPATCHED,IN_TRANSIT,COMPLETED&limit=20&page=1&includeDispatchSummary=true&q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${token}` } });
      let j = null; try { j = await r.json(); } catch { /* */ }
      log('fb011-api-probe', { q, status: r.status, total: j?.total ?? null, error: j?.error ?? j?.message ?? null });
    }
    const page = await openAuthed(browser, 'dieuvan', '/dispatch', { width: 1440, height: 1000 });
    await sleep(2500);
    const input = await page.$('input[aria-label="Tìm kiếm lô hàng"]');
    log('fb011-search-input-found', { found: Boolean(input) });
    if (input) {
      await input.click({ clickCount: 3 });
      await input.type('{', { delay: 60 });
      await sleep(1400); // debounce 300ms + fetch
      const state = await page.evaluate(() => ({
        inputValue: document.querySelector('input[aria-label="Tìm kiếm lô hàng"]')?.value ?? null,
        alerts: [...document.querySelectorAll('[role="alert"]')].map((n) => n.textContent.trim()).filter(Boolean),
        searchError: document.querySelector('.filter-bar__search-error')?.textContent ?? null,
        errorBanners: [...document.querySelectorAll('.master-plan-grid__error, [class*="error"]')].map((n) => n.textContent.trim().slice(0, 120)).filter(Boolean).slice(0, 5),
        emptyStates: [...document.querySelectorAll('[class*="empty"]')].map((n) => n.textContent.trim().slice(0, 100)).filter(Boolean).slice(0, 5),
        bodySnippets: document.body.innerText.split('\n').filter((l) => /không|lỗi|thất bại|không hợp lệ|vui lòng/i.test(l)).slice(0, 8),
      }));
      log('fb011-search-brace-state', state);
      await page.screenshot({ path: path.join(OUT, 'before-fb011-dispatch-search-brace.png'), fullPage: true });
      // also check the network response status for the q={ request
    }
    await page.close();
  }

  // ── FB-036: driver phone in Điều phối block on /dispatch-detail ─────────
  {
    const page = await openAuthed(browser, 'dieuvan', '/dispatch-detail', { width: 1440, height: 1000 });
    await sleep(2500);
    const rows = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('.dispatch-assignment-cell')].slice(0, 12);
      return cells.map((c) => ({
        text: c.textContent.replace(/\s+/g, ' ').trim().slice(0, 160),
        hasPhoneGlyph: /(\d[\s.-]?){9,}/.test(c.textContent),
      }));
    });
    log('fb036-dispatch-cells', { count: rows.length, sample: rows.slice(0, 8) });
    // open first editable cell's editor dialog and dump its dispatch info block
    const opened = await page.evaluate(() => {
      const btn = document.querySelector('.dispatch-assignment-cell__trigger');
      if (!btn) return false;
      btn.click();
      return true;
    });
    await sleep(1200);
    if (opened) {
      const dialog = await page.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"], .modal, .dispatch-assignment-dialog');
        if (!dlg) return null;
        return dlg.textContent.replace(/\s+/g, ' ').trim().slice(0, 800);
      });
      log('fb036-editor-dialog-text', { dialog });
      await page.screenshot({ path: path.join(OUT, 'before-fb036-dispatch-editor-dialog.png'), fullPage: true });
    }
    await page.screenshot({ path: path.join(OUT, 'before-fb036-dispatch-detail-grid.png'), fullPage: true });
    await page.close();
  }

  // ── FB-045: Chi tiết container dialog GIỜ HẸN ĐÓNG/TRẢ clip ─────────────
  {
    const page = await openAuthed(browser, 'dieuvan', '/dispatch', { width: 1440, height: 1000 });
    await sleep(2500);
    // find the per-row "Chi tiết container" affordance
    const affordances = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('button, a')];
      return buttons.map((b) => (b.textContent || '').trim()).filter((t) => /container/i.test(t)).slice(0, 10);
    });
    log('fb045-affordances-text', { affordances });
    // MasterPlanGrid single-detail affordance: try title/aria containing "container"
    const clicked = await page.evaluate(() => {
      const el = [...document.querySelectorAll('button, a, [role="button"]')].find((b) => /chi tiết container/i.test((b.getAttribute('title') || '') + ' ' + (b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '')));
      if (!el) return false;
      el.click();
      return true;
    });
    await sleep(1800);
    log('fb045-opened', { clicked });
    const measure = await page.evaluate(() => {
      const drawer = document.querySelector('.dispatch-container-detail-drawer, [role="dialog"]');
      if (!drawer) return { drawer: false };
      const ths = [...drawer.querySelectorAll('thead th')];
      const lastTh = ths[ths.length - 1];
      const td = drawer.querySelector('tbody tr td[data-label="Giờ hẹn đóng/trả"]');
      const range = (el) => {
        if (!el) return null;
        const r = document.createRange();
        r.selectNodeContents(el);
        const rects = [...r.getClientRects()].filter((x) => x.height > 1);
        const lines = [];
        for (const x of rects) {
          const hit = lines.find((l) => Math.abs(l.top - x.top) < x.height * 0.6);
          if (hit) hit.width += x.width; else lines.push({ top: x.top, width: x.width, height: x.height });
        }
        return { lineCount: lines.length, rectWidth: Math.round(rects[0]?.width ?? 0) };
      };
      return {
        drawer: true,
        headers: ths.map((th) => ({ label: th.textContent.trim(), w: Math.round(th.getBoundingClientRect().width), lines: range(th)?.lineCount })),
        lastCellText: td?.textContent.trim() ?? null,
        lastCell: td ? { w: Math.round(td.getBoundingClientRect().width), scrollW: td.scrollWidth, clientW: td.clientWidth, lines: range(td)?.lineCount } : null,
        tableMinWidth: getComputedStyle(drawer.querySelector('table')).minWidth,
        scrollW: drawer.querySelector('.dispatch-container-detail__table-scroll')?.scrollWidth ?? null,
        clientW: drawer.querySelector('.dispatch-container-detail__table-scroll')?.clientWidth ?? null,
      };
    });
    log('fb045-measure', measure);
    await page.screenshot({ path: path.join(OUT, 'before-fb045-container-detail-dialog.png'), fullPage: true });
    await page.close();
  }

  log('run-complete');
} catch (err) {
  log('driver-error', { message: err.message, stack: String(err.stack).slice(0, 400) });
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(OUT, 'before-driver.log'), LOG.map((l) => JSON.stringify(l)).join('\n') + '\n');
  await browser.close();
}
