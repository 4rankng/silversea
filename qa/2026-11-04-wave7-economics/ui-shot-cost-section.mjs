// Close-up evidence capture for the Wave 7 cost breakdown section.
import puppeteer from 'puppeteer';
import path from 'node:path';
const FE = 'http://localhost:7176';
const API = 'http://localhost:3102/api';
const OUT = 'qa/2026-11-04-wave7-economics';

async function login(identifier) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  return (await res.json()).token;
}

const browser = await puppeteer.launch({ headless: true, defaultViewport: { width: 390, height: 844 } });
try {
  const token = await login('laixe');
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${FE}/my-trips/1321`, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1200));
  const el = await page.$('#driver-task-cost-grid');
  if (el) {
    await el.screenshot({ path: path.join(OUT, 'ui-390-cost-section-closeup.png') });
    console.log('closeup saved');
  } else {
    console.log('grid not found');
  }
  await page.evaluate(() => document.querySelector('#driver-task-cost-grid')?.scrollIntoView({ block: 'center' }));
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: path.join(OUT, 'ui-390-legA-cost-breakdown.png') });
  console.log('viewport shot with section centered saved');
  await browser.close();
} catch (err) {
  console.error('drive failed:', err.message);
  process.exit(1);
}
