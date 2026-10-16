/**
 * QA driver lib — consolidated cost-doc wave, staging.
 * Bun runtime (node v25 fetch is flaky against vantai TLS), Playwright chromium.
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const req = createRequire(
  '/Users/dev/.nvm/versions/node/v25.8.1/lib/node_modules/@playwright/test/',
);
const { chromium } = req('playwright');

export const BASE = 'https://vantai.tingting.vip';
export const API = `${BASE}/api`;
export const PASS = 'Abc123';
export const ART = 'testplan/qa/2026-10-15-cost-doc-wave-qa';

mkdirSync(ART, { recursive: true });

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function login(username, password = PASS) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: username, password }),
  });
  if (!res.ok) throw new Error(`login ${username} → ${res.status} ${(await res.text()).slice(0, 200)}`);
  const b = await res.json();
  if (!b?.token) throw new Error(`login ${username}: no token ${JSON.stringify(b).slice(0, 200)}`);
  return b.token;
}

export async function api(token, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, ok: res.ok, data };
}

/** Launch chromium + a page preloaded with the JWT in localStorage (SPA auth). */
export async function session(token, { width = 1440, height = 900 } = {}) {
  const browser = await chromium.launch({ args: ['--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width, height } });
  await context.addInitScript((t) => {
    try {
      for (const k of ['token', 'access_token', 'accessToken', 'ss_token', 'user'])
        localStorage.setItem(k, t);
    } catch {}
  }, token);
  const page = await context.newPage();
  const errors = [];
  const netErrors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`);
  });
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 400)
      netErrors.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });
  return { browser, context, page, errors, netErrors };
}

export async function goto(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  await sleep(900);
}

export async function shot(page, name, { full = false } = {}) {
  const p = join(ART, `${name}.png`);
  await page.screenshot({ path: p, fullPage: full });
  return p;
}

export function log(name, obj) {
  const p = join(ART, `${name}.json`);
  writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
}

/** Text of <main>, trimmed, for DOM assertions. */
export async function mainText(page) {
  return page.evaluate(() => {
    const m = document.querySelector('main') ?? document.body;
    return (m.innerText ?? '').replace(/\n{3,}/g, '\n\n').trim();
  });
}

/** Visible buttons/links with their text — helps a tester map the surface. */
export async function controls(page, sel = 'button, a[href], [role="button"], [role="tab"]') {
  return page.evaluate((s) => {
    return [...document.querySelectorAll(s)]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .map((e) => ({
        tag: e.tagName.toLowerCase(),
        text: (e.innerText ?? e.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
        dis: e.disabled === true || e.getAttribute('aria-disabled') === 'true' || false,
      }))
      .filter((c) => c.text);
  }, sel);
}

/** All form field labels/placeholders visible on the page. */
export async function fields(page) {
  return page.evaluate(() => {
    return [...document.querySelectorAll('input, select, textarea')].map((e) => ({
      tag: e.tagName.toLowerCase(),
      type: e.type ?? '',
      name: e.name ?? '',
      ph: e.placeholder ?? '',
      label: (() => {
        const id = e.id;
        if (id) {
          const l = document.querySelector(`label[for="${CSS.escape(id)}"]`);
          if (l) return l.innerText.trim();
        }
        const w = e.closest('label');
        if (w) return w.innerText.trim().slice(0, 60);
        return e.getAttribute('aria-label') ?? '';
      })(),
      req: e.required === true,
      dis: e.disabled === true,
      val: e.value ?? '',
    }));
  });
}