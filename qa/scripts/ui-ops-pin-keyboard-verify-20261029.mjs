// SIL-575 verify — /ops/orders pin toggle, the two QA residuals (29/10:
// "trạng thái aria-disabled/aria-busy lúc đang chuyển đổi chưa quan sát trực
// tiếp được; ghim thuần bàn phím cũng chưa chứng minh riêng"):
//   1. PURE KEYBOARD pin: no mouse anywhere — focus the button, press Enter,
//      the row floats to the top and focus stays on the SAME order's button
//      (aria-pressed flips with it). Enter again unpins.
//   2. DIRECT in-flight observation: the PATCH is delayed ~2.5s via request
//      interception so the aria-busy/aria-disabled window is measurable (+
//      screenshot + DOM dump); the settled button must carry NO `disabled`
//      (the aria-disabled pattern keeps it in the tab order).
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const FE = process.env.QA_BASE_URL || 'http://localhost:7202';
const OUT = 'qa';
const log = [];
const say = (l) => { log.push(l); console.log(l); };
let checks = 0; const fails = [];
const check = (name, ok, detail = '') => {
  checks += 1;
  say(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};

const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 120000 });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle2' });
  await page.type('input[name="username"]', process.env.QA_USER || 'giaonhan');
  await page.type('input[name="password"]', 'Abc123');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
  await new Promise((r) => setTimeout(r, 1500));
  say(`login → ${new URL(page.url()).pathname}`);

  await page.goto(`${FE}/ops/orders`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2000));

  const snapshot = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button.ops-pin')];
    return {
      pinButtons: buttons.length,
      firstCode: document.querySelector('.ops-orders__table tbody tr .col-code')?.textContent ?? '',
      firstLabel: buttons[0]?.getAttribute('aria-label') ?? '',
    };
  });
  check('/ops/orders renders pin buttons', snapshot.pinButtons > 0, `n=${snapshot.pinButtons} first="${snapshot.firstLabel}"`);

  // Delay the pin PATCH so the in-flight window is directly observable.
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.url().includes('shipment-pins')) setTimeout(() => req.continue().catch(() => {}), 2500);
    else req.continue().catch(() => {});
  });

  // ── 1. PURE KEYBOARD pin (focus + Enter — no mouse) ──────────────────────
  const targetLabel = snapshot.firstLabel; // "Ghim …"
  await page.evaluate((label) => {
    const btn = [...document.querySelectorAll('button.ops-pin')].find((b) => b.getAttribute('aria-label') === label);
    btn?.focus();
  }, targetLabel);
  const focusedBefore = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
  check('pin button takes keyboard focus', focusedBefore === targetLabel, focusedBefore);
  await page.keyboard.press('Enter');

  // ── 2. DIRECT in-flight observation (delayed PATCH) ──────────────────────
  await new Promise((r) => setTimeout(r, 600));
  const inflight = await page.evaluate(() => {
    const busy = [...document.querySelectorAll('button.ops-pin')].find((b) => b.getAttribute('aria-busy') === 'true');
    return {
      hasBusy: !!busy,
      busyLabel: busy?.getAttribute('aria-label') ?? '',
      ariaDisabled: busy?.getAttribute('aria-disabled') ?? null,
      nativeDisabled: busy?.hasAttribute('disabled') ?? null,
      activeStillOnButton: document.activeElement === busy,
      allOthersDisabled: [...document.querySelectorAll('button.ops-pin')]
        .filter((b) => b !== busy)
        .every((b) => b.getAttribute('aria-disabled') === 'true'),
    };
  });
  check('in-flight button carries aria-busy=true (direct observation)', inflight.hasBusy, `label=${inflight.busyLabel}`);
  check('in-flight button keeps aria-disabled pattern (no native disabled)', inflight.ariaDisabled === 'true' && !inflight.nativeDisabled);
  check('siblings share the in-flight aria-disabled pass', inflight.allOthersDisabled);
  await page.screenshot({ path: `${OUT}/2026-10-29_sil575_ui-ops-pin-inflight-1280.png` });
  writeFileSync(`${OUT}/2026-10-29_sil575_ui-inflight-dom.log`, JSON.stringify(inflight, null, 2));

  // ── settle: row floats to top, focus back on the same order's button ────
  await new Promise((r) => setTimeout(r, 3000));
  const settled = await page.evaluate(() => {
    const busyGone = ![...document.querySelectorAll('button.ops-pin')].some((b) => b.getAttribute('aria-busy') === 'true');
    const firstBtn = document.querySelector('button.ops-pin');
    return {
      busyGone,
      firstLabel: firstBtn?.getAttribute('aria-label') ?? '',
      firstPressed: firstBtn?.getAttribute('aria-pressed') ?? '',
      activeLabel: document.activeElement?.getAttribute('aria-label') ?? '',
      firstCode: document.querySelector('.ops-orders__table tbody tr .col-code')?.textContent ?? '',
    };
  });
  const pinnedLabel = targetLabel.replace(/^Ghim /, 'Bỏ ghim ');
  check('after settle the row floats to top with aria-pressed=true', settled.firstLabel === pinnedLabel && settled.firstPressed === 'true', `${settled.firstLabel} pressed=${settled.firstPressed} row=${settled.firstCode}`);
  check('keyboard focus survives the re-sort (same order button)', settled.activeLabel === pinnedLabel, settled.activeLabel);

  // ── 3. PURE KEYBOARD unpin ───────────────────────────────────────────────
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 3200));
  const un = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button.ops-pin')].find((b) => b.getAttribute('aria-label') === document.activeElement?.getAttribute('aria-label'));
    return {
      activeLabel: document.activeElement?.getAttribute('aria-label') ?? '',
      pressed: btn?.getAttribute('aria-pressed') ?? '',
    };
  });
  check('Enter unpins and keeps focus on the same order button', un.activeLabel === targetLabel && un.pressed === 'false', `${un.activeLabel} pressed=${un.pressed}`);
} finally {
  await browser.close();
  writeFileSync(`${OUT}/2026-10-29_sil575_ui-driver.log`, log.join('\n') + `\nTOTAL ${checks - fails.length}/${checks} PASS\n`);
  say(`TOTAL ${checks - fails.length}/${checks} PASS`);
  if (fails.length) process.exit(1);
}
