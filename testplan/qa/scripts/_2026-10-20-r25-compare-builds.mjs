// Compare-side probe: identical steps against two builds (R24 base vs R25 HEAD).
// FB-011 "{" search warning · FB-036 driver phone in Điều phối block · FB-045 dialog column clip.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(import.meta.dirname, '../../../qa/2026-10-20-r25-regressions');
fs.mkdirSync(OUT, { recursive: true });
const PASSWORD = 'Abc123';
const LOG = [];
const log = (step, obj = {}) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(api, identifier) {
  const res = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password: PASSWORD }) });
  const body = await res.json();
  if (!res.ok) throw new Error(`login ${identifier}: ${res.status}`);
  return body.token;
}
async function openAuthed(browser, base, api, identifier, url, viewport) {
  const token = await login(api, identifier);
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${base}${url}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  return page;
}

async function runBuild(browser, tag, base, api) {
  // ── FB-011 ──
  {
    const page = await openAuthed(browser, base, api, 'dieuvan', '/dispatch', { width: 1440, height: 1000 });
    await sleep(2500);
    const input = await page.$('input[aria-label="Tìm kiếm lô hàng"]');
    if (input) {
      await input.click({ clickCount: 3 });
      await input.type('{', { delay: 50 });
      await sleep(1500);
      const state = await page.evaluate(() => ({
        inputValue: document.querySelector('input[aria-label="Tìm kiếm lô hàng"]')?.value ?? null,
        alerts: [...document.querySelectorAll('[role="alert"]')].map((n) => n.textContent.trim()).filter(Boolean),
        searchError: document.querySelector('.filter-bar__search-error')?.textContent ?? null,
        toasts: [...document.querySelectorAll('[class*="toast"]')].map((n) => n.textContent.trim().slice(0, 120)).filter(Boolean),
        notices: document.body.innerText.split('\n').filter((l) => /không thể tải|lỗi|thất bại|không hợp lệ|ký tự|vui lòng thử/i.test(l)).slice(0, 6),
      }));
      log(`${tag}-fb011-brace`, state);
      await page.screenshot({ path: path.join(OUT, `${tag}-fb011-dispatch-search-brace.png`), fullPage: false });
    } else {
      log(`${tag}-fb011-brace`, { inputFound: false });
    }
    await page.close();
  }

  // ── FB-036 ──
  {
    const page = await openAuthed(browser, base, api, 'dieuvan', '/dispatch-detail', { width: 1440, height: 1000 });
    await sleep(2500);
    const cells = await page.evaluate(() =>
      [...document.querySelectorAll('.dispatch-assignment-cell')].slice(0, 10).map((c) => ({
        text: c.textContent.replace(/\s+/g, ' ').trim().slice(0, 140),
      })));
    log(`${tag}-fb036-cells`, { count: cells.length, cells: cells.slice(0, 6) });
    // API wire: does dispatch detail row carry any driver phone field?
    const token = await login(api, 'dieuvan');
    const r = await fetch(`${api}/dispatch-planning/detail-plan?limit=5`, { headers: { Authorization: `Bearer ${token}` } });
    let wire = null; try { wire = await r.json(); } catch { /* */ }
    const firstRow = wire?.items?.[0] ?? null;
    log(`${tag}-fb036-wire`, {
      status: r.status,
      dispatchKeys: firstRow?.dispatch ? Object.keys(firstRow.dispatch) : null,
      dispatchSample: firstRow ? { plate: firstRow.dispatch?.assignedPlate, driver: firstRow.dispatch?.assignedDriverName } : null,
    });
    await page.close();
  }

  // ── FB-045 ──
  for (const width of [1440, 1280, 1024]) {
    const page = await openAuthed(browser, base, api, 'dieuvan', '/dispatch', { width, height: 950 });
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
      const td = drawer.querySelector('tbody tr td[data-label="Giờ hẹn đóng/trả"]');
      return {
        drawer: true,
        headers: ths.map((th) => {
          const info = lineInfo(th);
          const cs = getComputedStyle(th);
          return {
            label: th.textContent.trim(),
            w: Math.round(th.getBoundingClientRect().width),
            lines: info?.lines,
            sheared: th.scrollWidth > th.clientWidth + 1,
            whiteSpace: cs.whiteSpace,
          };
        }),
        lastCell: td ? {
          text: td.textContent.trim(),
          w: Math.round(td.getBoundingClientRect().width),
          lines: lineInfo(td)?.lines,
          sheared: td.scrollWidth > td.clientWidth + 1,
        } : null,
        overflowing: (() => {
          const scroller = drawer.querySelector('.dispatch-container-detail__table-scroll');
          return scroller ? { scrollW: scroller.scrollWidth, clientW: scroller.clientWidth } : null;
        })(),
      };
    });
    log(`${tag}-fb045-w${width}`, { clicked, ...measure });
    if (width === 1440) {
      await page.screenshot({ path: path.join(OUT, `${tag}-fb045-container-detail-dialog.png`), fullPage: false });
    }
    await page.close();
  }
}

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  await runBuild(browser, 'r24base', process.env.QA_BASE_R24 || 'http://localhost:7176', process.env.QA_API_R24 || 'http://localhost:3003/api');
  await runBuild(browser, 'r25head', process.env.QA_BASE_R25 || 'http://localhost:7175', process.env.QA_API_R25 || 'http://localhost:3002/api');
  log('run-complete');
} catch (err) {
  log('driver-error', { message: err.message, stack: String(err.stack).slice(0, 300) });
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(OUT, 'compare-builds-driver.log'), LOG.map((l) => JSON.stringify(l)).join('\n') + '\n');
  await browser.close();
}
