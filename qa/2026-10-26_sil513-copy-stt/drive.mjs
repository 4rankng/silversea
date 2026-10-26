/**
 * SIL-513 UI drive — the create form container table at 1440:
 *   (1) NO copy icon in the appointment cell / action column,
 *   (2) NO "Copy giờ hẹn cho tất cả N cont" chip in Lịch & ghi chú,
 *   (3) STT hover reveals a small copy icon BESIDE the ordinal (ordinal
 *       stays visible); clicking it DUPLICATES the row right below with
 *       every value (cont number, weight, appointment),
 *   (4) weight column hugs the FB-063 header floor (header not clipped).
 *
 * Usage: node qa/2026-10-26_sil513-copy-stt/drive.mjs <tag>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const BASE = 'http://localhost:7176';
const API = 'http://localhost:3002/api';
const OUT = 'qa/2026-10-26_sil513-copy-stt';
const TAG = process.argv[2] ?? 'after';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
});
if (!login.ok) throw new Error(`login failed: ${login.status}`);
const { token } = await login.json();

mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
});

try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 2 });
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle0', timeout: 45000 });
  await page.waitForSelector('.csc-container-table', { timeout: 30000 });
  // A second row so "insert below" is observable between existing rows.
  await page.click('.csc-add-container');
  await new Promise((r) => setTimeout(r, 500));

  // Fill row 1: số container + trọng lượng + giờ đóng/trả (per-segment —
  // the split datetime renders one input per segment).
  await page.evaluate(() => {
    const numbers = [...document.querySelectorAll('input')].filter((i) => i.getAttribute('aria-label') === 'Số container');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const set = (el, v) => { setter.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    set(numbers[0], 'MSCU6639870');
    const weights = [...document.querySelectorAll('input')].filter((i) => i.getAttribute('aria-label') === 'Trọng lượng (kg)');
    set(weights[0], '24500');
    const row1 = document.querySelectorAll('.csc-container-row')[0];
    const segs = {};
    row1.querySelectorAll('input[data-seg]').forEach((i) => { segs[i.dataset.seg] = i; });
    if (segs.hh) set(segs.hh, '09');
    if (segs.mm) set(segs.mm, '00');
    if (segs.dd) set(segs.dd, '20');
    if (segs.mm2) set(segs.mm2, '09');
    if (segs.yyyy) set(segs.yyyy, '2026');
  });
  await new Promise((r) => setTimeout(r, 300));

  const before = await page.evaluate(() => {
    const row1 = document.querySelectorAll('.csc-container-row')[0];
    const copy = row1.querySelector('.csc-container-row__copy');
    const ordinal = row1.querySelector('.csc-container-row__desktop-index');
    const copyRect = copy?.getBoundingClientRect();
    const ordinalRect = ordinal?.getBoundingClientRect();
    const appointmentCell = row1.querySelector('td.csc-container-cell--appointment');
    const chips = [...document.querySelectorAll('button')].map((b) => b.textContent ?? '');
    const weightTh = [...document.querySelectorAll('.csc-container-table thead th')].find((th) => th.textContent.includes('Trọng lượng'));
    return {
      rowCount: document.querySelectorAll('.csc-container-row').length,
      sttCopy: copyRect ? { x: Math.round(copyRect.x), y: Math.round(copyRect.y), opacity: getComputedStyle(copy).opacity } : null,
      ordinalVisible: ordinal ? getComputedStyle(ordinal).visibility : null,
      ordinalRight: ordinalRect ? Math.round(ordinalRect.right) : null,
      copyBesideOrdinal: copyRect && ordinalRect ? Math.round(copyRect.x) >= Math.round(ordinalRect.x) : null,
      copyInAppointmentCell: appointmentCell ? appointmentCell.querySelector('button') != null : null,
      copyAllChipGone: !chips.some((t) => t.includes('Copy giờ hẹn cho tất cả')),
      weightHeader: weightTh ? { boxW: Math.round(weightTh.getBoundingClientRect().width), textW: (() => { const r = document.createRange(); r.selectNodeContents(weightTh); return Math.round(r.getBoundingClientRect().width); })() } : null,
    };
  });

  // Hover row 1 → the icon reveals (opacity 1).
  await page.evaluate(() => {
    const row1 = document.querySelectorAll('.csc-container-row')[0];
    row1.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  });
  await page.hover('.csc-container-row');
  await new Promise((r) => setTimeout(r, 250));
  const hoverOpacity = await page.evaluate(() => {
    const copy = document.querySelector('.csc-container-row .csc-container-row__copy');
    return copy ? getComputedStyle(copy).opacity : null;
  });
  await page.screenshot({ path: `${OUT}/sil513_${TAG}_hover-stt.png`, fullPage: false });

  // Click the STT copy → duplicate row right below.
  await page.click('.csc-container-row .csc-container-row__copy');
  await new Promise((r) => setTimeout(r, 600));
  const after = await page.evaluate(() => {
    const byLabel = (label) => [...document.querySelectorAll('input')].filter((i) => i.getAttribute('aria-label') === label);
    const numbers = byLabel('Số container');
    const weights = byLabel('Trọng lượng (kg)');
    const readAppt = (rowIndex) => {
      const row = document.querySelectorAll('.csc-container-row')[rowIndex];
      if (!row) return null;
      const segs = {};
      row.querySelectorAll('input[data-seg]').forEach((i) => { segs[i.dataset.seg] = i.value; });
      return { date: `${segs.dd ?? ''}/${segs.mm2 ?? ''}/${segs.yyyy ?? ''}`, time: `${segs.hh ?? ''}:${segs.mm ?? ''}` };
    };
    const rows = [0, 1, 2].map((i) => ({
      number: numbers[i] ? numbers[i].value : null,
      weight: weights[i] ? weights[i].value : null,
      appt: readAppt(i),
    }));
    return {
      rowCount: document.querySelectorAll('.csc-container-row').length,
      rows,
      toast: (document.body.textContent ?? '').includes('Đã nhân bản container 1'),
    };
  });
  await page.screenshot({ path: `${OUT}/sil513_${TAG}_duplicated.png`, fullPage: false });

  const report = { tag: TAG, before, hoverOpacity, after };
  writeFileSync(`${OUT}/sil513_${TAG}_report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
