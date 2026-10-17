#!/usr/bin/env node
// Card 171026154000 — UI rung 3: the Loại hàng (cargoMode) scope on /dispatch-detail.
//
// Drives the REAL changed control (Bộ lọc → Loại hàng → Hàng lẻ (LCL)) against
// THIS worktree's stack (backend :3092, frontend :7185 — not the main checkout),
// then proves the identity chain:
//   DOM (page-1 rows all LCL after the pick)
//   = API request (?cargoMode=LCL, captured live from the browser)
//   = API response (total, assignmentStatusCounts)
//   = DB (October LCL fulfillment count under the same predicates).
// Clearing the select back to Tất cả must restore the mixed default view.
// Role: dieuvan (DISPATCHER, testplan/testaccounts.txt — password Abc123).
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { login } from '../../../scripts/lib/http.mjs';

const API = 'http://localhost:3092/api';
const BASE = 'http://localhost:7185';
const SHOT = (n) => `qa/2026-10-17_171026154000_ui-${n}.png`;
const LOG = 'qa/2026-10-17_171026154000_ui-driver.log';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.rmSync(LOG, { force: true });
const log = (m) => { const line = `[rung ${new Date().toISOString()}] ${m}`; console.log(line); fs.appendFileSync(LOG, line + '\n'); };

const OCT = 'dateFrom=2026-10-01&dateTo=2026-10-31';

// ── API identity (this worktree's backend) ───────────────────────────────────
const token = await login('dieuvan', { backend: API });
const auth = { Authorization: `Bearer ${token}` };
const apiGet = async (q) => {
  const res = await fetch(`${API}/shipments/dispatch-detail-plan-rows?${q}`, { headers: auth });
  return { status: res.status, data: await res.json() };
};
const pre = await apiGet(`page=1&limit=50&${OCT}`);
const post = await apiGet(`page=1&limit=50&${OCT}&cargoMode=LCL`);
const postFcl = await apiGet(`page=1&limit=50&${OCT}&cargoMode=FCL`);
const modes = (d) => d.data.items.reduce((acc, r) => { acc[r.cargoMode] = (acc[r.cargoMode] ?? 0) + 1; return acc; }, {});
log(`API pre-filter: status=${pre.status} total=${pre.data.total} counts=${JSON.stringify(pre.data.assignmentStatusCounts)} page1=${JSON.stringify(modes(pre))}`);
log(`API cargoMode=LCL: status=${post.status} total=${post.data.total} counts=${JSON.stringify(post.data.assignmentStatusCounts)} page1=${JSON.stringify(modes(post))} allLCL=${post.data.items.every((r) => r.cargoMode === 'LCL')}`);
log(`API cargoMode=FCL: status=${postFcl.status} total=${postFcl.data.total} page1=${JSON.stringify(modes(postFcl))} allFCL=${postFcl.data.items.every((r) => r.cargoMode === 'FCL')}`);
if (post.status !== 200 || !post.data.items.every((r) => r.cargoMode === 'LCL')) throw new Error('API LCL filter failed');

// ── DB identity: the October LCL fulfillment count under the same predicates ──
// Mirrors the endpoint's own predicate set: live customer inner join, the 4
// dispatch-eligible statuses, live (non-canceled) fulfillment, carrier type
// OWN/EXTERNAL/null — plus the LCL lot's transport date (no container ⇒ the
// lot's expected delivery date).
const dbOut = execFileSync('docker', ['exec', 'ss-prod-db', 'psql', '-U', 'postgres', '-d', 'silversea', '-t', '-A', '-c',
  `select count(*) from shipment_fulfillments f
   join shipments sh on sh.id = f.shipment_id
   join customers c on c.id = sh.customer_id and c.deleted_at is null
   where f.canceled_at is null and sh.deleted_at is null and f.cargo_mode = 'LCL'
     and sh.status in ('READY_FOR_DISPATCH','DISPATCHED','IN_TRANSIT','COMPLETED')
     and (f.planned_carrier_type in ('OWN','EXTERNAL') or f.planned_carrier_type is null)
     and coalesce(sh.expected_delivery_date, '9999-12-31') between '2026-10-01' and '2026-10-31'`], { encoding: 'utf8' }).trim();
log(`DB October LCL fulfillments = ${dbOut}; API cargoMode=LCL total = ${post.data.total}`);
if (Number(dbOut) !== Number(post.data.total)) throw new Error(`DB(${dbOut}) != API LCL total(${post.data.total})`);

