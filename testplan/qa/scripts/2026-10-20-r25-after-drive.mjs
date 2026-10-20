// R25 after-fix UI drive (local dev, HEAD of fix-r25-regressions):
// FB-011 "{" cảnh báo · FB-036 SĐT lái xe trong khối Điều phối · FB-045
// dialog column no-clip. Rung 3: click/type the real controls, screenshot +
// DOM assertion + wire/DB side-effect proof.
import puppeteer from 'puppeteer';
import { execSync } from 'node:child_process';
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
  // ── FB-011: the "{" cảnh báo ────────────────────────────────────────────
  {
    const page = await openAuthed(browser, 'dieuvan', '/dispatch', { width: 1440, height: 1000 });
    await sleep(2500);
    const input = await page.$('input[aria-label="Tìm kiếm lô hàng"]');
    await input.click({ clickCount: 3 });
    await input.type('{', { delay: 60 });
    await sleep(900); // alert is derived state — no debounce needed
    const brace = await page.evaluate(() => ({
      inputValue: document.querySelector('input[aria-label="Tìm kiếm lô hàng"]')?.value ?? null,
      ariaInvalid: document.querySelector('input[aria-label="Tìm kiếm lô hàng"]')?.getAttribute('aria-invalid') ?? null,
      alertText: document.querySelector('.filter-bar__search-error')?.textContent ?? null,
      alertRole: document.querySelector('.filter-bar__search-error')?.getAttribute('role') ?? null,
    }));
    log('fb011-after-brace', brace);
    await page.screenshot({ path: path.join(OUT, 'after-fb011-dispatch-search-brace.png') });
    // and it clears the moment the term gains a letter
    await input.type('B', { delay: 60 });
    await sleep(400);
    const cleared = await page.evaluate(() => ({
      inputValue: document.querySelector('input[aria-label="Tìm kiếm lô hàng"]')?.value ?? null,
      alertGone: !document.querySelector('.filter-bar__search-error'),
    }));
    log('fb011-after-brace-cleared', cleared);
    await page.screenshot({ path: path.join(OUT, 'after-fb011-dispatch-search-braceB.png') });
    await page.close();
  }

  // ── FB-036: SĐT lái xe in the Điều phối block ───────────────────────────
  {
    // Wire proof first: the detail-plan rows now carry assignedDriverPhone.
    const token = await login('dieuvan');
    const wire = await fetch(`${API}/dispatch-planning/detail-plan-rows?limit=50`, { headers: { Authorization: `Bearer ${token}` } });
    const wireBody = await wire.json();
    const rows = wireBody.items ?? [];
    const withPhone = rows.filter((r) => r?.dispatch?.assignedDriverPhone);
    log('fb036-wire', {
      status: wire.status,
      rows: rows.length,
      rowsWithPhone: withPhone.length,
      sample: withPhone.slice(0, 5).map((r) => ({
        shipmentCode: r.shipmentCode,
        plate: r.dispatch.assignedPlate,
        driver: r.dispatch.assignedDriverName,
        phone: r.dispatch.assignedDriverPhone,
        tripId: r.dispatch.tripId ?? null,
      })),
    });
    // DB side-effect proof: the driver roster phones the wire renders.
    if (withPhone.length > 0) {
      const phones = [...new Set(withPhone.map((r) => r.dispatch.assignedDriverPhone))];
      const sql = `select d.name, d.phone from drivers d where d.phone in (${phones.map((p) => `'${p}'`).join(',')}) and d.deleted_at is null order by d.name limit 8;`;
      let dbRows = null;
      try {
        dbRows = execSync(`docker exec ss-prod-db psql -U postgres -d silversea -Atc ${JSON.stringify(sql)}`, { encoding: 'utf8' }).trim();
      } catch (err) {
        dbRows = `DB-PROBE-FAILED: ${err.message.slice(0, 120)}`;
      }
      log('fb036-db-proof', { sql, rows: dbRows });
    }
    // UI drive: open the tab that has a plated row with driver+phone.
    const page = await openAuthed(browser, 'dieuvan', '/dispatch-detail', { width: 1440, height: 1000 });
    await sleep(2500);
    const cells = await page.evaluate(() =>
      [...document.querySelectorAll('.dispatch-assignment-cell')].map((c) => ({
        text: c.textContent.replace(/\s+/g, ' ').trim().slice(0, 160),
        phone: c.querySelector('.dispatch-assignment-cell__driver-phone')?.textContent ?? null,
      })));
    const shown = cells.filter((c) => c.phone);
    log('fb036-after-cells', { total: cells.length, withPhone: shown.length, sample: shown.slice(0, 6) });
    await page.screenshot({ path: path.join(OUT, 'after-fb036-dispatch-detail.png'), fullPage: false });
    await page.close();
  }

  // ── FB-045: dialog column no-clip at every width ────────────────────────
  for (const width of [1440, 1280, 1024]) {
    const page = await openAuthed(browser, 'dieuvan', '/dispatch', { width, height: 950 });
    await sleep(2200);
    const clicked = await page.evaluate(() => {
      const el = [...document.querySelectorAll('button, a, [role="button"]')].find((b) => /chi tiết container/i.test((b.getAttribute('title') || '') + ' ' + (b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '')));
      if (!el) return false;
      el.click();
      return true;
    });
    await sleep(1700);
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
      const lastTh = ths[ths.length - 1];
      const cells = [...drawer.querySelectorAll('tbody tr td[data-label="Giờ hẹn đóng/trả"]')].slice(0, 6);
      return {
        drawer: true,
        headers: ths.map((th) => ({ label: th.textContent.trim(), w: Math.round(th.getBoundingClientRect().width), lines: lineInfo(th)?.lines, sheared: th.scrollWidth > th.clientWidth + 1 })),
        lastHeaderText: lastTh?.textContent.trim() ?? null,
        lastCells: cells.map((c) => ({ text: c.textContent.trim(), w: Math.round(c.getBoundingClientRect().width), lines: lineInfo(c)?.lines })),
        overflowing: (() => {
          const scroller = drawer.querySelector('.dispatch-container-detail__table-scroll');
          return scroller ? { scrollW: scroller.scrollWidth, clientW: scroller.clientWidth } : null;
        })(),
      };
    });
    const verdict = measure.drawer
      && measure.headers.every((h) => h.lines === 1 && !h.sheared)
      && measure.lastCells.every((c) => c.lines === 1);
    log(`fb045-after-w${width}`, { clicked, verdict, ...measure });
    await page.screenshot({ path: path.join(OUT, `after-fb045-container-detail-w${width}.png`) });
    await page.close();
  }

  log('run-complete');
} catch (err) {
  log('driver-error', { message: err.message, stack: String(err.stack).slice(0, 300) });
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(OUT, 'after-driver.log'), LOG.map((l) => JSON.stringify(l)).join('\n') + '\n');
  await browser.close();
}
