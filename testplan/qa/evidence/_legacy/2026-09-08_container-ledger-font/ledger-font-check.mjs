// Capture the Chi tiết container ledger for shipment 4 (has both states:
// row with plate rendered as <strong> + row without plate rendered through
// <ShipmentContainerCell> placeholder).

import puppeteer from 'puppeteer';
import fs from 'node:fs/promises';

const FRONTEND = 'http://localhost:7174';
const API = 'http://localhost:3001';

async function login() {
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
  });
  if (!res.ok) throw new Error(`login ${res.status}`);
  const { token } = await res.json();
  return token;
}

const argv = process.argv.slice(2);
const mode = argv[0] === 'after' ? 'after' : 'before';
const outName = argv[1] || (mode === 'after' ? 'after-container-ledger.png' : 'before-container-ledger.png');
const logName = argv[2] || (mode === 'after' ? 'after-ledger-font.log' : 'before-ledger-font.log');

const out = [];
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const consoleLogs = [];
  page.on('console', (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => consoleLogs.push(`[pageerror] ${err.message}`));

  const token = await login();
  await page.evaluateOnNewDocument((t) => {
    localStorage.setItem('token', t);
  }, token);

  await page.goto(`${FRONTEND}/shipments`, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForSelector('table.cus-dashboard-table', { timeout: 15000 });

  // Find shipment 4 row's detail button (the test data has 2 containers on shipment 4)
  const detailTarget = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('table.cus-dashboard-table tbody tr'));
    for (const row of rows) {
      const cid = row.querySelector('[data-shipment-id]')?.getAttribute('data-shipment-id');
      if (cid === '4') {
        const btn = row.querySelector('.cus-dashboard-detail');
        if (btn) {
          const r = btn.getBoundingClientRect();
          return { customerName: row.querySelector('.cus-customer-name')?.textContent?.trim(), x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }
      }
    }
    // fallback: pick any row that contains 2 container summary badges
    for (const row of rows) {
      const summary = row.querySelector('.cus-cargo-summary')?.textContent || '';
      if (/2\s*cont|2x/i.test(summary)) {
        const btn = row.querySelector('.cus-dashboard-detail');
        if (btn) {
          const r = btn.getBoundingClientRect();
          return { customerName: row.querySelector('.cus-customer-name')?.textContent?.trim(), x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }
      }
    }
    return null;
  });

  if (!detailTarget) {
    out.push('No detail button found');
  } else {
    await page.mouse.click(detailTarget.x, detailTarget.y);
    await page.waitForSelector('.cus-container-table', { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 800));

    const tableRect = await page.evaluate(() => {
      const t = document.querySelector('.cus-container-table');
      if (!t) return null;
      const r = t.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });

    if (tableRect) {
      await page.screenshot({
        path: `/tmp/opencode/qa/${outName}`,
        clip: {
          x: Math.max(0, tableRect.x - 8),
          y: Math.max(0, tableRect.y - 60),
          width: Math.min(1440, tableRect.width + 16),
          height: Math.min(900, tableRect.height + 80),
        },
      });
      out.push(`Saved ledger screenshot -> /tmp/opencode/qa/${outName}`);
    }

    const inspection = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.cus-container-table tbody tr'));
      return rows.map((row) => {
        const ordinal = row.querySelector('.cus-container-row__ordinal')?.textContent?.trim() || null;
        const plateCell = row.querySelector('td[data-label="Biển số"]');
        const cellWithStrong = plateCell?.querySelector('strong');
        const displaySpan = plateCell?.querySelector('.csc-container-cell__display');
        const tdStyle = plateCell ? getComputedStyle(plateCell) : null;
        const strongStyle = cellWithStrong ? getComputedStyle(cellWithStrong) : null;
        const displayStyle = displaySpan ? getComputedStyle(displaySpan) : null;
        const input = plateCell?.querySelector('input');
        const inputStyle = input ? getComputedStyle(input) : null;
        return {
          ordinal,
          plateText: displaySpan?.textContent?.trim() || cellWithStrong?.textContent?.trim() || null,
          tdFontSize: tdStyle?.fontSize,
          tdFontWeight: tdStyle?.fontWeight,
          strongFontSize: strongStyle?.fontSize || null,
          strongFontWeight: strongStyle?.fontWeight || null,
          displayFontSize: displayStyle?.fontSize || null,
          displayFontWeight: displayStyle?.fontWeight || null,
          displayColor: displayStyle?.color || null,
          inputFontSize: inputStyle?.fontSize || null,
        };
      });
    });
    out.push('=== BIỂN SỐ font comparison ===');
    out.push(JSON.stringify(inspection, null, 2));

    // Verdict
    const ok = inspection.every((row) => {
      const a = row.strongFontSize || row.displayFontSize;
      const b = row.displayFontSize || row.strongFontSize;
      return a === b && row.tdFontSize === a;
    });
    out.push(`\nVERDICT: ${ok ? 'PASS — same font-size across rows' : 'FAIL — font-size differs between rows'}`);
  }

  out.push('\n=== console ===');
  out.push(consoleLogs.join('\n'));
} catch (err) {
  out.push('SCRIPT ERROR: ' + err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}

const finalOut = out.join('\n');
console.log(finalOut);
await fs.writeFile(`/tmp/opencode/qa/${logName}`, finalOut);