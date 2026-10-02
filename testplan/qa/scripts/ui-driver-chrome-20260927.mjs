// Driver app chrome QA driver — reusable (local dev or staging).
//
// Case: the driver phone chrome must stay compact. Two promises, both
// operator-reported (2026-09-27):
//   TC-DRIVER-CHROME-01  the green driver topbar is ONE row at phone width —
//                        identity · date chip · bell share a single line, and
//                        the chip carries no period range (compact).
//   TC-DRIVER-CHROME-02  the trip-detail completion sticky bar is subtle:
//                        the CTA holds the shared touch floor, not a raised
//                        cabin size, and its disabled face is a quiet
//                        surface — never the ink fill at 55% opacity.
//   TC-DRIVER-CHROME-03  the disabled face itself (forced, because a live run
//                        may land on an enabled trip): quiet surface, full
//                        opacity, no raised height.
//
// Usage:
//   BASE_URL=http://localhost:7175 node testplan/qa/scripts/ui-driver-chrome-20260927.mjs
//   STAGING_URL=https://vantai.tingting.vip WIDTHS=390,414,768 \
//     node testplan/qa/scripts/ui-driver-chrome-20260927.mjs
//
// Env: BASE_URL | STAGING_URL (target), QA_USER_LAIXE, PASSWORD,
//      WIDTHS (default 390,768), ROUTE (default /my-trips), TRIP_LINK (an
//      explicit /my-trips/<id> when the list has no openable row),
//      OUT_DIR, BROWSER_EXECUTABLE_PATH, HEADFUL=1.
// Evidence: testplan/qa/evidence/<stamp>_<pid>_driver-chrome/ (report.json + PNGs).
// Exit: 0 only when every assertion passes.
import puppeteer from 'puppeteer';
import fs from 'node:fs/promises';
import path from 'node:path';

const BASE = (process.env.BASE_URL || process.env.STAGING_URL || 'http://localhost:7175').replace(/\/$/, '');
const USER = process.env.QA_USER_LAIXE || 'laixe';
const PASS = process.env.PASSWORD || process.env.QA_PASS || 'Abc123';
const WIDTHS = (process.env.WIDTHS || '390,768').split(',').map((w) => Number(w.trim())).filter(Boolean);
const ROUTE = process.env.ROUTE || '/my-trips';
const TRIP_LINK = process.env.TRIP_LINK || '';
const RUN_ID = process.env.RUN_ID || `${new Date().toISOString().replace(/[:.]/g, '-')}_${process.pid}_driver-chrome`;
const DIR = process.env.OUT_DIR || path.resolve(process.cwd(), 'testplan/qa/evidence', RUN_ID);

