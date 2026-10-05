// Card 20261005_364 (REQ-05) STAGING rung — the driver "SĐT kho" (Thông tin
// lệnh) must be a real tap-to-call control. Runs against the deployed staging
// build (buildHash gate is HARD: a verdict on a stale build is a false verdict).
//
// Shape (mirrors rung-364-tel.mjs + the agent-browser pitfalls notes):
//   - token injection (API login from node, localStorage), ONE goto per state
//   - a FRESH browser per state so trusted-mouse rot cannot poison the rung
//   - real pointer taps (mouse move -> down -> up) with hit-testing, via
//     lead-qa-lib's `tap` (throws when zero trusted events reach the document)
//   - full-page 390x844 screenshot per state + a row closeup, so a clipped
//     control would be visible
//
// Env: QA_BASE (default staging), IDENTIFIER (default dvthuc), PASSWORD,
//      OUT_DIR, EXPECT_BUILD (default 19ed100f), TRIP_WITH_PHONE, TRIP_EMPTY,
//      STATES (default "with,empty").
import { launch, tap, probe, shot } from './lead-qa-lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.QA_BASE || 'https://vantai.tingting.vip';
const IDENTIFIER = process.env.IDENTIFIER || 'dvthuc';
const PASSWORD = process.env.PASSWORD || 'Abc123';
const EXPECT_BUILD = process.env.EXPECT_BUILD || '19ed100f';
const OUT = process.env.OUT_DIR || 'testplan/qa/evidence/2026-10-05_364-sdt-kho-tap-de-goi/staging';
const STATES = (process.env.STATES || 'with,empty').split(',').map((s) => s.trim()).filter(Boolean);
const RUN_TAG = process.env.RUN_TAG || 'main';
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });

const json = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };

// ---- hard build-currency gate ------------------------------------------------
const health = await json(await fetch(`${BASE}/api/health`));
const buildHash = health?.buildHash ?? null;
console.log(`HEALTH status=${health?.status} buildHash=${buildHash} expected=${EXPECT_BUILD}`);
if (buildHash !== EXPECT_BUILD) {
  writeFileSync(`${OUT}/build-gate.json`, JSON.stringify({ ok: false, buildHash, expected: EXPECT_BUILD, health }, null, 2));
  console.error(`BLOCKED: staging buildHash=${buildHash} != ${EXPECT_BUILD} — not scoring a stale build`);
  process.exit(2);
}

// ---- login + data discovery (read-only) --------------------------------------
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: IDENTIFIER, password: PASSWORD }),
});
if (!login.ok) throw new Error(`login failed ${login.status}`);
const { token, user } = await login.json();
const H = { Authorization: `Bearer ${token}` };

const board = await json(await fetch(`${BASE}/api/driver/me/journey-board`, { headers: H }));
const items = board?.items ?? [];
const details = [];
for (const it of items) {
  if (!it.fulfillmentId) { details.push({ tripId: it.tripId, fulfillmentId: null, khoPhone: null, reachable: false }); continue; }
  const d = await json(await fetch(`${BASE}/api/driver/me/fulfillments/${it.fulfillmentId}`, { headers: H }));
  details.push({
    tripId: it.tripId, fulfillmentId: it.fulfillmentId, code: it.tripCode, bucket: it.bucket,
    khoPhone: d.khoPhone ?? null, factoryContacts: (d.factoryContacts ?? []).length,
    contactPhone: d.contactPhone ?? null, factoryShortName: d.factoryShortName ?? null,
    reachable: true,
  });
}
console.log('board items', items.length, 'details', JSON.stringify(details));

const pickWith = process.env.TRIP_WITH_PHONE
  ? details.find((d) => String(d.tripId) === String(process.env.TRIP_WITH_PHONE))
  : details.find((d) => d.khoPhone && d.reachable);
const pickEmpty = process.env.TRIP_EMPTY
  ? details.find((d) => String(d.tripId) === String(process.env.TRIP_EMPTY))
  : details.find((d) => !d.khoPhone && d.reachable);
console.log('pickWith', JSON.stringify(pickWith), 'pickEmpty', JSON.stringify(pickEmpty));

// ---- per-state rung -----------------------------------------------------------
const results = { buildHash, base: BASE, identifier: IDENTIFIER, user, board: details, states: {} };

const STATE_TRIP = {
  with: pickWith,
  whitespace: pickWith,      // same trip, fixture phone carries whitespace (proves href strip)
  empty: pickEmpty,
};

const khoState = async (page) => page.evaluate(() => {
  const facts = [...document.querySelectorAll('.driver-task-fact')];
  const kho = facts.find((f) => (f.querySelector('.driver-task-fact__label')?.textContent || '').trim() === 'SĐT kho');
  const valueEl = kho?.querySelector('.driver-task-fact__value');
  const link = valueEl?.querySelector('a');
  return {
    khoRowPresent: Boolean(kho),
    label: (kho?.querySelector('.driver-task-fact__label')?.textContent || '').trim() || null,
    valueText: (valueEl?.textContent || '').trim() || null,
    linkHref: link?.getAttribute('href') ?? null,
    linkText: (link?.textContent || '').trim() || null,
    linkClass: link ? (link.className || '').toString() : null,
    valueHasLink: Boolean(link),
    rowLabels: facts.map((f) => (f.querySelector('.driver-task-fact__label')?.textContent || '').trim()),
    dialogs: document.querySelectorAll('[role="dialog"]').length,
    telLinks: [...document.querySelectorAll('a[href^="tel:"]')].map((a) => ({
      href: a.getAttribute('href'), text: (a.textContent || '').trim().slice(0, 30), cls: (a.className || '').toString().slice(0, 60),
    })),
    callBarText: (document.querySelector('.driver-task-call-bar')?.textContent || '').trim() || null,
    viewport: { w: window.innerWidth, h: window.innerHeight },
  };
});

