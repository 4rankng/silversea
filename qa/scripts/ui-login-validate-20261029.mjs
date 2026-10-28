// SIL-563 — login validates on submit; the button never sits disabled-while-
// typing; placeholders read as examples. Drives the real /login form at 390
// and 1280: clicks Đăng nhập on empty/partial fields and asserts the inline
// message naming the field, the focus target and the aria-invalid wiring.
// Evidence: qa/2026-10-29_sil563_ui-*.png / _driver.log
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7285';
const OUT = resolve('qa');
const log = [];
const say = (line) => { log.push(line); console.log(line); };

mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ headless: 'new' });
const results = {};

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 160)}`); });
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) errors.push(`api ${r.status()} ${r.url().slice(0, 140)}`); });

  const snapshot = () => page.evaluate(() => {
    const btn = document.querySelector('button[type="submit"]');
    const username = document.getElementById('username-input');
    const password = document.getElementById('password-input');
    const alert = document.getElementById('login-error');
    return {
      submitDisabled: btn ? btn.disabled : null,
      alert: alert ? alert.textContent : null,
      focusId: document.activeElement?.id || null,
      userInvalid: username?.getAttribute('aria-invalid'),
      passInvalid: password?.getAttribute('aria-invalid'),
      userPlaceholder: username?.getAttribute('placeholder'),
      passPlaceholder: password?.getAttribute('placeholder'),
    };
  });

  await page.goto(`${FE}/login`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 600));

  // ── 1280: empty submit ────────────────────────────────────────────────────
  results.initial = await snapshot();
  say(`initial @1280: ${JSON.stringify(results.initial)}`);
  await page.screenshot({ path: `${OUT}/2026-10-29_sil563_ui-login-1280-empty.png` });
  say('screenshot qa/2026-10-29_sil563_ui-login-1280-empty.png');

  await page.click('button[type="submit"]');
  await new Promise((r) => setTimeout(r, 300));
  results.emptySubmit = await snapshot();
  say(`after empty submit @1280: ${JSON.stringify(results.emptySubmit)}`);
  await page.screenshot({ path: `${OUT}/2026-10-29_sil563_ui-login-1280-username-error.png` });
  say('screenshot qa/2026-10-29_sil563_ui-login-1280-username-error.png');

  // ── fill username only, submit again ─────────────────────────────────────
  await page.type('#username-input', 'admin');
  await page.click('button[type="submit"]');
  await new Promise((r) => setTimeout(r, 300));
  results.partialSubmit = await snapshot();
  say(`after username-only submit @1280: ${JSON.stringify(results.partialSubmit)}`);
  await page.screenshot({ path: `${OUT}/2026-10-29_sil563_ui-login-1280-password-error.png` });
  say('screenshot qa/2026-10-29_sil563_ui-login-1280-password-error.png');

  // ── 390: same flow, mobile band ──────────────────────────────────────────
  await page.setViewport({ width: 390, height: 844 });
  await new Promise((r) => setTimeout(r, 500));
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 600));
  await page.click('button[type="submit"]');
  await new Promise((r) => setTimeout(r, 300));
  results.mobile = await snapshot();
  say(`after empty submit @390: ${JSON.stringify(results.mobile)}`);
  await page.screenshot({ path: `${OUT}/2026-10-29_sil563_ui-login-390-username-error.png` });
  say('screenshot qa/2026-10-29_sil563_ui-login-390-username-error.png');

  results.errors = errors;
  say(errors.length ? `ERRORS: ${errors.join(' | ')}` : 'no console/api errors');
} finally {
  await browser.close();
}

const r = results;
const checks = [
  ['button enabled on a fresh form @1280', r.initial?.submitDisabled === false],
  ['placeholders are examples (nv001/0901 + dots)', /nv001|0901/.test(r.initial?.userPlaceholder ?? '') && r.initial?.passPlaceholder === '••••••••'],
  ['empty submit: alert names username', r.emptySubmit?.alert === 'Vui lòng nhập tên đăng nhập hoặc số điện thoại.'],
  ['empty submit: username focused + aria-invalid', r.emptySubmit?.focusId === 'username-input' && r.emptySubmit?.userInvalid === 'true'],
  ['empty submit: password untouched', r.emptySubmit?.passInvalid === 'false'],
  ['username-only submit: alert names password', r.partialSubmit?.alert === 'Vui lòng nhập mật khẩu.'],
  ['username-only submit: password focused + aria-invalid', r.partialSubmit?.focusId === 'password-input' && r.partialSubmit?.passInvalid === 'true'],
  ['390 empty submit: same named-field behavior', r.mobile?.alert === 'Vui lòng nhập tên đăng nhập hoặc số điện thoại.' && r.mobile?.focusId === 'username-input' && r.mobile?.submitDisabled === false],
  ['no console/api errors', (r.errors ?? []).length === 0],
];
let failed = 0;
for (const [name, ok] of checks) { say(`${ok ? 'PASS' : 'FAIL'} — ${name}`); if (!ok) failed += 1; }
say(failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`);
writeFileSync(`${OUT}/2026-10-29_sil563_ui-driver.log`, log.join('\n') + '\n');
process.exit(failed === 0 ? 0 : 1);
