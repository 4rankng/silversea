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

// ── shared toolkit (2026-10-17) ─────────────────────────────────────────────
// The 16/10 drivers addressed the create form and the dispatch grids by LABEL
// text and by `containerNumbers` fields the ops payload does not carry; both
// drifted when FB-105 relabelled the LCL pickers and OPS moved the container
// choice onto a lot-level default. These helpers address the stable contracts
// instead: `data-field-id` anchors, the DB's optimistic-lock version, and the
// sites endpoint the create form itself calls.

/** Pick a value in a SearchableField addressed by its `data-field-id`. */
export async function pickField(page, fieldId, fragment) {
  const sel = `[data-field-id="${fieldId}"] input`;
  const has = await page.evaluate((s) => Boolean(document.querySelector(s)), sel);
  if (!has) return { ok: false, reason: 'field-missing' };
  await page.evaluate((s) => { document.querySelector(s)?.scrollIntoView({ block: 'center' }); }, sel);
  await page.click(sel);
  await sleep(700);
  if (fragment) { await page.keyboard.type(fragment, { delay: 45 }); await sleep(1400); } else await sleep(900);
  const options = await page.evaluate(() => [...document.querySelectorAll('[role="option"]')]
    .filter((o) => o.offsetParent !== null)
    .map((o) => (o.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60))
    .slice(0, 8));
  const picked = await tap(page, `() => {
    const opts = [...document.querySelectorAll('[role="option"]')].filter(o => o.offsetParent !== null);
    if (!opts.length) return null;
    const want = ${JSON.stringify(String(fragment ?? ''))}.trim().toLowerCase();
    if (!want) return opts[0];
    return opts.find(o => (o.textContent || '').trim().toLowerCase().includes(want)) ?? opts[0];
  }`);
  await sleep(600);
  const value = await page.evaluate((s) => document.querySelector(s)?.value ?? null, sel);
  return { ok: Boolean(picked), value, options };
}

/** The operational sites the create form itself offers for a customer. */
export async function customerSites(token, customerId) {
  const res = await api(token, 'GET', `/shipments/operational-sites?customerId=${customerId}`);
  return res.json?.items ?? res.json ?? [];
}

/** First site of a `siteType` the picker can actually resolve. */
export function siteOfType(sites, siteType, { named = true } = {}) {
  const pool = named ? sites.filter((s) => !s.deletedAt && !/chưa xác định/i.test(s.name ?? '')) : sites;
  return pool.find((s) => new RegExp(siteType, 'i').test(String(s.siteType)))
    ?? sites.find((s) => new RegExp(siteType, 'i').test(String(s.siteType)))
    ?? null;
}

/**
 * Governed lot delete. `DELETE /api/shipments/:id` requires the optimistic-lock
 * `version` (the detail payload nests it at `shipment.version`), so read it from
 * the staging row and retry once if a concurrent write moved it.
 */
export async function deleteLot(token, id, reason = 'QA cleanup fullguide') {
  const version = Number(psql(`SELECT version FROM shipments WHERE id=${id}`) || 0);
  for (const attempt of [version, version + 1]) {
    const res = await api(token, 'DELETE', `/shipments/${id}`, { version: attempt, reason });
    if (res.ok) return { ok: true, version: attempt, status: res.status };
    if (res.status !== 409) return { ok: false, version: attempt, status: res.status, body: res.text?.slice(0, 140) };
  }
  return { ok: false, status: 409, body: 'version kept moving' };
}

/** VN calendar date `today + offsetDays` — the price-lane dates the config page accepts. */
export function vnDate(offsetDays = 0) {
  return new Date(Date.now() + 7 * 3600 * 1000 + offsetDays * 86400 * 1000).toISOString().slice(0, 10);
}

/**
 * Real mouse click on the first visible button matching `textRe`. React Aria
 * opens some popovers/dialogs only for a trusted click, so `element.click()`
 * is not enough (the A.3 "Gán xe nhóm" dialog stayed shut for it).
 */
export async function clickByText(page, textRe) {
  const box = await page.evaluate((re) => {
    const rx = new RegExp(re, 'i');
    const b = [...document.querySelectorAll('button')].find((x) => rx.test(x.textContent || '') && !x.disabled && x.offsetParent !== null);
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, textRe);
  if (!box) return false;
  await page.mouse.click(box.x, box.y);
  return true;
}

/**
 * Read the master-plan grid rows carrying each ref as aligned cells. The grid
 * is a div table (no `tr`/`td`), so walk the text node up to the row element
 * whose own text holds the ref and take its direct children as the columns.
 * Returns `{ headerCells, rows: { [ref]: { cls, text, cells } | null } }`.
 */
export async function readPlanRows(page, refs) {
  return page.evaluate((tokens) => {
    const headerCells = [...document.querySelectorAll('[role="columnheader"], th')]
      .map((h) => (h.innerText || '').replace(/\s+/g, ' ').trim());
    const rowFor = (ref) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node = null;
      let hit = null;
      while ((node = walker.nextNode())) {
        if ((node.nodeValue || '').includes(ref)) { hit = node.parentElement; break; }
      }
      if (!hit) return null;
      let el = hit;
      for (let i = 0; i < 8 && el; i += 1) {
        const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
        if (text.includes(ref) && text.length > 40) {
          return { cls: String(el.className ?? '').slice(0, 70), text, cells: [...el.children].map((c) => (c.innerText || '').replace(/\s+/g, ' ').trim()) };
        }
        el = el.parentElement;
      }
      return null;
    };
    return { headerCells, rows: Object.fromEntries(tokens.map((token) => [token, rowFor(token)])) };
  }, refs);
}
