// QA wave 17/10 — cluster B: QA1-002 OPS expense-dialog write-scope gate,
// FB-033 search entries per role, QA1-004 duplicate API requests.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const BASE = process.env.BASE ?? 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const SHOTS = process.env.SHOTS ?? '/tmp/qamiscb';
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const record = (r, ok, d) => { const v = ok ? 'PASS' : 'FAIL'; results.push(v); console.log(`[${v}] ${r} — ${d}`); };
const login = async (id) => {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: id, password: 'Abc123' }) });
    if (r.ok) return (await r.json()).token;
    await sleep(500);
  }
  throw new Error(`login ${id} failed`);
};
const api = async (token, path) => (await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } })).json();
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
try {
  // ── QA1-002: OPS expense dialog answers the grant before input ──
  const ops = await login('hoangnh');
  const orders = await api(ops, '/ops/orders?limit=20');
  const rows = orders.items ?? orders.data ?? orders ?? [];
  const first = Array.isArray(rows) ? rows.find((o) => o.shipmentId ?? o.id) : null;
  let blocked = null;
  for (const o of (Array.isArray(rows) ? rows.slice(0, 12) : [])) {
    const sid = o.shipmentId ?? o.id;
    try {
      const ws = await api(ops, `/ops/expenses/write-scope?shipmentId=${sid}`);
      if (ws && ws.writable === false) { blocked = { sid, reason: ws.reason }; break; }
      if (ws && ws.writable === true) { blocked = blocked ?? null; }
    } catch { /* endpoint per-order; skip */ }
  }
  record('qa1-002-scope-probe-found', !!blocked, `blocked row: ${JSON.stringify(blocked)} (rows scanned: ${Array.isArray(rows) ? rows.length : 0})`);
  if (blocked) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000 });
    await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), ops);
    await page.goto(`${BASE}/ops/orders`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(3000);
    // find the row and open its Khai chi phí dialog
    const opened = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')].filter((b) => /khai chi phí/i.test(b.textContent || '') && !b.disabled);
      if (!btns.length) return false;
      btns[0].click();
      return true;
    });
    await sleep(1500);
    const dlg = await page.evaluate(() => {
      const root = document.querySelector('[role="dialog"]') ?? document.body;
      const alert = root.querySelector('[role="alert"]');
      const fieldset = root.querySelector('fieldset');
      const save = [...root.querySelectorAll('button')].find((b) => /^lưu/i.test((b.textContent || '').trim()));
      return {
        dialogOpen: !!document.querySelector('[role="dialog"]'),
        alertText: alert ? alert.textContent.trim() : null,
        fieldsetDisabled: fieldset ? fieldset.disabled : null,
        saveDisabled: save ? save.disabled : null,
      };
    });
    await page.screenshot({ path: `${SHOTS}/01-ops-dialog-scope-blocked.png` });
    record('qa1-002-dialog-gates-before-input',
      dlg.dialogOpen && !!dlg.alertText && dlg.fieldsetDisabled === true && dlg.saveDisabled === true,
      JSON.stringify(dlg) + ` · ${SHOTS}/01-ops-dialog-scope-blocked.png`);
    await page.close();
  }

  // ── FB-033: search entries per role ──
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), ops);
  await page.goto(`${BASE}/shipments`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2500);
  await page.evaluate(() => document.querySelector('.topbar__search input')?.focus());
  await page.keyboard.type('ghi nhận chi phí', { delay: 50 });
  await sleep(1200);
  const opsSearch = await page.evaluate(() => {
    const results = document.querySelector('[role="listbox"], [role="menu"], .topbar-search-results, [data-search-results]');
    const text = results ? results.textContent : document.body.textContent;
    return { hasHit: /ghi nhận chi phí|Kế hoạch làm hàng/i.test(text ?? ''), snippet: (text ?? '').slice(0, 200) };
  });
  await page.screenshot({ path: `${SHOTS}/02-ops-search-entry.png` });
  record('fb033-ops-search-entry', opsSearch.hasHit, JSON.stringify(opsSearch).slice(0, 300) + ` · ${SHOTS}/02-ops-search-entry.png`);
  // pick the entry if present and land on /my-orders
  const picked = await page.evaluate(() => {
    const opt = [...document.querySelectorAll('[role="option"], [role="menuitem"], li, a')].find((el) => /ghi nhận chi phí/i.test(el.textContent || ''));
    if (!opt) return false;
    opt.click();
    return true;
  });
  await sleep(1800);
  const landed = await page.evaluate(() => ({ url: location.pathname, heading: document.querySelector('h1,h2')?.textContent?.trim() ?? '' }));
  record('fb033-ops-entry-lands-my-orders', picked && /my-orders/.test(landed.url), `picked=${picked} → ${JSON.stringify(landed)}`);

  // dispatcher: no expense entry by ruling (owner refused to open DISPATCHER)
  const disp = await login('dungnv');
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), disp);
  await page.goto(`${BASE}/dispatch`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2500);
  await page.evaluate(() => document.querySelector('.topbar__search input')?.focus());
  await page.keyboard.type('chi phí', { delay: 50 });
  await sleep(1200);
  const dispSearch = await page.evaluate(() => {
    const box = document.querySelector('[role="listbox"], [role="menu"], [data-search-results]');
    const text = (box ? box.textContent : '') || '';
    return { noResults: /không có kết quả/i.test(text) || (box && text.trim().length === 0), snippet: text.slice(0, 120) };
  });
  await page.screenshot({ path: `${SHOTS}/03-dispatcher-search-no-entry.png` });
  record('fb033-dispatcher-no-entry-by-ruling', dispSearch.noResults, JSON.stringify(dispSearch) + ` · ${SHOTS}/03-dispatcher-search-no-entry.png`);

  // ── QA1-004: production build request duplication ──
  const drv = await login('dvthuc');
  const page2 = await browser.newPage();
  const reqs = [];
  page2.on('request', (req) => { if (req.url().includes('/api/')) reqs.push(new URL(req.url()).pathname); });
  await page2.evaluateOnNewDocument((t) => localStorage.setItem('token', t), drv);
  await page2.setViewport({ width: 1440, height: 1000 });
  await page2.goto(`${BASE}/my-trips`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(9000);
  const counts = {};
  for (const p of reqs) counts[p] = (counts[p] ?? 0) + 1;
  const dups = Object.entries(counts).filter(([, n]) => n > 1);
  await page2.screenshot({ path: `${SHOTS}/04-my-trips-loaded.png` });
  record('qa1-004-no-duplicate-api', dups.length === 0, `total=${reqs.length} dups=${JSON.stringify(dups)} · ${SHOTS}/04-my-trips-loaded.png`);
  await page2.close();
  await page.close();
} finally { await browser.close(); }
const fails = results.filter((v) => v === 'FAIL').length;
console.log(fails ? `=== ${fails} RUNG FAIL ===` : '=== ALL RUNGS PASS ===');
process.exit(fails ? 1 : 0);
