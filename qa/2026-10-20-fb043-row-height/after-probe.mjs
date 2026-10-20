import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'http://localhost:7175';
const API = 'https://vantai.tingting.vip/api';
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

const log = [];
function record(step, data) {
  console.log(`[${step}]`, typeof data === 'object' ? JSON.stringify(data) : data);
  log.push({ at: new Date().toISOString(), step, data });
}

try {
  record('login-start', { user: 'admin', url: API });
  const token = await login('admin');
  record('login-success', { tokenPrefix: token.slice(0, 10) });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  record('navigate-shipments', { url: `${BASE}/shipments` });
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

  const heights = rowInfo.map((r) => r.height);
  const min = Math.min(...heights);
  const max = Math.max(...heights);
  const spread = Math.round((max - min) * 10) / 10;
  const unique = [...new Set(heights)];

  record('row-measurements', {
    totalRows: rowInfo.length,
    minHeight: min,
    maxHeight: max,
    spread,
    uniqueHeights: unique,
    isUniform: spread <= 1.5,
  });

  fs.writeFileSync(path.join(OUT, 'after_measurements.json'), JSON.stringify(rowInfo, null, 2));

  // Screenshot full table
  await page.screenshot({ path: path.join(OUT, 'after_full_table.png'), fullPage: false });

  // Specifically capture rows 11 to 16
  const rowElements = await page.$$('tbody tr');
  if (rowElements.length >= 17) {
    await page.evaluate(() => {
      const trs = document.querySelectorAll('tbody tr');
      trs[11]?.scrollIntoView({ block: 'center' });
    });
    await new Promise((r) => setTimeout(r, 1000));

    await page.screenshot({
      path: path.join(OUT, 'after_even_rows_11_16.png'),
    });
  }

  // Element screenshots
  if (rowElements[11] && rowElements[12] && rowElements[14]) {
    await rowElements[11].screenshot({ path: path.join(OUT, 'after_row11_76.6px.png') });
    await rowElements[12].screenshot({ path: path.join(OUT, 'after_row12_76.6px.png') });
    await rowElements[14].screenshot({ path: path.join(OUT, 'after_row14_76.6px.png') });
  }

  record('verdict', {
    status: spread <= 1.5 ? 'PASS' : 'FAIL',
    criterion: 'spread <= 1.5px across all table rows (#33 / FB-043)',
  });
} catch (err) {
  record('error', { message: err.message, stack: err.stack });
  throw err;
} finally {
  fs.writeFileSync(path.join(OUT, 'after-driver.log'), JSON.stringify(log, null, 2));
  await browser.close();
}
