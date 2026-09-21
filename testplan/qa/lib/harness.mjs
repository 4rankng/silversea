// testplan/qa/lib/harness.mjs — reusable browser + API harness.
//
// Every case imports `createSession` and gets a `ctx` with a domain-specific API
// (e.g. ctx.pickCustomer('Long Minh'), ctx.clearCombobox('Nhà máy')). Raw
// puppeteer calls should NEVER appear in case files — they're for the harness.
//
// Rung-3 evidence pattern (per AGENTS.md UI verification contract):
//   1. Screenshot after click       — ctx.screenshot('name') writes to evidence dir
//   2. Post-click DOM assertion     — ctx.assertTextMatches(...) or custom JS
//   3. DB/API side-effect proof     — ctx.apiGet('/api/...') or ctx.snapshotShipment(id)
//   4. Driver log                   — automatic (case → harness writes JSON summary)

import puppeteer from 'puppeteer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { QE } from './selectors.mjs';
import { loadEnv } from './env.mjs';

const SETTLE_DEFAULT_MS = 500;
const NAV_TIMEOUT_MS = 30000;

async function settle(page, ms = SETTLE_DEFAULT_MS) {
  await new Promise((r) => setTimeout(r, ms));
  try { await page.waitForNetworkIdle({ idleTime: 250, timeout: 2500 }); } catch (_) {}
}

