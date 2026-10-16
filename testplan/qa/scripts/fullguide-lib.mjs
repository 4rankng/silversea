// Shared harness for the 2026-10-16 full-guide closed-loop QA wave
// (customer test guide "161026100000-huong-dan-su-dung-kiem-thu-hang-le-chi-phi").
//
// House rules baked in: staging only, health buildHash gate before driving,
// Idempotency-Key on every write, QA-prefixed fixtures, read-only psql over
// ssh for DB side-effect proof, token injected BEFORE first navigation
// (puppeteer-spa-auth), real CDP clicks for React Aria controls.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export const BASE = 'https://vantai.tingting.vip';
export const API = `${BASE}/api`;
export const PIN = process.env.EXPECT_BUILD || '227a08b2';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const uuid = () => randomUUID();

export function makeLogger(scope) {
  const LOG = `qa/2026-10-16_fullguide_${scope}.log`;
  fs.writeFileSync(LOG, `# fullguide ${scope} driver — ${new Date().toISOString()} pin=${PIN}\n`);
  const step = (name, data) => {
    const line = `${new Date().toISOString()} ${name} ${JSON.stringify(data) ?? ''}`;
    console.log(line);
    fs.appendFileSync(LOG, line + '\n');
  };
  const log = (msg) => {
    console.log(msg);
    fs.appendFileSync(LOG, `${msg}\n`);
  };
  return { step, log, LOG };
}

export async function healthGate(logger) {
  const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
  logger.step('health', health);
  if (health?.status !== 'ok' || health.buildHash !== PIN) {
    throw new Error(`ABORT: staging health ${JSON.stringify(health)} != pin ${PIN}`);
  }
  return health;
}

export async function login(identifier, password = 'Abc123') {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  if (!res.ok) return { error: res.status };
  const body = await res.json();
  const token = body.token ?? body.accessToken ?? body?.data?.token ?? null;
  return { token, user: body.user ?? null };
}

/** API helper — writes always carry a fresh Idempotency-Key. */
export async function api(token, method, path, body, extraHeaders = {}) {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...extraHeaders };
  if (method !== 'GET' && method !== 'HEAD') headers['Idempotency-Key'] = uuid();
  const res = await fetch(`${API}${path}`, { method, headers, body: body == null ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-json */ }
  return { status: res.status, ok: res.ok, json, text };
}

/** Read-only staging DB proof (psql over ssh; house lesson: no stdin). */
export function psql(sql) {
  return execSync(
    `ssh -o BatchMode=yes root@vantai.tingting.vip "docker exec vantai-postgres-1 psql -U vantai -d vantai -tAc \\"${sql.replace(/"/g, '\\\\"')}\\""`,
    { encoding: 'utf8' },
  ).trim();
}

export async function boot({ token, width = 1440, height = 1000 } = {}) {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  if (token) await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  return { browser, page };
}

/** Resolve an in-page predicate (source string) to an element and REAL-click it. */
export async function tap(page, predicateSource, { label = 'tap' } = {}) {
  const handle = await page.evaluateHandle(`(${predicateSource})()`);
  const el = handle.asElement();
  if (!el) { await handle.dispose(); return false; }
  await el.click();
  await handle.dispose();
  return true;
}

/** Set an input's value through React's native setter + events. */
export async function setInput(page, predicateSource, value) {
  return page.evaluate(`(() => {
    const el = (${predicateSource})();
    if (!el) return false;
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
}

/** Wait until body text contains a fragment. */
export async function waitText(page, fragment, timeout = 20000) {
  try {
    await page.waitForFunction(
      (f) => (document.body.innerText || '').includes(f),
      { polling: 120, timeout },
      fragment,
    );
    return true;
  } catch { return false; }
}

/** Wait until at least N elements match a selector. */
export async function waitCount(page, selector, n = 1, timeout = 20000) {
  try {
    await page.waitForFunction(
      (sel, count) => document.querySelectorAll(sel).length >= count,
      { polling: 120, timeout },
      selector, n,
    );
    return true;
  } catch { return false; }
}

export async function bodyText(page) {
  return page.evaluate(() => (document.body.innerText || '').replace(/[ \t]+/g, ' '));
}
