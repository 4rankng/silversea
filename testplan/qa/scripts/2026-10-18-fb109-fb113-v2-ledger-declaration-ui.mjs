// FB-109 + FB-113 v2 — the REAL QA surface: the /shipments-detail ledger
// TABLE (ShipmentContainerLedger.tsx), not the documents popup. QA feedback
// 18/10 on build 2bf3cf9f: the table lacked a "Số tờ khai" COLUMN (FB-113)
// and an inline Sửa button per declaration row (FB-109).
// Flow: cus login → lot 110222 (FB110-BL-001, 2 conts; FBKU1234565 has
// FB110-DECL-A, FBKU2234560 empty) → column header order → cell values →
// Sửa click → documents editor opens seeded → retype số → Lưu → table + DB
// updated → restore the original number through the SAME UI path.
// Usage: node testplan/qa/scripts/2026-10-18-fb109-fb113-v2-ledger-declaration-ui.mjs
// (QA_BASE overrides the frontend base when another dev server owns 7175.)
import puppeteer from 'puppeteer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const API = 'http://localhost:3002/api';
const BASE = process.env.QA_BASE || 'http://localhost:7175';
const OUT = path.resolve(import.meta.dirname, '../../../qa/2026-10-18_fb109-fb113-v2');
fs.mkdirSync(OUT, { recursive: true });

const LOG = [];
const log = (step, obj = {}) => {
  const e = { at: new Date().toISOString(), step, ...obj };
  LOG.push(e);
  console.log(JSON.stringify(e));
};
const results = [];
let exitCode = 0;
const record = (id, pass, detail) => {
  results.push({ id, pass, detail });
  if (!pass) exitCode = 1;
  log('RESULT', { id, pass, detail });
};

const login = async (identifier) => {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (!res.ok) throw new Error(`login ${identifier} -> ${res.status}`);
  const { token } = await res.json();
  return token;
};

const api = (token) => async (method, p, body) => {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = text;
  try { parsed = JSON.parse(text); } catch { /* keep raw */ }
  return { status: res.status, body: parsed };
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CONT = 'FBKU1234565';
const SUA_SELECTOR = `button[aria-label="Sửa tờ khai container ${CONT}"]`;
const SAVE_SELECTOR = `button[aria-label="Lưu chứng từ và hãng tàu ${CONT}"]`;

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });

/** Opens the documents editor via the row's Sửa button, select-alls the
 *  Số tờ khai input, types `next`, asserts field content AND selection before
 *  saving, then waits for the editor to close (the table then refetches). */
async function editDeclarationViaUi(page, cont, next) {
  const suaSelector = `button[aria-label="Sửa tờ khai container ${cont}"]`;
  const saveSelector = `button[aria-label="Lưu chứng từ và hãng tàu ${cont}"]`;
  await page.evaluate((sel) => {
    document.querySelector(sel)?.scrollIntoView({ block: 'center' });
  }, suaSelector);
  await sleep(200);
  await page.click(suaSelector);
  await page.waitForSelector('.shipment-container-ledger__inline-editor[data-mode="documents"]', { timeout: 20000 });
  await sleep(400);
  const inputInfo = await page.evaluate(() => {
    const editor = document.querySelector('.shipment-container-ledger__inline-editor[data-mode="documents"]');
    const label = Array.from(editor.querySelectorAll('label')).find((l) => l.querySelector('span')?.textContent === 'Số tờ khai');
    const input = label.querySelector('input');
    input.focus();
    return { value: input.value, length: input.value.length };
  });
  // Select the whole value inside the page (deterministic even across React
  // re-renders), type through real key events, and verify; if the keyboard
  // path still misses (focus raced a re-render), fall back to the native
  // value setter + input event — the same controlled-input pipeline React
  // reads. The value check below gates either way; a silent mismatch never
  // reaches Lưu.
  await page.evaluate(() => {
    const editor = document.querySelector('.shipment-container-ledger__inline-editor[data-mode="documents"]');
    const label = Array.from(editor.querySelectorAll('label')).find((l) => l.querySelector('span')?.textContent === 'Số tờ khai');
    const input = label.querySelector('input');
    input.focus();
    input.setSelectionRange(0, input.value.length);
  });
  await page.keyboard.type(next, { delay: 25 });
  await sleep(150);
  let typed = await page.evaluate(() => {
    const editor = document.querySelector('.shipment-container-ledger__inline-editor[data-mode="documents"]');
    const label = Array.from(editor.querySelectorAll('label')).find((l) => l.querySelector('span')?.textContent === 'Số tờ khai');
    return label.querySelector('input').value;
  });
  if (typed !== next) {
    log('keyboard typing missed — native setter fallback', { typed, expected: next });
    typed = await page.evaluate((value) => {
      const editor = document.querySelector('.shipment-container-ledger__inline-editor[data-mode="documents"]');
      const label = Array.from(editor.querySelectorAll('label')).find((l) => l.querySelector('span')?.textContent === 'Số tờ khai');
      const input = label.querySelector('input');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      input.focus();
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return input.value;
    }, next);
    await sleep(150);
  }
  if (typed !== next) throw new Error(`typed value mismatch: expected "${next}", field holds "${typed}" (was "${inputInfo.value}")`);
  await page.click(saveSelector);
  await page.waitForFunction(() => !document.querySelector('.shipment-container-ledger__inline-editor[data-mode="documents"]'), { timeout: 20000 });
  await sleep(500);
}

