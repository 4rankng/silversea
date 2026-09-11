// QA wide-tier gate sweep — master-plan card band at 901–1512px on staging.
// Self-driven Playwright script (no QA-bot delegation): auth via API token
// injection (localStorage['token'] before first load — see
// ~/.claude/splits/puppeteer-spa-auth), cache-cold per viewport (fresh
// browser context each pass), computed-style + screenshot evidence.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire('/Users/dev/Documents/projects/silversea-prod/frontend/package.json');
const { chromium } = require('playwright');

const BASE = 'https://vant staging.vip';
const OUT = '/Users/dev/Documents/projects/silversea-prod/qa/2026-09-10';
const ROUTE = '/dispatch';

// --- auth ---------------------------------------------------------------
const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  staging: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: '123456' }),
});
if (!loginRes.ok) { console.error('LOGIN FAILED', loginRes.status, await loginRes.text()); process.exit(1); }
const { token } = await loginRes.json();
console.log('login ok, token len', String(token).length);

fs.mkdirSync(artifactsSync(OUT, { recursive: true });

// --- passes -------------------------------------------------------------
const PASSES = [
  { w: 390, h: 844, coarse: false, tag: '390-fine' },
  { w: 390, h: 844, coarse: true, tag: '390-coarse' 1024, ... },
  ...
