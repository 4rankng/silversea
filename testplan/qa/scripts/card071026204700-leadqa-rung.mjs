// Card 071026204700 — lead staging QA on cut 9e4e9713: the create-form
// appointment cell opens ONE combined 'Chọn ngày giờ' popup (calendar +
// Giờ/Phút + 'Giờ chính xác'). v3: field renders with the default row.
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-07_kb204700-leadqa';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: '9e4e9713' });
if (!String(health.buildHash || '').startsWith('9e4e9713')) { log('build-currency-FAIL'); process.exit(2); }

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'thanhdc', password: 'Abc123' }) });
const token = (await login.json()).token;
if (!token) { log('login-FAIL'); process.exit(2); }

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1100 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(5000);

  // Ensure a container row exists (the appointment column lives in the container table)
  const needRow = await page.evaluate(() => {
    const ths = [...document.querySelectorAll('th')].filter((e) => e.offsetParent !== null);
    return !ths.some((t) => /đóng trả/i.test((t.textContent || '').trim()));
  });
  if (needRow) {
    const add = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].filter((e) => e.offsetParent !== null).find((x) => /Thêm container/.test((x.textContent || '').trim()));
      if (!b) return null;
      b.scrollIntoView({ block: 'center' });
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    log('add-container', { add });
    if (!add) { log('FAIL-no-add-button'); exitCode = 1; throw new Error('no add button'); }
    await page.mouse.move(add.x, add.y); await page.mouse.down(); await page.mouse.up();
    await sleep(1200);
  } else log('row-already-present', {});

  // Locate the appointment cell (outside-input point)
  // Find a click point INSIDE the appointment cell that is not covered by a
  // sticky heading/overlay — scan a grid of candidate points in the td.
  const cellPt = await page.evaluate(() => {
    const ths = [...document.querySelectorAll('th')].filter((e) => e.offsetParent !== null);
    const target = ths.find((t) => /đóng trả/i.test((t.textContent || '').trim()));
    if (!target) return { err: 'no-th' };
    const table = target.closest('table');
    const row = table ? table.querySelector('tbody tr') : null;
    if (!row) return { err: 'no-body-row' };
    const hdrCells = [...target.parentElement.children];
    const idx = hdrCells.indexOf(target);
    const td = row.children[idx];
    if (!td) return { err: 'no-td', idx };
    td.scrollIntoView({ block: 'center', inline: 'center' });
    const r = td.getBoundingClientRect();
    const owns = (el) => td === el || td.contains(el);
    const candidates = [];
    for (const fx of [0.25, 0.5, 0.75, 0.15, 0.85]) {
      for (const fy of [0.5, 0.3, 0.7]) {
        const x = r.x + r.width * fx, y = r.y + r.height * fy;
        const top = document.elementsFromPoint(x, y)[0];
        if (top && owns(top)) candidates.push({ x, y, top: `${top.tagName}.${String(top.className).slice(0, 40)}` });
      }
    }
    return candidates[0] ? { ...candidates[0], allClear: candidates.length, tdClass: String(td.className).slice(0, 50) } : { err: 'td-fully-covered', tdClass: String(td.className).slice(0, 50) };
  });
  log('cell-point', cellPt);
  if (cellPt.err || !cellPt.x) { log('FAIL-no-cell', cellPt); exitCode = 1; throw new Error('no cell'); }
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-before-click.png` });
  await page.mouse.move(cellPt.x, cellPt.y); await page.mouse.down(); await page.mouse.up();
  await sleep(1200);

  const popup = await page.evaluate(() => {
    const body = document.body.textContent || '';
    const portals = [...document.querySelectorAll('body > div:not(#root), [class*="popup"], [class*="surface"], [role="dialog"]')];
    const candidates = portals.filter((p) => /Chọn ngày|Giờ|Xong|Tháng/.test((p.textContent || '')));
    return {
      chonNgayGio: body.includes('Chọn ngày giờ'),
      chonNgayOnly: body.includes('Chọn ngày') && !body.includes('Chọn ngày giờ'),
      gioChinhXac: body.includes('Giờ chính xác'),
      xong: body.includes('Xong'),
      hasCalendarMonth: /Tháng \d+/.test(body),
      combinedClass: Boolean(document.querySelector('[class*="combined"]')),
      candidateCount: candidates.length,
      candidateInfo: candidates.slice(0, 3).map((c) => ({ cls: String(c.className).slice(0, 90), text: (c.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 160) })),
    };
  });
  log('popup-scan', popup);
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-popup.png` });
  if (popup.combinedClass && popup.gioChinhXac) {
    log('PASS-combined-popup', { AC1: true });
  } else {
    // Retry once on the td center (MiMo's card says the click opens the popup
    // from the cell area outside the input).
    const retry = await page.evaluate(() => {
      const ths = [...document.querySelectorAll('th')].filter((e) => e.offsetParent !== null);
      const target = ths.find((t) => /đóng trả/i.test((t.textContent || '').trim()));
      const row = target && target.closest('table')?.querySelector('tbody tr');
      const td = row && row.children[[...target.parentElement.children].indexOf(target)];
      if (!td) return null;
      const r = td.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (retry) {
      await page.mouse.move(retry.x, retry.y); await page.mouse.down(); await page.mouse.up();
      await sleep(1200);
      const scan2 = await page.evaluate(() => ({
        combinedClass: Boolean(document.querySelector('[class*="combined"]')),
        gioChinhXac: (document.body.textContent || '').includes('Giờ chính xác'),
        xong: (document.body.textContent || '').includes('Xong'),
        portalText: [...document.querySelectorAll('body > div:not(#root)')].map((p) => (p.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120)).filter(Boolean).slice(0, 4),
      }));
      log('popup-scan-retry', scan2);
      await page.screenshot({ path: `${QA}/${SCOPE}_ui-popup-retry.png` });
      if (scan2.combinedClass && scan2.gioChinhXac) { log('PASS-combined-popup', { AC1: true, via: 'retry-center' }); exitCode = exitCode; }
      else { log('FAIL-popup-not-detected'); exitCode = 1; }
    } else { log('FAIL-popup-not-detected'); exitCode = 1; }
  }
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
