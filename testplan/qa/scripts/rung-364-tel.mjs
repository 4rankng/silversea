// Card 20261005_364 (REQ-05) — the driver "Thông tin lệnh" warehouse phone
// (SĐT kho) must be a tap-to-call control. Rung shape: token injection (the
// FORM-LOGIN SPA transition poisons CDP input), single goto, real taps at
// 390x844, full-page screenshots before/after the change.
//
// Modes:
//   MODE=before  — record the BEFORE state (plain text phone, no tel: link)
//   MODE=after   — record the AFTER state (tel: link on the kho phone)
// Usage:
//   QA_BASE=http://localhost:7175 IDENTIFIER=laixe MODE=before node testplan/qa/scripts/rung-364-tel.mjs
// Env: QA_BASE, IDENTIFIER (default laixe), PASSWORD (Abc123), OUT_DIR.
import { launch, tap, shot, probe } from './lead-qa-lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.QA_BASE || 'http://localhost:7175';
const IDENTIFIER = process.env.IDENTIFIER || 'laixe';
const PASSWORD = process.env.PASSWORD || 'Abc123';
const MODE = process.env.MODE || 'after';
const OUT = process.env.OUT_DIR || `testplan/qa/evidence/2026-10-05_364-sdt-kho-tap-de-goi/${MODE}`;
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });

async function main() {
  // Blessed shape: POST /api/auth/login from node → token → inject → one goto.
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: IDENTIFIER, password: PASSWORD }),
  });
  if (!login.ok) throw new Error(`login failed ${login.status}`);
  const { token } = await login.json();

  const { browser, page } = await launch({ width: 390, height: 844, base: BASE });
  try {
    await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
    await page.goto(`${BASE}/my-trips`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await settle(3500);

    const tripId = await page.evaluate(async () => {
      const t = localStorage.getItem('token');
      const res = await fetch('/api/driver/me/journey-board', { headers: { Authorization: `Bearer ${t}` } });
      const json = await res.json();
      return json.items?.[0]?.tripId ?? null;
    });
    if (!tripId) throw new Error('no trip on the driver board');
    await page.goto(`${BASE}/my-trips/${tripId}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await settle(3500);

    // Expand Thông tin lệnh if collapsed.
    await page.evaluate(() => {
      const toggle = document.querySelector('[data-testid="task-section-toggle-driver-task-info-grid"]');
      if (toggle && toggle.getAttribute('aria-expanded') === 'false') toggle.click();
    });
    await settle(600);

    // Full-page screenshot of the order detail (Thông tin lệnh visible).
    await shot(page, `${OUT}/order-detail-fullpage.png`);

    // DOM state of the SĐT kho row BEFORE/AFTER the tap.
    const domState = await page.evaluate(() => {
      const facts = [...document.querySelectorAll('.driver-task-fact')];
      const kho = facts.find((f) => f.querySelector('.driver-task-fact__label')?.textContent === 'SĐT kho');
      const valueEl = kho?.querySelector('.driver-task-fact__value');
      const link = valueEl?.querySelector('a');
      return {
        khoRowPresent: Boolean(kho),
        valueText: valueEl?.textContent?.trim() ?? null,
        linkHref: link?.getAttribute('href') ?? null,
        linkText: link?.textContent?.trim() ?? null,
        allTelLinks: [...document.querySelectorAll('a[href^="tel:"]')].map((a) => ({
          href: a.getAttribute('href'),
          text: a.textContent?.trim().slice(0, 24),
          cls: (a.className || '').toString().slice(0, 48),
        })),
      };
    });

    // Real tap ON the SĐT kho value area (the control the driver presses).
    let tapResult = null;
    let tapError = null;
    try {
      const el = await page.$('.driver-task-fact__value a[href^="tel:"]') || await page.$('.driver-task-fact__value');
      const sel = (await page.$('.driver-task-fact__value a[href^="tel:"]')) ? 'SĐT kho tel link' : 'SĐT kho plain value';
      if (el) {
        const box = await el.boundingBox();
        const cx = Math.round(box.x + box.width / 2);
        const cy = Math.round(box.y + box.height / 2);
        const before = await probe(page);
        await page.mouse.move(cx, cy);
        await page.mouse.down();
        await page.mouse.up();
        await settle(700);
        const after = await probe(page);
        tapResult = { target: sel, cx, cy, trustedPointerDelta: after.pointerdown - before.pointerdown, trustedClickDelta: after.click - before.click };
      }
    } catch (e) {
      tapError = e.message;
    }

    // Post-tap URL (tel: navigation cannot be observed headless — record it).
    const urlAfterTap = page.url();

    // Zoomed screenshot of the phone row.
    const rowBox = await page.evaluate(() => {
      const facts = [...document.querySelectorAll('.driver-task-fact')];
      const kho = facts.find((f) => f.querySelector('.driver-task-fact__label')?.textContent === 'SĐT kho');
      if (!kho) return null;
      const r = kho.getBoundingClientRect();
      return { x: 0, y: Math.max(0, r.top + window.scrollY - 40), width: 390, height: Math.ceil(r.height + 80) };
    });
    if (rowBox) {
      await page.screenshot({ path: `${OUT}/kho-row-closeup.png`, clip: { x: 0, y: rowBox.y, width: 390, height: rowBox.height }, captureBeyondViewport: true });
    }

    const report = { mode: MODE, base: BASE, tripId, domState, tapResult, tapError, urlAfterTap, trusted: await probe(page) };
    writeFileSync(`${OUT}/rung-result.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 1));

    const verdict = MODE === 'before'
      ? (domState.linkHref === null ? 'BEFORE CONFIRMED: plain text, no tel link' : 'UNEXPECTED: tel link already present')
      : MODE === 'empty'
        ? (domState.linkHref === null && domState.valueText === '—' ? 'EMPTY CONFIRMED: dash plain text, no tel link' : 'FAIL: empty state renders a dialable control')
        : (domState.linkHref?.startsWith('tel:') ? 'AFTER CONFIRMED: tel link present' : 'FAIL: no tel link');
    console.log('VERDICT:', verdict);
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error('RUNG-ERR', e.message); process.exit(1); });
