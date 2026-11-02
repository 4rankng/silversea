// SIL-650 — capture the CSS chunks staging actually loads on /config/factories,
// then extract the deployed .factories-table geometry rules to compare with HEAD.
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';

const BASE = 'https://vantai.tingting.vip';
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
});
const { token } = await login.json();
if (!token) process.exit(1);

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--no-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
const styles = [];
page.on('response', async (res) => {
  const url = res.url();
  if (url.endsWith('.css') || (url.includes('/assets/') && url.includes('css'))) {
    try { const text = await res.text(); styles.push({ url, text }); } catch {}
  }
});
await page.goto(`${BASE}/config/factories`, { waitUntil: 'networkidle2', timeout: 45000 });
await page.waitForSelector('.factories-table tbody tr', { timeout: 30000 });
await new Promise((r) => setTimeout(r, 1500));
await browser.close();

console.log(`captured ${styles.length} css responses`);
let found = 0;
for (const { url, text } of styles) {
  if (!text.includes('factories-table')) continue;
  found += 1;
  console.log(`\n=== ${url} (${text.length} bytes) ===`);
  const rules = text.match(/[^{}]*factories-table[^{}]*\{[^}]*\}/g) ?? [];
  for (const r of rules.slice(0, 30)) console.log(r.trim());
  writeFileSync('testplan/assets/sil650-staging-deployed-factories.css', text);
}
if (!found) console.log('NO css chunk contains factories-table rules!');
process.exit(0);
