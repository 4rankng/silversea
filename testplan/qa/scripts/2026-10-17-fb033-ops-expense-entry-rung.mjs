// FB-033 verify-fail (kanban card 171026121110) — the Điều vận role reportedly has
// no way to record a trip expense. This rung pins the CURRENT state factually:
// global search, /expenses, and the lot-detail expense entry point, for both
// the DISPATCHER account (the card's subject) and the OPS account (the role the
// 2026-10-17 spec T3 ruling names).
//
// LOCAL ONLY: vite 7175 → api 3002.
//   node testplan/qa/scripts/2026-10-17-fb033-ops-expense-entry-rung.mjs
// Exit 0 = every rung answered (PASS or a recorded FAIL — this rung PINNED
// behaviour, so a FAIL here is a finding, not a runner error).

import puppeteer from 'puppeteer';
import fs from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:7175';
const API = `${BASE}/api`;
const SHOTS = process.env.SHOTS ?? '/tmp/fb033';
fs.mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function record(rung, verdict, detail) {
  results.push({ rung, verdict, detail });
  console.log(`[${verdict}] ${rung} — ${detail}`);
}

async function loginWithRetry(id, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: id, password: 'Abc123' }),
    });
    const text = await res.text();
    if (res.ok && text) { try { return JSON.parse(text); } catch { /* retry */ } }
    await sleep(1500 * i);
  }
  throw new Error(`login ${id} failed`);
}

const LOT = process.env.FB033_LOT ?? '110535'; // an FCL lot from this run's earlier fixtures
const findings = {};

// No OPS account exists in this local DB, so the contrast role is ACCOUNTANT
// (ketoan) — the role the card itself records as PASSING.
for (const who of ['dungnv', 'ketoan']) {
  const login = await loginWithRetry(who);
  const browser = await puppeteer.launch({
    headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), login.token);
  const role = login.user?.role;

  try {
    // 1. Global search for "chi phí"
    await page.goto(`${BASE}/shipments/${LOT}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(3500);
    const search = await page.evaluate(() => {
      const i = [...document.querySelectorAll('input')]
        .find((el) => /tìm trang|tìm kiếm|search/i.test(`${el.placeholder || ''} ${el.getAttribute('aria-label') || ''}`));
      if (!i) return { found: false };
      i.focus();
      return { found: true };
    });
    let searchResult = null;
    if (search.found) {
      await page.keyboard.type('chi phí', { delay: 45 });
      await sleep(2000);
      searchResult = await page.evaluate(() => {
        const t = document.body.innerText || '';
        return {
          noResults: /Không có kết quả/i.test(t),
          hits: [...document.querySelectorAll('[role="option"], [role="menuitem"], a')]
            .map((el) => (el.innerText || '').trim())
            .filter((s) => /chi phí/i.test(s)).slice(0, 5),
        };
      });
      await page.keyboard.press('Escape');
      await sleep(400);
    }

    // 2. /expenses directly
    await page.goto(`${BASE}/expenses`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(3000);
    const expenses = await page.evaluate(() => ({
      url: location.pathname,
      denied: /không có quyền truy cập/i.test(document.body.innerText || ''),
      hasAddVoucher: /Thêm phiếu chi/i.test(document.body.innerText || ''),
      hasIncurred: /Chi phí phát sinh/i.test(document.body.innerText || ''),
    }));

    // 3. The lot-detail expense entry point
    await page.goto(`${BASE}/shipments/${LOT}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(3500);
    const detail = await page.evaluate(() => ({
      khaiChiPhi: [...document.querySelectorAll('button')]
        .map((b) => (b.innerText || '').trim())
        .filter((t) => /khai chi phí/i.test(t)),
      themKhoanChi: [...document.querySelectorAll('button')]
        .map((b) => (b.innerText || '').trim())
        .filter((t) => /thêm khoản chi/i.test(t)),
      expensePanel: /Chi phí/i.test(document.body.innerText || ''),
    }));
    await page.screenshot({ path: `${SHOTS}/${who}-chi-tiet-lo.png` });

    findings[who] = { role, search, searchResult, expenses, detail };
    record(`${who}-search`, searchResult ? 'INFO' : 'FAIL',
      `role=${role} search=${JSON.stringify(searchResult)}`);
    record(`${who}-expenses`, 'INFO', `/expenses → ${JSON.stringify(expenses)}`);
    record(`${who}-detail-entry`, 'INFO', `chi tiết lô → ${JSON.stringify(detail)}`);
  } catch (e) {
    record(`${who}-runner`, 'FAIL', String(e.message ?? e));
  } finally {
    await browser.close();
  }
}

console.log('\n=== FINDINGS (pinned current behaviour) ===');
console.log(JSON.stringify(findings, null, 1));
process.exit(0);