// ── UI drive ─────────────────────────────────────────────────────────────────
const browser = await puppeteer.launch({ headless: 'new', defaultViewport: { width: 1440, height: 1000 }, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  const planCalls = [];
  page.on('response', async (res) => {
    const url = res.url();
    if (url.includes('dispatch-detail-plan-rows')) {
      let body = null;
      try { body = await res.json(); } catch { /* keep null */ }
      planCalls.push({ url, total: body?.total, counts: body?.assignmentStatusCounts });
      log(`plan-rows call: ${url.replace(BASE, '')} → total=${body?.total} counts=${JSON.stringify(body?.assignmentStatusCounts)}`);
    }
  });
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('.detailed-plan-grid__cell--container', { timeout: 30000 });
  await sleep(800);

  const rowModes = () => page.evaluate(() => [...document.querySelectorAll('.detailed-plan-grid__cell--container')]
    .map((c) => (c.querySelector('.detailed-plan-grid__line--strong')?.textContent ?? '').trim())
    .map((t) => (t.startsWith('Lẻ') ? 'LCL' : 'FCL'))
    .reduce((acc, m) => { acc[m] = (acc[m] ?? 0) + 1; return acc; }, {}));
  const preModes = await rowModes();
  log(`UI pre-filter page-1 modes: ${JSON.stringify(preModes)}`);
  await page.screenshot({ path: SHOT('1-pre-filter-1440'), fullPage: false });

  // Open Bộ lọc → Loại hàng → Hàng lẻ (LCL) — real pointer taps on the control.
  const clickByName = async (name) => {
    const target = await page.evaluate((n) => {
      const el = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || b.textContent || '').replace(/\s+/g, ' ').trim() === n);
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, name);
    if (!target) throw new Error(`button not found: ${name}`);
    await page.mouse.move(target.x, target.y, { steps: 4 });
    await page.mouse.click(target.x, target.y);
    await sleep(500);
  };
  // Option clicks MUST be scoped to the open listbox: several bar controls
  // (date-scope tab, Xuất / Nhập) also carry a literal 'Tất cả' label, and a
  // generic button search clicks the wrong one.
  const clickOption = async (label) => {
    const target = await page.evaluate((n) => {
      const el = [...document.querySelectorAll('[role="option"]')].find((o) => (o.textContent || '').replace(/\s+/g, ' ').trim() === n);
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, label);
    if (!target) throw new Error(`option not found: ${label}`);
    await page.mouse.move(target.x, target.y, { steps: 4 });
    await page.mouse.click(target.x, target.y);
    await sleep(500);
  };
  await clickByName('Bộ lọc');
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
  await clickByName('Loại hàng: Tất cả');
  await page.waitForSelector('[role="option"]', { timeout: 10000 });
  await clickOption('Hàng lẻ (LCL)');
  await sleep(400);

  // Wait for the filtered refetch to land and the grid to re-render LCL-only.
  await page.waitForFunction(() => {
    const cells = [...document.querySelectorAll('.detailed-plan-grid__cell--container')];
    return cells.length > 0 && cells.every((c) => (c.querySelector('.detailed-plan-grid__line--strong')?.textContent ?? '').trim().startsWith('Lẻ'));
  }, { timeout: 30000 });
  const lclModes = await rowModes();
  const lclCall = planCalls.filter((c) => c.url.includes('cargoMode=LCL')).pop();
  log(`UI after Hàng lẻ pick: page-1 modes=${JSON.stringify(lclModes)}; captured browser request total=${lclCall?.total} counts=${JSON.stringify(lclCall?.counts)}`);
  if (!lclCall) throw new Error('no cargoMode=LCL request captured from the UI');
  if ((lclModes.FCL ?? 0) !== 0) throw new Error('FCL rows leaked into the LCL view');
  await page.screenshot({ path: SHOT('2-lcl-filtered-1440'), fullPage: false });

  // Clear back to Tất cả — the mixed default must return (scoped to the
  // cargo-mode listbox, never the same-labeled date-scope tab).
  await clickByName('Loại hàng: Hàng lẻ (LCL)');
  await page.waitForSelector('[role="option"]', { timeout: 10000 });
  await clickOption('Tất cả');
  await sleep(300);
  await page.waitForFunction(() => {
    const cells = [...document.querySelectorAll('.detailed-plan-grid__cell--container')];
    const fcl = cells.filter((c) => !(c.querySelector('.detailed-plan-grid__line--strong')?.textContent ?? '').trim().startsWith('Lẻ')).length;
    return cells.length > 0 && fcl > 0;
  }, { timeout: 30000 });
  const clearedModes = await rowModes();
  log(`UI after Tất cả clear: page-1 modes=${JSON.stringify(clearedModes)}`);
  await page.screenshot({ path: SHOT('3-cleared-1440'), fullPage: false });

  // 390 viewport: the fold dialog still exposes the select. Close any dialog
  // left open from the clear step first — 'Bộ lọc' is a toggle, not an opener.
  await page.keyboard.press('Escape');
  await sleep(800);
  await page.setViewport({ width: 390, height: 844 });
  await sleep(900);
  await clickByName('Bộ lọc');
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
  await clickByName('Loại hàng: Tất cả');
  await page.waitForSelector('[role="option"]', { timeout: 10000 });
  const pick = await page.evaluate(() => {
    const el = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent.trim() === 'Hàng lẻ (LCL)');
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!pick) throw new Error('Hàng lẻ (LCL) option not reachable at 390');
  await page.mouse.click(pick.x, pick.y);
  await sleep(400);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => {
    const cells = [...document.querySelectorAll('.detailed-plan-grid__cell--container')];
    return cells.length > 0 && cells.every((c) => (c.querySelector('.detailed-plan-grid__line--strong')?.textContent ?? '').trim().startsWith('Lẻ'));
  }, { timeout: 30000 });
  log('UI 390: LCL pick reachable and effective');
  await page.screenshot({ path: SHOT('4-lcl-filtered-390'), fullPage: false });

  fs.appendFileSync(LOG, '[rung] RESULT: PASS\n');
  console.log(JSON.stringify({
    apiPre: { total: pre.data.total, counts: pre.data.assignmentStatusCounts, page1: modes(pre) },
    apiLcl: { total: post.data.total, counts: post.data.assignmentStatusCounts },
    dbLclOctober: Number(dbOut),
    uiPre: preModes, uiLcl: lclModes, uiCleared: clearedModes,
  }, null, 2));
  process.exitCode = 0;
} catch (error) {
  fs.appendFileSync(LOG, `[rung] RESULT: FAIL — ${error?.message ?? error}\n`);
  throw error;
} finally {
  await browser.close();
}
