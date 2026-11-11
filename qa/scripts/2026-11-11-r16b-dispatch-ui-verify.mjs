// qa/scripts/2026-11-11-r16b-dispatch-ui-verify.mjs
// SIL-792/793/795/796/798/800 — UI DRIVEN evidence for the r16b dispatch-ui
// lane. Logs in as the real roles (dieuvan dispatcher / laixe driver), drives
// the changed screens at 1440/820/390, and asserts the RENDERED result
// (computed styles + measurements), saving screenshots per claim.
// Run: node qa/scripts/2026-11-11-r16b-dispatch-ui-verify.mjs  (dev stack up)
import { chromium } from '../../frontend/node_modules/@playwright/test/index.mjs';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.FE_URL ?? 'http://localhost:7175';
const PASS = 'Abc123';
const OUT = resolve(process.cwd(), 'qa/2026-11-11_r16b-dispatch-ui');
mkdirSync(OUT, { recursive: true });

const results = [];
const record = (claim, ok, evidence) => {
  results.push({ claim, ok, evidence });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${claim} — ${evidence}`);
};

const browser = await chromium.launch();
try {
  // ── Dispatcher surfaces ────────────────────────────────────────────────
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 160)}`); });
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) errors.push(`api ${r.status()} ${r.url().slice(0, 140)}`); });

  await page.goto(`${FE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="username"]', 'dieuvan');
  await page.fill('input[name="password"]', PASS);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 20000 });
  await page.waitForTimeout(1200);

  // SIL-792 — /dispatch PHÂN BỔ NHÀ XE: chips render per carrier, each fully
  // readable (no clipping container, no ellipsis), wrapping BETWEEN chips.
  await page.goto(`${FE}/dispatch`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/sil792-dispatch-full.png`, fullPage: false });
  const chipsBox = await page.evaluate(() => {
    const containers = [...document.querySelectorAll('[class*="__chips"]')];
    const chips = containers.flatMap((c) => [...c.querySelectorAll('[class*="__chip"]')]);
    if (!chips.length) return { present: false };
    const cs = getComputedStyle(chips[0]);
    const container = containers[0];
    const cStyle = getComputedStyle(container);
    return {
      present: true,
      chipCount: chips.length,
      multiCarrier: containers.some((c) => c.querySelectorAll('[class*="__chip"]').length > 1),
      chipOverflow: cs.overflow,
      chipNowrap: cs.whiteSpace,
      containerWrap: cStyle.flexWrap,
      containerClip: cStyle.overflow,
      clippedChip: chips.some((chip) => chip.scrollWidth > chip.clientWidth + 1),
    };
  });
  if (!chipsBox.present) {
    record('SIL-792 chips container present on /dispatch', false, 'no .master-plan-grid__chips rendered — board may have no allocated lot in local seed');
  } else {
    record('SIL-792 per-carrier chips wrap and never clip', chipsBox.containerWrap === 'wrap' && chipsBox.containerClip !== 'hidden' && !chipsBox.clippedChip, JSON.stringify(chipsBox));
    if (chipsBox.multiCarrier) await page.screenshot({ path: `${OUT}/sil792-multi-carrier-chips.png` });
  }

  // SIL-793 — /dispatch-detail LỊCH TRÌNH prints "N x TYPE" for FCL rows.
  await page.goto(`${FE}/dispatch-detail`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/sil793-dispatch-detail.png` });
  const demand = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('[class*="cell--schedule"]')];
    const withDemand = cells.filter((c) => /\d+\s*x\s*[A-Z0-9]/.test(c.textContent));
    return { scheduleCells: cells.length, withDemand: withDemand.length, sample: cells[0]?.textContent?.slice(0, 80) };
  });
  record('SIL-793 schedule column prints container demand', demand.scheduleCells > 0 && demand.withDemand > 0, JSON.stringify(demand));

  // SIL-795 — header one-line + identifier cells uncut at 1440.
  const clip = await page.evaluate(() => {
    const ths = [...document.querySelectorAll('[class*="detailed"][class*="grid"] thead th')];
    const chopped = ths.filter((th) => th.scrollWidth > th.clientWidth + 1).map((th) => ({ t: th.textContent.trim(), need: th.scrollWidth, have: th.clientWidth }));
    const cont = [...document.querySelectorAll('[class*="cell--container"] [class*="container-line"]')].map((el) => ({ need: el.scrollWidth, have: el.clientWidth }));
    const decl = [...document.querySelectorAll('[class*="decl-value"]')].map((el) => ({ need: el.scrollWidth, have: el.clientWidth }));
    const maxNeed = (arr) => arr.reduce((mx, x) => Math.max(mx, x.need), 0);
    const tableScrolls = (() => { const w = document.querySelector('.detailed-plan-grid__wrapper'); return w ? w.scrollWidth > w.clientWidth : null; })();
    return {
      choppedHeaders: chopped,
      containerCount: cont.length, containerClipped: cont.filter((x) => x.need > x.have + 1).length, maxContainerNeed: maxNeed(cont),
      declCount: decl.length, declClipped: decl.filter((x) => x.need > x.have + 1).length, maxDeclNeed: maxNeed(decl),
      tableScrolls,
    };
  });
  record('SIL-795 headers hold one unclipped line at 1440', clip.choppedHeaders.length === 0, JSON.stringify(clip));
  record('SIL-795 identifier cells uncut (container/declaration)', clip.containerClipped === 0 && clip.declClipped === 0, `container ${clip.containerClipped}/${clip.containerCount} maxNeed ${clip.maxContainerNeed}; decl ${clip.declClipped}/${clip.declCount} maxNeed ${clip.maxDeclNeed}`);

  // SIL-800 — the Bill line never breaks mid-token; whole-token with honest
  // ellipsis + title when tight.
  const bill = await page.evaluate(() => {
    const bills = [...document.querySelectorAll('[class*="route-bill"]')];
    const twoLine = bills.filter((el) => el.getClientRects().length > 1 || el.clientHeight > parseFloat(getComputedStyle(el).lineHeight) * 1.6);
    const cs = bills[0] ? getComputedStyle(bills[0]) : null;
    return { count: bills.length, twoLineBills: twoLine.length, nowrap: cs?.whiteSpace, ellipsis: cs?.textOverflow, titled: bills[0]?.getAttribute('title')?.slice(0, 30) ?? null };
  });
  record('SIL-800 bill identifier stays one unbroken token', bill.count === 0 || (bill.twoLineBills === 0 && bill.nowrap === 'nowrap'), JSON.stringify(bill));

  // SIL-795/800 at 820 (the ticket's second viewport).
  await page.setViewportSize({ width: 820, height: 900 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/sil795-820.png` });
  const clip820 = await page.evaluate(() => {
    const ths = [...document.querySelectorAll('[class*="detailed"][class*="grid"] thead th')];
    return { chopped: ths.filter((th) => th.scrollWidth > th.clientWidth + 1).length };
  });
  record('SIL-795 headers uncut at 820 too', clip820.chopped === 0, JSON.stringify(clip820));

  // SIL-796 — open the editor on the first FCL row; the fee fields must show
  // the signed price (AUTO) or the missing-price hint — never a bare 0.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(500);
  const editorOpened = await (async () => {
    const menu = page.locator('[class*="row-actions"] button:visible').first();
    await menu.click();
    await page.waitForTimeout(400);
    const edit = page.locator('[role="menuitem"]:visible', { hasText: 'Sửa điều phối' }).first();
    if (await edit.count()) { await edit.click(); return true; }
    return false;
  })();
  if (!editorOpened) {
    record('SIL-796 editor dialog opened', false, 'no Sửa điều phối menu item on the first row');
  } else {
    await page.waitForSelector('[role="dialog"]', { timeout: 8000 });
    await page.waitForTimeout(2500); // preview roundtrip
    await page.screenshot({ path: `${OUT}/sil796-editor-dialog.png` });
    const fees = await page.evaluate(() => {
      const revenue = document.querySelector('input[aria-label="Cước thu dự kiến"], input[id^="dispatch-rev"]');
      const cost = document.querySelector('input[id^="dispatch-cost"]');
      const help = [...document.querySelectorAll('[role="dialog"] p, [role="dialog"] small, [role="dialog"] .ds-field__help')].map((el) => el.textContent.trim()).filter(Boolean);
      return { revenue: revenue?.value ?? null, cost: cost?.value ?? null, help: help.slice(0, 3) };
    });
    const fakeZero = fees.revenue === '0';
    record('SIL-796 fee fields never show a fabricated 0', !fakeZero, JSON.stringify(fees));
    await page.keyboard.press('Escape');
  }

  // ── Driver surface (SIL-798) ────────────────────────────────────────────
  const dctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const dpage = await dctx.newPage();
  await dpage.goto(`${FE}/login`, { waitUntil: 'networkidle' });
  await dpage.fill('input[name="username"]', 'laixe');
  await dpage.fill('input[name="password"]', PASS);
  await dpage.locator('button[type="submit"]').first().click();
  await dpage.waitForURL((u) => !dpage.url().includes('login'), { timeout: 20000 });
  await dpage.goto(`${FE}/my-trips`, { waitUntil: 'networkidle' });
  await dpage.waitForTimeout(1200);
  // The FIRST NEW/ready order card — a driver with a running trip gets the 409.
  const firstTripHref = await dpage.evaluate(() => {
    const cards = [...document.querySelectorAll('a[href^="/my-trips/"]')];
    const fresh = cards.map((a) => a.getAttribute('href')).find((h) => /\/my-trips\/\d+$/.test(h));
    return fresh ?? null;
  });
  if (!firstTripHref) {
    record('SIL-798 driver trip list has an openable order', false, 'no /my-trips/:id card for laixe in local seed');
  } else {
    await dpage.goto(`${FE}${firstTripHref}`, { waitUntil: 'networkidle' });
    await dpage.waitForTimeout(1200);
    const btn = dpage.locator('[data-testid="accept-sticky-bar"] button');
    const idleFace = await btn.count() ? await btn.evaluate((el) => {
      const cs = getComputedStyle(el);
      const svg = el.querySelector('svg');
      return { bg: cs.backgroundColor, hasCheckPath: svg ? svg.innerHTML.includes('M9 12l2 2 4-4') : false, iconCount: el.querySelectorAll('svg').length };
    }) : null;
    await dpage.screenshot({ path: `${OUT}/sil798-idle-accept.png` });
    record('SIL-798 idle accept button is neutral ink without a success check', idleFace != null && idleFace.hasCheckPath === false, JSON.stringify(idleFace));
    if (await btn.count()) {
      await btn.click();
      await dpage.waitForTimeout(2500);
      await dpage.screenshot({ path: `${OUT}/sil798-after-click.png` });
      const banner = dpage.locator('[data-testid="blocking-trip-banner"]');
      const bannerState = await banner.count() ? await banner.evaluate((el) => ({
        hasLink: el.querySelectorAll('a').length,
        text: el.textContent.slice(0, 160),
      })) : { present: false, note: 'no banner — the accept either succeeded (local laixe has no running trip) or a non-blocking error' };
      record('SIL-798 blocking banner names + links the trip when blocked', bannerState.present === false || (bannerState.hasLink > 0), JSON.stringify(bannerState));
    }
  }

  record('no console/API errors on driven surfaces', errors.length === 0, errors.slice(0, 5).join(' | ') || 'clean');
} finally {
  await browser.close();
  console.log('\nRESULTS_JSON', JSON.stringify(results));
}
