// SIL-507 (f) UI drive — click dòng ghi chú (NM:/OPS:/Ghi chú:) mở MODAL ghi
// chú, KHÔNG navigate sang /dispatch-detail (QA 27/10: cả mobile lẫn desktop
// đều navigate — bubble lên click-to-detail của FB-014).
//
// Read-only: KHÔNG mutation API — chỉ login + GET /api/shipments (đối chiếu
// text ghi chú UI ↔ dữ liệu API, giữ nguyên persisted state).
//   A. Mobile @390 /dispatch — card có dòng ghi chú: click → modal mở với
//      ĐẦY ĐỦ text ghi chú từ API; URL giữ nguyên /dispatch.
//   B. Desktop @1440 /dispatch — dòng NM/OPS: click → modal; URL giữ nguyên.
//   C. Đối chiếu: text trong modal == ghi chú của lot đó trong GET
//      /api/shipments (expected data identity).
//
// Usage: cd frontend && node ../qa/scripts/2026-10-27-sil507-note-modal-ui-drive.mjs
// Output: qa/2026-10-27_sil507-note-modal/*.png + assertions JSON + driver log.

import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7175';
const API = process.env.QA_API_URL || 'http://localhost:3002/api';
const OUT = resolve(process.cwd(), '../qa/2026-10-27_sil507-note-modal');
mkdirSync(OUT, { recursive: true });
const log = [];
const assertions = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function assert(name, ok, detail) {
  assertions.push({ name, ok: Boolean(ok), detail: detail ?? null });
  log.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail != null ? ` — ${JSON.stringify(detail)}` : ''}`);
  if (!ok) process.exitCode = 1;
}

// ─── API: login + tìm lot có ghi chú (NM/OPS/operational) ───────────────────
const loginRes = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'dungnv', password: 'Abc123' }),
});
const { token } = await loginRes.json();
assert('api login dungnv (DISPATCHER)', Boolean(token));
const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

let target = null;
// Mirror đúng query trang 1 của board (masterPlanListParams): 4 status vận
// hành — lot tìm được chắc chắn nằm trên /dispatch page 1 mặc định.
const BOARD_STATUS = 'READY_FOR_DISPATCH,DISPATCHED,IN_TRANSIT,COMPLETED';
for (let pageIndex = 1; pageIndex <= 6 && !target; pageIndex += 1) {
  const res = await (await fetch(`${API}/shipments?status=${encodeURIComponent(BOARD_STATUS)}&limit=50&page=${pageIndex}`, { headers: auth })).json().catch(() => null);
  const items = res?.items ?? [];
  const withNote = items.find((it) => (it.factoryNotes ?? '').trim() || (it.opsRecoveryNotes?.[0] ?? '').trim());
  if (withNote) target = withNote;
}
assert('tìm thấy lot có NM/OPS note trên board /dispatch (cùng query board)', Boolean(target), target ? { id: target.id, bl: target.blNumber, status: target.status, nm: (target.factoryNotes ?? '').slice(0, 40), ops: (target.opsRecoveryNotes?.[0] ?? '').slice(0, 40) } : null);

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  defaultViewport: { width: 390, height: 844 },
});
const page = await browser.newPage();
await page.goto(`${FE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
await page.goto(`${FE}/login`, { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForSelector('input[name="username"]', { timeout: 45000 });
await page.type('input[name="username"]', 'dungnv');
await page.type('input[name="password"]', 'Abc123');
await page.keyboard.press('Enter');
await page.waitForFunction(() => !window.location.href.includes('login'), { timeout: 45000 });
assert('browser login dungnv', true, { url: page.url() });

const modalProbe = () => page.evaluate(() => {
  const dialog = document.querySelector('[role="dialog"], .modal__content');
  if (!dialog) return { open: false };
  return {
    open: true,
    heading: dialog.querySelector('h1,h2,[class*="title"]')?.textContent?.trim() ?? null,
    body: (dialog.querySelector('[class*="note-modal-content"], [class*="modal-body"], [class*="content"]')?.textContent ?? dialog.textContent).trim().slice(0, 220),
  };
});

async function driveNoteClick({ width, height, tag }) {
  await page.setViewport({ width, height });
  await page.goto(`${FE}/dispatch`, { waitUntil: 'networkidle2', timeout: 60000 });
  // Chờ board render row thật (table tr hoặc card) — không đoán sleep.
  let rowCount = 0;
  try {
    await page.waitForFunction(() => document.querySelectorAll('tbody tr, li.mpcard').length > 0, { timeout: 25000 });
    rowCount = await page.evaluate(() => document.querySelectorAll('tbody tr, li.mpcard').length);
  } catch { /* handled below */ }
  await sleep(800);
  if (rowCount === 0) {
    await page.screenshot({ path: resolve(OUT, `sil507-debug-${tag}-norows.png`) });
    const diag = await page.evaluate(() => ({ path: location.pathname, h1: document.querySelector('h1')?.textContent ?? null, body: document.body.innerText.slice(0, 200) }));
    log.push(`DEBUG [${tag}] no rows — ${JSON.stringify(diag)}`);
  }
  // Needle = đoạn đầu của ghi chú target (bỏ nhãn Ghi chú:/NM:/OPS:, bỏ quote).
  const rawNote = (target?.factoryNotes ?? '').trim() || (target?.opsRecoveryNotes?.[0] ?? '').trim();
  const noteNeedle = rawNote.replace(/^["']|["']$/g, '').slice(0, 14).replace(/\s+/g, ' ');
  // Tìm dòng ghi chú: match row chứa TEXT ghi chú của target (note unique),
  // fallback row đầu tiên có note-line control.
  const clicked = await page.evaluate((noteNeedle) => {
    const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
    const rows = [...document.querySelectorAll('tr, li.mpcard')];
    let row = noteNeedle
      ? rows.find((r) => {
          const line = r.querySelector('.mpcard__note, .mpcard__line--muted, .master-plan-grid__line--notes');
          return line && norm(line.textContent).includes(noteNeedle);
        })
      : null;
    if (!row) {
      row = rows.find((r) => r.querySelector('.mpcard__note, .master-plan-grid__line--notes button.master-plan-grid__notes-trigger'));
    }
    if (!row) return { r: 'row-missing', rowCount: rows.length };
    const noteBtn = row.querySelector('.mpcard__note')
      ?? [...row.querySelectorAll('button')].find((b) => {
        const label = b.getAttribute('aria-label') ?? '';
        return label.startsWith('Xem ghi chú') || /NM:|OPS:/.test(b.textContent);
      });
    if (!noteBtn) return { r: 'note-trigger-missing', rowText: row.textContent.trim().slice(0, 160) };
    noteBtn.click();
    return { r: 'clicked', text: noteBtn.textContent.trim().slice(0, 120), urlBefore: location.pathname };
  }, noteNeedle);
  assert(`[${tag}] dòng ghi chú clicked`, clicked.r === 'clicked', clicked);
  if (clicked.r !== 'clicked') {
    await page.screenshot({ path: resolve(OUT, `sil507-debug-${tag}.png`) });
    return clicked;
  }
  await sleep(900);
  await page.screenshot({ path: resolve(OUT, `sil507-${tag}-modal-open.png`) });
  const modal = await modalProbe();
  assert(`[${tag}] modal ghi chú MỞ sau click`, modal.open === true, modal);
  assert(`[${tag}] KHÔNG navigate sang /dispatch-detail`, !page.url().includes('/dispatch-detail'), { url: page.url() });
  return { clicked, modal };
}

// ─── A. Mobile @390 ─────────────────────────────────────────────────────────
const mobile = await driveNoteClick({ width: 390, height: 844, tag: 'mobile390' });

// ─── B. Desktop @1440 ───────────────────────────────────────────────────────
const desktop = await driveNoteClick({ width: 1440, height: 900, tag: 'desktop1440' });

// ─── C. Đối chiếu text modal ↔ API (expected data identity, read-only) ──────
if (target) {
  const expected = (target.factoryNotes ?? '').trim() || (target.opsRecoveryNotes?.[0] ?? '').trim();
  const modalText = desktop?.modal?.body ?? mobile?.modal?.body ?? '';
  const norm = (s) => s.replace(/\s+/g, ' ');
  assert('modal text khớp ghi chú của lot trong API', Boolean(expected) && norm(modalText).includes(norm(expected).slice(0, 60)), { expected: norm(expected).slice(0, 80), modal: norm(modalText).slice(0, 120) });
}

await browser.close();
writeFileSync(resolve(OUT, 'assertions.json'), JSON.stringify({ targetLot: target ? { id: target.id, blNumber: target.blNumber } : null, mobile, desktop, assertions }, null, 2));
writeFileSync(resolve(OUT, 'ui-driver.log'), `${log.join('\n')}\nEXIT=${process.exitCode ?? 0}\n`);
console.log(log.join('\n'));
console.log(`EXIT=${process.exitCode ?? 0}`);