const persistedDeclaration = async (call, cont) => {
  const res = await call('GET', '/shipments/cus-workspace/containers?page=1&limit=20&searchSuffix=BL-001');
  const row = (res.body?.items ?? []).find((i) => i.containerNumber === cont);
  return { status: res.status, declarationNumber: row?.declarationNumber ?? null };
};

try {
  const token = await login('cus');
  const call = api(token);
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const mutations = [];
  page.on('request', (req) => {
    if (/\/api\/shipments/.test(req.url()) && !['GET', 'OPTIONS'].includes(req.method())) {
      mutations.push({ method: req.method(), url: req.url(), body: req.postData() ?? null });
      log('mutation', { method: req.method(), url: req.url(), body: (req.postData() ?? '').slice(0, 300) });
    }
  });
  page.on('response', (res) => {
    if (/\/api\/shipments/.test(res.url()) && !['GET', 'OPTIONS'].includes(res.request().method())) {
      log('mutation_status', { status: res.status, url: res.url() });
    }
  });

  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/shipments-detail?dateScope=all&searchSuffix=BL-001`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('.shipment-container-ledger table', { timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll('.shipment-container-ledger tbody tr').length >= 2, { timeout: 30000 });
  await sleep(400);

  // ── Cleanup guard: whatever a previous probe left behind, land BOTH rows
  //    on the seeded state first — every later assertion then reads a known
  //    state, and the lot ends the run exactly as it started. (The editor's
  //    auto-copy fills EMPTY siblings on save, so a polluted probe write can
  //    reach the sibling too; its clear applies only to its own container.)
  const before = await persistedDeclaration(call, CONT);
  log('state before', before);
  if (before.declarationNumber !== 'FB110-DECL-A') {
    await editDeclarationViaUi(page, CONT, 'FB110-DECL-A');
    const cleaned = await persistedDeclaration(call, CONT);
    record('cleanup guard: row reset to FB110-DECL-A', cleaned.declarationNumber === 'FB110-DECL-A', JSON.stringify(cleaned));
  }
  const beforeSibling = await persistedDeclaration(call, 'FBKU2234560');
  if (beforeSibling.declarationNumber != null) {
    await editDeclarationViaUi(page, 'FBKU2234560', '');
    const cleanedSibling = await persistedDeclaration(call, 'FBKU2234560');
    record('cleanup guard: empty sibling reset to no-number', cleanedSibling.declarationNumber == null, JSON.stringify(cleanedSibling));
  }

  // ── FB-113: header order Số Bill/Booking → Số tờ khai → Nhập/Xuất → Hãng tàu ──
  const headers = await page.evaluate(() => Array.from(document.querySelectorAll('.shipment-container-ledger thead th')).map((th) => th.textContent.trim()));
  log('headers', { headers });
  const idx = (name) => headers.indexOf(name);
  record('FB113 header order', ['Bill/Booking', 'Số tờ khai', 'Nhập/Xuất', 'Hãng tàu'].every((h, i, arr) => {
    const at = idx(h);
    return at >= 0 && (i === 0 || at > idx(arr[i - 1]));
  }) && idx('Bill/Booking') > idx('Khách hàng & lộ trình') && idx('Hãng tàu') < idx('Thông số container'), JSON.stringify(headers));

  const ledgerBox = await (await page.$('.shipment-container-ledger')).boundingBox();
  await page.screenshot({ path: path.join(OUT, 'ui-1-ledger-columns-fb113.png'), clip: ledgerBox });

  // ── Cell contents live in their own columns (visible text only — the
  //    trigger's a11y purpose span is clip-hidden but part of textContent). ──
  const suaSelector = `button[aria-label="Sửa tờ khai container ${CONT}"]`;
  const rowCells = await page.evaluate((sel) => {
    const row = Array.from(document.querySelectorAll('.shipment-container-ledger tbody tr'))
      .find((tr) => tr.textContent.includes('FBKU1234565'));
    if (!row) return null;
    const visible = (td) => (td ? Array.from(td.querySelectorAll('*'))
      .filter((el) => el.closest('.shipment-container-ledger__edit-purpose') === null && el.children.length === 0)
      .map((el) => el.textContent.trim()).filter(Boolean).join(' ') : null);
    const cell = (label) => visible(row.querySelector(`td[data-label="${label}"]`));
    return {
      bill: cell('Bill/Booking'), declaration: cell('Số tờ khai'),
      direction: cell('Nhập/Xuất'), line: cell('Hãng tàu'),
      suaPresent: Boolean(row.querySelector(sel)),
    };
  }, suaSelector);
  log('row FBKU1234565', rowCells);
  record('FB113 per-column values', rowCells
    && rowCells.bill === 'FB110-BL-001'
    && rowCells.declaration === 'FB110-DECL-A Sửa'
    && rowCells.direction === 'Nhập'
    && (rowCells.line ?? '').includes('Maersk'), JSON.stringify(rowCells));

  // ── R17: every QA-named header fits ONE line at the QA width (1440) ──
  const headerFit = await page.evaluate(() => Array.from(document.querySelectorAll('.shipment-container-ledger thead th'))
    .filter((th) => ['Bill/Booking', 'Số tờ khai', 'Nhập/Xuất', 'Hãng tàu'].includes(th.textContent.trim()))
    .map((th) => ({ text: th.textContent.trim(), clips: th.querySelector('.table-sort-button')
      ? th.querySelector('.table-sort-button').scrollWidth > th.clientWidth
      : th.scrollWidth > th.clientWidth })));
  record('FB113 new headers fit one line', headerFit.every((h) => !h.clips), JSON.stringify(headerFit));

  // ── FB-109: Sửa button on the row WITH a tờ khai ──
  record('FB109 Sửa visible on filled row', rowCells?.suaPresent === true, `suaPresent=${rowCells?.suaPresent}`);
  const rowBox = await page.evaluate((cont) => {
    const row = Array.from(document.querySelectorAll('.shipment-container-ledger tbody tr'))
      .find((tr) => tr.textContent.includes(cont));
    const r = row.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, CONT);
  await page.screenshot({ path: path.join(OUT, 'ui-2-sua-button-filled-row-fb109.png'), clip: rowBox });

  // The still-empty sibling keeps the affordance too (add path).
  const emptyRowSua = await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.shipment-container-ledger tbody tr'))
      .find((tr) => tr.textContent.includes('FBKU2234560'));
    return Boolean(row?.querySelector('button[aria-label="Sửa tờ khai container FBKU2234560"]'));
  });
  record('FB109 Sửa visible on empty row', emptyRowSua, `suaPresent=${emptyRowSua}`);

  // ── Click Sửa → documents editor opens, seeded with the row's number ──
  await page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ block: 'center' }), SUA_SELECTOR);
  await sleep(200);
  await page.click(SUA_SELECTOR);
  await page.waitForSelector('.shipment-container-ledger__inline-editor[data-mode="documents"]', { timeout: 20000 });
  await sleep(400);
  const editorState = await page.evaluate((cont) => {
    const editors = document.querySelectorAll('.shipment-container-ledger__inline-editor[data-mode="documents"]');
    const editor = editors[0];
    const label = Array.from(editor.querySelectorAll('label')).find((l) => l.querySelector('span')?.textContent === 'Số tờ khai');
    return {
      editorCount: editors.length,
      anchoredInToKhaiCell: Boolean(document.querySelector('td[data-label="Số tờ khai"] .shipment-container-ledger__inline-editor[data-mode="documents"]')),
      declarationValue: label?.querySelector('input')?.value ?? null,
      saveLabel: Array.from(editor.querySelectorAll('button')).map((b) => b.getAttribute('aria-label') || b.textContent.trim()).join('|'),
      purpose: cont,
    };
  }, CONT);
  log('editor open', editorState);
  record('FB109 editor opens seeded', editorState.editorCount === 1 && editorState.anchoredInToKhaiCell && editorState.declarationValue === 'FB110-DECL-A', JSON.stringify(editorState));
  const editorBox = await (await page.$('.shipment-container-ledger__inline-editor[data-mode="documents"]')).boundingBox();
  await page.screenshot({ path: path.join(OUT, 'ui-3-editor-open.png'), clip: {
    x: Math.max(0, editorBox.x - 20), y: Math.max(0, editorBox.y - 120),
    width: Math.min(1440, editorBox.width + 200), height: editorBox.height + 160,
  } });

  // The editor closes via the keyboard path too (Esc = cancel, no write).
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.shipment-container-ledger__inline-editor[data-mode="documents"]'), { timeout: 20000 });
  const afterEsc = await persistedDeclaration(call, CONT);
  record('Esc cancels without a write', afterEsc.declarationNumber === 'FB110-DECL-A', JSON.stringify(afterEsc));

  // ── Retype the số → Lưu → table + DB update ──
  await editDeclarationViaUi(page, CONT, 'TK-QA-V2-001');
  const afterSaveCell = await page.evaluate((cont) => {
    const row = Array.from(document.querySelectorAll('.shipment-container-ledger tbody tr'))
      .find((tr) => tr.textContent.includes(cont));
    const td = row.querySelector('td[data-label="Số tờ khai"]');
    return Array.from(td.querySelectorAll('*'))
      .filter((el) => el.closest('.shipment-container-ledger__edit-purpose') === null && el.children.length === 0)
      .map((el) => el.textContent.trim()).filter(Boolean).join(' ');
  }, CONT);
  record('FB109 save updates table', afterSaveCell.includes('TK-QA-V2-001'), `cell="${afterSaveCell}"`);
  const rowBox2 = await page.evaluate((cont) => {
    const row = Array.from(document.querySelectorAll('.shipment-container-ledger tbody tr'))
      .find((tr) => tr.textContent.includes(cont));
    const r = row.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, CONT);
  await page.screenshot({ path: path.join(OUT, 'ui-4-after-save.png'), clip: rowBox2 });

  // ── DB side effect: the persisted row carries the new number ──
  const persisted = await persistedDeclaration(call, CONT);
  log('persisted row', persisted);
  record('DB side effect', persisted.status === 200 && persisted.declarationNumber === 'TK-QA-V2-001', JSON.stringify(persisted));

  // ── Restore the original number through the SAME UI path ──
  await editDeclarationViaUi(page, CONT, 'FB110-DECL-A');
  const restored = await persistedDeclaration(call, CONT);
  record('restore original số', restored.declarationNumber === 'FB110-DECL-A', JSON.stringify(restored));

  // ── Responsive bands: 768 and 390 (card mode labels + Sửa) ──
  for (const [w, h] of [[768, 1024], [390, 844]]) {
    await page.setViewport({ width: w, height: h });
    await page.goto(`${BASE}/shipments-detail?dateScope=all&searchSuffix=BL-001`, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('.shipment-container-ledger tbody tr', { timeout: 30000 });
    await sleep(500);
    const mobileState = await page.evaluate((sel) => {
      const sua = document.querySelector(sel);
      const rect = sua?.getBoundingClientRect();
      return {
        suaVisible: Boolean(sua && rect.width > 0 && rect.height > 0),
        suaHeight: rect?.height ?? null,
        overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    }, SUA_SELECTOR);
    log(`band ${w}`, mobileState);
    record(`band ${w}: Sửa visible, no page overflow`, mobileState.suaVisible && !mobileState.overflowX, JSON.stringify(mobileState));
    await page.screenshot({ path: path.join(OUT, `ui-5-band-${w}.png`), fullPage: false });
  }

  fs.writeFileSync(path.join(OUT, 'ui-driver.log'), JSON.stringify({ base: BASE, results, log: LOG }, null, 2));
  log('DONE', { pass: results.filter((r) => r.pass).length, fail: results.filter((r) => !r.pass).length });
} catch (e) {
  exitCode = 1;
  log('FATAL', { error: String(e) });
  fs.writeFileSync(path.join(OUT, 'ui-driver.log'), JSON.stringify({ base: BASE, results, log: LOG, fatal: String(e) }, null, 2));
} finally {
  await browser.close();
}
process.exit(exitCode);
