// FB-057 (card 141026012000) — topbar reflects the current build on staging.
// (1) fresh build 5a139108: no stale banner, topbar search fluid at 1920px,
//     profile dialog "Phiên bản máy chủ" == health hash;
// (2) simulated re-cut via intercepted /api/health: the stale banner appears;
// (3) reload on the real hash: banner gone again.
import { assertBuild, login, launch, makeLogger, installIdempotency, sleep } from './w5w4-lib.mjs';

const log = makeLogger('2026-10-16_w5w4_fb057');
const expect = (cond, msg) => { if (!cond) throw new Error(`ASSERT FAIL: ${msg}`); };

const realHash = await assertBuild(log);
const token = await login('admin');
log('login admin OK');

const browser = await launch({ width: 1920, height: 1080 });
try {
  const page = await browser.newPage();
  installIdempotency(page);
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  await page.goto('https://vantai.tingting.vip/', { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForSelector('.topbar__search', { timeout: 20000 });
  await sleep(1500);

  // (1a) no banner on a fresh build + search fluid at 1920
  let banner = await page.evaluate(() => !!document.querySelector('.stale-build-banner'));
  expect(!banner, 'no stale-build banner on the fresh build');
  const atRest = await page.evaluate(() => {
    const el = document.querySelector('.topbar__search');
    const cs = getComputedStyle(el);
    return { w: Math.round(el.getBoundingClientRect().width), max: cs.maxWidth, flex: cs.flex };
  });
  log(`FB-057: 1920px search at rest → width=${atRest.w}px, max-width=${atRest.max}, flex=${atRest.flex}`);
  expect(atRest.max === 'none', 'computed max-width: none at ≥1280px');
  expect(atRest.w > 900, `field is fluid at 1920px (got ${atRest.w}px; the old defect measured ~364px)`);
  await page.evaluate(() => document.querySelector('.topbar__search input, .topbar__search [role="textbox"], .topbar__search button')?.click());
  await sleep(500);
  const focused = await page.evaluate(() => Math.round(document.querySelector('.topbar__search').getBoundingClientRect().width));
  log(`FB-057: focused width=${focused}px`);
  expect(focused >= atRest.w - 2, 'focused field does not shrink below its rest width');
  await log.shot(page, 'ui-01-topbar-1920-fluid-search');

  // (1b) profile dialog shows the server build
  await page.evaluate(() => document.querySelector('button.sidebar-user')?.click());
  await sleep(400);
  await page.evaluate(() => {
    const item = [...document.querySelectorAll('button, [role="menuitem"], li, a')]
      .find((el) => /^Thông tin cá nhân/.test(el.textContent.trim()));
    if (item) item.click();
  });
  await page.waitForFunction(() => document.body.innerText.includes('Phiên bản máy chủ'), { timeout: 8000, polling: 120 });
  const shown = await page.evaluate(() => {
    const code = [...document.querySelectorAll('code')].find((c) => /^[0-9a-f]{7,40}$/.test(c.textContent.trim()));
    return code ? code.textContent.trim() : null;
  });
  log(`FB-057: profile dialog "Phiên bản máy chủ" code=${shown} (health=${realHash})`);
  expect(shown === realHash, 'BuildVersion displays the live server hash');
  await log.shot(page, 'ui-02-profile-server-build');
  await page.keyboard.press('Escape');
  await sleep(400);

  // (2) simulate a re-cut under the open tab: every /api/health answer now
  // carries a different hash; the 60s poll must flag the banner.
  await page.setRequestInterception(true);
  let fake = true;
  page.on('request', (req) => {
    if (fake && req.url().includes('/api/health')) {
      req.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok', buildHash: '0000000000000000000000000000000000000000' }),
      });
    } else {
      req.continue();
    }
  });
  log('FB-057: /api/health now returns a foreign hash — waiting for the poll to flag the banner (≤110s)');
  await page.waitForFunction(() => !!document.querySelector('.stale-build-banner'), { timeout: 110000, polling: 1000 });
  const banner2 = await page.evaluate(() => {
    const el = document.querySelector('.stale-build-banner');
    return { role: el.getAttribute('role'), text: el.textContent.trim() };
  });
  log(`FB-057: banner appeared — role=${banner2.role}, text="${banner2.text}"`);
  expect(banner2.role === 'status', 'banner is a non-blocking status region');
  expect(banner2.text.includes('Phiên bản mới'), 'banner offers the new version');
  await log.shot(page, 'ui-03-stale-banner-after-recut');

  // (3) reload on the real build: banner must be gone.
  fake = false;
  await page.reload({ waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForSelector('.topbar__search', { timeout: 20000 });
  await sleep(1500);
  banner = await page.evaluate(() => !!document.querySelector('.stale-build-banner'));
  expect(!banner, 'banner gone after reload on the fresh build');
  await log.shot(page, 'ui-04-banner-gone-after-reload');

  await browser.close();
  log('FB-057 ALL ASSERTIONS PASS');
  process.exit(0);
} catch (e) {
  log(`FAIL: ${e.message}`);
  try { await log.shot((await browser.pages()).slice(-1)[0], 'FAIL-last-state'); } catch {}
  await browser.close().catch(() => {});
  process.exit(1);
}
