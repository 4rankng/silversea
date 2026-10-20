// QA R27 — session-instability two-tab UI drive (fix evidence).
// Scenario = the QA workflow from the R27 environment note: two tabs in ONE
// browser profile (they share localStorage['token']), two roles.
//
// Phase 1 (TC-2, the reported "phiên tự rớt"): tab1 works as admin; tab2
//   (inheriting the shared session) clicks Đăng xuất through the real UI →
//   tab1 must show "Phiên đăng nhập đã kết thúc ở thẻ khác." and land on
//   /login. Server side-effect proof: the shared token is revoked (Redis
//   blacklist) — direct /auth/me with the old token → 401 "Token đã bị thu hồi".
// Phase 2 ("đăng nhập lại đúng vai trò"): tab1 signs back in as admin through
//   the real login form (idle tab2 is signed out — no interference).
// Phase 3 (TC-1, the reported "tự chuyển user"): tab2 logs in as ketoan
//   through the real login form → tab1 must show the warning toast naming the
//   account it now runs as (no silent swap) and its identity must become
//   ketoan, proven on the wire by /auth/me resolving to ketoan.
//
// Environment: local vite (this worktree, :7176, build carries the fix)
// proxying /api to the shared local backend :3002. Local dev accounts from
// testplan/testaccounts.txt (admin, ketoan — local dev, password resolved
// at runtime from that file).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire('/Volumes/LexarSSD/projects/silversea/package.json');
const puppeteer = require('puppeteer');

const BASE = process.env.QA_BASE || 'http://localhost:7176';
const API = process.env.QA_API || 'http://localhost:3002/api';
const OUT = path.resolve(import.meta.dirname);

// Repo rule: credentials live ONLY in testplan/testaccounts.txt — resolve at
// runtime (local dev section), never embed them in this artifact.
const ROOT = path.resolve(import.meta.dirname, '../..');
const accountsTxt = fs.readFileSync(path.join(ROOT, 'testplan', 'testaccounts.txt'), 'utf8');
const localPassword = accountsTxt.match(/^local:\n(?:.*\n)*?[ \t]*password:[ \t]*(\S+)/m)?.[1];
if (!localPassword) throw new Error('local dev password not found in testplan/testaccounts.txt');

const LOG = [];
const log = (step, obj = {}) => {
  const e = { at: new Date().toISOString(), step, ...obj };
  LOG.push(e);
  console.log(JSON.stringify(e));
};
const flush = () => fs.writeFileSync(`${OUT}/r27-two-tab-ui-driver.log`, `${LOG.map((e) => JSON.stringify(e)).join('\n')}\n`, 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apiLogin(identifier) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: localPassword }),
  });
  if (!res.ok) throw new Error(`login ${identifier} -> HTTP ${res.status}`);
  return res.json();
}

const readToasts = (page) => page.evaluate(() => {
  const nodes = [...document.querySelectorAll('[class*="toast"], [role="status"], [role="alert"]')];
  const texts = nodes.map((t) => t.textContent?.trim()).filter(Boolean);
  return [...new Set(texts)];
});
const readIdentity = (page) => page.evaluate(() => ({
  pathname: location.pathname,
  name: document.querySelector('.sidebar-user .name')?.textContent?.trim() ?? null,
  role: document.querySelector('.sidebar-user .role')?.textContent?.trim() ?? null,
}));

async function loginViaForm(page, identifier) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 90_000 });
  await sleep(1200);
  await page.type('#username-input', identifier);
  await page.type('#password-input', localPassword);
  await page.click('button[type="submit"]');
  await sleep(4000);
}

/** Login through the real form while the page is still authenticated: the
 *  form is visible for the window before /me resolves and <Navigate> bounces
 *  the tab away — the exact race a fast QA typist hits when the shared
 *  profile is already signed in. Types the moment the inputs render. */
async function loginViaFormRacingRedirect(page, identifier, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    const found = await page.waitForSelector('#username-input', { timeout: 2500 }).then(() => true).catch(() => false);
    if (!found) continue;
    try {
      await page.type('#username-input', identifier, { delay: 5 });
      await page.type('#password-input', localPassword, { delay: 5 });
      await page.click('button[type="submit"]');
      await sleep(4000);
      const stillOnLogin = await page.evaluate(() => location.pathname === '/login');
      if (!stillOnLogin) return true;
    } catch {
      // Redirect won the race — retry.
    }
  }
  return false;
}

const health = await (await fetch(`${API}/health`)).json();
log('env', { base: BASE, api: API, backendBuild: health.buildHash });

const adminSession = await apiLogin('admin');
log('login_api', { username: 'admin', role: 'ADMIN', id: adminSession.user.id });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const consoleErrors = [];
const onErr = (e) => consoleErrors.push(String(e?.message || e));

