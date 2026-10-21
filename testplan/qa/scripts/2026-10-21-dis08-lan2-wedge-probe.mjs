// DIS-08 lan-2 probe v4 — the wedge: container summary lines in the master
// grid "Tổng quan hàng hóa" (cargo) column render at 400 while the same line
// under Cảng nâng/Cảng hạ renders 600. Same container fact, two weights.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.QA_BASE || 'https://vantai.tingting.vip';
const API = process.env.QA_API || 'https://vantai.tingting.vip/api';
const OUT = path.resolve('qa/2026-10-21-dis08-lan2');

const login = async (identifier, password = 'Abc123') => {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }) });
  if (!res.ok) throw new Error(`login -> ${res.status}`);
  return (await res.json()).token;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const token = await login(process.env.QA_USER || 'dungnv');
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/dispatch`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(2500);

  const wedge = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.master-plan-grid tbody tr')).slice(0, 6);
    return rows.map((row) => {
      const cargoCell = row.querySelector('td[data-label="Tổng quan hàng hóa"], td[data-label="Hàng"]');
      const cargoLines = cargoCell
        ? Array.from(cargoCell.querySelectorAll('.master-plan-grid__line')).map((el) => ({
          text: (el.textContent || '').trim().slice(0, 24),
          cls: el.className.replace('master-plan-grid__line', '').trim(),
          weight: Number(getComputedStyle(el).fontWeight),
        }))
        : [];
      const portSummaries = Array.from(row.querySelectorAll('.master-plan-grid__location-block'))
        .slice(0, 2)
        .flatMap((b) => Array.from(b.children).slice(1).map((el) => ({
          text: (el.textContent || '').trim().slice(0, 24),
          weight: Number(getComputedStyle(el).fontWeight),
        })));
      return { cargoLines, portSummaries };
    });
  });
  console.log(JSON.stringify(wedge, null, 2));
  fs.writeFileSync(path.join(OUT, 'staging-wedge-cargo-column.json'), JSON.stringify(wedge, null, 2));

  const firstRow = await page.$('.master-plan-grid tbody tr');
  if (firstRow) {
    const box = await firstRow.boundingBox();
    if (box) await page.screenshot({ path: path.join(OUT, 'staging-dispatch-row-cargo-column.png'), clip: { x: 0, y: Math.max(0, box.y - 8), width: 1440, height: Math.min(220, box.height + 16) } });
  }
} finally {
  await browser.close();
}
