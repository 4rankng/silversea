// FB-066 — /trips/new TripInfoCard quick-add (the original card-121026141040
// surface, adminOnly route). As ADMIN: the OWN branch (Xe đầu kéo / Lái xe)
// must render WITH its "+ Thêm nhanh" buttons; clicking the vehicle one must
// open the "Thêm nhanh biển số xe" dialog.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.QA_BASE || 'http://localhost:7175';
const API = process.env.QA_API || 'http://localhost:3002/api';
const OUT = path.resolve(import.meta.dirname, '../../../qa/2026-10-20-regressions');
fs.mkdirSync(OUT, { recursive: true });
const LOG = [];
const log = (step, obj = {}) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = async (identifier) => {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password: 'Abc123' }) });
  const body = await res.json();
  if (!res.ok) throw new Error(`login: ${res.status}`);
  return body.token;
};

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const token = await login('admin');
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/trips/new`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(4000);
  const state = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.tc-field-quick-add')];
    const heads = [...document.querySelectorAll('.tc-field-head')].map((h) => h.textContent.replace(/\s+/g, ' ').trim());
    return {
      url: location.href,
      noAccess: document.body.innerText.includes('Bạn không có quyền'),
      quickAddCount: btns.length,
      quickAddVisible: btns.filter((b) => b.offsetParent !== null).length,
      fieldHeads: heads,
      truckSelectExists: !!document.querySelector('#truckId'),
    };
  });
  log('trips-new-admin', state);
  await page.screenshot({ path: path.join(OUT, 'fb066-trips-new-admin.png'), fullPage: false });

  if (state.quickAddVisible > 0) {
    const btn = (await page.$$('.tc-field-quick-add'))[0];
    await btn.click();
    await sleep(1000);
    const dialog = await page.evaluate(() => [...document.querySelectorAll('[role=dialog]')].map((d) => d.textContent?.replace(/\s+/g, ' ').trim().slice(0, 80)));
    log('quick-add-dialog', { dialogs: dialog });
    await page.screenshot({ path: path.join(OUT, 'fb066-trips-new-quickadd-dialog.png'), fullPage: false });
  }
  log('run-complete');
} catch (err) {
  log('driver-error', { message: err.message });
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(OUT, 'fb066-trips-new-admin.log'), LOG.map((l) => JSON.stringify(l)).join('\n') + '\n');
  await browser.close();
}
