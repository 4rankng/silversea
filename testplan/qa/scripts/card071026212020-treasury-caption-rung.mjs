// Card 071026212020 — /finance/treasury: the account caption must never show
// the migration phrase; cutover timestamps show only when they exist.
import puppeteer from 'puppeteer';
import { appendFileSync } from 'node:fs';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const CARD = 'card071026212020';
const BASE = 'http://localhost:7175';
const step = (s, o) => { const e = { at: new Date().toISOString(), step: s, ...o }; appendFileSync(`${QA}/2026-10-08_${CARD}_ui-driver.log`, JSON.stringify(e) + '\n'); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const login = await fetch('http://localhost:3002/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
const session = await login.json();
const token = session.token ?? session.accessToken ?? session?.data?.token;
step('login', { gotToken: Boolean(token), role: session.user?.role ?? null });
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (req) => { void req.continue(); });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${BASE}/finance/treasury`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  let ready = false;
  for (let i = 0; i < 15 && !ready; i++) { await sleep(3000); ready = await page.evaluate(() => Boolean(document.querySelector('.treasury-table'))); }
  step('page', { tableRendered: ready });
  if (!ready) throw new Error('treasury table did not render');
  const census = await page.evaluate(() => {
    const body = document.body.innerText;
    const rows = document.querySelectorAll('.treasury-table tbody tr').length;
    const captions = [...document.querySelectorAll('.treasury-table__account small')];
    return {
      accountRows: rows,
      migrationPhraseCount: (body.match(/Chưa chuyển đổi/g) ?? []).length,
      cutoverCaptionCount: captions.filter((el) => el.textContent.includes('Chuyển đổi:')).length,
      captionSamples: captions.slice(0, 3).map((el) => el.textContent.trim()),
      firstRowText: document.querySelector('.treasury-table tbody tr')?.innerText?.replace(/\s+/g, ' ').slice(0, 160) ?? null,
    };
  });
  step('census', census);
  await page.screenshot({ path: `${QA}/2026-10-08_${CARD}_ui-treasury.png` });
  if (census.migrationPhraseCount > 0) throw new Error(`migration phrase still on the page ×${census.migrationPhraseCount}`);
  if (census.accountRows === 0) throw new Error('no account rows rendered');
  console.log('RUNG EVIDENCE CAPTURED');
} catch (e) {
  step('FAIL', { error: String(e && e.message ? e.message : e) });
  console.log('RUNG FAIL:', e && e.message ? e.message : e);
  process.exitCode = 1;
} finally { await browser.close(); }
