// FB-097 — the slim expense-create drawer (ketoan).
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const BASE = process.env.BASE ?? 'https://vantai.tingting.vip';
const SHOTS = process.env.SHOTS ?? '/tmp/fb097';
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'hoapt', password: 'Abc123' }) });
const { token } = await r.json();
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1540, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/accounting/expenses`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(4000);
  // find ANY create-affordance mentioning khoản chi / phiếu chi anywhere
  let clicked = null;
  for (const pattern of [/thêm khoản chi/i, /thêm phiếu chi/i, /thêm chi phí/i]) {
    clicked = await page.evaluate((src) => {
      const re = new RegExp(src, 'i');
      const b = [...document.querySelectorAll('button')].find((x) => re.test(x.textContent || ''));
      if (!b) return null;
      b.scrollIntoView({ block: 'center' });
      b.click();
      return (b.textContent || '').trim();
    }, pattern.source);
    if (clicked) break;
    await sleep(600);
  }
  console.log('clicked:', JSON.stringify(clicked));
  await sleep(2500);
  const drawer = await page.evaluate(() => {
    const d = [...document.querySelectorAll('[role="dialog"]')][0] ?? document.querySelector('[class*="drawer" i]');
    if (!d) return null;
    const t = d.textContent || '';
    return {
      groups: ['Tiền đường', 'Chi phí lô hàng'].map((g) => ({ g, present: t.includes(g) })),
      removed: ['Ghi chú khoản chi', 'Loại chứng từ'].map((g) => ({ g, absent: !t.includes(g) })),
      kept: ['Loại phí', 'Ngày chi'].map((g) => ({ g, present: t.includes(g) })),
      hoaDon: /hóa đơn/i.test(t),
      text: t.slice(0, 220),
    };
  });
  await page.screenshot({ path: `${SHOTS}/01-drawer.png` });
  const ok = !!drawer && drawer.groups.every((g) => g.present) && drawer.removed.every((g) => g.absent) && drawer.kept.every((g) => g.present);
  console.log(JSON.stringify({ ok, drawer }, null, 1));
  process.exit(ok ? 0 : 1);
} finally { await browser.close(); }
