#!/usr/bin/env node
/**
 * SPA auth + RBAC smoke test for Silversea local dev.
 *
 * Walks one role through:
 *   1) visit /             → expect redirect to role home
 *   2) visit role home     → expect 200, no redirect away
 *   3) try /admin-center   → expect block (unless role is admin)
 *   4) try /dispatch       → expect block (unless role is dieuvan or admin)
 *
 * Captures:  1 screenshot per state + a JSON summary per role
 * Output:    qa/<date>_spa-smoke/<role>.{json,png}
 * Exit code: 0 on every PASS, 1 if any role failed.
 *
 * Usage: node scripts/test-spa-smoke.mjs [role]
 *        node scripts/test-spa-smoke.mjs all   # run every role in ROLES
 */

import puppeteer from "puppeteer";
import { join } from "node:path";
import { api, DEFAULT_BACKEND, DEFAULT_FRONTEND, login, ROLES, role } from "./lib/http.mjs";
import {
  STANDARD_BROWSER_ARGS,
  STANDARD_HEADLESS,
  STANDARD_VIEWPORT,
  installPageLogging,
  sleep,
  withSession,
  writeArtifact,
} from "./lib/ui-driver.mjs";

const FRONTEND = process.env.FRONTEND ?? DEFAULT_FRONTEND;
const ARTIFACTS = process.env.ARTIFACTS ?? `qa/${new Date().toISOString().slice(0, 10)}_spa-smoke`;

const FORBIDDEN = "/admin-center";
const DISPATCH = "/dispatch";

const rolesToRun = process.argv[2] === "all"
  ? Object.keys(ROLES)
  : [process.argv[2] ?? "cus"];

async function runRole(roleKey) {
  const spec = role(roleKey);
  const token = await login(roleKey);
  const log = [];
  log.push(`[${new Date().toISOString()}] role=${roleKey} token-len=${token.length}`);

  const result = await withSession(token, async (page, ctx) => {
    installPageLogging(page, ctx.log);

    // 1) Visit root, expect redirect to role home
    await page.goto(`${FRONTEND}/`, { waitUntil: "networkidle2", timeout: 15_000 });
    await sleep(800);
    const urlAfterRoot = page.url();
    ctx.log.push(`after /  url=${urlAfterRoot}`);
    await page.screenshot({ path: join(ARTIFACTS, `${roleKey}_home.png`) });

    // 2) Visit home directly
    await page.goto(`${FRONTEND}${spec.home}`, { waitUntil: "networkidle2", timeout: 15_000 });
    await sleep(600);
    const urlAfterHome = page.url();
    const homeOk = urlAfterHome.includes(spec.home);
    ctx.log.push(`home visit: ${urlAfterHome} → ${homeOk ? "PASS" : "FAIL"}`);

    // Sidebar nav items
    const nav = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll(".sidebar-nav .sidebar-item"));
      return buttons
        .map((b) => b.querySelector(".sidebar-item-label")?.textContent?.trim() || b.getAttribute("aria-label"))
        .filter(Boolean);
    });
    ctx.log.push(`nav items: ${JSON.stringify(nav)}`);

    // 3) Forbidden: /admin-center
    await page.goto(`${FRONTEND}${FORBIDDEN}`, { waitUntil: "networkidle2", timeout: 15_000 });
    await sleep(800);
    const urlAfterForbidden = page.url();
    const blockedFromAdmin = !urlAfterForbidden.includes(FORBIDDEN) || roleKey === "admin";
    ctx.log.push(`forbidden ${FORBIDDEN} → ${urlAfterForbidden} → ${blockedFromAdmin ? "BLOCKED-OK" : "LEAKED"}`);
    await page.screenshot({ path: join(ARTIFACTS, `${roleKey}_after-forbidden.png`) });

    // 4) /dispatch — DISPATCH resource is allowed for ADMIN, MANAGER, DISPATCHER
    //    per the ROLE_GUARDS table in staging-visual-matrix.mjs. Others are blocked.
    const DISPATCH_ALLOWED = new Set(["admin", "giamdoc", "dieuvan"]);
    await page.goto(`${FRONTEND}${DISPATCH}`, { waitUntil: "networkidle2", timeout: 15_000 });
    await sleep(600);
    const urlAfterDispatch = page.url();
    const blockedFromDispatch = !urlAfterDispatch.includes(DISPATCH) || DISPATCH_ALLOWED.has(roleKey);
    ctx.log.push(`${DISPATCH} → ${urlAfterDispatch} → ${blockedFromDispatch ? "BLOCKED-OK" : "LEAKED"}`);

    return {
      role: roleKey,
      username: spec.username,
      expectedHome: spec.home,
      urlAfterRoot,
      urlAfterHome,
      homeOk,
      forbiddenAdminBlocked: blockedFromAdmin,
      dispatchBlocked: blockedFromDispatch,
      navItemsCount: nav.length,
      navItems: nav,
    };
  }, { artifactDir: ARTIFACTS, name: roleKey, puppeteerImpl: puppeteer });

  // Sanity check: also hit the role's own API endpoint to make sure the
  // token is not just valid in the SPA but also against the backend RBAC.
  const apiCheck = await api(token, "GET", spec.api);
  result.apiSmoke = { endpoint: spec.api, status: apiCheck.status, ok: apiCheck.ok };
  result.log = [...log, ...result.log ?? []];

  const ok = result.homeOk && result.forbiddenAdminBlocked && result.dispatchBlocked;
  writeArtifact(ARTIFACTS, `${roleKey}.json`, { ...result, ok });
  return { ...result, ok };
}

const summary = { generatedAt: new Date().toISOString(), frontend: FRONTEND, roles: [], allPassed: true };
for (const roleKey of rolesToRun) {
  try {
    const r = await runRole(roleKey);
    summary.roles.push(r);
    if (!r.ok) summary.allPassed = false;
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${roleKey}  home=${r.urlAfterHome}  api=${r.apiSmoke?.status}`);
  } catch (error) {
    summary.allPassed = false;
    summary.roles.push({ role: roleKey, ok: false, error: error?.message ?? String(error) });
    console.error(`FAIL  ${roleKey}  ${error?.message ?? error}`);
  }
}
writeArtifact(ARTIFACTS, "summary.json", summary);
process.exit(summary.allPassed ? 0 : 1);
