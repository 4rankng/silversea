/**
 * Card 071026141610 — stat-card census evidence on staging for all three
 * pages the card named, as the role QA used.
 *
 * /suppliers + /customers were fixed (ACCOUNTANT authz; whole-dataset
 * customers census). /users was left open because the API looked healthy.
 * This reads the RENDERED DOM for each so the evidence is what a person
 * actually sees, not what the API promised.
 */
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const BASE = process.env.BASE || 'https://vantai.tingting.vip';
const SCOPE = process.argv[2] || 'staging';
const EXPECT_SHA = process.env.EXPECT_SHA || '';
const API = BASE.replace(/\/$/, '') + '/api';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const LOG = [];
const log = (s, o) => { const e = { at: new Date().toISOString(), step: s, ...o }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const health = await fetch(API + '/health').then((r) => r.json()).catch(() => ({}));
log('health', { buildHash: health.buildHash, expect: EXPECT_SHA || '(any)' });
if (EXPECT_SHA && !String(health.buildHash || '').startsWith(EXPECT_SHA)) {
  log('build-mismatch-FAIL', { got: health.buildHash, want: EXPECT_SHA });
  process.exit(2);
}

async function tokenFor(identifier) {
  const r = await fetch(API + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  }).then((x) => x.json());
  return r.token ? { identifier, token: r.token } : { identifier, error: r.error || 'no token' };
}

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  // ── Kế toán (the role QA used) on the two pages that were broken ──
  const acct = await tokenFor('hoapt');
  log('login', { role: 'ACCOUNTANT(hoapt)', ok: !!acct.token, error: acct.error });
  if (acct.token) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1100 });
    await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), acct.token);

    for (const path of ['/suppliers', '/customers']) {
      await page.goto(BASE + path, { waitUntil: 'networkidle2', timeout: 90000 });
      await sleep(7000);
      const scan = await page.evaluate(() => {
        // Filter pills: label + optional count. A pill with NO count span is
        // the exact defect the card reported.
        const pills = [...document.querySelectorAll('.ds-tabs__item, [class*="tabs"] > *')]
          .map((n) => {
            const label = (n.querySelector('.ds-tabs__label')?.textContent || n.querySelector('[class*="label"]')?.textContent || '').trim();
            const countEl = n.querySelector('.ds-tabs__count, [class*="count"]');
            return { label, count: countEl ? (countEl.textContent || '').trim() : null };
          })
          .filter((p) => p.label);
        const kpi = [...document.querySelectorAll('[class*="stat"], [class*="kpi"], .card')]
          .map((c) => (c.textContent || '').replace(/\s+/g, ' ').trim())
          .filter((t) => /Không thể tải số liệu/i.test(t));
        return {
          pills,
          pillsMissingCount: pills.filter((p) => p.count === null).map((p) => p.label),
          errorTiles: kpi,
        };
      });
      log('page', { path, role: 'ACCOUNTANT', ...scan });
      await page.screenshot({ path: `${QA}/${SCOPE}-card071026141610-${path.slice(1)}-accountant.png` });
    }
  }

  // ── Admin on /users ──
  const admin = await tokenFor('admin');
  log('login', { role: 'ADMIN(admin)', ok: !!admin.token, error: admin.error });
  if (admin.token) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1100 });
    await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), admin.token);
    await page.goto(BASE + '/users', { waitUntil: 'networkidle2', timeout: 90000 });
    await sleep(7000);
    const scan = await page.evaluate(() => {
      const rail = document.querySelector('.summary-rail');
      const tiles = rail
        ? [...rail.querySelectorAll('.summary-rail__item')].map((it) => ({
            label: (it.querySelector('dt')?.textContent || '').trim(),
            value: (it.querySelector('dd')?.textContent || '').trim(),
          }))
        : null;
      return { hasRail: !!rail, tiles, tilesMissingValue: tiles ? tiles.filter((t) => t.value === '').map((t) => t.label) : [] };
    });
    log('page', { path: '/users', role: 'ADMIN', ...scan });
    await page.screenshot({ path: `${QA}/${SCOPE}-card071026141610-users-admin.png` });
  }
} catch (err) {
  log('driver-error', { message: String((err && err.message) || err).slice(0, 300) });
} finally {
  writeFileSync(`${QA}/${SCOPE}-card071026141610-statcards.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
}