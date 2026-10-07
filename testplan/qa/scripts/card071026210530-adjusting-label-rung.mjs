// Card 071026210530 — /ops/wallet Lịch sử chi phí: a negative RECORDED row
// must label itself as the adjusting entry ("bút toán điều chỉnh (dòng âm)"),
// positive rows stay plain "Đã ghi nhận". Drives the fixture row 7013
// (inserted for giaonhan, deleted by the runner after the pass).
import puppeteer from 'puppeteer';
import { appendFileSync } from 'node:fs';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const CARD = 'card071026210530';
const BASE = 'http://localhost:7175';
const step = (s, o) => { const e = { at: new Date().toISOString(), step: s, ...o }; appendFileSync(`${QA}/2026-10-08_${CARD}_ui-driver.log`, JSON.stringify(e) + '\n'); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const login = await fetch('http://localhost:3002/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'giaonhan', password: 'Abc123' }) });
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
  await page.goto(`${BASE}/ops/wallet`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  let ready = false;
  for (let i = 0; i < 15 && !ready; i++) { await sleep(3000); ready = await page.evaluate(() => Boolean(document.querySelector('section[aria-label="Lịch sử chi phí"] tbody tr'))); }
  step('page', { historyRendered: ready });
  if (!ready) throw new Error('wallet history did not render');
  await sleep(6000); // let the wallet queries settle before reading the rows
  const verdict = await page.evaluate(() => {
    const section = document.querySelector('section[aria-label="Lịch sử chi phí"]');
    const rows = [...section.querySelectorAll('tbody tr')];
    // The table never renders the note — identify the fixture by its negative
    // amount and the -50.000 sum (row 7013 is the only -50.000 row for this user).
    const negative = rows.find((r) => r.innerText.includes('-50.000'));
    const positiveSample = rows.find((r) => r.innerText.includes('50.000') && !r.innerText.includes('-50.000'));
    return {
      rowCount: rows.length,
      negativeRowText: negative?.innerText.replace(/\s+/g, ' ').slice(0, 220) ?? null,
      negativeHasQualifier: Boolean(negative?.innerText.includes('bút toán điều chỉnh (dòng âm)')),
      positiveRowText: positiveSample?.innerText.replace(/\s+/g, ' ').slice(0, 160) ?? null,
      positiveHasQualifier: Boolean(positiveSample?.innerText.includes('bút toán điều chỉnh (dòng âm)')),
      voidedCount: (document.body.innerText.match(/Đã hủy/g) ?? []).length,
    };
  });
  step('census', verdict);
  await page.screenshot({ path: `${QA}/2026-10-08_${CARD}_ui-wallet-history.png` });
  if (!verdict.negativeRowText) throw new Error('negative row not visible in the wallet history');
  if (!verdict.negativeHasQualifier) throw new Error('negative row lacks the adjusting-entry qualifier: ' + JSON.stringify(verdict));
  if (verdict.positiveRowText && verdict.positiveHasQualifier) throw new Error('a positive row was wrongly labeled as adjusting: ' + JSON.stringify(verdict));
  console.log('RUNG EVIDENCE CAPTURED');
} catch (e) {
  step('FAIL', { error: String(e && e.message ? e.message : e) });
  console.log('RUNG FAIL:', e && e.message ? e.message : e);
  process.exitCode = 1;
} finally { await browser.close(); }
