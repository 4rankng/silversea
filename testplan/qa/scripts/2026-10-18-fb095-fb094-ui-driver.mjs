/**
 * FB-095 + FB-094 UI driver (rung 3 evidence) — local dev stack.
 *
 * FB-095: /dispatch-detail badge "Lẻ · Ghép (i/N)" → group menu (Xem nhóm /
 * Hủy ghép) → SPEC §4 confirm guard → POST /api/shipments/lcl/unmerge → toast
 * + grid refresh, proven against the dev DB.
 * FB-094: /accounting/chot-debit toolbar "Xuất Debit Note" → issue + xlsx
 * download + message banner, proven against the dev DB.
 *
 * Env: QA_BASE (default http://localhost:7175 — the dev-port contract;
 * export QA_BASE for an ad-hoc second instance), QA_API (default
 * http://localhost:3002/api), QA_OUT (artifact prefix dir, default qa),
 * QA_RESUME=1 skips the already-proven FB-095 click path (run 1) and only
 * re-verifies DB state + the post-unmerge grid + the FB-094 section.
 * Exit status: 0 only when every step passes. Log is stdout (tee to qa/).
 */
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

// Dev-port contract (frontend/src/tests/dev-port-contract.test.ts): the
// documented startup port is 7175; a second ad-hoc vite instance rides the
// QA_BASE env override, never a hardcoded default.
const BASE = process.env.QA_BASE ?? 'http://localhost:7175';
const API = process.env.QA_API ?? 'http://localhost:3002/api';
const OUT = process.env.QA_OUT ?? 'qa';
const RESUME = process.env.QA_RESUME === '1';
const PREFIX = '2026-10-18_fb095';
const PREFIX094 = '2026-10-18_fb094';
const DL = resolve(OUT, 'downloads');
mkdirSync(OUT, { recursive: true });
mkdirSync(DL, { recursive: true });

const require = createRequire(new URL('../../../backend/package.json', import.meta.url));
const postgres = require('postgres');

let failures = 0;
const log = (line) => console.log(line);
function check(name, ok, detail = '') {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

async function login(identifier) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  const body = await res.json();
  if (!body.token) throw new Error(`login ${identifier} failed: ${JSON.stringify(body).slice(0, 200)}`);
  return body.token;
}

async function withUser(browser, token, fn) {
  const page = await browser.newPage();
  // puppeteer-spa-auth: the token must exist BEFORE the SPA boots or the auth
  // guard silently redirects to /login.
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  page.setDefaultTimeout(20000);
  try {
    await fn(page);
  } finally {
    await page.close().catch(() => {});
  }
}

async function clickByText(page, selector, text) {
  return page.evaluate((sel, label) => {
    const nodes = [...document.querySelectorAll(sel)];
    const target = nodes.find((n) => (n.textContent ?? '').trim() === label);
    if (!target) return false;
    target.click();
    return true;
  }, selector, text);
}

async function textPresent(page, text) {
  return page.evaluate((t) => (document.body.innerText ?? '').includes(t), text);
}

