// CUS QA sweep — Pass 1. Env: QA_BASE_URL, QA_API, QA_USER, QA_PASS.
// Outputs screenshots + signals to qa/2026-08-16_cus-qa/.
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.QA_BASE_URL;
const API = process.env.QA_API;
if (!BASE || !API || !process.env.QA_USER || !process.env.QA_PASS) {
  throw new Error('Set QA_BASE_URL, QA_API, QA_USER, and QA_PASS before running the CUS QA sweep.');
}
const OUT = resolve('..', 'qa', '2026-08-16_cus-qa');
const SCREENS = resolve(OUT, 'screens');
mkdirSync(SCREENS, { recursive: true });

const signals = [];
const log = (m) => { console.log(m); appendFileSync(resolve(OUT, 'sweep.log'), m + '\n'); };
const record = (entry) => { signals.push({ time: new Date().toISOString(), ...entry }); };

// ── Login via API to keep credentials out of the page layer ──
const loginRes = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identifier: process.env.QA_USER, password: process.env.QA_PASS }),
});
if (!loginRes.ok) { console.error('LOGIN FAILED', loginRes.status); process.exit(2); }
const { token } = await loginRes.json();
log(`login ok (${loginRes.status})`);

const browser = await chromium.launch();
const contexts = {
  desktop: await browser.newContext({ viewport: { width: 1440, height: 900 } }),
  mobile: await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }),
};

for (const [label, ctx] of Object.entries(contexts)) {
  const page = await ctx.newPage();
  await page.addInitScript((t) => globalThis.localStorage.setItem('token', t), token);

  page.on('console', (msg) => {
    if (msg.type() === 'error') record({ kind: 'console.error', viewport: label, text: msg.text().slice(0, 500) });
  });
  page.on('pageerror', (err) => record({ kind: 'pageerror', viewport: label, text: String(err).slice(0, 500) }));
  page.on('response', (res) => {
    const url = res.url();
    if (url.includes('/api') && res.status() >= 400) record({ kind: 'http', viewport: label, status: res.status(), url: url.slice(0, 300) });
  });

  // ── Land on / and confirm redirect to /shipments ──
  await page.goto(BASE, { waitUntil: 'networkidle' });
  log(`[${label}] landed: ${page.url()}`);
  if (!page.url().includes('/shipments')) record({ kind: 'redirect', viewport: label, text: `expected /shipments, got ${page.url()}` });
  await page.screenshot({ path: resolve(SCREENS, `${label}-01-shipments.png`), fullPage: true });

  // ── Crawl every visible nav link ──
  const navHrefs = await page.$$eval('nav a[href], aside a[href], [class*="sidebar"] a[href]', (els) =>
    [...new Set(els.map((e) => e.getAttribute('href')).filter(Boolean))],
  );
  log(`[${label}] nav links: ${navHrefs.join(', ')}`);

  let shotIdx = 2;
  for (const href of navHrefs) {
    const url = href.startsWith('http') ? href : BASE + href;
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
      await page.waitForTimeout(400);
      const slug = href.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
      await page.screenshot({ path: resolve(SCREENS, `${label}-${String(shotIdx).padStart(2, '0')}-${slug}.png`), fullPage: true });
      log(`[${label}] visited ${href} → ${page.url()}`);
      shotIdx++;
    } catch (e) {
      record({ kind: 'nav', viewport: label, text: `failed visiting ${href}: ${String(e).slice(0, 200)}` });
    }
  }

  // ── Interaction probes on /shipments (desktop only; mobile taps after) ──
  await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  const clickables = await page.$$eval(
    'button:visible, [role="button"]:visible, a:visible, [role="tab"]:visible, summary:visible',
    (els) => els.slice(0, 80).map((e, i) => ({
      i,
      tag: e.tagName.toLowerCase(),
      label: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 60),
    })).filter((e) => e.label),
  );
  log(`[${label}] probe targets: ${clickables.length}`);

  for (const target of clickableTargets(clickables)) {
    try {
      const el = page.locator('button:visible, [role="button"]:visible, a:visible, [role="tab"]:visible, summary:visible').filter({ hasText: target.label }).first();
      if (!(await el.count())) continue;
      await el.click({ timeout: 3000 });
      await page.waitForTimeout(600);
      // screenshot open overlays only
      const overlayOpen = await page.locator('[class*="modal"][class*="open"], [role="dialog"], [class*="drawer"][class*="open"]').count();
      if (overlayOpen > 0) {
        await page.screenshot({ path: resolve(SCREENS, `${label}-probe-${target.i}-${slugify(target.label)}.png`) });
        log(`[${label}] opened overlay: ${target.label}`);
      }
      // Escape is the only overlay close action; never invoke a dialog's
      // primary button while testing shared staging data.
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    } catch (error) {
      record({ kind: 'probe', viewport: label, text: `failed ${target.label}: ${String(error).slice(0, 200)}` });
    }
  }

  await ctx.close();
}

writeFileSync(resolve(OUT, 'errors.json'), JSON.stringify(signals, null, 2));
log(`done. ${signals.length} signals`);
await browser.close();

function clickableTargets(list) {
  // Restrict shared-environment probes to non-mutating navigation and filters.
  const safe = /(tìm kiếm|lọc|filter|tab|chi tiết|kebab|more|⋯|⋮)/i;
  const mutating = /(thêm|tạo|mới|sửa|xóa|lưu|hoàn tất|khóa|mở khóa)/i;
  return list.filter((target) => safe.test(target.label) && !mutating.test(target.label)).slice(0, 40);
}
function slugify(s) { return s.replace(/[^a-z0-9]+/gi, '-').slice(0, 30).toLowerCase(); }