await fs.mkdir(DIR, { recursive: true });
const lines = [];
const log = (msg, extra) => {
  const line = extra === undefined ? msg : `${msg} ${JSON.stringify(extra)}`;
  console.log(line);
  lines.push(line);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const record = (id, ok, detail) => {
  results.push({ id, verdict: ok ? 'PASS' : 'FAIL', detail });
  log(`${id} ${ok ? 'PASS' : 'FAIL'}`, detail);
};

const launch = { headless: process.env.HEADFUL !== '1', args: ['--no-sandbox'] };
if (process.env.BROWSER_EXECUTABLE_PATH) launch.executablePath = process.env.BROWSER_EXECUTABLE_PATH;
const browser = await puppeteer.launch(launch);

/** Probe the driver topbar: how many visual rows, what the chip renders. */
const probeTopbar = () => {
  const bar = document.querySelector('.topbar--driver');
  if (!bar) return null;
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const slots = [
    ['.topbar__left-driver', box(bar.querySelector('.topbar__left-driver'))],
    ['.topbar__center-driver', box(bar.querySelector('.topbar__center-driver'))],
    ['.topbar__actions', box(bar.querySelector('.topbar__actions'))],
  ].filter(([, b]) => b && b.w > 0);
  // Two slots share a visual row when their vertical ranges overlap — tops
  // differ even on one row because the row is centre-aligned and the slots
  // have different heights.
  const rows = new Set();
  for (const [, b] of slots) {
    let row = null;
    for (const r of rows) {
      const [, o] = r;
      if (Math.max(b.y, o.y) < Math.min(b.y + b.h, o.y + o.h)) { row = r; break; }
    }
    if (row) rows.add(row);
    else rows.add([b.y, b]);
  }
  const trigger = bar.querySelector('.topbar-date__trigger');
  const period = bar.querySelector('.topbar-date__period');
  const name = bar.querySelector('.topbar__welcome .name');
  const chip = bar.querySelector('.topbar-date');
  return {
    barH: Math.round(bar.getBoundingClientRect().height),
    rowCount: rows.size,
    slotTops: slots.map(([sel, b]) => ({ sel, y: b.y, w: b.w })),
    chipVisible: Boolean(chip && chip.getBoundingClientRect().width > 0),
    chipText: trigger ? trigger.textContent.replace(/\s+/g, ' ').trim() : null,
    chipAria: trigger ? trigger.getAttribute('aria-label') : null,
    chipTriggerH: trigger ? Math.round(trigger.getBoundingClientRect().height) : null,
    periodDisplay: period ? getComputedStyle(period).display : 'absent',
    nameClipped: name ? name.scrollWidth > name.clientWidth + 1 : null,
    fontSize: trigger ? getComputedStyle(trigger).fontSize : null,
  };
};

/** Probe the completion sticky bar: geometry + the computed disabled face. */
const probeSticky = () => {
  const bar = document.querySelector('.driver-task-complete-sticky');
  if (!bar) return { present: false };
  const btn = bar.querySelector('.driver-task-complete-sticky__btn');
  const status = bar.querySelector('.driver-task-complete-sticky__status');
  if (!btn) return { present: true, btn: null };
  const cs = getComputedStyle(btn);
  const r = btn.getBoundingClientRect();
  const sr = status ? status.getBoundingClientRect() : null;
  const nav = document.querySelector('.bottom-nav');
  return {
    present: true,
    disabled: btn.disabled,
    label: btn.textContent.replace(/\s+/g, ' ').trim(),
    btnH: Math.round(r.height),
    btnW: Math.round(r.width),
    radius: cs.borderRadius,
    fontWeight: cs.fontWeight,
    background: cs.backgroundColor,
    color: cs.color,
    opacity: cs.opacity,
    statusText: status ? status.textContent.trim() : null,
    statusFont: status ? getComputedStyle(status).fontSize : null,
    statusH: sr ? Math.round(sr.height) : null,
    barH: Math.round(bar.getBoundingClientRect().height),
    navTop: nav ? Math.round(nav.getBoundingClientRect().y) : null,
  };
};

try {
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') log('console-error', m.text().slice(0, 200)); });
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) log('api-error', `${r.status()} ${r.url()}`); });

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.type('input[name="username"]', USER, { delay: 12 });
  await page.type('input[name="password"]', PASS, { delay: 12 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await sleep(1500);
  const afterLogin = new URL(page.url()).pathname;
  if (afterLogin.includes('login')) throw new Error(`login failed for ${USER} @ ${BASE} (still at ${afterLogin})`);
  log('login ok', { user: USER, base: BASE, landed: afterLogin });

  for (const width of WIDTHS) {
    await page.setViewport({ width, height: 844, deviceScaleFactor: 2, isMobile: width <= 768, hasTouch: width <= 1024 });
    await page.goto(`${BASE}${ROUTE}`, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
    await sleep(1800);

    const topbar = await page.evaluate(probeTopbar);
    await page.screenshot({ path: `${DIR}/${width}_01-my-trips.png` });
    log(`TC-DRIVER-CHROME-01 @${width}`, topbar);

    if (!topbar) {
      record(`TC-DRIVER-CHROME-01@${width}`, false, 'driver topbar not found — is the session a DRIVER?');
    } else if (width <= 640) {
      const ok = topbar.rowCount === 1 && topbar.chipVisible && topbar.periodDisplay === 'none' && topbar.nameClipped === false;
      record(`TC-DRIVER-CHROME-01@${width}`, ok, {
        rows: topbar.rowCount, chip: topbar.chipText, period: topbar.periodDisplay, nameClipped: topbar.nameClipped, barH: topbar.barH,
      });
    } else {
      record(`TC-DRIVER-CHROME-01@${width}`, topbar.rowCount === 1, { rows: topbar.rowCount, chip: topbar.chipText, barH: topbar.barH });
    }

    // Candidates for a trip that renders the completion bar: the explicit
    // TRIP_LINK, then every deeper /my-trips/<digits> anchor on the current
    // route. The journey cards navigate from an onClick footer rather than an
    // anchor, so a card footer click is the last resort.
    const candidates = await page.evaluate((explicit) => {
      const out = explicit ? [explicit] : [];
      const here = location.pathname.replace(/\/$/, '');
      for (const a of document.querySelectorAll('main a[href^="/my-trips/"]')) {
        const p = (a.getAttribute('href') || '').split('?')[0].replace(/\/$/, '');
        if (p.startsWith(here + '/') && /\/\d+$/.test(p) && !out.includes(p)) out.push(p);
      }
      return out;
    }, TRIP_LINK);

    let sticky = { present: false };
    let opened = null;

    /** Probe the current page for the completion bar (after scrolling down). */
    const probeHere = async (label) => {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await sleep(600);
      const probe = await page.evaluate(probeSticky);
      if (probe.present) { sticky = probe; opened = label; return true; }
      if (await page.$('[data-testid="accept-sticky-bar"]')) {
        log(`  @${width} ${label}: accept bar is up (trip not yet received) — trying the next trip`);
      }
      return false;
    };

    const openCandidate = async (href) => {
      await page.goto(`${BASE}${href}`, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
      await sleep(1500);
      return probeHere(href);
    };

    // 1) an explicit TRIP_LINK, 2) deeper /my-trips/<id> anchors, 3) journey
    // cards for each tab (the board opens on Lệnh mới; the completion bar
    // only exists on an ACCEPTED trip, so Đã nhận leads).
    for (const cand of candidates.slice(0, 4)) {
      if (await openCandidate(cand)) break;
    }

    if (!sticky.present) {
      const tabLabels = await page.evaluate(() => [...document.querySelectorAll('main [role="tab"], main .ds-tabs__btn')]
        .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean));
      // Labels carry a count badge ("Đã nhận2"): match on the text prefix.
      const tabs = [process.env.TAB || 'Đã nhận', ...tabLabels].filter((v, i, a) => v && a.indexOf(v) === i);
      for (const tab of tabs) {
        if (sticky.present) break;
        const clickTab = async () => page.evaluate((label) => {
          const hit = [...document.querySelectorAll('main [role="tab"], main .ds-tabs__btn')]
            .find((el) => (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase().startsWith(label.toLowerCase()));
          if (hit) hit.click();
          return Boolean(hit);
        }, tab);
        await page.goto(`${BASE}${ROUTE}`, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
        await sleep(1200);
        const clicked = await clickTab();
        if (!clicked) continue;
        await sleep(1200);
        const cards = await page.$$('main [class*="driver-journey-card__footer"]');
        log(`  @${width} tab "${tab}": ${cards.length} journey card(s)`);
        for (let i = 0; i < Math.min(cards.length, 4); i += 1) {
          await page.goto(`${BASE}${ROUTE}`, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
          await sleep(1000);
          await clickTab();
          await sleep(900);
          const again = await page.$$('main [class*="driver-journey-card__footer"]');
          if (!again[i]) continue;
          await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
            again[i].click({ delay: 10 }),
          ]);
          await sleep(1500);
          if (await probeHere(new URL(page.url()).pathname)) break;
        }
      }
    }

    if (!sticky.present) {
      log(`TC-DRIVER-CHROME-02 @${width} : no completion sticky bar reachable from ${ROUTE}`);
      record(`TC-DRIVER-CHROME-02@${width}`, false, 'no trip with a completion sticky bar reachable — pass TRIP_LINK=/my-trips/<id>');
      continue;
    }

    await page.screenshot({ path: `${DIR}/${width}_02-trip-detail.png` });
    log(`TC-DRIVER-CHROME-02 @${width} ${opened}`, sticky);

    // Subtle = shared touch floor, striped of the raised cabin size, and a
    // quiet (non-ink) disabled face.
    const heightOk = sticky.btnH <= 46;
    const radiusOk = sticky.radius === '8px';
    const weightOk = sticky.fontWeight === '600';
    const disabledQuiet = !sticky.disabled
      || (!sticky.background.startsWith('rgb(15, 23, 42') && sticky.opacity === '1');
    const statusQuiet = (sticky.statusFont ?? '0px') === '11px';
    record(`TC-DRIVER-CHROME-02@${width}`, heightOk && radiusOk && weightOk && disabledQuiet && statusQuiet, {
      btnH: sticky.btnH, radius: sticky.radius, weight: sticky.fontWeight,
      background: sticky.background, opacity: sticky.opacity, disabled: sticky.disabled,
      statusFont: sticky.statusFont, statusText: sticky.statusText, barH: sticky.barH,
    });

    // The disabled face is the one the operator screenshotted (a live run may
    // land on an enabled trip), so force `disabled` for the visual assertion —
    // labelled in the evidence, it proves the disabled CSS, not a trip state.
    const face = await page.evaluate(() => {
      const btn = document.querySelector('.driver-task-complete-sticky__btn');
      if (!btn) return null;
      const wasDisabled = btn.disabled;
      btn.disabled = true;
      const cs = getComputedStyle(btn);
      return {
        forced: !wasDisabled,
        background: cs.backgroundColor,
        color: cs.color,
        border: cs.borderColor,
        opacity: cs.opacity,
        btnH: Math.round(btn.getBoundingClientRect().height),
      };
    });
    await page.screenshot({ path: `${DIR}/${width}_03-disabled-face.png` });
    log(`TC-DRIVER-CHROME-03 @${width}`, face);
    record(`TC-DRIVER-CHROME-03@${width}`, Boolean(face)
      && !face.background.startsWith('rgb(15, 23, 42')
      && face.opacity === '1'
      && face.btnH <= 46, face);
  }
} catch (error) {
  record('RUN', false, `aborted: ${error.message}`);
} finally {
  await browser.close();
}

const failed = results.filter((r) => r.verdict !== 'PASS');
await fs.writeFile(`${DIR}/report.json`, JSON.stringify({ base: BASE, user: USER, widths: WIDTHS, route: ROUTE, results }, null, 2));
await fs.writeFile(`${DIR}/driver.log`, lines.join('\n') + '\n');
log(`evidence: ${DIR}`);
console.log(failed.length ? `FAIL — ${failed.length}/${results.length} assertion(s) failed` : `PASS — ${results.length}/${results.length} assertions`);
process.exit(failed.length ? 1 : 0);