async function waitForText(page, text, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await textPresent(page, text)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function shot(page, name) {
  await page.screenshot({ path: resolve(OUT, `${name}.png`) });
  log(`SHOT ${name}.png`);
}

async function dbToJson(query) {
  const sql = postgres({ host: '127.0.0.1', port: 5441, user: 'postgres', password: 'postgres', database: 'silversea' });
  try {
    return (await sql.unsafe(query)).map((r) => r.j ?? r);
  } finally {
    await sql.end();
  }
}

// A failing evidence query must report FAIL and let the run continue.
async function dbCheck(name, query, assert, detailOf = (rows) => JSON.stringify(rows[0] ?? {}).slice(0, 240)) {
  try {
    const rows = await dbToJson(query);
    check(name, assert(rows), detailOf(rows));
    return rows;
  } catch (err) {
    check(name, false, `query error: ${err.message}`);
    return [];
  }
}

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  // ─── FB-095: badge → Hủy ghép on /dispatch-detail (dieuvan) ────────────────
  log('== FB-095 (card 181026145610) — Hủy ghép trên badge nhóm ==');
  const dieuvan = await login('dieuvan');
  await withUser(browser, dieuvan, async (page) => {
    if (!RESUME) {
      await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2' });
      const search = await page.waitForSelector('[aria-label="Tìm nhanh"]', { timeout: 20000 }).catch(() => null);
      check('FB095-01 /dispatch-detail mở, có ô Tìm nhanh', search != null);
      if (!search) return;
      await search.type('UI-LCL-B77AP2');
      const badgeFound = await waitForText(page, 'Lẻ · Ghép (1/3)');
      check('FB095-02 badge "Lẻ · Ghép (1/3)" hiện trên hàng Lô 1', badgeFound);
      if (!badgeFound) return;
      await shot(page, `${PREFIX}_ui-01-badge`);

      check('FB095-03 click badge mở menu nhóm', await clickByText(page, 'button', 'Lẻ · Ghép (1/3)'));
      const menuNamed = await waitForText(page, 'Nhóm ghép trả ĐV · Lẻ (1/3)');
      check('FB095-04 menu "Nhóm ghép trả ĐV · Lẻ (1/3)" mở (Xem nhóm)', menuNamed);
      const membersShown = (await textPresent(page, 'UI-LCL-B77AP2-1'))
        && (await textPresent(page, 'UI-LCL-B77AP2-2'))
        && (await textPresent(page, 'UI-LCL-B77AP2-3'))
        && (await textPresent(page, '29C-B77AP2'));
      check('FB095-05 menu liệt kê thành viên + BKS', membersShown);
      await shot(page, `${PREFIX}_ui-02-badge-menu`);

      check('FB095-06 chọn "Hủy ghép" mở guard confirm', await clickByText(page, 'button', 'Hủy ghép'));
      const guardCopy = await waitForText(page, 'Hủy ghép nhóm 3 lô? Lô 2 sẽ thành Lô chính và nhận 100% tiền cước trả ĐV.');
      check('FB095-07 confirm nêu thăng cấp Lô 2 (SPEC §4)', guardCopy);
      await shot(page, `${PREFIX}_ui-03-confirm`);

      check('FB095-08 xác nhận "Hủy ghép"', await clickByText(page, '.confirm-actions button.btn--primary', 'Hủy ghép'));
      const toasted = await waitForText(page, 'Đã hủy ghép');
      check('FB095-09 toast kết quả thành công', toasted);
      await shot(page, `${PREFIX}_ui-04-toast`);
    } else {
      log('SKIP FB095-01..09 — click path proven in run 1 (qa/2026-10-18_fb095-fb094_ui-driver.log)');
    }

    const rows = await dbCheck(
      'FB095-10..12 DB: tách Lô 1 → Lô 2 thăng cấp, nhóm renumber (SPEC §4)',
      'SELECT to_jsonb(s) AS j FROM shipments s WHERE s.id IN (104250,104251,104252)',
      (rs) => {
        const by = Object.fromEntries(rs.map((r) => [r.id, r]));
        return by[104250]?.cost_group_id == null
          && by[104251]?.cost_group_order === 1
          && by[104252]?.cost_group_order === 2;
      },
      (rs) => JSON.stringify(rs.map((r) => ({ id: r.id, g: r.cost_group_id, o: r.cost_group_order }))),
    );
    writeFileSync(resolve(OUT, `${PREFIX}_db-after.json`), JSON.stringify(rows, null, 2));

    await dbCheck(
      'FB095-13 DB audit: SHIPMENT_LCL_GROUP_UNMERGED + chuyển tiền cho lô kế vị',
      'SELECT to_jsonb(a) AS j FROM audit_logs a ORDER BY a.id DESC LIMIT 30',
      (rs) => rs.some((r) => {
        const s = JSON.stringify(r);
        return s.includes('SHIPMENT_LCL_GROUP_UNMERGED') && s.includes('104251') && s.includes('transferredAmount');
      }),
      (rs) => {
        const hit = rs.find((r) => JSON.stringify(r).includes('SHIPMENT_LCL_GROUP_UNMERGED'));
        return JSON.stringify(hit ?? {}).slice(0, 240);
      },
    );

    // Post-unmerge grid identity (persisted state on screen).
    await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2' });
    const search = await page.waitForSelector('[aria-label="Tìm nhanh"]', { timeout: 20000 }).catch(() => null);
    if (search) await search.type('UI-LCL-B77AP2');
    const refreshed = await waitForText(page, RESUME ? 'Lẻ · Ghép (1/2)' : 'Lẻ · Ghép (1/2)');
    check('FB095-14 lưới tải lại, badge phản ánh nhóm sau tách (1/2)', refreshed);
    await shot(page, `${PREFIX}_ui-05-grid-after`);
  });

  // ─── FB-094: Xuất Debit Note trên /accounting/chot-debit (ketoan) ──────────
  log('== FB-094 (card 181026145620) — Xuất Debit Note ==');
  const ketoan = await login('ketoan');
  await withUser(browser, ketoan, async (page) => {
    await page.goto(`${BASE}/accounting/chot-debit`, { waitUntil: 'networkidle2' });
    const cdp = await page.createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL, eventsEnabled: true }).catch(() => {});

    const button = await page.waitForSelector('button ::-p-text(Xuất Debit Note)', { timeout: 20000 }).catch(() => null);
    check('FB094-01 toolbar có nút "Xuất Debit Note"', button != null);
    if (!button) return;
    const disabledNoSel = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((n) => (n.textContent ?? '').trim() === 'Xuất Debit Note');
      return b ? b.disabled : null;
    });
    check('FB094-02 chưa chọn dòng → nút disable + giải thích', disabledNoSel === true);
    await shot(page, `${PREFIX094}_ui-01-toolbar`);

    // Row selection is the row itself (card 20260929_207).
    const rowClicked = await page.evaluate(() => {
      const row = document.querySelector('.debit-board tbody tr');
      if (!row) return false;
      row.click();
      return true;
    });
    check('FB094-03 chọn 1 dòng (click row)', rowClicked);
    const enabledAfter = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((n) => (n.textContent ?? '').trim() === 'Xuất Debit Note');
      return b ? !b.disabled : null;
    });
    check('FB094-04 chọn dòng → nút enabled', enabledAfter === true);
    await shot(page, `${PREFIX094}_ui-02-selected`);

    check('FB094-05 click "Xuất Debit Note"', await clickByText(page, 'button', 'Xuất Debit Note'));
    const reported = await waitForText(page, 'Đã xuất Debit Note');
    check('FB094-06 message thành công sau khi xuất', reported);
    await shot(page, `${PREFIX094}_ui-03-result`);

    await new Promise((r) => setTimeout(r, 3000));
    const files = existsSync(DL) ? readdirSync(DL).filter((f) => f.endsWith('.xlsx')) : [];
    check('FB094-07 file .xlsx tải về máy', files.length > 0, files.join(', '));

    await dbCheck(
      'FB094-08 DB: Debit Note document được tạo',
      "SELECT to_jsonb(b) AS j FROM billing_documents b WHERE b.type = 'DEBIT_NOTE' ORDER BY b.id DESC LIMIT 2",
      (rs) => rs.length > 0,
    );
  });
} finally {
  await browser.close();
}

log(`DONE failures=${failures}`);
process.exit(failures === 0 ? 0 : 1);
