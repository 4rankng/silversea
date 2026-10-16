// W1 staging QA shared driver (house recipe: token injection via
// evaluateOnNewDocument, real fetch login). Run from repo root:
//   node testplan/qa/2026-10-16_w1-verify/<script>.mjs
// Secrets: the staging password is parsed at runtime from
// testplan/testaccounts.txt and never written to disk here.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASE = 'https://vantai.tingting.vip';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = HERE;

export function stagingPassword() {
  const raw = fs.readFileSync(path.join(HERE, '../../testaccounts.txt'), 'utf8');
  const stagingBlock = raw.split(/^staging:/m)[1];
  const match = stagingBlock?.match(/^  password:\s*(\S+)/m);
  if (!match) throw new Error('staging password not found in testaccounts.txt');
  return match[1];
}

export async function apiLogin(identifier) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: stagingPassword() }),
  });
  if (!res.ok) throw new Error(`login ${identifier} -> ${res.status}`);
  const body = await res.json();
  return body.token ?? body.accessToken ?? body.jwt;
}

let browser = null;
export async function getBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars', '--lang=vi'],
    });
  }
  return browser;
}

export async function closeBrowser() {
  if (browser) { await browser.close(); browser = null; }
}

const logs = [];
export function log(line) {
  logs.push(`[${new Date().toISOString()}] ${line}`);
  console.log(line);
}

/** Authenticated JSON API call with Idempotency-Key on writes. */
export async function api({ user, method = 'GET', path: apiPath, body, idem }) {
  const token = await apiLogin(user);
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  if (method !== 'GET') headers['Idempotency-Key'] = idem ?? `qa-w1-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await fetch(`${BASE}${apiPath}`, {
    method, headers,
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON (file, empty) */ }
  log(`API ${method} ${apiPath} as ${user} -> ${res.status}`);
  return { status: res.status, ok: res.ok, json, text };
}

/** Open an authenticated page session. */
export async function openAs(user, { w = 1440, h = 900 } = {}) {
  const token = await apiLogin(user);
  const brow = await getBrowser();
  const page = await brow.newPage();
  await page.setViewport({ width: w, height: h, isMobile: w < 800, hasTouch: w < 800 });
  page.on('pageerror', (e) => log(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') log(`console.error: ${m.text().slice(0, 300)}`); });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  return page;
}

export async function goto(page, url, { wait = 2500 } = {}) {
  await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, wait));
  log(`GOTO ${url}`);
}

export async function shot(page, name, { fullPage = true } = {}) {
  const file = path.join(OUT, name.endsWith('.png') ? name : `${name}.png`);
  await page.screenshot({ path: file, fullPage });
  log(`SHOT ${file}`);
  return file;
}

/** DOM text helpers — body text is the primary assertion surface. */
export async function bodyText(page) {
  return page.evaluate(() => document.body.innerText);
}

export async function assertEval(page, name, fn) {
  try {
    const value = await page.evaluate(fn);
    log(`ASSERT ${name} = ${JSON.stringify(value)?.slice(0, 400)}`);
    return value;
  } catch (e) {
    log(`ASSERT ${name} EVAL-ERROR: ${e.message}`);
    return `EVAL-ERROR: ${e.message}`;
  }
}

/** Set a React controlled input's value with native setter + input event. */
export async function setInputValue(page, selector, value) {
  await page.evaluate((sel, val) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`no element ${sel}`);
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, selector, value);
}

export async function clickButtonByText(page, text, { exact = false } = {}) {
  const clicked = await page.evaluate((needle, isExact) => {
    const buttons = [...document.querySelectorAll('button, [role="button"], a')];
    const target = buttons.find((b) => {
      const t = (b.textContent ?? '').trim();
      return isExact ? t === needle : t.includes(needle);
    });
    if (!target) return false;
    target.scrollIntoView({ block: 'center' });
    target.click();
    return (target.textContent ?? '').trim();
  }, text, exact);
  log(`CLICK "${text}" -> ${JSON.stringify(clicked)}`);
  if (!clicked) throw new Error(`button not found: ${text}`);
  await new Promise((r) => setTimeout(r, 1200));
  return clicked;
}

/** Finish: write driver log + assertions json, close browser. */
export async function finish(card, results) {
  fs.writeFileSync(path.join(OUT, `${card}_ui-driver.log`), logs.join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, `${card}_assertions.json`), JSON.stringify(results, null, 2));
  await closeBrowser();
  const fails = Object.entries(results).filter(([, v]) => v === false || (typeof v === 'string' && v.startsWith('EVAL-ERROR')));
  log(`FINISH ${card}: ${results.length ? `${Object.keys(results).length} checks, ${fails.length} failed` : 'log only'}`);
  if (fails.length) console.log('FAILED CHECKS:', fails.map(([k]) => k).join(', '));
  return fails;
}
