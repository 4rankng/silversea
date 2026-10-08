// Card 051026230645 — rung 3 LOCAL: biên bản multi-upload stays visible.
// Local dev only (dvthuc), fixture trip 35381 / fulfillment 23699. No staging.
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const EV = '/Volumes/LexarSSD/projects/silversea-prod/testplan/qa/evidence/2026-10-06_card051026230645-driver-note-multi';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };

const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'dvthuc', password: 'Abc123' }) });
if (!r.ok) throw new Error(`login failed ${r.status}`);
const session = await r.json();
const token = session.token ?? session.accessToken;
log('login', { ok: Boolean(token), role: session.user?.role ?? session.role });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
await page.goto(`${BASE}/my-trips/35381`, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((res) => setTimeout(res, 4000));
log('nav', { url: page.url() });

const count = () => page.evaluate(() => ({
  figures: [...document.querySelectorAll('img[alt="Ảnh biên bản giao hàng"]')].length,
  deletes: [...document.querySelectorAll('button[aria-label^="Xóa ảnh biên bản"]')].map((b) => b.getAttribute('aria-label')),
  views: [...document.querySelectorAll('button[aria-label^="Xem ảnh biên bản"]')].map((b) => b.getAttribute('aria-label')),
}));

const before = await count();
log('before-upload', before);
if (before.figures < 2) throw new Error(`expected >=2 seeded biên bản photos, saw ${before.figures}`);

const input = await page.$('input[aria-label="Chọn ảnh biên bản"]');
if (!input) throw new Error('hidden biên bản input not found');
await input.uploadFile('/tmp/kb373-pod-ha-bai.jpg');
log('uploaded-via-real-input', { file: 'kb373-pod-ha-bai.jpg' });

let after = null;
for (let i = 0; i < 20; i += 1) {
  await new Promise((res) => setTimeout(res, 1000));
  after = await count();
  if (after.figures > before.figures) break;
}
log('after-upload', after);
if (!after || after.figures !== before.figures + 1) throw new Error(`upload did not append: ${before.figures} -> ${after && after.figures}`);
if (after.deletes.length !== after.figures) throw new Error('per-photo delete buttons missing');
if (!(after.deletes.includes('Xóa ảnh biên bản 1') && after.deletes.includes(`Xóa ảnh biên bản ${after.figures}`))) throw new Error(`indexed delete labels missing: ${after.deletes}`);

fs.mkdirSync(EV, { recursive: true });
await page.screenshot({ path: `${EV}/after-third-upload.png`, fullPage: true });
log('screenshot', { path: 'after-third-upload.png' });
fs.writeFileSync(`${EV}/driver-log.json`, JSON.stringify(LOG, null, 2));
console.log('RUNG3 PASS');
await browser.close();
