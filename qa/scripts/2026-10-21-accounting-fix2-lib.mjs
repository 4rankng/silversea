// Shared helpers for the 2026-10-21 accounting-fix2 verify-first drivers.
// Local dev only: FE :7185, BE :3012 (this worktree's stack).
import { strict as assert } from 'node:assert';

export const FE = 'http://localhost:7185';
export const API = 'http://localhost:3012/api';

export async function login(identifier, password = 'Abc123') {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  assert.equal(res.status, 200, `login ${identifier} -> ${res.status}`);
  return res.json();
}

export async function authedGet(token, path) {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

export async function authedSend(token, path, method, payload, extraHeaders = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...extraHeaders },
    body: payload == null ? undefined : JSON.stringify(payload),
  });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

export async function newPage(browser, token, { width = 1440, height = 900 } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width, height });
  if (token) {
    await page.evaluateOnNewDocument((t) => {
      localStorage.setItem('token', t);
    }, token);
  }
  return page;
}

export async function shot(page, path) {
  await page.screenshot({ path, fullPage: true });
  return path;
}

export function log(section, ...rest) {
  console.log(`[${new Date().toISOString()}] ${section}`, ...rest);
}