async function shot(page, evidenceDir, name) {
  await fs.mkdir(evidenceDir, { recursive: true });
  const file = path.join(evidenceDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

/**
 * Create a session: token via API + a fresh browser context with the token
 * pre-injected into localStorage (puppeteer-spa-auth pattern).
 */
export async function createSession({ env, role, evidenceDir, runId }) {
  // Resolve the login by walking the role's candidate list: the local DB may
  // be in either mode (dev-seed demo users or make stgdb prod-mirror), so the
  // first testaccounts entry is not always present. QA_USER_<ROLE> override
  // still wins and is tried alone.
  const override = process.env[`QA_USER_${role}`];
  const candidates = override ? [override] : env.candidatesFor(role).filter((u) => /^[a-z][a-z0-9-]+$/i.test(u));
  if (candidates.length === 0) {
    throw new Error(`no username for role ${role} in env ${env.env}; check testplan/testaccounts.txt`);
  }

  // Get token via API (fast, no DOM interaction)
  let token; let user; let username = null;
  for (const candidate of candidates) {
    const r = await fetch(`${env.api}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: candidate, password: env.password }),
    });
    if (r.ok) {
      ({ token, user } = await r.json());
      username = candidate;
      break;
    }
  }
  if (!username) {
    throw new Error(`login for role ${role} failed: all ${candidates.length} candidate(s) refused (${candidates.join(', ')})`);
  }

  const browser = await puppeteer.launch({
    headless: 'shell',
    ...(process.env.BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH } : {}),
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const browserContext = await browser.createBrowserContext();
  const page = await browserContext.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text().slice(0, 200)}`);
  });

  // Auto-capture all POST/PUT/PATCH responses for "API side-effect proof"
  const apiCalls = [];
  page.on('response', async (resp) => {
    const req = resp.request();
    const m = req.method();
    if (m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE') {
      try {
        const body = await resp.text();
        apiCalls.push({ method: m, url: resp.url(), status: resp.status(), body: body.slice(0, 1500) });
      } catch (_) {}
    }
  });

  /** ctx — domain API exposed to case files. */
  const ctx = {
    env, browser, page, browserContext, evidenceDir, runId,
    username, role, user,
    token,
    errors,
    apiCalls,
    shotCounter: 0,

    async goto(url) {
      await page.goto(`${env.baseUrl}${url}`, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT_MS });
      await settle(page, 800);
      return this;
    },

    async screenshot(label) {
      this.shotCounter += 1;
      const name = `${String(this.shotCounter).padStart(2, '0')}_${label}`;
      const file = await shot(page, evidenceDir, name);
      return file;
    },

    async settle(ms) { await settle(page, ms); return this; },

    async apiGet(path) {
      // Use the stored token directly (works before first navigation, when
      // localStorage isn't accessible from the page yet).
      const r = await fetch(`${env.api.replace(/\/$/, '')}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const text = await r.text();
      return { status: r.status, body: (() => { try { return JSON.parse(text); } catch { return text; } })() };
    },

    // Write-capable API client for cases that create or mutate fixtures
    // (ctx.apiGet stays read-only). Returns the fetch-like shape cases
    // expect ({ok, status, data}). Paths may carry a leading "/api" —
    // env.api already ends in /api, so it is stripped to avoid doubling.
    api: {
      async _call(method, path, body) {
        const clean = path.startsWith('/api/') ? path.slice(4) : path;
        const r = await fetch(`${env.api.replace(/\/$/, '')}/${clean.replace(/^\//, '')}`, {
          method,
          headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        const text = await r.text();
        const data = (() => { try { return JSON.parse(text); } catch { return text; } })();
        return { ok: r.ok, status: r.status, data };
      },
      get(path) { return this._call('GET', path); },
      post(path, body) { return this._call('POST', path, body); },
      put(path, body) { return this._call('PUT', path, body); },
      patch(path, body) { return this._call('PATCH', path, body); },
      delete(path) { return this._call('DELETE', path); },
    },

    async snapshotShipment(id) {
      return await this.apiGet(`/shipments/${id}`);
    },

    /** Pick a combobox by aria-label, optionally type a query, click first option. */
    async pickCombobox(label, query = '') {
      const handle = await page.evaluateHandle(QE.comboboxByAriaLabel(label));
      const el = handle.asElement();
      if (!el) return { ok: false, error: `no combobox aria-label="${label}"` };
      await el.click();
      await settle(page, 250);
      if (query) {
        await page.keyboard.type(query, { delay: 25 });
        await settle(page, 700);
      }
      const picked = await page.evaluate(QE.clickFirstListboxOption);
      if (!picked) return { ok: false, error: 'listbox did not appear or no option matched' };
      await settle(page, 500);
      return { ok: true, picked };
    },

    async pickComboboxByPlaceholder(placeholder, query = '') {
      const handle = await page.evaluateHandle(QE.comboboxByPlaceholder(placeholder));
      const el = handle.asElement();
      if (!el) return { ok: false, error: `no combobox placeholder="${placeholder}"` };
      await el.click();
      await settle(page, 250);
      if (query) {
        await page.keyboard.type(query, { delay: 25 });
        await settle(page, 700);
      }
      const picked = await page.evaluate(QE.clickFirstListboxOption);
      if (!picked) return { ok: false, error: 'listbox did not appear or no option matched' };
      await settle(page, 500);
      return { ok: true, picked };
    },

    async pickHinhThucNhapKhau() {
      const result = await page.evaluate(QE.setHinhThucValue('IMPORT'));
      await settle(page, 400);
      return result;
    },

    /** Click the X (clear) button next to a combobox identified by aria-label. */
    async clearCombobox(label) {
      return await page.evaluate(QE.clickClearForCombobox(label));
    },

    /** Read the current value of a combobox. */
    async comboboxValue(label) {
      return await page.evaluate(QE.comboboxValue(label));
    },

    async clickSubmit(text = 'Tạo lô hàng') {
      return await page.evaluate(QE.clickSubmitButton(text));
    },

    /** Find a table row containing fragment and return its text snippet. */
    async rowContaining(fragment) {
      return await page.evaluate(QE.tableRowContaining(fragment));
    },

    async domText() {
      return await page.evaluate(() => document.body.innerText);
    },

    async typeInto(selector, text) {
      const handle = await page.$(selector);
      if (!handle) return { ok: false, error: `selector not found: ${selector}` };
      await handle.click();
      await page.keyboard.type(text, { delay: 20 });
      return { ok: true };
    },

    async close() {
      await browserContext.close();
      await browser.close();
    },
  };

  return ctx;
}

/**
 * Pick today's date in YYYY-MM-DD, useful for date filter smoke tests.
 */
export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/** Write a per-run summary file. */
export async function writeRunSummary({ runId, evidenceDir, results }) {
  const file = path.join(evidenceDir, 'results.json');
  await fs.mkdir(evidenceDir, { recursive: true });
  await fs.writeFile(file, JSON.stringify({ runId, timestamp: new Date().toISOString(), results }, null, 2));
  return file;
}
