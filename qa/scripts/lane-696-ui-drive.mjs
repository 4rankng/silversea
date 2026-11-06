// Lane SIL-696 UI drive — the staff trip page must show the trip direct cost
// carrying BOTH approved amounts (lift 175k + toll 135k = 310k).
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const FE = process.env.LANE_FE || 'http://localhost:7180';
const API = process.env.LANE_API || 'http://localhost:3004/api';
const TRIP = Number(process.env.LANE_TRIP || 40);
const OUT = new URL('../2026-11-06-lane-696-697/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const loginRes = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
const { token } = await loginRes.json();
if (!token) throw new Error('admin login failed');

const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 120000,
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument((t) => { localStorage.setItem('token', t); }, token);
  await page.goto(`${FE}/trips/${TRIP}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(3500);

  const facts = await page.evaluate(() => {
    const text = document.body.textContent ?? '';
    const financial = document.querySelector('.pl, [class*="financial"], [class*="kpi"]');
    const totalLabel = text.includes('Tổng chi phí');
    const idx = text.indexOf('Tổng chi phí');
    const snippet = idx >= 0 ? text.slice(idx, idx + 60).replace(/\s+/g, ' ') : null;
    return { totalLabel, snippet, financialText: financial?.textContent?.slice(0, 300) ?? null, heading: document.querySelector('h1,h2')?.textContent ?? null };
  });
  console.log(JSON.stringify(facts, null, 2));
  await page.screenshot({ path: `${OUT}sil-696_ui-trip-cost-310k.png`, fullPage: false });

  const ok = facts.totalLabel && (facts.snippet?.includes('310.000') ?? false);
  writeFileSync(`${OUT}sil-696_ui-driver.json`, JSON.stringify({ facts, ok }, null, 2));
  console.log(ok ? 'SIL-696 UI VERIFIED: trip direct cost shows 310.000₫' : 'SIL-696 UI CHECK FAILED');
  process.exitCode = ok ? 0 : 1;
} finally {
  await browser.close();
}