const scrollRowIntoView = async (page) => {
  await page.evaluate(() => {
    const facts = [...document.querySelectorAll('.driver-task-fact')];
    const kho = facts.find((f) => (f.querySelector('.driver-task-fact__label')?.textContent || '').trim() === 'SĐT kho');
    const scroller = document.querySelector('main.app-body') || document.scrollingElement;
    if (kho && scroller) {
      const r = kho.getBoundingClientRect();
      const target = scroller.scrollTop + r.top - scroller.clientHeight / 2 + r.height / 2;
      scroller.scrollTop = Math.max(0, target);
    }
  });
  await settle(1200); // settle the scroll baseline before measuring (pitfall note)
};

const rowBox = async (page) => page.evaluate(() => {
  const facts = [...document.querySelectorAll('.driver-task-fact')];
  const kho = facts.find((f) => (f.querySelector('.driver-task-fact__label')?.textContent || '').trim() === 'SĐT kho');
  if (!kho) return null;
  const r = kho.getBoundingClientRect();
  return { x: 0, y: Math.max(0, r.top + window.scrollY - 40), width: 390, height: Math.ceil(r.height + 80) };
});

const runState = async (name) => {
  const pick = STATE_TRIP[name];
  if (!pick) { results.states[name] = { ok: false, error: 'no candidate trip for this state' }; console.log(name, 'NO TRIP'); return; }
  const { browser, page } = await launch({ width: 390, height: 844, base: BASE });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text().slice(0, 200)}`); });
  try {
    await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await page.goto(`${BASE}/my-trips/${pick.tripId}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await settle(3500);
    // Expand Thông tin lệnh if collapsed (it defaults expanded).
    await page.evaluate(() => {
      const tg = document.querySelector('[data-testid="task-section-toggle-driver-task-info-grid"]');
      if (tg && tg.getAttribute('aria-expanded') === 'false') tg.click();
    });
    await settle(600);
    await scrollRowIntoView(page);

    const dom = await khoState(page);
    const shotFull = `${OUT}/${name}-fullpage-390x844.png`;
    await shot(page, shotFull, { full: true });
    const box = await rowBox(page);
    const shotRow = `${OUT}/${name}-row-closeup.png`;
    if (box) await page.screenshot({ path: shotRow, clip: box, captureBeyondViewport: true });

    // Real trusted tap on the SĐT kho VALUE (the link when present).
    const tapSel = dom.valueHasLink ? '.driver-task-fact__value a[href^="tel:"]' : null;
    const tapTarget = tapSel || '.driver-task-fact__value';
    let tapResult = null; let tapError = null; let urlBefore = page.url(); let dialogBefore = dom.dialogs;
    try {
      const t = await tap(page, tapSel ? `${tapSel}` : '.driver-task-fact__value', { expectEvent: true });
      tapResult = { target: tapTarget, cx: t.cx, cy: t.cy, hit: t.hit, trustedPointerDelta: t.after.pointerdown - t.before.pointerdown, trustedClickDelta: t.after.click - t.before.click, before: t.before, after: t.after };
    } catch (e) { tapError = e.message; }
    await settle(800);
    const urlAfter = page.url();
    let post = null;
    try { post = await khoState(page); } catch (e) { post = { readError: e.message }; }
    const shotAfter = `${OUT}/${name}-after-tap-fullpage.png`;
    try { await shot(page, shotAfter, { full: true }); } catch (e) { console.log('after-tap shot failed', e.message); }

    results.states[name] = {
      ok: true, tripId: pick.tripId, fulfillmentId: pick.fulfillmentId, code: pick.code, bucket: pick.bucket,
      apiKhoPhone: pick.khoPhone, domBeforeTap: dom, tapResult, tapError,
      urlBeforeTap: urlBefore, urlAfterTap: urlAfter, dialogBefore, dialogAfterTap: post.dialogs,
      domAfterTap: post, errors,
      files: { fullpage: shotFull, rowCloseup: shotRow, afterTapFullpage: shotAfter },
    };
    console.log(`STATE ${name}`, JSON.stringify({ tripId: pick.tripId, apiKhoPhone: pick.khoPhone, valueText: dom.valueText, linkHref: dom.linkHref, delta: tapResult?.trustedPointerDelta, dialogs: post.dialogs, url: urlAfter }, null, 1));
  } finally {
    await browser.close();
  }
};

for (const s of STATES) await runState(s);

writeFileSync(`${OUT}/rung-result-${RUN_TAG}.json`, JSON.stringify(results, null, 2));
console.log('WROTE', `${OUT}/rung-result-${RUN_TAG}.json`);
