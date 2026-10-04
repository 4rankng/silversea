// Input diagnostic 2: pre-auth token injection (no login document), then real tap on /dispatch.
import { launch, probe } from './lead-qa-lib.mjs';

const base = process.env.QA_BASE || 'http://localhost:7175';
const { browser, page } = await launch({ width: 1440, height: 900 });

const res = await fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identifier: 'dungnv', password: 'Abc123' }),
});
const body = await res.json();
const token = body.token || body.accessToken || body.data?.token || body.data?.accessToken;
console.log('LOGIN', res.status, 'token?', !!token, 'keys:', Object.keys(body).join(','));

await page.evaluateOnNewDocument((t) => { if (t) localStorage.setItem('token', t); }, token);
await page.goto(`${base}/dispatch`, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((r) => setTimeout(r, 3000));
const url = await page.evaluate(() => location.pathname);
console.log('URL', url);

const el = await page.$('.master-plan-grid tbody tr:nth-child(2) .master-plan-grid__allocation-trigger');
if (!el) { console.log('NO TRIGGER — page state:', await page.evaluate(() => document.body.innerText.slice(0, 120))); await browser.close(); process.exit(0); }
const box = await el.boundingBox();
const cx = Math.round(box.x + box.width / 2), cy = Math.round(box.y + box.height / 2);
await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.up();
await new Promise((r) => setTimeout(r, 1200));
const after = await probe(page);
const dialog = await page.evaluate(() => ({
  pop: !!document.querySelector('.dispatch-allocation-popover'),
  modal: !!document.querySelector('[role=dialog]'),
  text: (document.querySelector('.dispatch-allocation-popover,[role=dialog]') || {}).innerText?.slice(0, 200),
}));
console.log('TAP', JSON.stringify({ cx, cy, after, dialog }));
await browser.close();
