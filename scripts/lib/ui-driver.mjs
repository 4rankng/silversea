#!/usr/bin/env node
/**
 * Puppeteer session + form helpers for Silversea QA scripts.
 *
 * Why this module exists (read this before forking it):
 *
 *  1. The Silversea SPA's auth guard runs on React mount and reads
 *     `localStorage.token`. If you `localStorage.setItem("token", t)` AFTER
 *     the first page load, the guard sees no token and silently redirects
 *     to /login — every assertion downstream then screenshots the login
 *     page. The fix is `evaluateOnNewDocument`, which runs before any
 *     page script on every navigation in the session. This module
 *     enforces that pattern via `withSession()` so a future script
 *     cannot regress to the "injects too late" trap.
 *
 *  2. The form helpers (`pickCombobox`, `fillPlain`, `setAtIndex`) all
 *     use the React-friendly "set value via the prototype setter + dispatch
 *     input/change events" pattern, which is the only reliable way to
 *     drive a controlled React input from puppeteer. Plain `el.value =`
 *     silently no-ops on controlled inputs.
 *
 *  3. The 3 existing puppeteer scripts (test-spa-smoke, test-cus-create-final,
 *     test-o2c-happy) used to copy these 80 lines. This module is the
 *     single source of truth.
 */

import puppeteer from "puppeteer";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Standard puppeteer launch options for the silversea dev stack.
 *  `--disable-dev-shm-usage` is required inside Docker/headless containers
 *  to avoid the /dev/shm 64MB OOM on a moderately heavy page. */
export const STANDARD_BROWSER_ARGS = Object.freeze([
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
]);

/** Default viewport for QA runs. 1440x900 is the design baseline; mobile
 *  tests must override per-script (most layouts are validated at 390x844). */
export const STANDARD_VIEWPORT = Object.freeze({ width: 1440, height: 900 });

/** Headless mode: "new" = Chrome's new headless (recommended for screenshots
 *  that need to look like Chrome). Pass `false` for visible-mode debugging. */
export const STANDARD_HEADLESS = "new";

/**
 * Launch a browser, run `fn(page)` with a page that already has the JWT
 * injected via `evaluateOnNewDocument`, and tear down on completion.
 *
 * @param {string} token  JWT (from `login` in lib/http.mjs). Pass `null`
 *   to skip injection (e.g. for the login screen itself).
 * @param {(page: import('puppeteer').Page, ctx: { log: string[], dir: string }) => Promise<T>} fn
 *   The test body. `ctx.log` is a string[] for one-line notes (saved as
 *   an artifact if you call `writeArtifact`); `ctx.dir` is the artifact
 *   directory scoped to the call.
 * @param {object} [opts]
 *   - `artifactDir`: root directory for artifacts (default: `qa/`).
 *   - `name`: per-session subdir (default: timestamp).
 *   - `headless`, `viewport`, `args`: pass-through to `puppeteer.launch`.
 *   - `installLogging` (default true): attach pageerror/console error
 *     listeners to `page` and push them onto `ctx.log`.
 *   - `puppeteerImpl`: injected puppeteer (tests).
 * @returns {Promise<T>} whatever `fn` returned.
 */
export async function withSession(token, fn, opts = {}) {
  const puppeteerImpl = opts.puppeteerImpl ?? puppeteer;
  const artifactRoot = opts.artifactDir ?? "qa";
  const sessionName = opts.name ?? new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(artifactRoot, sessionName);
  mkdirSync(dir, { recursive: true });
  const log = [];

  const browser = await puppeteerImpl.launch({
    headless: opts.headless ?? STANDARD_HEADLESS,
    args: opts.args ?? STANDARD_BROWSER_ARGS,
    ...(opts.executablePath ? { executablePath: opts.executablePath } : {}),
  });
  try {
    const page = await browser.newPage();
    await page.setViewport(opts.viewport ?? STANDARD_VIEWPORT);

    // CRITICAL: inject before any navigation. The React auth guard reads
    // localStorage on mount; a post-load setItem lands after the redirect
    // to /login and the rest of the script screenshots a login page.
    if (token) {
      await page.evaluateOnNewDocument((t) => {
        localStorage.setItem("token", t);
      }, token);
    }

    if (opts.installLogging !== false) installPageLogging(page, log);

    return await fn(page, { log, dir });
  } finally {
    await browser.close();
  }
}

