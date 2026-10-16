// W5+W4 staging verify (buildHash 5a139108) — shared drive helpers.
// House pattern from qa/2026-10-16_bang-gia-tombstone_ui-drive.mjs:
// puppeteer-core + system Chrome, localStorage token injection, click-by-text.
import puppeteer from 'puppeteer-core';
import { mkdirSync, appendFileSync } from 'node:fs';

export const BASE = 'https://vantai.tingting.vip';
export const API = `${BASE}/api`;
// Re-pinnable per dispatcher ruling (2026-10-16: 5a139108 → 9e400e63).
export const EXPECTED_BUILD = process.env.W5W4_EXPECTED_BUILD ?? '5a139108';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export async function assertBuild(logger) {
  const res = await fetch(`${API}/health`);
  const j = await res.json();
  if (j.buildHash !== EXPECTED_BUILD) {
    throw new Error(`BUILD GATE FAILED: staging buildHash ${j.buildHash} != expected ${EXPECTED_BUILD}`);
  }
  logger?.(`buildHash gate OK: ${j.buildHash}`);
  return j.buildHash;
}

export async function login(identifier, password = 'Abc123') {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  if (!res.ok) throw new Error(`login ${identifier}: HTTP ${res.status}`);
  const { token } = await res.json();
  if (!token) throw new Error(`login ${identifier}: no token`);
  return token;
}

export async function launch(viewport = { width: 1440, height: 1000 }) {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--window-size=1920,1200', '--hide-scrollbars'],
    defaultViewport: viewport,
  });
}

export function makeLogger(prefix) {
  mkdirSync('qa', { recursive: true });
  const LOG = `qa/${prefix}_ui-driver.log`;
  appendFileSync(LOG, `\n=== run ${new Date().toISOString()} ===\n`);
  const log = (line) => {
    const t = `${new Date().toISOString()} ${line}`;
    console.log(t);
    appendFileSync(LOG, `${t}\n`);
  };
  log.shot = async (page, name) => {
    const path = `qa/${prefix}_${name}.png`;
    await page.screenshot({ path });
    log(`shot ${path}`);
    return path;
  };
  return log;
}

// Every non-GET the SPA issues through window.fetch carries a unique
// Idempotency-Key, recorded in window.__w5w4Writes for the driver to dump.
export function installIdempotency(page) {
  return page.evaluateOnNewDocument(() => {
    const orig = window.fetch.bind(window);
    window.__w5w4Writes = [];
    window.fetch = function (input, init) {
      init = init || {};
      let method = init.method || (input && input.method) || 'GET';
      method = String(method).toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') {
        const key = window.crypto && window.crypto.randomUUID
          ? window.crypto.randomUUID()
          : `qa-${Date.now()}-${Math.random()}`;
        const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
        headers.set('Idempotency-Key', key);
        init.headers = headers;
        window.__w5w4Writes.push({ method, url: String(input), key });
      }
      return orig(input, init);
    };
  });
}

export function newPage(browser) {
  return browser.newPage();
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// clickButtonByText: pass the pattern SOURCE as a string — puppeteer serializes
// a RegExp argument to {} (house lesson, HANDOFF 2026-10-16).
export async function clickButtonByText(page, re, scope = '') {
  const source = re instanceof RegExp ? re.source : String(re);
  const flags = re instanceof RegExp ? re.flags : '';
  const ok = await page.evaluate((src, fl, sc) => {
    const re2 = new RegExp(src, fl);
    const root = sc ? document.querySelector(sc) : document;
    const btn = [...(root ? root.querySelectorAll('button') : [])].find((b) => {
      const label = `${b.getAttribute('aria-label') || ''} ${b.textContent || ''}`.trim();
      return re2.test(label) && !b.disabled;
    });
    if (!btn) return false;
    btn.click();
    return true;
  }, source, flags, scope);
  if (!ok) throw new Error(`button not found/enabled: /${source}/ in ${scope || 'page'}`);
  await sleep(250);
}

// Native setter + input/change/blur, the way the tombstone drive fills inputs.
export async function fillInput(page, findEl, value) {
  // findEl(page-context fn) → boolean
  const ok = await page.evaluate(findEl, value);
  if (!ok) throw new Error('fillInput: target input not found');
  await sleep(150);
}

export async function setInputBySelectorIn(page, scopeSelector, inputSelector, value) {
  const ok = await page.evaluate((scope, sel, val) => {
    const root = scope ? document.querySelector(scope) : document;
    if (!root) return false;
    const input = [...root.querySelectorAll(sel)].find((i) => !i.disabled && !i.readOnly);
    if (!input) return false;
    const proto = input instanceof window.HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(input, val);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }, scopeSelector, inputSelector, value);
  if (!ok) throw new Error(`setInputBySelectorIn: no input ${inputSelector} in ${scopeSelector || 'page'}`);
  await sleep(150);
}

// UuiSelectField is a styled native <select>; pick by OPTION LABEL.
export async function selectByLabel(page, labelText, optionLabelMatcher) {
  // optionLabelMatcher: string source of RegExp; matches the option text.
  const source = optionLabelMatcher instanceof RegExp ? optionLabelMatcher.source : String(optionLabelMatcher);
  const flags = optionLabelMatcher instanceof RegExp ? optionLabelMatcher.flags : 'i';
  const ok = await page.evaluate((lt, src, fl) => {
    const re2 = new RegExp(src, fl);
    const labels = [...document.querySelectorAll('label')];
    const lbl = labels.find((l) => l.textContent.trim() === lt);
    if (!lbl) return `no label ${lt}`;
    let el = lbl.parentElement;
    let guard = 0;
    while (el && guard++ < 6 && !el.querySelector('select')) el = el.parentElement;
    const select = el && el.querySelector('select');
    if (!select) return `no select under label ${lt}`;
    const opt = [...select.options].find((o) => re2.test(o.textContent.trim()));
    if (!opt) return `no option matching /${src}/ under ${lt}`;
    const proto = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    proto.call(select, opt.value);
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return `picked "${opt.textContent.trim()}" (${opt.value})`;
  }, labelText, source, flags);
  if (typeof ok === 'string' && !ok.startsWith('picked')) throw new Error(`selectByLabel: ${ok}`);
  await sleep(200);
  return ok;
}

export async function waitFor(page, fn, timeoutMs = 15000, ...args) {
  try {
    await page.waitForFunction(fn, { timeout: timeoutMs, polling: 120 }, ...args);
  } catch (e) {
    throw new Error(`waitFor timeout: ${e.message.split('\n')[0]}`);
  }
}

export async function bodyText(page) {
  return page.evaluate(() => document.body.innerText);
}
