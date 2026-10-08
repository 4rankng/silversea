// Card 071026204720 reproduction rung — staging, CUS (thanhdc).
// Surface A: lot drawer custody select — capture the trigger text, the
//            button's accessible-name refs, and "Phơi phiếu" occurrence count.
// Surface B: create form "Lịch & ghi chú" section header — capture the exact
//            heading text to expose the missing-space join.
import puppeteer from 'puppeteer';
import { appendFileSync } from 'node:fs';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const CARD = 'card071026204720';
const step = (s, o) => { const e = { at: new Date().toISOString(), step: s, ...o }; appendFileSync(`${QA}/2026-10-07_${CARD}_ui-driver.log`, JSON.stringify(e) + '\n'); console.log(JSON.stringify(e)); };
const flat = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const login = await fetch('https://vantai.tingting.vip/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'thanhdc', password: 'Abc123' }) });
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

  // ── Surface A: drawer custody select ─────────────────────────────────
  await page.goto('https://vantai.tingting.vip/shipments', { waitUntil: 'domcontentloaded', timeout: 60000 });
  let rows = 0;
  for (let i = 0; i < 15 && !rows; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    rows = await page.evaluate(() => document.querySelectorAll('button.cus-dashboard-detail').length);
  }
  step('list', { rows });
  if (!rows) throw new Error('CUS shipments list did not render detail buttons');
  const drawer = await page.evaluate(() => {
    const btn = document.querySelector('button.cus-dashboard-detail');
    return btn ? (btn.closest('tr')?.querySelector('[data-key="billOrBookNumber"], td')?.textContent ?? '') : '';
  });
  step('first-row', { drawer });
  await page.evaluate(() => document.querySelector('button.cus-dashboard-detail')?.click());
  let drawerOpen = false;
  for (let i = 0; i < 10 && !drawerOpen; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    drawerOpen = await page.evaluate(() => Boolean(document.querySelector('.cus-drawer-decision--custody [data-uui-control="select"]')));
  }
  step('drawer', { drawerOpen });
  if (!drawerOpen) throw new Error('lot drawer did not render the custody select');
  const custody = await page.evaluate(() => {
    const cell = document.querySelector('.cus-drawer-decision--custody');
    const btn = cell?.querySelector('[data-uui-control="select"]');
    const refs = btn?.getAttribute('aria-labelledby') ?? '';
    return {
      cellText: cell?.innerText ?? null,
      buttonText: btn?.textContent ?? null,
      labelledby: refs,
      refTexts: refs ? refs.split(' ').map((r) => document.getElementById(r)?.textContent ?? null) : [],
      phoiPhieuCount: (document.querySelector('[role="dialog"]')?.innerText.match(/Phơi phiếu/g) ?? []).length,
    };
  });
  step('custody', custody);
  const grid = await page.$('.cus-drawer-decision-grid');
  if (grid) await grid.screenshot({ path: `${QA}/2026-10-07_${CARD}_ui-custody.png` });
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 1500));

  // ── Surface B: create form schedule section header ───────────────────
  await page.goto('https://vantai.tingting.vip/shipments/new', { waitUntil: 'domcontentloaded', timeout: 60000 });
  let where = { ok: false };
  for (let i = 0; i < 15 && !where.ok; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    where = await page.evaluate(() => ({ ok: Boolean(document.querySelector('#shipment-section-schedule')), tail: document.body.innerText.slice(-300) }));
  }
  step('create-page', { ok: where.ok, tail: where.ok ? undefined : where.tail });
  if (!where.ok) throw new Error('create page did not render the schedule section');
  const header = await page.evaluate(() => {
    const sec = document.querySelector('#shipment-section-schedule');
    const heading = sec?.querySelector('.csc-section__heading');
    const h2 = sec?.querySelector('h2');
    const firstLabel = sec?.querySelector('label');
    const rect = (el) => el ? (({ top, bottom, left, right }) => ({ top: Math.round(top), bottom: Math.round(bottom), left: Math.round(left), right: Math.round(right) }))(el.getBoundingClientRect()) : null;
    return {
      headingText: heading?.innerText ?? null,
      h2Text: h2?.textContent ?? null,
      nextSiblingText: h2?.nextElementSibling?.textContent ?? null,
      firstFieldLabelText: firstLabel?.textContent ?? null,
      h2Rect: rect(h2),
      firstLabelRect: rect(firstLabel),
      visuallyOnSameLine: Boolean(h2 && firstLabel && firstLabel.getBoundingClientRect().top < h2.getBoundingClientRect().bottom),
      sectionText: sec?.innerText.slice(0, 400) ?? null,
    };
  });
  step('schedule-header', header);
  const secEl = await page.$('#shipment-section-schedule .csc-section__heading');
  if (secEl) await secEl.screenshot({ path: `${QA}/2026-10-07_${CARD}_ui-schedule-header.png` });
  console.log('RUNG EVIDENCE CAPTURED');
} catch (e) {
  step('FAIL', { error: String(e && e.message ? e.message : e) });
  console.log('RUNG FAIL:', e && e.message ? e.message : e);
  process.exitCode = 1;
} finally { await browser.close(); }
