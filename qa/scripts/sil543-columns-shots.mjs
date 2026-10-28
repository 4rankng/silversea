// SIL-543 (id 609) — /shipments-detail column-share rebalance, UI gate driver.
// Captures the changed workboard at 1440 / 1280 / 390 and asserts the four
// re-balanced columns against the measured floors (DOM assertions double as
// the post-verification text evidence required by the UI contract).
// Auth: token injected into localStorage BEFORE the SPA boots (no real
// mutation — read-only page drive).
import puppeteer from 'puppeteer-core';
import { mkdirSync, appendFileSync } from 'node:fs';

const FE = 'http://localhost:7181';
const OUT = 'qa';
const log = (line) => {
  console.log(line);
  appendFileSync(`${OUT}/2026-10-28_sil543-cols_ui-driver.log`, `${line}\n`);
};

mkdirSync(OUT, { recursive: true });

const login = async (page) => {
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle2' });
  const res = await page.evaluate(async () => {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
    });
    const data = await r.json();
    if (!data.token) throw new Error(`login failed: ${r.status}`);
    localStorage.setItem('token', data.token);
    return data.user.role;
  });
  log(`auth ok role=${res}`);
  // Boot the SPA WITH the token in place.
  await page.goto(`${FE}/shipments-detail`, { waitUntil: 'networkidle2' });
};

const assertions = (page) => page.evaluate(() => {
  const table = document.querySelector('.shipment-container-ledger table');
  if (!table) return { error: 'table not rendered' };
  const heads = [...table.querySelectorAll('thead th')];
  const w = (label) => {
    const i = heads.findIndex((th) => th.textContent.trim() === label);
    const cell = table.querySelector(`tbody tr > *:nth-child(${i + 1})`);
    return cell ? Math.round(cell.getBoundingClientRect().width) : null;
  };
  const headerOverflow = heads.some((th) => {
    const el = th.querySelector('.table-sort-button') || th;
    return el.scrollWidth > el.clientWidth + 1;
  });
  const iShip = heads.findIndex((th) => th.textContent.trim() === 'Hãng tàu');
  const shipLines = [];
  for (const tr of table.querySelectorAll('tbody tr')) {
    const span = tr.children[iShip]?.querySelector('.shipment-container-ledger__multiline > span:not(.shipment-container-ledger__edit-purpose)');
    if (span && /R42CUS/.test(span.textContent)) {
      const r = document.createRange();
      r.selectNodeContents(span);
      shipLines.push([...r.getClientRects()].filter((x) => x.width > 2).length);
    }
  }
  return {
    viewport: window.innerWidth,
    tableW: Math.round(table.getBoundingClientRect().width),
    customer: w('Khách hàng & lộ trình'),
    direction: w('Nhập/Xuất'),
    shippingline: w('Hãng tàu'),
    vehicle: w('Phân xe'),
    headerOverflow,
    r42cusLineRects: shipLines.slice(0, 2),
  };
});

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
});

try {
  const page = await browser.newPage();
  const failures = [];
  page.on('pageerror', (e) => failures.push(`pageerror: ${e.message}`));

  for (const [w, h, name, floors] of [
    [1440, 900, '1440', { customer: 130, direction: 85, shippingline: 113, vehicle: 94 }],
    [1280, 800, '1280', { customer: 130, direction: 85, shippingline: 113, vehicle: 94 }],
    [390, 844, '390', null],
  ]) {
    await page.setViewport({ width: w, height: h });
    await login(page);
    await page.waitForSelector('.shipment-container-ledger tbody tr', { timeout: 20000 });
    const path = `${OUT}/2026-10-28_sil543-cols_ui-${name}.png`;
    await page.screenshot({ path, fullPage: false });
    log(`shot ${path}`);
    const m = await assertions(page);
    log(`metrics ${name}: ${JSON.stringify(m)}`);
    if (floors) {
      for (const [col, min] of Object.entries(floors)) {
        if (m[col] == null || m[col] < min) failures.push(`${name}: ${col}=${m[col]} < floor ${min}`);
      }
      if (m.headerOverflow) failures.push(`${name}: a header token overflows its th`);
      if (m.r42cusLineRects.some((n) => n !== 1)) failures.push(`${name}: R42CUS-LINE breaks across ${JSON.stringify(m.r42cusLineRects)} lines`);
    }
    // 390 is the phone card layout: the table ladder does not apply there;
    // reaching the tbody wait above proves the cards rendered.
  }
  // 390 card sanity is checked by selector presence above; a missing tbody fails the wait.
  if (failures.length) {
    failures.forEach((f) => log(`FAIL ${f}`));
    process.exitCode = 1;
  } else {
    log('ALL ASSERTIONS PASS');
  }
} finally {
  await browser.close();
}
