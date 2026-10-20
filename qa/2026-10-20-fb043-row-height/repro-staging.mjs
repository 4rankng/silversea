import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
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
  await new Promise((r) => setTimeout(r, 4000));

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
        top: Math.round(rect.top),
      };
    });
  });

  console.log(`Total rows measured: ${rowInfo.length}`);
  console.log(JSON.stringify(rowInfo, null, 2));

  // Screenshot full table
  await page.screenshot({ path: path.join(OUT, 'before_full_table.png'), fullPage: false });

  // Specifically capture rows 11 to 16 where regular rows (~75px) meet status rows (~90px)
  const rowElements = await page.$$('tbody tr');
  if (rowElements.length >= 17) {
    // Scroll to rows 11-16
    await page.evaluate(() => {
      const trs = document.querySelectorAll('tbody tr');
      trs[11]?.scrollIntoView({ block: 'center' });
    });
    await new Promise((r) => setTimeout(r, 1000));

    await page.screenshot({
      path: path.join(OUT, 'before_uneven_rows_11_16.png'),
    });
  }

  // Also take an element screenshot of row 11 (normal ~75px) and row 12/14 (status ~90px)
  if (rowElements[11] && rowElements[12]) {
    await rowElements[11].screenshot({ path: path.join(OUT, 'before_row11_normal_75px.png') });
    await rowElements[12].screenshot({ path: path.join(OUT, 'before_row12_status_90px.png') });
  }

  fs.writeFileSync(path.join(OUT, 'before_staging_measurements.json'), JSON.stringify(rowInfo, null, 2));
} finally {
  await browser.close();
}