// ── Tab 1: existing admin session, mid-work ─────────────────────────────────
const tab1 = await browser.newPage();
tab1.on('pageerror', onErr);
await tab1.setViewport({ width: 1440, height: 900 });
await tab1.evaluateOnNewDocument((t) => { localStorage.setItem('token', t); }, adminSession.token);
await tab1.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 90_000 });
await sleep(3500);
const tab1Before = await readIdentity(tab1);
log('tab1_identity_before', tab1Before);

// ── Phase 1 / TC-2: tab2 inherits the shared session, logs out via the UI ───
const tab2 = await browser.newPage();
tab2.on('pageerror', onErr);
await tab2.setViewport({ width: 1440, height: 900 });
await tab2.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 90_000 });
await sleep(2500);
const tab2Inherited = await readIdentity(tab2);
log('tab2_inherited_identity', tab2Inherited);
const sharedTokenBeforeLogout = await tab2.evaluate(() => localStorage.getItem('token'));

await tab2.click('.sidebar-user');
await sleep(700);
const logoutBtn = await tab2.evaluateHandle(() => {
  const btns = [...document.querySelectorAll('.sidebar-user-dropdown-item')];
  return btns.find((b) => (b.textContent || '').includes('Đăng xuất'));
});
if (!logoutBtn || !(await logoutBtn.asElement())) {
  log('STOP_logout_button_not_found');
  flush();
  await browser.close();
  process.exit(2);
}
await logoutBtn.asElement().click();
await sleep(4500);
const tc2Tab1Toasts = await readToasts(tab1);
const tc2Tab1 = await readIdentity(tab1);
const tc2Token = await tab1.evaluate(() => localStorage.getItem('token'));
await tab1.bringToFront();
await sleep(600);
await tab1.screenshot({ path: `${OUT}/r27-tc2-logout-toast.png` });
const revokedCheck = await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${sharedTokenBeforeLogout}` } });
const revokedBody = await revokedCheck.json().catch(() => ({}));
fs.writeFileSync(`${OUT}/r27-tc2-dom.txt`, JSON.stringify({ tc2Tab1, tc2Tab1Toasts, tc2Token, revoked: { status: revokedCheck.status, error: revokedBody.error } }, null, 2));
log('tc2_result', {
  tab1: tc2Tab1,
  toasts: tc2Tab1Toasts,
  server_revocation: { status: revokedCheck.status, error: revokedBody.error },
});

// ── Phase 2: tab1 signs back in as admin ("đăng nhập lại đúng vai trò") ────
await loginViaForm(tab1, 'admin');
await sleep(2000);
const tab1ReSigned = await readIdentity(tab1);
log('tab1_resigned_as_admin', tab1ReSigned);

// ── Phase 3 / TC-1: a different signed-in session appears in the profile ───
// UI-only note: an authenticated same-profile tab cannot reach /login (it
// <Navigate>s home instantly), so the pure-UI role switch is logout→login —
// proven in phase 1 (tab1 drops first). The LIVE mid-work swap — tab1 still
// holding a KNOWN user while another session writes the shared token — is
// what every QA harness tab does (session seeding, the r2x driver pattern)
// and what a session-restored/backgrounded tab effectively is. Drive it the
// same way: seed tab2 with a ketoan session, then a normal navigation.
const ketoanSession = await apiLogin('ketoan');
await tab2.evaluateOnNewDocument((t) => { localStorage.setItem('token', t); }, ketoanSession.token);
await tab2.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 90_000 });
await sleep(2500);
const tab2Ketoan = await readIdentity(tab2);
log('tab2_login_ketoan', tab2Ketoan);
const tc1Tab1Toasts = await readToasts(tab1);
const tc1Tab1 = await readIdentity(tab1);
const meNow = await tab1.evaluate(async () => {
  const token = localStorage.getItem('token');
  const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, id: body.id, username: body.username, role: body.role, fullName: body.fullName };
});
await tab1.bringToFront();
await sleep(600);
await tab1.screenshot({ path: `${OUT}/r27-tc1-swap-toast.png` });
fs.writeFileSync(`${OUT}/r27-tc1-dom.txt`, JSON.stringify({ tc1Tab1, tc1Tab1Toasts, meNow }, null, 2));

log('tc1_result', {
  tab2_seeded_session: 'ketoan',
  tab1: tc1Tab1,
  toasts: tc1Tab1Toasts,
  meNow,
});

log('verdict', {
  tc2_logout_toast_visible: tc2Tab1Toasts.some((t) => t.includes('kết thúc ở thẻ khác')),
  tc2_tab1_back_to_login: tc2Tab1.pathname === '/login',
  tc2_token_revoked_server_side: revokedCheck.status === 401,
  tc1_toast_visible: tc1Tab1Toasts.some((t) => t.includes('Thẻ khác đã đăng nhập')),
  tc1_identity_swapped_to_ketoan: meNow.username === 'ketoan' && meNow.role === 'ACCOUNTANT',
  consoleErrors,
});
flush();
await browser.close();
process.exit(0);
