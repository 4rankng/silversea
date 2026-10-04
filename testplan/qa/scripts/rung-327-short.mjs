// Rung 327 (short-list state): filter to ONE lot at mobile width — the reported defect state — bottom-strip proof.
// mutates: none (search filter only)
import { launch, shot } from './lead-qa-lib.mjs';

const base = process.env.QA_BASE || 'http://localhost:7175';
const E = process.env.EVID_DIR;
const { browser, page } = await launch({ width: 390, height: 844 });
const res = await fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identifier: 'thanhdc', password: 'Abc123' }),
});
const { token } = await res.json();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
await page.goto(`${base}/shipments`, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((r) => setTimeout(r, 3500));

const search = await page.$('input[aria-label="Tìm lô hàng"]');
if (search) { await search.click(); await page.keyboard.type('SHP-2610-010', { delay: 35 }); }
else { console.log('WARN: search input not found'); }
await new Promise((r) => setTimeout(r, 2500));

const state = await page.evaluate(() => ({
  text: document.body.innerText.slice(60, 420).replace(/\n/g, ' | '),
  scrollH: (document.querySelector('main.app-body') || document.body).scrollHeight,
  innerH: window.innerHeight,
}));
console.log('SHORT_STATE', JSON.stringify(state));
await shot(page, `${E}/shipments-390x844-shortlist.png`, { full: true });
console.log('SHOT done');
await browser.close();
