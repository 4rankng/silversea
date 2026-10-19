// Local drive helpers — card 191026160000 chiphi2-b. House pattern from
// testplan/qa/scripts/w5w4-lib.mjs, pointed at the ephemeral local stack
// (frontend :7178 → backend :3003 → dev DB :5441) serving THIS worktree.
import puppeteer from 'puppeteer-core';
import { mkdirSync, appendFileSync } from 'node:fs';

export const BASE = process.env.QA_BASE ?? 'http://localhost:7178';
export const API = process.env.QA_API ?? 'http://localhost:3003/api';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

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
    await page.screenshot({ path, fullPage: false });
    log(`shot ${path}`);
    return path;
  };
  return log;
}

export async function tokenPage(browser, token, url) {
  const page = await browser.newPage();
  page.on('pageerror', (err) => console.log(`[pageerror] ${err.message}`));
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
  return page;
}

/** Click the first button whose trimmed text contains `text`. */
export async function clickButtonByText(page, text, { scope = 'body' } = {}) {
  const clicked = await page.evaluate((needle, scopeSel) => {
    const root = document.querySelector(scopeSel) ?? document;
    const buttons = [...root.querySelectorAll('button')];
    const hit = buttons.find((b) => (b.textContent ?? '').trim().includes(needle) && !b.disabled);
    if (!hit) return null;
    hit.scrollIntoView({ block: 'center' });
    hit.click();
    return hit.textContent.trim();
  }, text, scope);
  if (!clicked) throw new Error(`button not found/enabled: ${text}`);
  return clicked;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function bodyText(page) {
  return page.evaluate(() => document.body.innerText);
}
