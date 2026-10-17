// FB-098 (Khai chi phí button on lot detail) + FB-097 (slim create drawer).
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const BASE = process.env.BASE ?? 'https://vantai.tingting.vip';
const SHOTS = process.env.SHOTS ?? '/tmp/fb09798';
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const record = (r, ok, d) => { const v = ok ? 'PASS' : 'FAIL'; results.push(v); console.log(`[${v}] ${r} — ${String(d).slice(0, 420)}`); };
const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'hoapt', password: 'Abc123' }) });
const { token } = await r.json();
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1540, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/shipments/875`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(4500);
  const btn = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /^khai chi phí/i.test((x.textContent || '').trim()));
    if (!b) return null;
    const rect = b.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, text: (b.textContent || '').trim() };
  });
  await page.screenshot({ path: `${SHOTS}/01-khai-chi-phi-button.png` });
  record('fb098-khai-chi-phi-button', !!btn, JSON.stringify(btn) + ` · ${SHOTS}/01-khai-chi-phi-button.png`);
  if (btn) {
    await page.mouse.click(btn.x, btn.y);
    await sleep(2500);
  }
  const drawer = await page.evaluate(() => {
    const d = [...document.querySelectorAll('[role="dialog"]')][0] ?? document.querySelector('[class*="drawer" i]');
    if (!d) return null;
    const t = d.textContent || '';
    return {
      groups: ['Tiền đường', 'Chi phí lô hàng'].map((g) => ({ g, present: t.includes(g) })),
      removed: ['Ghi chú khoản chi', 'Loại chứng từ'].map((g) => ({ g, absent: !t.includes(g) })),
      kept: ['Loại phí', 'Ngày chi'].map((g) => ({ g, present: t.includes(g) })),
      hoaDon: /hóa đơn/i.test(t),
      text: t.slice(0, 200),
    };
  });
  await page.screenshot({ path: `${SHOTS}/02-drawer.png` });
  record('fb097-drawer-slim', !!drawer && drawer.groups.every((g) => g.present) && drawer.removed.every((g) => g.absent) && drawer.kept.every((g) => g.present) && drawer.hoaDon,
    JSON.stringify(drawer) + ` · ${SHOTS}/02-drawer.png`);
} finally { await browser.close(); }
const fails = results.filter((v) => v === 'FAIL').length;
console.log(fails ? `=== ${fails} RUNG FAIL ===` : '=== ALL RUNGS PASS ===');
process.exit(fails ? 1 : 0);
