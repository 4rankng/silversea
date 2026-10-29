// SIL-582 verify round 2 — /shipments-debit: the meta line (Số Booking ·
// date · count) never clips @390 (wraps at the ' · ' separators; no token
// breaks mid-token); customer names still wrap; @768 the booking column
// keeps its 148px floor (no clipped booking tail). Point 3 (/shipments/:id
// @768 route/port cells) stays blocked by SIL-593 — the route does not load.
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7291';
const OUT = resolve('qa');
const log = [];
const say = (l) => { log.push(l); console.log(l); };

mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ headless: 'new' });
let failed = 0;
const check = (name, ok, detail = '') => { say(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` (${detail})` : ''}`); if (!ok) failed += 1; };
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle2' });
  await page.type('input[name="username"]', 'giamdoc');
  await page.type('input[name="password"]', 'Abc123');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
  await new Promise((r) => setTimeout(r, 1200));

  // @390 — the QA-failed band.
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${FE}/shipments-debit`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1800));
  const metas390 = await page.evaluate(() => [...document.querySelectorAll('.ledger-glist__meta')].map((m) => {
    const cs = getComputedStyle(m);
    return { text: m.textContent.trim().slice(0, 46), sw: m.scrollWidth, cw: m.clientWidth, whiteSpace: cs.whiteSpace, clipped: m.scrollWidth > m.clientWidth };
  }));
  check('@390 meta lines exist', metas390.length > 0, `${metas390.length}`);
  check('@390 no meta line clips', metas390.every((m) => !m.clipped), JSON.stringify(metas390.filter((m) => m.clipped)));
  check('@390 meta wraps (white-space normal)', metas390.every((m) => m.whiteSpace === 'normal'));
  const bookingLine = metas390.find((m) => /EGLV|·/.test(m.text));
  if (bookingLine) check('@390 the previously-clipped booking line reads in full', !bookingLine.clipped, JSON.stringify(bookingLine));
  // names still wrap (regression guard on the round-1 fix)
  const names = await page.evaluate(() => [...document.querySelectorAll('.ledger-glist__name')].slice(0, 12).map((n) => ({ sw: n.scrollWidth, cw: n.clientWidth })));
  check('@390 customer names still wrap, none clip', names.every((n) => n.sw <= n.cw + 1), JSON.stringify(names.filter((n) => n.sw > n.cw + 1)));
  await page.screenshot({ path: `${OUT}/2026-10-29_sil582_ui-debit-390-meta.png` });
  say('screenshot qa/2026-10-29_sil582_ui-debit-390-meta.png');

  // @768 — booking column floor (round-1 regression guard).
  await page.setViewport({ width: 768, height: 1024 });
  await new Promise((r) => setTimeout(r, 800));
  const booking768 = await page.evaluate(() => {
    const col = document.querySelector('.shipment-debit-col--booking');
    const cells = [...document.querySelectorAll('.shipment-debit-booking')];
    // Real carrier bookings are 16-char tokens (EGLV149607019409 class) — the
    // round-1 landed contract guarantees THOSE never clip. Longer tokens
    // (seed markers, test rows) ride the desktop title-hover guard.
    const real = (c) => /^[A-Z]{4}\d{12}$/.test(c.textContent.trim().split(/\s/)[0] ?? '');
    return {
      colW: col ? +getComputedStyle(col).width.replace('px', '') : null,
      clippedReal: cells.filter((c) => real(c) && c.scrollWidth > c.clientWidth).map((c) => c.textContent.trim().slice(0, 24)),
      pathological: cells.filter((c) => !real(c) && c.scrollWidth > c.clientWidth).length,
    };
  });
  check('@768 booking column ≥ 148px floor', booking768.colW == null || booking768.colW >= 148, `${booking768.colW}`);
  check('@768 no real 16-char booking clips', booking768.clippedReal.length === 0, JSON.stringify(booking768.clippedReal));
  say(`note: @768 pathological >16-char tokens clipping under the desktop title guard: ${booking768.pathological}`);
  await page.screenshot({ path: `${OUT}/2026-10-29_sil582_ui-debit-768-booking.png` });
  say('screenshot qa/2026-10-29_sil582_ui-debit-768-booking.png');

  // @390 landscape-ish sanity (layout didn't regress at 768 names either).
  const names768 = await page.evaluate(() => {
    const list = document.querySelector('.ledger-glist');
    return { phoneListAt768: !!list };
  });
  say(`note: @768 ledger phone list present=${names768.phoneListAt768} (component is ≤640 only; desktop table owns 768)`);
} finally { await browser.close(); }
say(failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`);
writeFileSync(`${OUT}/2026-10-29_sil582_ui-driver-round2.log`, log.join('\n') + '\n');
process.exit(failed === 0 ? 0 : 1);