/** Attach pageerror + console error listeners to `page`; pushes
 *  truncated lines onto `log`. Does not throw — a page error does
 *  not mean the test should fail at the listener stage; let the
 *  assertion in the test body decide. */
export function installPageLogging(page, log) {
  page.on("pageerror", (e) => log.push(`PAGE-EXC: ${(e?.message ?? String(e)).slice(0, 200)}`));
  page.on("console", (m) => {
    if (m.type() === "error") log.push(`CONSOLE-ERR: ${m.text().slice(0, 200)}`);
  });
}

/** Set the value of the Nth (0-based) input/select/textarea on the page
 *  using the React-friendly prototype-setter pattern. Dispatches
 *  input + change events so controlled inputs re-render. */
export async function setAtIndex(page, idx, value) {
  return page.evaluate(({ idx, value }) => {
    const inputs = Array.from(document.querySelectorAll("input, select, textarea"));
    const el = inputs[idx];
    if (!el) throw new Error(`setAtIndex: no input at index ${idx} (have ${inputs.length})`);
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype
                : el.tagName === "SELECT" ? HTMLSelectElement.prototype
                : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { idx, tag: el.tagName, value };
  }, { idx, value });
}

/** Focus the Nth input/select/textarea, then type via puppeteer keyboard
 *  (so React sees the keystrokes; do NOT use this for comboboxes that
 *  filter on a `<div role="listbox">` after a click). */
export async function typeAtIndex(page, idx, text, { delay = 30 } = {}) {
  await page.evaluate(({ idx }) => {
    const inputs = Array.from(document.querySelectorAll("input, select, textarea"));
    inputs[idx]?.focus();
  }, { idx });
  await page.keyboard.type(text, { delay });
}

/** Click the first visible `[role="option"]` element. Returns the option's
 *  text content (truncated) or null if none is visible. */
export async function clickFirstRoleOption(page) {
  return page.evaluate(() => {
    const opts = Array.from(document.querySelectorAll('[role="option"]'))
      .filter((o) => o.offsetParent !== null);
    if (opts.length === 0) return null;
    opts[0].click();
    return opts[0].textContent?.trim()?.slice(0, 60) ?? true;
  });
}

/** Discover the index of an input whose nearest <label> (or aria-label or
 *  placeholder) matches the given substr. Returns -1 if not found. */
export async function findInputIndexByLabel(page, substr) {
  return page.evaluate((needle) => {
    const labels = Array.from(document.querySelectorAll("label"));
    const inputs = Array.from(document.querySelectorAll("input, select, textarea"));
    return inputs.findIndex((inp) => {
      const lab = labels.find((l) => {
        if (l.getAttribute("for") === inp.id) return true;
        return l.parentElement === inp.parentElement
            || l.parentElement === inp.parentElement?.parentElement;
      });
      const haystack = [
        lab?.textContent?.trim() ?? "",
        inp.getAttribute("aria-label") ?? "",
        inp.placeholder ?? "",
      ].join(" | ").toLowerCase();
      return haystack.includes(needle.toLowerCase());
    });
  }, substr);
}

/** Find an input by its label text and return the bound element handle
 *  (useful for comboboxes where the index can shift between pages). */
