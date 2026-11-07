// SIL-688 r4 — rung-3 UI DRIVEN (AGENTS §9): the Xóa lô affordance obeys the
// ORDER-issued law, never lot status, on every CUS/ADMIN surface; dispatchers
// get no affordance.
// Stack: FE :7190 (this worktree) → BE :3003 (this worktree) → DB ss-prod-db:5441.
import puppeteer from 'puppeteer-core';
import { mkdirSync, appendFileSync } from 'node:fs';

const BASE = 'http://localhost:7190';
const API = 'http://localhost:3003/api';
const DIR = 'qa/2026-11-07-k9-688-693';
const LOG = `${DIR}/ui-driver-688.log`;
mkdirSync(DIR, { recursive: true });
const log = (line) => { const text = `${new Date().toISOString()} ${line}`; console.log(text); appendFileSync(LOG, `${text}\n`); };
appendFileSync(LOG, `\n=== SIL-688 r4 UI drive ${new Date().toISOString()} ===\n`);

const login = async (identifier) => {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (!res.ok) throw new Error(`login ${identifier} failed: ${res.status}`);
  const { token } = await res.json();
  log(`login ${identifier}: ${token ? 'OK' : 'FAIL'}`);
  return token;
};

const apiGet = async (token, path) => {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, text: await res.text() };
};

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1440,1000'],
  defaultViewport: { width: 1440, height: 1000 },
});
let failures = 0;
const check = (name, ok, detail) => {
  failures += ok ? 0 : 1;
  log(`ASSERT ${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openAs(token, url) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(600);
  return page;
}

const admin = await login('admin');
const cus = await login('tiepvv');
const dispatcher = await login('dieuvan');

try {
  // ── 1. CUS: stale IN_TRANSIT lot 779166 — Xóa lô ARMED on the detail page ──
  const p1 = await openAs(cus, `${BASE}/shipments/779166`);
  const armed = await p1.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? '').startsWith('Xóa lô'));
    return btn ? { disabled: btn.disabled, aria: btn.getAttribute('aria-label') } : null;
  });
  check('CUS detail: Xóa lô armed trên lô IN_TRANSIT chưa phát lệnh (779166)', armed != null && armed.disabled === false,
    `button=${JSON.stringify(armed)}`);
  await p1.screenshot({ path: `${DIR}/688-01-cus-detail-armed-1440.png` });
  log(`shot ${DIR}/688-01-cus-detail-armed-1440.png`);

  // ── 2. CUS deletes it for real: confirm + mandatory reason + toast ────────
  const delBtn = await p1.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? '').startsWith('Xóa lô')));
  await delBtn.asElement().click();
  await sleep(400);
  const modalOpen = await p1.evaluate(() => document.body.innerText.includes('Xóa lô hàng?'));
  check('CUS detail: confirm modal mở', modalOpen === true);
  await p1.type('#shipment-delete-lot-reason', 'SIL-688 r4 QA: xóa lô IN_TRANSIT chưa phát lệnh qua UI (CUS)');
  const confirmDisabledBefore = await p1.evaluate(() => document.querySelector('.modal .btn--danger, [class*="modal"] .btn--danger')?.disabled ?? null);
  await sleep(200);
  const confirmDisabledAfter = await p1.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    return btns.find((b) => b.className.includes('btn--danger') && b.textContent.includes('Xóa lô hàng'))?.disabled ?? null;
  });
  check('confirm reason bắt buộc (nút enable sau khi nhập lý do)', confirmDisabledAfter === false, `after=${confirmDisabledAfter}`);
  await p1.screenshot({ path: `${DIR}/688-02-cus-confirm-modal-1440.png` });
  await p1.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    btns.find((b) => b.className.includes('btn--danger') && b.textContent.includes('Xóa lô hàng')).click();
  });
  await sleep(1200);
  const toast = await p1.evaluate(() => document.body.innerText);
  check('toast "Đã xóa lô hàng." hiện', /Đã xóa lô hàng/.test(toast));
  await p1.screenshot({ path: `${DIR}/688-03-cus-deleted-toast-1440.png` });
  const after = await apiGet(cus, '/shipments/779166');
  check('GET sau xóa → 404', after.status === 404, `status=${after.status}`);
  await p1.close();

  // ── 3. CUS: list drawer carries the delete affordance ─────────────────────
  const p3 = await openAs(cus, `${BASE}/shipments`);
  await sleep(800);
  const drawer = await p3.evaluate(() => {
    const detailBtn = [...document.querySelectorAll('button, a')].find((b) => (b.textContent ?? '').trim() === 'Chi tiết');
    return { hasDetailBtn: detailBtn != null };
  });
  check('danh sách /shipments: hàng có nút Chi tiết (mở drawer)', drawer.hasDetailBtn === true);
  if (drawer.hasDetailBtn) {
    await p3.evaluate(() => {
      const detailBtn = [...document.querySelectorAll('button, a')].find((b) => (b.textContent ?? '').trim() === 'Chi tiết');
      detailBtn.click();
    });
    await sleep(900);
    const drawerDelete = await p3.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? '') === 'Xóa lô');
      return btn ? { disabled: btn.disabled, aria: btn.getAttribute('aria-label') } : null;
    });
    check('drawer danh sách: nút Xóa lô có cho CUS', drawerDelete != null, JSON.stringify(drawerDelete));
    await p3.screenshot({ path: `${DIR}/688-04-cus-list-drawer-delete-1440.png` });
  }
  await p3.close();

  // ── 4. CUS: settlement board "…" menu carries Xóa lô ──────────────────────
  const p4 = await openAs(cus, `${BASE}/shipments-debit`);
  await sleep(1200);
  const menuBtn = await p4.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? '').startsWith('Hành động lô')));
  const menuEl = menuBtn.asElement();
  if (menuEl) {
    await menuEl.click();
    await sleep(400);
    const menuHasDelete = await p4.evaluate(() => {
      const items = [...document.querySelectorAll('[role="menuitem"]')];
      return items.some((i) => (i.textContent ?? '').includes('Xóa lô'));
    });
    check('quyết toán /shipments-debit: menu "…" có mục Xóa lô cho CUS', menuHasDelete === true);
    await p4.screenshot({ path: `${DIR}/688-05-cus-debit-menu-delete-1440.png` });
  } else {
    check('quyết toán: tìm được menu hành động của một lô', false, 'không có row nào');
  }
  await p4.close();

  // ── 5. Dispatcher: NO delete affordance on any detail ─────────────────────
  const p5 = await openAs(dispatcher, `${BASE}/shipments/779170`);
  const dispHasDelete = await p5.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? '').startsWith('Xóa lô'));
    return btn != null;
  });
  check('Điều vận (dieuvan): KHÔNG có nút Xóa lô trên chi tiết lô', dispHasDelete === false);
  await p5.screenshot({ path: `${DIR}/688-06-dispatcher-no-delete-1440.png` });
  const dispApi = await apiGet(dispatcher, '/shipments/779170');
  const del403 = await fetch(`${API}/shipments/cus-workspace/779170`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${dispatcher}`, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ version: 1, reason: 'SIL-688 r4 QA: dieu van 403' }),
  });
  check('Điều vận: API DELETE → 403', del403.status === 403 && dispApi.status === 200, `delete=${del403.status}`);
  await p5.close();

  // ── 6. Admin: issued lot (779171) — button DISABLED with the law reason ───
  const p6 = await openAs(admin, `${BASE}/shipments/779171`);
  const issued = await p6.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? '').startsWith('Xóa lô'));
    return btn ? { disabled: btn.disabled, aria: btn.getAttribute('aria-label') } : null;
  });
  check('Admin trên lô đã phát lệnh (779171): Xóa lô disabled + lý do luật', issued != null && issued.disabled === true && /Chỉ xóa được khi mọi container chưa phát lệnh/.test(issued.aria ?? ''),
    JSON.stringify(issued));
  await p6.screenshot({ path: `${DIR}/688-07-admin-issued-disabled-1440.png` });
  await p6.close();
} catch (err) {
  failures += 1;
  log(`DRIVE ERROR: ${err.message}`);
} finally {
  await browser.close();
}

log(`== SIL-688 UI drive: ${failures === 0 ? 'ALL PASS' : `${failures} FAILURES`} ==`);
process.exitCode = failures === 0 ? 0 : 1;
