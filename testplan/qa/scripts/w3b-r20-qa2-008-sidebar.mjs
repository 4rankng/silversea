// W3b — QA2-008 sidebar label ↔ page taxonomy re-verify on staging.
// Original record: testplan/qa/scripts/qa2-008-sidebar-titles-local.mjs
// (local demo accounts). Staging accounts: OPS hoangnh + ADMIN admin.
// Contract: clicking a sidebar item opens the page whose taxonomy matches the
// visible label (label === route === page heading family).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const pathModule = path;
const require2 = createRequire('/Volumes/LexarSSD/projects/silversea/package.json');
const puppeteer = require2('puppeteer');

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const EXPECT_BUILD = process.env.QA_EXPECT_BUILD || '7dcdcf33';
const OUT = path.resolve(import.meta.dirname, '../../../qa/2026-10-16_w3b-r20-verify');
fs.mkdirSync(OUT, { recursive: true });

const LOG = [];
const log = (step, obj = {}) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const healthRes = await fetch(`${API}/health`);
const healthText = await healthRes.text();
let health;
try { health = JSON.parse(healthText); } catch { console.error(`health ${healthRes.status}`); process.exit(2); }
log('health', { buildHash: health.buildHash, expect: EXPECT_BUILD });
if (!String(health.buildHash || '').startsWith(EXPECT_BUILD)) { console.error('STALE BUILD — abort'); process.exit(2); }

const CHECKS = {
  hoangnh: [['Tạm ứng', '/my-advances'], ['Phiếu thanh toán', '/my-settlements']],
  admin: [
    ['Kế hoạch Tổng quát', '/dispatch'],
    ['Phân chia lợi nhuận', '/profit'],
    ['Nhật ký người dùng', '/audit-logs'],
    ['Cấu hình hệ thống', '/config'],
    ['Cảng / Bãi', '/config/ports'],
    ['Người dùng', '/users'],
  ],
};

const launchUser = async (user) => {
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: user, password: 'Abc123' }),
  });
  if (login.status !== 200) throw new Error(`login ${user} -> ${login.status}`);
  const token = (await login.json()).token;
  const jwt = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
  log('identity', { user, jwtUsername: jwt.username ?? jwt.identifier ?? jwt.sub });
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 960 });
  await page.evaluateOnNewDocument((t, o) => { if (location.origin === o) localStorage.setItem('token', t); }, token, new URL(BASE).origin);
  return { browser, page };
};

for (const [user, checks] of Object.entries(CHECKS)) {
  const { browser, page } = await launchUser(user);
  try {
    for (const [label, route] of checks) {
      await page.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 60000 });
      await sleep(2000);
      // expand every collapsed sidebar section, settle, then click the item
      // via elementHandle (puppeteer scrolls + clicks the element itself —
      // no coordinate drift when the expansion re-renders the rail)
      await page.evaluate(() => {
        for (const toggle of [...document.querySelectorAll('.sidebar-section-toggle')]) {
          const section = toggle.closest('.sidebar-section');
          if (section && !section.querySelector('.sidebar-item-label')) toggle.click();
        }
      });
      await sleep(900);
      let clicked = null;
      for (let attempt = 0; attempt < 2 && !clicked; attempt++) {
        if (attempt > 0) await sleep(1200);
        const handle = await page.evaluateHandle((lbl) => {
          const el = [...document.querySelectorAll('.sidebar-item-label')].find((n) => (n.textContent || '').trim() === lbl);
          return el ? el.closest('button,a') : null;
        }, label);
        const el = handle.asElement();
        if (el) { await el.click(); clicked = true; }
        else await handle.dispose();
      }
      if (!clicked) {
        const sidebarDump = await page.evaluate(() => [...document.querySelectorAll('.sidebar-item-label')].map((n) => n.textContent.trim()));
        log('TC-step', { user, label, route, verdict: 'LABEL-MISSING', sidebar: sidebarDump });
        exitCode = 1;
        continue;
      }
      await sleep(2200);
      const after = await page.evaluate(() => ({
        url: location.pathname,
        docTitle: document.title,
        h1: [...document.querySelectorAll('main h1, main h2, [class*="topbar"] h1, [class*="topbar"] h2')].map((h) => h.textContent.trim()).slice(0, 3),
      }));
      const urlOk = after.url === route || after.url.startsWith(route);
      log('TC-step', { user, label, route, found: true, landedAt: after.url, urlOk, docTitle: after.docTitle, headings: after.h1 });
      await page.screenshot({ path: pathModule.join(OUT, `qa2008_${user}${route.replaceAll('/', '_')}.png`) });
      if (!urlOk) exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

const allOk = exitCode === 0;
log('TC', { id: 'QA2-008', verdict: allOk ? 'PASS' : 'FAIL', note: 'each TC-step records label → landed URL + headings' });
fs.writeFileSync(path.join(OUT, 'qa2008_log.json'), JSON.stringify(LOG, null, 2));
process.exit(exitCode);
