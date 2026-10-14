// Sweep widths for /dispatch + /dispatch-detail; report per-row pair unevenness
// in card bands and cell-height equality in table bands.
import puppeteer from 'puppeteer-core';

const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002/api';

const login = async () => {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'dieuvan', password: 'Abc123' }),
  });
  if (!res.ok) throw new Error(`login failed ${res.status}`);
  return (await res.json()).token;
};

const widths = [1440, 1280, 1144, 1024, 960, 900, 860, 820, 768, 700, 660, 640, 600, 540, 390];

const run = async () => {
  const token = await login();
  const browser = await puppeteer.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  for (const w of widths) {
    await page.setViewport({ width: w, height: 900 });
    for (const path of ['/dispatch', '/dispatch-detail']) {
      await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 900));
      const res = await page.evaluate(() => {
        const wrapper = document.querySelector('.master-plan-grid__wrapper, .detailed-plan-grid__wrapper');
        const contW = wrapper ? Math.round(wrapper.getBoundingClientRect().width) : -1;
        const mode = document.querySelector('.master-plan-grid, .detailed-plan-grid')?.className.includes('master') ? 'master' : 'detail';
        const isTable = wrapper ? getComputedStyle(wrapper.querySelector('table')).display !== 'block' : false;
        const rows = [...document.querySelectorAll('table tbody tr')].slice(0, 8);
        const perRow = rows.map((row) => {
          const cells = [...row.querySelectorAll('td')].map((c) => Math.round(c.getBoundingClientRect().height));
          const uniq = [...new Set(cells)];
          return { h: Math.round(row.getBoundingClientRect().height), cells, even: uniq.length === 1 };
        });
        const unevenRows = perRow.filter((r) => !r.even);
        return { contW, mode, isTable, rowCount: rows.length, unevenCount: unevenRows.length, sample: perRow.slice(0, 3) };
      });
      console.log(`${path} @vp${w} (container ${res.contW}, ${res.isTable ? 'TABLE' : 'CARDS'}): rows=${res.rowCount} unevenCellRows=${res.unevenCount}`
        + (res.unevenCount ? ` e.g. h=${res.sample.map((s) => `${s.h}[${s.cells.join(',')}]`).join(' ')}` : ''));
    }
  }
  await browser.close();
};

run().catch((e) => { console.error(e); process.exit(1); });
