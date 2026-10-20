// Cards 201026101500 (FB-063) + 201026101600 (FB-066) — BEFORE-fix repro on
// the fix-regressions-1020b worktree (local dev :7175/:3002).
//
// FB-063: /shipments/new container-table header — measure every `thead th`
// line count; a wrapped header (2 lines) is the regression. Screenshot.
// FB-066: every quick-add surface — /trips/new TripInfoCard (Xe đầu kéo /
// Lái xe), dispatch detailed-plan editor (Xe / biển số), LCL Gán xe nhóm /
// Đổi BKS nhóm dialogs — record whether the "Thêm nhanh" button renders.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.QA_BASE || 'http://localhost:7175';
const API = process.env.QA_API || 'http://localhost:3002/api';
const OUT = process.env.OUT_DIR || path.resolve(import.meta.dirname, '../../../qa/2026-10-20-regressions');
fs.mkdirSync(OUT, { recursive: true });
const PASSWORD = 'Abc123';

const LOG = [];
const log = (step, obj = {}) => {
  const e = { at: new Date().toISOString(), step, ...obj };
  LOG.push(e);
  console.log(JSON.stringify(e));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(identifier) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: PASSWORD }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`login ${identifier}: ${res.status} ${JSON.stringify(body)}`);
  return { token: body.token, role: body.user?.role };
}

async function openAuthed(browser, identifier, url, viewport) {
  const { token } = await login(identifier);
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle2', timeout: 45000 });
  return page;
}

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  // ── FB-063: /shipments/new header wrap (ADMIN) ──────────────────────────
  {
    const page = await openAuthed(browser, 'admin', '/shipments/new', { width: 1440, height: 900 });
    await sleep(1200);
    const headerInfo = await page.evaluate(() => {
      const ths = [...document.querySelectorAll('.csc-container-table thead th')];
      return ths.map((th) => {
        const style = getComputedStyle(th);
        const range = document.createRange();
        range.selectNodeContents(th);
        const contentH = Math.round(range.getBoundingClientRect().height);
        // A single 11px/1.35 caption line is ~15px; wrapped labels stack 2+.
        const lineH = Math.round(parseFloat(style.fontSize) * parseFloat(style.lineHeight));
        return {
          label: th.textContent.trim(),
          whiteSpace: style.whiteSpace,
          contentH,
          lines: Math.max(1, Math.round(contentH / lineH)),
        };
      });
    });
    const wrapped = headerInfo.filter((h) => h.lines > 1);
    log('fb063-header-measure', { viewport: 1440, headers: headerInfo, wrappedCount: wrapped.length });
    await page.screenshot({ path: path.join(OUT, 'fb063-before-header-1440.png'), fullPage: false });
    await page.close();
  }

  // ── FB-066 surface 1: /trips/new TripInfoCard quick-add (OPS) ───────────
  {
    const page = await openAuthed(browser, 'giaonhan', '/trips/new', { width: 1440, height: 900 });
    await sleep(1500);
    const info = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('.tc-field-quick-add')];
      const labels = [...document.querySelectorAll('.tc-field-head label')].map((l) => l.textContent.trim());
      const carrierTypeOwn = !!document.querySelector('#truckId');
      return {
        quickAddButtons: btns.length,
        buttonVisible: btns.filter((b) => b.offsetParent !== null).length,
        headLabels: labels,
        ownBranchRendered: carrierTypeOwn,
        bodyText: document.body.innerText.includes('Thêm nhanh'),
      };
    });
    log('fb066-trips-new', info);
    await page.screenshot({ path: path.join(OUT, 'fb066-before-trips-new-1440.png'), fullPage: false });
    await page.close();
  }

  // ── FB-066 surface 2: dispatch detailed-plan editor (DISPATCHER) ────────
  {
    const page = await openAuthed(browser, 'dieuvan', '/dispatch', { width: 1440, height: 900 });
    await sleep(2000);
    const info = await page.evaluate(() => {
      const text = document.body.innerText;
      return {
        url: location.href,
        hasDetailPlanLink: !!document.querySelector('a[href*="detail"]'),
        quickAddAnywhere: text.includes('Thêm nhanh'),
        sampleText: text.slice(0, 300),
      };
    });
    log('fb066-dispatch-landing', info);
    await page.screenshot({ path: path.join(OUT, 'fb066-before-dispatch-landing.png'), fullPage: false });
    await page.close();
  }

  log('run-complete');
} catch (err) {
  log('driver-error', { message: err.message, stack: err.stack?.split('\n').slice(0, 4) });
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(OUT, 'repro-before-driver.log'), LOG.map((l) => JSON.stringify(l)).join('\n') + '\n');
  await browser.close();
}
