/**
 * Read-only probes for the two cards still open on staging:
 *   card 071026141610 — /users stat tiles ("Nhân sự văn phòng" / "Bị khoá · Ngưng"
 *                       were reported as carrying no number)
 *   card 071026141600 — /fleet-productivity "% Năng suất cao" cell / header
 *
 * Dumps the rendered DOM only; asserts nothing. A probe that cannot fail is
 * honest about "look, here is what the page actually shows" and never invents
 * a verdict. Run with EXPECT_SHA to pin the build.
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

const token = (await (await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
})).json()).token;

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1100 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  // ── /users stat tiles ──
  await page.goto(BASE + '/users', { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(6000);
  const users = await page.evaluate(() => {
    const rail = document.querySelector('.summary-rail');
    const tiles = rail
      ? [...rail.querySelectorAll('.summary-rail__item')].map((it) => ({
          label: (it.querySelector('dt')?.textContent || '').trim(),
          value: (it.querySelector('dd')?.textContent || '').trim(),
        }))
      : null;
    return { hasRail: !!rail, tiles };
  });
  log('users-summary-rail', users);
  await page.screenshot({ path: `${QA}/${SCOPE}-card071026141610-users-rail.png` });

  // Same read straight from the API the page uses, for comparison.
  const counts = await fetch(API + '/auth/users?page=1&limit=10', { headers: { Authorization: `Bearer ${token}` } })
    .then((r) => r.json()).catch((e) => ({ error: String(e) }));
  log('users-api-counts', counts && typeof counts === 'object'
    ? { total: counts.total, staffCount: counts.staffCount, driverCount: counts.driverCount, inactiveCount: counts.inactiveCount }
    : counts);

  // ── /fleet/productivity "% Năng suất cao" ── (both tabs; route is /fleet/productivity)
  for (const tab of ['DAILY', 'MONTHLY']) {
    await page.goto(BASE + '/fleet/productivity', { waitUntil: 'networkidle2', timeout: 90000 });
    await sleep(7000);
    // Real pointer tap on the tab control — no synthetic state poke.
    const tapped = await page.evaluate((wanted) => {
      const cands = [...document.querySelectorAll('button, [role="tab"], .ds-tabs__tab')]
        .filter((b) => /ngày|tháng/i.test(b.textContent || ''));
      const t = cands.find((b) => (wanted === 'DAILY' ? /ngày/i.test(b.textContent || '') : /tháng/i.test(b.textContent || '')));
      if (!t) return { found: false, labels: cands.map((c) => (c.textContent || '').trim()) };
      const box = t.getBoundingClientRect();
      return { found: true, label: (t.textContent || '').trim(), x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }, tab);
    log('tab-locate', { tab, ...tapped });
    if (tapped.found) {
      await page.mouse.click(tapped.x, tapped.y);
      await sleep(5000);
    }
    const fleet = await page.evaluate(() => {
      const wrap = document.querySelector('.fleet-productivity-table-wrap');
      const table = wrap?.querySelector('table');
      const ths = [...(table?.querySelectorAll('thead th') || [])];
      const lineBoxes = (el) => {
        const r = document.createRange();
        r.selectNodeContents(el);
        return r.getClientRects().length;
      };
      const wrapInfo = wrap ? { scrollWidth: wrap.scrollWidth, clientWidth: wrap.clientWidth, scrollable: wrap.scrollWidth > wrap.clientWidth } : null;
      const lastTh = ths[ths.length - 1];
      return {
        tableFound: !!table,
        headerCount: ths.length,
        pctHeaders: ths.filter((t) => /năng suất cao/i.test(t.textContent || '')).map((t) => ({
          text: (t.textContent || '').replace(/\s+/g, ' ').trim(),
          lineBoxes: lineBoxes(t),
          clipped: t.scrollWidth > t.clientWidth,
        })),
        lastHeader: lastTh ? {
          text: (lastTh.textContent || '').replace(/\s+/g, ' ').trim(),
          clipped: lastTh.scrollWidth > lastTh.clientWidth,
          lineBoxes: lineBoxes(lastTh),
        } : null,
        wrapInfo,
        pctCells: [...(table?.querySelectorAll('tbody td, tfoot td') || [])]
          .filter((td) => /%\s*$/.test((td.textContent || '').trim()))
          .slice(0, 8)
          .map((td) => ({ text: (td.textContent || '').trim(), lineBoxes: lineBoxes(td) })),
      };
    });
    log('fleet-productivity', { tab, ...fleet });
    await page.screenshot({ path: `${QA}/${SCOPE}-card071026141600-fleet-${tab.toLowerCase()}.png` });
  }
} catch (err) {
  log('driver-error', { message: String((err && err.message) || err).slice(0, 300) });
} finally {
  writeFileSync(`${QA}/${SCOPE}-open-cards-probe.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
}