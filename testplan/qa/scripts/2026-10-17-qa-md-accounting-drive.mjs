// QA wave 17/10 — md-card accounting batch (role hoapt / ACCOUNTANT):
// FB-094 grid columns, FB-099 three zones, FB-096 Thêm cược modal,
// FB-097 expense drawer, FB-100 advances, FB-101/102/103 timesheet, FB-104.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const BASE = process.env.BASE ?? 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const SHOTS = process.env.SHOTS ?? '/tmp/mdacc';
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const record = (r, ok, d) => { const v = ok ? 'PASS' : 'FAIL'; results.push(v); console.log(`[${v}] ${r} — ${String(d).slice(0, 400)}`); };
const login = async (id) => {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: id, password: 'Abc123' }) });
    if (r.ok) return (await r.json()).token;
    await sleep(1200);
  }
  throw new Error('login ' + id);
};
const ktok = await login('hoapt');
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
const go = async (page, path, wait = 3500) => { await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(wait); };
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1540, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), ktok);

  await go(page, '/accounting/chot-debit');
  const debit = await page.evaluate(() => {
    const t = document.body.textContent || '';
    return {
      zones: ['Tổng hợp', 'Chờ xác nhận'].map((z) => ({ z, present: t.includes(z) })),
      h2s: [...document.querySelectorAll('h1,h2,h3')].map((h) => (h.textContent || '').trim()).filter(Boolean).slice(0, 8),
    };
  });
  await page.screenshot({ path: `${SHOTS}/01-chot-debit.png` });
  record('fb099-three-zones', debit.zones.every((z) => z.present), JSON.stringify(debit) + ` · ${SHOTS}/01-chot-debit.png`);
  await page.evaluate(() => document.querySelector('input[aria-label="Tìm nhanh"], input[placeholder*="Tìm"]')?.focus());
  await page.keyboard.type('KBQA-GRP', { delay: 40 });
  await sleep(3000);
  const lclRow = await page.evaluate(() => {
    const tr = [...document.querySelectorAll('tr')].find((r) => /KBQA-GRP-A/.test(r.textContent || ''));
    if (!tr) return null;
    return { text: (tr.textContent || '').slice(0, 340), twoLines: /BKS Thực/.test(tr.textContent || '') && /Báo khách/.test(tr.textContent || '') };
  });
  await page.screenshot({ path: `${SHOTS}/02-chot-debit-lcl-row.png` });
  record('fb094-lcl-columns-on-grid', !!lclRow && /Lẻ/.test(lclRow.text ?? '') && /(Thu|Trả):/.test(lclRow.text ?? ''), JSON.stringify(lclRow) + ` · ${SHOTS}/02-chot-debit-lcl-row.png`);

  await go(page, '/accounting/deposit-tracker');
  const depBtn = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /thêm cược/i.test(x.textContent || ''));
    if (!b) return null;
    b.click();
    return true;
  });
  await sleep(1800);
  const depDlg = await page.evaluate(() => {
    const d = [...document.querySelectorAll('[role="dialog"]')][0];
    return d ? { title: (d.querySelector('h1,h2,h3')?.textContent || '').trim(), labels: [...d.querySelectorAll('label')].map((l) => (l.textContent || '').trim()).slice(0, 8) } : null;
  });
  await page.screenshot({ path: `${SHOTS}/03-them-cuoc-modal.png` });
  record('fb096-them-cuoc-modal', depBtn === true && !!depDlg && /Thêm cược/.test(depDlg.title || ''), JSON.stringify(depDlg) + ` · ${SHOTS}/03-them-cuoc-modal.png`);
  await page.keyboard.press('Escape');
  await sleep(500);

  await go(page, '/accounting/expenses');
  const expBtn = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /thêm khoản chi|thêm phiếu chi/i.test(x.textContent || ''));
    if (!b) return null;
    b.click();
    return (b.textContent || '').trim();
  });
  await sleep(2200);
  const expDrawer = await page.evaluate(() => {
    const d = [...document.querySelectorAll('[role="dialog"]')][0] ?? document.querySelector('[class*="drawer"]');
    if (!d) return null;
    const t = d.textContent || '';
    return {
      groups: ['Tiền đường', 'Chi phí lô hàng'].map((g) => t.includes(g)),
      removed: ['Ghi chú khoản chi', 'Loại chứng từ'].map((g) => ({ g, absent: !t.includes(g) })),
      kept: ['Loại phí', 'Ngày chi', 'Số hóa đơn', 'Ngày hóa đơn'].map((g) => t.includes(g)),
    };
  });
  await page.screenshot({ path: `${SHOTS}/04-expense-drawer.png` });
  record('fb097-expense-drawer-slim', !!expDrawer && expDrawer.groups.every(Boolean) && expDrawer.removed.every((x) => x.absent) && expDrawer.kept.every(Boolean),
    JSON.stringify(expDrawer) + ` · ${SHOTS}/04-expense-drawer.png`);
  await page.keyboard.press('Escape');
  await sleep(600);

  await go(page, '/advances');
  const adv = await page.evaluate(() => {
    const t = document.body.textContent || '';
    return {
      approveBtn: [...document.querySelectorAll('button')].some((b) => /phê duyệt tạm ứng/i.test(b.textContent || '')),
      pendingZone: t.includes('PENDING') || t.includes('Chờ duyệt') || t.includes('Chờ xác nhận'),
      tickXn: t.includes('Xác nhận hoàn ứng'),
    };
  });
  await page.screenshot({ path: `${SHOTS}/05-advances.png` });
  record('fb100-advances-approve-present', adv.approveBtn || adv.pendingZone || adv.tickXn, JSON.stringify(adv) + ` · ${SHOTS}/05-advances.png`);

  await go(page, '/timesheet');
  const ts = await page.evaluate(() => {
    const t = document.body.textContent || '';
    return {
      moBang: [...document.querySelectorAll('button')].some((b) => /mở bảng chấm công/i.test(b.textContent || '')),
      luoi: [...document.querySelectorAll('button')].some((b) => /lưu lưới/i.test(b.textContent || '')),
      nav: t.includes('Chấm công lái xe'),
    };
  });
  await page.screenshot({ path: `${SHOTS}/06-timesheet-ketoan.png` });
  record('fb101-ketoan-sees-timesheet', ts.nav, JSON.stringify(ts) + ` · ${SHOTS}/06-timesheet-ketoan.png`);
  record('fb102-ketoan-has-mo-bang', ts.moBang, JSON.stringify(ts));
  const rec = await page.evaluate(() => {
    const t = document.body.textContent || '';
    return { chedoluong: t.includes('Chế độ lương') || t.includes('Hình thức lương'), perTrip: /theo chuyến|PER_TRIP/i.test(t) };
  });
  record('fb103-salary-mode-surface', rec.chedoluong || rec.perTrip, JSON.stringify(rec));
  await go(page, '/timesheet/bao-cao');
  const rep = await page.evaluate(() => {
    const t = document.body.textContent || '';
    return {
      cols: ['Loại xe', 'Biển kiểm soát', 'Hình thức lương', 'Lái xe'].map((c) => t.includes(c)),
      legend: t.includes('Tổng lệnh') || t.includes('Tỷ lệ'),
    };
  });
  await page.screenshot({ path: `${SHOTS}/07-timesheet-bao-cao.png` });
  record('fb104-bao-cao-page', rep.cols.every(Boolean) && rep.legend, JSON.stringify(rep) + ` · ${SHOTS}/07-timesheet-bao-cao.png`);
} finally { await browser.close(); }
const fails = results.filter((v) => v === 'FAIL').length;
console.log(fails ? `=== ${fails} RUNG FAIL ===` : '=== ALL RUNGS PASS ===');
process.exit(fails ? 1 : 0);