export async function findInputHandleByLabel(page, labelText) {
  const handle = await page.evaluateHandle((needle) => {
    const labels = Array.from(document.querySelectorAll("label"));
    const lab = labels.find((l) => new RegExp(needle, "i").test(l.textContent ?? ""));
    if (!lab) return null;
    const forId = lab.getAttribute("for");
    if (forId) return document.getElementById(forId);
    return lab.parentElement?.querySelector("input, select, textarea") ?? null;
  }, labelText);
  const isNull = await handle.evaluate((e) => e === null);
  return isNull ? null : handle;
}

/** Drive a combobox: click the input, wait for the listbox, type a query,
 *  wait for the filtered options, click the first visible option. Returns
 *  the picked option's text (truncated) or null on failure. Pushes diagnostic
 *  lines onto `log` (one per stage). */
export async function pickCombobox(page, labelText, query, log = []) {
  const handle = await findInputHandleByLabel(page, labelText);
  if (!handle) {
    log.push(`pickCombobox(${labelText}): input not found`);
    return null;
  }
  await handle.evaluate((e) => { e.focus(); e.click(); });
  await new Promise((r) => setTimeout(r, 600));

  // Clear via the prototype setter (controlled input), then type via
  // keyboard so the autocomplete runs.
  await handle.evaluate((e) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(e, "");
    e.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.keyboard.type(query, { delay: 40 });
  await new Promise((r) => setTimeout(r, 1100));

  const optInfo = await page.evaluate(() => {
    const opts = Array.from(document.querySelectorAll('[role="option"]'));
    return {
      count: opts.length,
      first: opts[0]?.textContent?.trim()?.slice(0, 60) ?? null,
      visible: opts.filter((o) => o.offsetParent !== null).length,
    };
  });
  log.push(`pickCombobox(${labelText}) options after type: ${JSON.stringify(optInfo)}`);

  const picked = await clickFirstRoleOption(page);
  log.push(`pickCombobox(${labelText}) picked: ${picked}`);
  await new Promise((r) => setTimeout(r, 500));
  return picked;
}

/** Find a non-combobox input by label and set its value via the prototype
 *  setter (works for date/time/number/email/text inputs). */
export async function fillPlain(page, labelText, value, log = []) {
  const handle = await findInputHandleByLabel(page, labelText);
  if (!handle) {
    log.push(`fillPlain(${labelText}): input not found`);
    return { ok: false, why: "label not found" };
  }
  const ok = await handle.evaluate((el, value) => {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype
                : el.tagName === "SELECT" ? HTMLSelectElement.prototype
                : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, tag: el.tagName };
  }, value);
  log.push(`fillPlain(${labelText}=${value}): ${JSON.stringify(ok)}`);
  return ok;
}

/** Find and click a button whose text matches `pattern` (RegExp source). */
export async function clickButtonByText(page, pattern) {
  return page.evaluate((patSrc) => {
    const re = new RegExp(patSrc);
    const btn = [...document.querySelectorAll("button")]
      .find((b) => re.test(b.textContent?.trim() ?? ""));
    if (!btn) return null;
    btn.click();
    return btn.textContent?.trim() ?? true;
  }, pattern);
}

/** Find and click a button by text or aria-label; returns the matched
 *  text (or null) for the assertion. */
export async function clickButton(page, { text, ariaLabel } = {}) {
  return page.evaluate(({ text, ariaLabel }) => {
    const btn = [...document.querySelectorAll("button")].find((b) => {
      if (ariaLabel && b.getAttribute("aria-label") === ariaLabel) return true;
      if (text && (b.textContent?.trim() ?? "").includes(text)) return true;
      return false;
    });
    if (!btn) return null;
    btn.click();
    return btn.textContent?.trim() ?? true;
  }, { text, ariaLabel });
}

/** Wait for `ms` milliseconds. Exists so the test body can use a single
 *  vocabulary for "settle" waits; not a substitute for `waitForSelector`. */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Write a JSON artifact under `dir/name`. Creates `dir` if missing.
 *  Returns the absolute path of the written file so the caller can attach
 *  it to a manifest. */
export function writeArtifact(dir, name, data) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  return file;
}
