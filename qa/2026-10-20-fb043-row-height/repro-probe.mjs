import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const OUT = path.resolve('qa/2026-10-20-fb043-row-height');
const PASSWORD = 'Abc123';

async function login(identifier) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: PASSWORD }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`login ${identifier}: ${res.status}`);
  return body.token;
}

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

try {
  const token = await login('admin');
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 3000));

  // Inspect the rows
  const rowInfo = await page.evaluate(() => {
    const trs = [...document.querySelectorAll('tbody tr')].filter((r) => r.offsetParent);
    return trs.map((r, i) => {
      const rect = r.getBoundingClientRect();
      const scheduleTd = r.querySelector('td[data-label="Lịch trình & điều xe"]');
      const scheduleText = scheduleTd ? scheduleTd.innerText.replace(/\n+/g, ' | ') : '';
      const identityTh = r.querySelector('th[data-label="Khách hàng & nhà máy"]');
      const identityText = identityTh ? identityTh.innerText.replace(/\n+/g, ' | ') : '';
      return {
        index: i,
        height: Math.round(rect.height * 10) / 10,
        identityText,
        scheduleText,
      };
    });
  });

  console.log(`Total rows measured: ${rowInfo.length}`);
  console.log(JSON.stringify(rowInfo, null, 2));

  // Screenshot full table
  await page.screenshot({ path: path.join(OUT, 'before_full_table.png'), fullPage: false });

  // If there are uneven rows, find two contrasting rows and screenshot them
  const heights = rowInfo.map((r) => r.height);
  const minH = Math.min(...heights);
  const maxH = Math.max(...heights);
  console.log(`Min height: ${minH}, Max height: ${maxH}, Difference: ${maxH - minH}`);

  // Screenshot the specific section containing uneven rows
  const unevenRows = await page.evaluate(() => {
    const trs = [...document.querySelectorAll('tbody tr')].filter((r) => r.offsetParent);
    for (let i = 0; i < trs.length - 1; i++) {
      const h1 = Math.round(trs[i].getBoundingClientRect().height * 10) / 10;
      const h2 = Math.round(trs[i + 1].getBoundingClientRect().height * 10) / 10;
      if (Math.abs(h1 - h2) >= 5) {
        return { index1: i, h1, index2: i + 1, h2 };
      }
    }
    return null;
  });

  console.log('Adjacent uneven rows found:', unevenRows);

  await page.screenshot({
    path: path.join(OUT, 'before_uneven_rows.png'),
    clip: { x: 0, y: 150, width: 1440, height: 700 },
  });

  fs.writeFileSync(path.join(OUT, 'before_measurements.json'), JSON.stringify({ rowInfo, minH, maxH, unevenRows }, null, 2));
} finally {
  await browser.close();
}
