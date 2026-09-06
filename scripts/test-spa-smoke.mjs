#!/usr/bin/env node
/**
 * SPA auth + RBAC smoke test for Silversea local dev.
 * - Logs in via API to obtain JWT (fast, deterministic).
 * - Pre-injects `localStorage.token` BEFORE any page load via
 *   `evaluateOnNewDocument` (the React app's auth guard fires on mount,
 *   so post-load injection silently redirects to /login).
 * - Visits the role's home + a forbidden route, captures screenshot,
 *   asserts the final URL.
 *
 * Usage: node scripts/test-spa-smoke.mjs <role>
 *
 * Exit code: 0 if every assertion passes; 1 otherwise.
 */

import puppeteer from "puppeteer";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FRONTEND = "http://localhost:7174";
const BACKEND = "http://localhost:3001/api";
const ARTIFACTS = "qa/2026-09-05_o2c-smoke/auth";
mkdirSync(ARTIFACTS, { recursive: true });

const ROLE_TABLE = {
  admin: { username: "admin", home: "/dashboard", allow: ["/admin-center"] },
  giamdoc: { username: "giamdoc", home: "/dashboard", allow: [] },
  ketoan: { username: "ketoan", home: "/accounting", allow: [] },
  cus: { username: "cus", home: "/shipments", allow: [] },
  dieuvan: { username: "dieuvan", home: "/dispatch", allow: [] },
  giaonhan: { username: "giaonhan", home: "/my-orders", allow: [] },
  laixe: { username: "laixe", home: "/my-trips", allow: [] },
  samsung: { username: "samsung-cs", home: "/portal/shipments", allow: [] },
};

async function login(username, password) {
  const res = await fetch(`${BACKEND}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: username, password }),
  });
  if (!res.ok) throw new Error(`login ${username} → ${res.status}`);
  const body = await res.json();
  return body.token;
}

async function runRole(roleKey) {
  const spec = ROLE_TABLE[roleKey];
  if (!spec) throw new Error(`unknown role ${roleKey}`);
  const token = await login(spec.username, "Abc123");
  const log = [];
  log.push(`[${new Date().toISOString()}] role=${roleKey} token-len=${token.length}`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on("pageerror", (e) => log.push(`PAGE-ERROR: ${e.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") log.push(`CONSOLE-ERROR: ${msg.text().slice(0, 200)}`);
  });

  // Critical: inject BEFORE first navigation. See puppeteer-spa-auth skill.
  await page.evaluateOnNewDocument((t) => {
    localStorage.setItem("token", t);
  }, token);

  // 1) Visit root, expect redirect to role home
  await page.goto(`${FRONTEND}/`, { waitUntil: "networkidle2", timeout: 15000 });
  await new Promise((r) => setTimeout(r, 800));
  const urlAfterRoot = page.url();
  log.push(`after /  url=${urlAfterRoot}`);

  // Screenshot home
  await page.screenshot({
    path: join(ARTIFACTS, `${roleKey}_home.png`),
    fullPage: false,
  });

  // 2) Visit home directly
  await page.goto(`${FRONTEND}${spec.home}`, { waitUntil: "networkidle2", timeout: 15000 });
  await new Promise((r) => setTimeout(r, 600));
  const urlAfterHome = page.url();
  const homeOk = urlAfterHome.includes(spec.home);
  log.push(`home visit: ${urlAfterHome} → ${homeOk ? "PASS" : "FAIL"}`);

  // Sidebar nav items (sidebar uses <button class="sidebar-item"> not <a>)
  const nav = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('.sidebar-nav .sidebar-item'));
    return buttons
      .map((b) => b.querySelector('.sidebar-item-label')?.textContent?.trim() || b.getAttribute('aria-label'))
      .filter(Boolean);
  });
  log.push(`nav items: ${JSON.stringify(nav)}`);

  // 3) RBAC negative: try a forbidden route
  const forbidden = "/admin-center";
  await page.goto(`${FRONTEND}${forbidden}`, { waitUntil: "networkidle2", timeout: 15000 });
  await new Promise((r) => setTimeout(r, 800));
  const urlAfterForbidden = page.url();
  // Should NOT be /admin-center — should redirect home or to /
  const blockedFromAdmin = !urlAfterForbidden.includes(forbidden) || roleKey === "admin";
  log.push(`forbidden /admin-center → ${urlAfterForbidden} → ${blockedFromAdmin ? "BLOCKED-OK" : "LEAKED"}`);

  await page.screenshot({
    path: join(ARTIFACTS, `${roleKey}_after-forbidden.png`),
  });

  // 4) RBAC negative: try /dispatch if not dispatcher
  const dispatchBlocked = await (async () => {
    await page.goto(`${FRONTEND}/dispatch`, { waitUntil: "networkidle2", timeout: 15000 });
    await new Promise((r) => setTimeout(r, 600));
    const u = page.url();
    return {
      url: u,
      blocked: !u.includes("/dispatch") || roleKey === "dieuvan" || roleKey === "admin",
    };
  })();
  log.push(`/dispatch → ${dispatchBlocked.url} → ${dispatchBlocked.blocked ? "BLOCKED-OK" : "LEAKED"}`);

  await browser.close();

  // Summary row
  const summary = {
    role: roleKey,
    username: spec.username,
    expectedHome: spec.home,
    urlAfterRoot,
    urlAfterHome,
    homeOk,
    forbiddenAdminBlocked: blockedFromAdmin,
    dispatchBlocked: dispatchBlocked.blocked,
    navItemsCount: nav.length,
    navItems: nav,
    log,
  };

  writeFileSync(
    join(ARTIFACTS, `${roleKey}.json`),
    JSON.stringify(summary, null, 2),
  );

  return summary;
}

const role = process.argv[2] || "cus";
const result = await runRole(role);
console.log(JSON.stringify(result, null, 2));
process.exit(result.homeOk && result.forbiddenAdminBlocked && result.dispatchBlocked ? 0 : 1);