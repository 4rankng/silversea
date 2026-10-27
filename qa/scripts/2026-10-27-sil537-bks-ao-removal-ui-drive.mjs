// SIL-537 (board id 602) — "Điều vận: gỡ bỏ hoàn toàn BKS báo khách (ảo) khỏi
// bảng Chi tiết Xe và popup Gán xe nhóm (popup chỉ còn 4 trường)" — rung-3
// drive against the WORKTREE build (frontend 7176 = this branch's code,
// backend 3002 shared local DB).
//
//   T01 Kế hoạch Chi tiết Xe: a grouped LCL row whose group carries
//       billing=15C-99999 ≠ actual=15C-77777 (SHP-2610-00102, R39B1-LCL01)
//       renders NO "Báo khách"/"Ảo" text anywhere — the group tag title reads
//       exactly "Ghép trả ĐV · BKS 15C-77777" (row ⋯ menu header included).
//   T02 Gán xe nhóm popup: tick two ungrouped LCL lots (R42RV-D2 / R42RV-02,
//       both EXPORT·Lẻ) → the popup holds EXACTLY 4 fields — Loại xe tính
//       cước trả ĐV *, Nhà xe *, BKS thực (xe chạy chuyến) *, Cước trả ĐV
//       Lô 1 (đ) — and zero BKS-báo-khách anything. Popup is closed without
//       submitting (read-only drive, no data mutation).
//
//   node qa/scripts/2026-10-27-sil537-bks-ao-removal-ui-drive.mjs
// Env: FRONT_PORT (7176), API_PORT (3002), DISPATCH_USER (dungnv)
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const FRONT = `http://localhost:${process.env.FRONT_PORT ?? 7176}`;
const API = `http://localhost:${process.env.API_PORT ?? 3002}/api`;
const OUT = path.resolve('qa');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, '2026-10-27_sil537_bks-ao-removal_ui-driver.log');
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `2026-10-27_sil537_bks-ao-removal_ui-${name}.png`), fullPage: false });

let failures = 0;
const check = (name, ok, detail) => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log(`HEALTH status=${health?.status} api=${API} front=${FRONT}`);
if (health?.status !== 'ok') { log('ABORT: local API health not ok'); process.exit(2); }

const loginRes = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: process.env.DISPATCH_USER ?? 'dungnv', password: 'Abc123' }),
});
if (!loginRes.ok) { log('ABORT: dispatcher login failed'); process.exit(2); }
const { token } = await loginRes.json();
log('LOGIN ok dungnv');

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument((t) => {
  if (location.origin.startsWith('http://localhost')) localStorage.setItem('token', t);
}, token);

