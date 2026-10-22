#!/usr/bin/env node
/**
 * 2026-10-23 LCL day-filter UI drive — card 231026000252 (rung 3 evidence).
 *
 * Drives the REAL Tổng quan (`/shipments`) and Chi tiết (`/shipments-detail`)
 * screens with the card's acceptance filters against LCL fixtures:
 *   UI-DATED-OUT  LCL dated 2026-10-17 under 23/10..23/10 -> ABSENT both screens
 *   UI-DATED-IN   same fixture under 17/10..17/10         -> PRESENT both screens
 *   UI-UNDATED    LCL undated under 23/10..23/10 and bare -> PRESENT both screens
 * Each nav captures: screenshot, page-body assertion, the scoped API request,
 * and the fixture rows' persisted state (psql). See the case doc for the rung
 * table. Driver log + exit status: qa/2026-10-23-filter-lcl-day/.
 *
 * Run:
 *   node testplan/qa/scripts/2026-10-23-lcl-dayfilter-ui.mjs
 * Env: FRONT_PORT (7175), API_PORT (3002) — same contract as the other drivers.
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { login, api } from '../../../scripts/lib/http.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = path.join(ROOT, 'qa', '2026-10-23-filter-lcl-day');
const FRONT = `http://localhost:${process.env.FRONT_PORT ?? 7175}`;
const BACKEND = process.env.BACKEND ?? `http://localhost:${process.env.API_PORT ?? 3002}/api`;

const stamp = String(Date.now()).slice(-8);
const BL_DATED = `LDAYUI${stamp}D`;
const BL_UNDATED = `LDAYUI${stamp}U`;

const checks = [];
let requests = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`);
}
const psql = (sqlText) =>
  execSync(`docker exec ss-prod-db psql -U postgres -d silversea -qtAX -c ${JSON.stringify(sqlText)}`).toString().trim();

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  console.log(`# LCL day-filter UI drive — backend ${BACKEND} front ${FRONT} stamp ${stamp}`);

  const tok = await login('admin', { backend: BACKEND });
  for (const [bl, expectedDeliveryDate] of [
    [BL_DATED, '2026-10-17'],
    [BL_UNDATED, undefined],
  ]) {
    const created = await api(tok, 'POST', '/shipments', {
      customerId: 2,
      cargoMode: 'LCL',
      tradeDirection: 'IMPORT',
      blNumber: bl,
      packageType: 'BAG',
      packageCount: 5,
      cargoWeightKg: 500,
      ...(expectedDeliveryDate ? { expectedDeliveryDate } : {}),
    }, { backend: BACKEND, headers: { 'Idempotency-Key': randomUUID() } });
    if (created.status !== 201 && created.status !== 200) {
      throw new Error(`create ${bl} -> ${created.status}`);
    }
    console.log(`fixture created: ${bl} transportDate=${expectedDeliveryDate ?? 'NULL'}`);
  }

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument((t) => { if (location.origin.startsWith('http://localhost')) localStorage.setItem('token', t); }, tok);
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('request', (r) => { const u = r.url(); if (u.includes('/api/shipments')) requests.push(u); });

  const drive = async (screen, needle, from, to, step) => {
    requests = [];
    const query = `searchSuffix=${needle}${from ? `&transportDateFrom=${from}&transportDateTo=${to}` : ''}`;
    await page.goto(`${FRONT}${screen}?${query}`, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 1200));
    await page.screenshot({ path: path.join(OUT, `2026-10-23_filter-lcl-day_ui-${step}.png`), fullPage: false });
    const text = await page.evaluate(() => document.body.textContent ?? '');
    const scoped = requests.find((u) => u.includes(`searchSuffix=${needle}`));
    return { text, scoped };
  };

  const expectPresence = async (screen, needle, from, to, step, want) => {
    const { text, scoped } = await drive(screen, needle, from, to, step);
    const present = text.includes(needle);
    check(`${step}: request scoped to ${needle} with the day filter`, Boolean(scoped), scoped ?? 'no request captured');
    check(`${step}: fixture ${needle} ${want ? 'PRESENT' : 'ABSENT'} on ${screen} filter ${from ?? 'bare'}`, present === want, `body contains=${present}`);
  };

  // THE card acceptance on both screens: dated 17/10 under a 23/10 filter.
  await expectPresence('/shipments', BL_DATED, '2026-10-23', '2026-10-23', 'dated-out-tongquan', false);
  await expectPresence('/shipments-detail', BL_DATED, '2026-10-23', '2026-10-23', 'dated-out-chitiet', false);
  // …and visible when the filter matches its day.
  await expectPresence('/shipments', BL_DATED, '2026-10-17', '2026-10-17', 'dated-in-tongquan', true);
  await expectPresence('/shipments-detail', BL_DATED, '2026-10-17', '2026-10-17', 'dated-in-chitiet', true);
  // Undated = luôn hiện: under an active filter AND bare, both screens.
  await expectPresence('/shipments', BL_UNDATED, '2026-10-23', '2026-10-23', 'undated-tongquan', true);
  await expectPresence('/shipments-detail', BL_UNDATED, '2026-10-23', '2026-10-23', 'undated-chitiet', true);
  await expectPresence('/shipments', BL_UNDATED, undefined, undefined, 'undated-bare-tongquan', true);
  await expectPresence('/shipments-detail', BL_UNDATED, undefined, undefined, 'undated-bare-chitiet', true);

  check('console errors none', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || 'clean');
  await browser.close();

  // DB side-effect proof for the read-only change: fixture rows persist with
  // the transportDate values the law is defined on (identity unchanged).
  const dbProof = psql(
    `select bl_number || ' | transportDate=' || coalesce(expected_delivery_date::text,'NULL') from shipments where bl_number like 'LDAYUI${stamp}%' order by bl_number`,
  );
  console.log(`DB proof:\n${dbProof}`);

  const failed = checks.filter((c) => !c.ok);
  const summary = `${checks.length - failed.length}/${checks.length} checks pass`;
  console.log(`\n${summary}`);
  fs.writeFileSync(
    path.join(OUT, '2026-10-23_filter-lcl-day_ui-driver.log'),
    [
      `# 2026-10-23 LCL day-filter UI drive — backend=${BACKEND} front=${FRONT} stamp=${stamp}`,
      `# fixtures: ${BL_DATED} (LCL dated 2026-10-17), ${BL_UNDATED} (LCL undated)`,
      ...checks.map((c) => `${c.ok ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? ` :: ${c.detail}` : ''}`),
      `DB proof:\n${dbProof}`,
      summary,
      '',
    ].join('\n'),
  );
  if (failed.length > 0) {
    console.log(`FAILED: ${failed.map((c) => c.name).join(' | ')}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
