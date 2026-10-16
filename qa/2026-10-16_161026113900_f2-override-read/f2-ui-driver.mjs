// Phase 2 — rung-3 UI drive of both money boards on staging @e3286338.
// CUS /shipments-debit (tiepvv): A row must show 7.654.321, B row 0 with the
// merge reason note, C row Chưa xác định. ACCOUNTANT /accounting/chot-debit
// (hoapt): A cuocThu 7.654.321 ₫, B 0 ₫, C Thiếu cước thu.
import puppeteer from 'puppeteer';
import { appendFileSync, writeFileSync } from 'node:fs';

const DIR = 'qa/2026-10-16_161026113900_f2-override-read';
const LOG = `${DIR}/f2-ui-driver.log`;
const BASE = 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const TAG = 'QA-F2-10162045';
const step = (s, o) => {
  const e = { at: new Date().toISOString(), step: s, ...o };
  appendFileSync(LOG, JSON.stringify(e) + '\n');
  console.log(JSON.stringify(e));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function login(identifier) {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password: 'Abc123' }) });
  const body = await res.json();
  return { token: body.token, user: body.user ?? null };
}

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const verdicts = {};
const mark = (id, pass, evidence) => { verdicts[id] = { pass, evidence }; step('verdict', { id, pass, evidence }); };

try {
  // ── Part 1: CUS Chi phí - Quyết toán (/shipments-debit as tiepvv) ──────────
  const cus = await login('tiepvv');
  step('login', { identifier: 'tiepvv', ok: Boolean(cus.token) });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate((t) => { localStorage.setItem('token', t); }, cus.token);
  await page.goto(`${BASE}/shipments-debit`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(4000);
  const bodyText = await page.evaluate(() => document.body.innerText);
  step('page-loaded', { url: page.url(), hasTag: bodyText.includes(TAG), textLen: bodyText.length });
  if (!bodyText.includes(TAG)) {
    // try widening the delivery window via the page's own filters — dump inputs first
    const inputs = await page.evaluate(() => [...document.querySelectorAll('input')].map((i) => ({ type: i.type, value: i.value, aria: i.getAttribute('aria-label'), ph: i.placeholder })));
    step('filters', { inputs });
    await page.screenshot({ path: `${DIR}/ui-01-cus-debit-no-tag.png` });
  }
  const rowText = async (ref) => page.evaluate((r) => {
    const tr = [...document.querySelectorAll('tr')].find((x) => x.innerText.includes(r));
    return tr ? tr.innerText.replace(/\n/g, ' | ') : null;
  }, ref);
  const rowA = await rowText(`${TAG}-A`);
  const rowB = await rowText(`${TAG}-B`);
  const rowC = await rowText(`${TAG}-C`);
  step('rows', { rowA, rowB, rowC });
  mark('UI-CUS-A-override-displayed', Boolean(rowA && rowA.includes('7.654.321')), { rowA });
  const noteB = await page.evaluate((r) => {
    const tr = [...document.querySelectorAll('tr')].find((x) => x.innerText.includes(r));
    const note = tr?.querySelector('.shipment-debit-row__freight-note');
    return note ? note.textContent : null;
  }, `${TAG}-B`);
  mark('UI-CUS-B-zero-with-reason-note', Boolean(rowB && noteB === `Ghép cước cùng Bill ${TAG}-A`), { rowB, noteB });
  mark('UI-CUS-C-fallback-unknown', Boolean(rowC && rowC.includes('Chưa xác định')), { rowC });
  await page.screenshot({ path: `${DIR}/qa-2026-10-16_f2-override-read_ui-cus-debit.png`, fullPage: false });

  // ── Part 2: ACCOUNTANT Kế hoạch điều động tổng hợp (/accounting/chot-debit) ─
  const acc = await login('hoapt');
  step('login', { identifier: 'hoapt', ok: Boolean(acc.token) });
  await page.evaluate((t) => { localStorage.setItem('token', t); localStorage.removeItem('role'); }, acc.token);
  await page.goto(`${BASE}/accounting/chot-debit`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(6000);
  const body2 = await page.evaluate(() => document.body.innerText);
  step('board-loaded', { url: page.url(), hasTag: body2.includes(TAG), textLen: body2.length });
  const boardRow = async (ref) => page.evaluate((r) => {
    const tr = [...document.querySelectorAll('tr')].find((x) => x.innerText.includes(r));
    return tr ? tr.innerText.replace(/\n/g, ' | ') : null;
  }, ref);
  const bA = await boardRow(`${TAG}-A`);
  const bB = await boardRow(`${TAG}-B`);
  const bC = await boardRow(`${TAG}-C`);
  const bD = await boardRow(`${TAG}-D`);
  const bE = await boardRow(`${TAG}-E`);
  step('board-rows', { bA, bB, bC, bD, bE });
  mark('UI-ACC-A-override-displayed', Boolean(bA && bA.includes('7.654.321')), { bA });
  mark('UI-ACC-B-zero', Boolean(bB), { bB });
  mark('UI-ACC-C-fallback-missing-label', Boolean(bC && bC.includes('Thiếu cước thu')), { bC });
  await page.screenshot({ path: `${DIR}/qa-2026-10-16_f2-override-read_ui-accounting-board.png`, fullPage: false });
} catch (err) {
  step('fatal', { error: String(err).slice(0, 500) });
  await page.screenshot({ path: `${DIR}/ui-fatal.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  writeFileSync(`${DIR}/f2-ui-verdicts.json`, JSON.stringify(verdicts, null, 2));
  await browser.close();
}
step('done-ui', { verdicts });