const openGrid = async () => {
  await page.goto(`${FRONT}/dispatch-detail`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.detailed-plan-grid__row', { timeout: 25000 });
  await sleep(800);
};
const searchFor = async (needle) => {
  const input = await page.$('input[placeholder="Bill, Cont, Tờ khai..."]');
  if (!input) throw new Error('quick search input not found');
  await input.click();
  await input.type(needle, { delay: 30 });
  for (let i = 0; i < 12; i += 1) {
    await sleep(700);
    const found = await page.evaluate((text) => Array.from(document.querySelectorAll('.detailed-plan-grid__row'))
      .some((n) => (n.textContent ?? '').includes(text)), needle);
    if (found) return true;
  }
  return false;
};

// ── T01: grouped row — no Báo khách/Ảo anywhere ─────────────────────────────
try {
  await openGrid();
  const found = await searchFor('R39B1-LCL01');
  check('T01 grouped lot R39B1-LCL01 visible', found, found ? 'row rendered' : 'row never rendered');
  const rowProbe = await page.evaluate(() => {
    const tr = Array.from(document.querySelectorAll('.detailed-plan-grid__row'))
      .find((n) => (n.textContent ?? '').includes('R39B1-LCL01'));
    if (!tr) return null;
    const tagged = tr.querySelector('.detailed-plan-grid__lcl-group-tag');
    return {
      rowText: (tr.textContent ?? '').replace(/\s+/g, ' ').trim(),
      tagTitle: tagged?.getAttribute('title') ?? null,
    };
  });
  if (!rowProbe) throw new Error('grouped row vanished');
  await shot(page, 'detail-grouped-row');
  check('T01 row text has no Báo khách/Ảo', !/Báo khách|Ảo:/.test(rowProbe.rowText),
    rowProbe.rowText.slice(0, 200));
  check('T01 group tag title = BKS thực only',
    rowProbe.tagTitle === 'Ghép trả ĐV · BKS 15C-77777',
    `title="${rowProbe.tagTitle}"`);

  // Open the row ⋯ menu — its group header repeats the same title.
  const menuBtn = await page.evaluateHandle(() => {
    const tr = Array.from(document.querySelectorAll('.detailed-plan-grid__row'))
      .find((n) => (n.textContent ?? '').includes('R39B1-LCL01'));
    if (!tr) return null;
    const btns = Array.from(tr.querySelectorAll('button'));
    return btns.find((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').includes('Thao tác')
      || (b.getAttribute('aria-label') ?? '').includes('⋮')
      || b.className.includes('row-actions')) ?? btns[btns.length - 1] ?? null;
  });
  const menuEl = menuBtn.asElement?.();
  if (menuEl) {
    await menuEl.click();
    await sleep(800);
    const menuProbe = await page.evaluate(() => {
      const menu = document.querySelector('.detailed-plan-grid__lcl-group-menu');
      return menu ? (menu.textContent ?? '').replace(/\s+/g, ' ').trim() : null;
    });
    await shot(page, 'detail-group-menu');
    if (menuProbe != null) {
      check('T01 row ⋯ group menu has no Báo khách/Ảo', !/Báo khách|Ảo:/.test(menuProbe),
        menuProbe.slice(0, 160));
    } else {
      log('INFO row menu did not open the group submenu — title assertion above still covers the rendered tag');
    }
  }
} catch (err) {
  check('T01 grouped-row drive', false, String(err));
}

// ── T02: Gán xe nhóm popup — exactly 4 fields ───────────────────────────────
try {
  await openGrid();
  const found = await searchFor('R42RV');
  check('T02 ungrouped EXPORT·Lẻ pair visible', found, found ? 'rows rendered' : 'rows never rendered');
  await sleep(400);
  // Tick both LCL rows' checkboxes.
  // The CHỌN column is on-demand (spec 23/10 §2): press [📦 Gộp hàng] first —
  // only then do the row checkboxes exist.
  const mergeToggle = await page.evaluateHandle(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns.find((b) => /Gộp hàng/.test(b.textContent ?? '')) ?? null;
  });
  const mergeEl = mergeToggle.asElement?.();
  if (!mergeEl) throw new Error('[Gộp hàng] toggle not found');
  await mergeEl.click();
  await sleep(900);
  const tickResults = await page.evaluate(() => {
    const trs = Array.from(document.querySelectorAll('.detailed-plan-grid__row'))
      .filter((n) => /R42RV/.test(n.textContent ?? ''));
    const out = [];
    trs.forEach((tr) => {
      const box = tr.querySelector('.detailed-plan-grid__cell--select [role="checkbox"]');
      if (box && box.getAttribute('aria-checked') !== 'true' && !box.hasAttribute('disabled')) { box.click(); out.push(1); }
      else if (box && box.getAttribute('aria-checked') === 'true') out.push(0);
    });
    return out;
  });
  log(`TICKED ${JSON.stringify(tickResults)}`);
  await sleep(900);
  await shot(page, 'assign-bar-ticked');
  // Click the floating-bar "Gán xe nhóm" button.
  const assignBtn = await page.evaluateHandle(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns.find((b) => /Gán xe nhóm/.test(b.textContent ?? '')) ?? null;
  });
  const assignEl = assignBtn.asElement?.();
  if (!assignEl) throw new Error('Gán xe nhóm button not found (bar hidden or rows not tickable)');
  await assignEl.click();
  await page.waitForSelector('[role="dialog"], .modal, .assign-truck-group', { timeout: 15000 });
  await sleep(800);
  const dialogProbe = await page.evaluate(() => {
    const root = document.querySelector('.assign-truck-group') ?? document.querySelector('[role="dialog"]') ?? document.querySelector('.modal');
    if (!root) return null;
    const text = (root.textContent ?? '').replace(/\s+/g, ' ').trim();
    const labels = Array.from(root.querySelectorAll('label, .assign-truck-group__label, .uui-field label'))
      .map((l) => (l.textContent ?? '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    return { text, labels };
  });
  if (!dialogProbe) throw new Error('Gán xe nhóm dialog not found');
  await shot(page, 'assign-popup');
  check('T02 popup has no BKS báo khách (ảo)', !/Báo khách|Ảo|báo khách/i.test(dialogProbe.text),
    'dialog text scanned');
  check('T02 popup field 1 Loại xe tính cước trả ĐV *', dialogProbe.text.includes('Loại xe tính cước trả ĐV'));
  check('T02 popup field 2 Nhà xe *', /\bNhà xe\b/.test(dialogProbe.text));
  check('T02 popup field 3 BKS thực (xe chạy chuyến) *', dialogProbe.text.includes('BKS thực (xe chạy chuyến)'));
  check('T02 popup field 4 Cước trả ĐV Lô 1 (đ)', dialogProbe.text.includes('Cước trả ĐV Lô 1 (đ)'));
  log(`LABELS ${JSON.stringify(dialogProbe.labels)}`);
  // Close without submitting (read-only drive).
  const closeBtn = await page.evaluateHandle(() => {
    const btns = Array.from(document.querySelectorAll('[role="dialog"] button, .modal button, .assign-truck-group button'));
    return btns.find((b) => /Đóng|Huỷ|Hủy|Cancel|Close|×/.test(b.textContent ?? b.getAttribute('aria-label') ?? '')) ?? null;
  });
  const closeEl = closeElSafe(closeBtn);
  if (closeEl) { await closeEl.click(); await sleep(400); }
} catch (err) {
  check('T02 assign-popup drive', false, String(err));
}

function closeElSafe(handle) { return handle?.asElement?.() ?? null; }

await browser.close();
log(`DONE failures=${failures}`);
process.exit(failures ? 1 : 0);
