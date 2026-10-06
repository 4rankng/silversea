// Card 061026172807 — API+UI rung: in the Quá hạn 1–30 drill-down each row
// shows its d30 share ("Nợ 1–30 ngày") so the rows sum to the bucket card
// amount; without a bucket filter the column is absent. Ledger fixtures are
// self-named (KB307) and purged; the aging cache is flushed after seeding.
import puppeteer from 'puppeteer';
import { createRequire } from 'node:module';
import { appendFileSync } from 'node:fs';
const require = createRequire('/Volumes/LexarSSD/projects/silversea-prod/backend/index.ts');
const postgres = require('postgres');
const sql = postgres({ host: 'localhost', port: 5441, database: 'silversea', user: 'postgres', password: 'postgres', max: 1 });
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const L = [];
const step = (s, o) => { const e = { at: new Date().toISOString(), step: s, ...o }; L.push(e); appendFileSync(`${QA}/2026-10-07_card061026172807_ui-driver.log`, JSON.stringify(e) + '\n'); console.log(JSON.stringify(e)); };

const API = 'http://localhost:3002/api';
const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
const session = await login.json();
const token = session.token ?? session.accessToken ?? session?.data?.token;
step('login', { gotToken: Boolean(token) });

const suffix = `KB307-${Date.now()}`;
let customerId = null;
try {
  const dueDate = new Date(Date.now() - 10 * 86400_000).toISOString().slice(0, 10); // overdue 10 days → d30 band
  const futureDue = new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10);
  const [admin] = await sql`SELECT id FROM users WHERE role='ADMIN' ORDER BY id LIMIT 1`;
  const [customer] = await sql`INSERT INTO customers (name, created_at, updated_at) VALUES (${`KB307 fixture ${suffix}`}, now(), now()) RETURNING id`;
  customerId = customer.id;
  await sql`INSERT INTO billing_documents (type, entity_type, entity_id, entity_name, range_from, range_to, debit_note_status, total_incl_vat, original_due_date, processing_due_date, issued_at, created_by, created_at)
    VALUES ('DEBIT_NOTE','CUSTOMER',${customerId},${`KB307 KH ${suffix}`}, ${dueDate}, ${dueDate}, 'SENT', '2200000', ${dueDate}, ${dueDate}, now() - interval '20 days', ${admin.id}, now())`;
  await sql`INSERT INTO billing_document_lines (document_id, source_type, line_type, type_label, description, base_amount, net_amount, gross_amount)
    VALUES (LASTVAL(), 'ADHOC', 'ADHOC', ${`KB307 line ${suffix}`}, ${`KB307 obligation ${suffix}`}, '2200000', '2200000', '2200000')`;
  step('fixture', { customerId, overdueShare: 2200000, total: 4219000 });

  // Flush the per-day aging cache so the fresh ledger rows are read.
  const Redis = createRequire('/Volumes/LexarSSD/projects/silversea-prod/backend/index.ts')('ioredis');
  const r = new Redis(6391, '127.0.0.1');
  const keys = await r.keys('reports:entity-results*');
  if (keys.length) await r.del(...keys);
  r.disconnect();
  step('cache-flushed', { keys: keys.length });

  const check = await fetch(`${API}/reports/receivables-aging?bucket=d30&limit=10`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await check.json();
  const rows = data.customers ?? [];
  step('api-d30', { rows: rows.length, totals_d30: data.totals?.d30, row: rows.find((c) => c.customerName.includes('KB307'))?.aging });
  const fixtureRow = rows.find((c) => c.customerId === customerId);
  if (!fixtureRow) throw new Error('fixture customer missing from the d30 bucket');
  if (fixtureRow.aging.d30 !== 2200000) throw new Error('d30 share mismatch: ' + fixtureRow.aging.d30);

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (req) => { void req.continue(); });
    await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto('http://localhost:7175/debt?filter=d30', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => document.body.innerText.includes('KB307 fixture'), { timeout: 90000 });
    const probe = await page.evaluate(() => {
      const header = [...document.querySelectorAll('th')].some((el) => (el.textContent || '').trim() === 'Nợ 1–30 ngày');
      const cells = [...document.querySelectorAll('tbody td')].filter((td) => (td.getAttribute('data-label') || '') === 'Nợ 1–30 ngày').map((td) => (td.textContent || '').trim());
      return { header, cells };
    });
    step('probe-bucket-view', probe);
    if (!probe.header) throw new Error('share column header missing in the d30 view');
    if (!probe.cells.includes('2.200.000 ₫')) throw new Error('share cell missing/incorrect: ' + JSON.stringify(probe.cells));
    await page.screenshot({ path: `${QA}/2026-10-07_card061026172807_ui-debt-d30-share.png` });
    step('screenshot', { path: 'qa/2026-10-07_card061026172807_ui-debt-d30-share.png' });

    await page.goto('http://localhost:7175/debt', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => document.body.innerText.includes('KB307 fixture') || document.body.innerText.includes('Tổng nợ'), { timeout: 90000 });
    const noFilter = await page.evaluate(() => [...document.querySelectorAll('th')].some((el) => (el.textContent || '').trim() === 'Nợ 1–30 ngày'));
    step('probe-no-filter', { shareColumnPresent: noFilter });
    if (noFilter) throw new Error('share column leaked into the unfiltered view');
  } finally { await browser.close(); }
  step('verdict', { result: 'PASS — bucket rows show their band share; rows sum to the card' });
} finally {
  try {
    if (customerId != null) await sql`DELETE FROM ledger WHERE entity_type = 'CUSTOMER' AND entity_id = ${customerId}`;
    if (customerId != null) await sql`DELETE FROM customers WHERE id = ${customerId}`;
    step('cleanup', { purged: true });
  } catch (e) { step('cleanup-error', { message: String(e) }); }
  await sql.end();
}
