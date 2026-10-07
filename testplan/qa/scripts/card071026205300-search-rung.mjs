// Card 071026205300 reproduction rung — staging, DISPATCHER (dungnv), /shipments.
// Drive the "Tìm lô hàng" search and capture: row counts, the page's actual
// /api/shipments request, and direct endpoint probes for both keywords plus
// the known lot /shipments/390.
import puppeteer from 'puppeteer';
import { appendFileSync } from 'node:fs';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const CARD = 'card071026205300';
const step = (s, o) => { const e = { at: new Date().toISOString(), step: s, ...toClean(o) }; appendFileSync(`${QA}/2026-10-07_${CARD}_ui-driver.log`, JSON.stringify(e) + '\n'); console.log(JSON.stringify(e)); };
const toClean = (o) => JSON.parse(JSON.stringify(o, (k, v) => typeof v === 'bigint' ? Number(v) : v));
const login = await fetch('https://vantai.tingting.vip/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'dungnv', password: 'Abc123' }) });
const session = await login.json();
const token = session.token ?? session.accessToken ?? session?.data?.token;
step('login', { gotToken: Boolean(token), role: session.user?.role ?? null });
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (req) => { void req.continue(); });
  const apiCalls = [];
  page.on('response', async (res) => {
    const url = res.request().url();
    if (url.includes('/api/shipments?')) {
      let body = null;
      try { body = await res.json(); } catch { /* stream already consumed */ }
      apiCalls.push({ url: url.replace('https://vantai.tingting.vip', ''), status: res.status(), total: body?.total ?? null, items: body?.items?.length ?? null });
    }
  });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto('https://vantai.tingting.vip/shipments', { waitUntil: 'domcontentloaded', timeout: 60000 });
  let rows = 0;
  for (let i = 0; i < 15 && !rows; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    rows = await page.evaluate(() => document.querySelectorAll('tr.cus-dashboard-row, tbody tr').length);
  }
  await new Promise((r) => setTimeout(r, 2000));
  const baseline = await page.evaluate(() => ({
    rows: document.querySelectorAll('tr.cus-dashboard-row, tbody tr').length,
    searchValue: document.querySelector('input[aria-label="Tìm lô hàng"]')?.value ?? null,
  }));
  step('baseline', baseline);
  const search = async (term) => {
    await page.evaluate((t) => {
      const i = document.querySelector('input[aria-label="Tìm lô hàng"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(i, t);
      i.dispatchEvent(new Event('input', { bubbles: true }));
      i.dispatchEvent(new Event('change', { bubbles: true }));
    }, term);
    await new Promise((r) => setTimeout(r, 2500));
    const state = await page.evaluate(() => ({
      url: location.search,
      rows: document.querySelectorAll('tr.cus-dashboard-row, tbody tr').length,
      bodyText: document.body.innerText.match(/(Không có lô|hiển thị \d+|tổng \d+|\d+ lô)/i)?.[0] ?? null,
    }));
    step('searched', { term, ...state });
  };
  await search('QADV-B2-01');
  await page.screenshot({ path: `${QA}/2026-10-07_${CARD}_ui-search-b2.png` });
  await search('QADV-MERGE');
  await page.screenshot({ path: `${QA}/2026-10-07_${CARD}_ui-search-merge.png` });
  // Direct endpoint probes
  const probe = async (term) => {
    const r = await fetch(`https://vantai.tingting.vip/api/shipments?searchSuffix=${encodeURIComponent(term)}&limit=20`, { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json();
    step('probe', { term, status: r.status, total: j?.total ?? null, first: j?.items?.[0]?.blNumber ?? j?.items?.[0]?.code ?? null });
  };
  await probe('QADV-B2-01');
  await probe('QADV-MERGE');
  const r390 = await fetch('https://vantai.tingting.vip/api/shipments/390', { headers: { Authorization: `Bearer ${token}` } });
  const j390 = await r390.json();
  const d390 = j390?.data ?? j390;
  step('lot-390', { status: r390.status, code: d390?.code ?? null, blNumber: d390?.blNumber ?? null, bookingRef: d390?.bookingRef ?? null, customerName: d390?.customerName ?? null, containers: (d390?.containers ?? d390?.shipmentContainers ?? [])?.slice?.(0, 3)?.map?.((c) => c.containerNumber) ?? null });
  step('api-calls', { count: apiCalls.length, calls: apiCalls.slice(-4) });
  console.log('RUNG EVIDENCE CAPTURED');
} catch (e) {
  step('FAIL', { error: String(e && e.message ? e.message : e) });
  console.log('RUNG FAIL:', e && e.message ? e.message : e);
  process.exitCode = 1;
} finally { await browser.close(); }
