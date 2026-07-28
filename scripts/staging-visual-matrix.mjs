import fs from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer";

const ROLE_GUARDS = Object.freeze({
  STAFF: new Set(["ADMIN", "MANAGER", "ACCOUNTANT"]),
  OFFICE: new Set(["ADMIN", "MANAGER", "ACCOUNTANT"]),
  STRICT_ADMIN: new Set(["ADMIN"]),
  MANAGER_ADMIN: new Set(["ADMIN", "MANAGER"]),
  DRIVER: new Set(["DRIVER"]),
  FORWARDER: new Set(["FORWARDER"]),
  CUSTOMER: new Set(["CUSTOMER"]),
  CLERK_ADMIN: new Set(["ADMIN", "CLERK"]),
});

export const ROUTES = Object.freeze([
  { path: "/dashboard", guard: "STAFF" },
  { path: "/dispatch", guard: "MANAGER_ADMIN" },
  { path: "/fleet", guard: "STAFF" },
  { path: "/fleet/:id/tires", guard: "OFFICE" },
  { path: "/fleet/trailers/:id/tires", guard: "OFFICE" },
  { path: "/trips", guard: "STAFF" },
  { path: "/trips/new", guard: "STAFF" },
  { path: "/trips/:id", guard: "STAFF" },
  { path: "/trips/:id/edit", guard: "STAFF" },
  { path: "/finance", guard: "STAFF" },
  { path: "/profit", guard: "STAFF" },
  { path: "/debt", guard: "STAFF" },
  { path: "/debt/:id", guard: "STAFF" },
  { path: "/debt/:id/billing/new", guard: "STAFF" },
  { path: "/penalties", guard: "STAFF" },
  { path: "/advances", guard: "STAFF" },
  { path: "/admin/advance-settlements", guard: "OFFICE" },
  { path: "/my-penalties", guard: "DRIVER" },
  { path: "/customers", guard: "STAFF" },
  { path: "/customers/:id", guard: "STAFF" },
  { path: "/customers/:id/billing/new", guard: "STAFF" },
  { path: "/shipments", guard: "OFFICE" },
  { path: "/shipments/:id", guard: "OFFICE" },
  { path: "/config", guard: "STAFF" },
  { path: "/config/trailers", guard: "STAFF" },
  { path: "/config/trucks", guard: "STAFF" },
  { path: "/config/trucks/:truckId/owners", guard: "STAFF" },
  { path: "/config/routes", guard: "STAFF" },
  { path: "/config/business-calendar", guard: "STRICT_ADMIN" },
  { path: "/config/cargo-types", guard: "STAFF" },
  { path: "/config/pricing-tables", guard: "STAFF" },
  { path: "/config/road-allowances", guard: "STAFF" },
  { path: "/config/penalty-reasons", guard: "STAFF" },
  { path: "/config/fuel", guard: "STAFF" },
  { path: "/config/fuel-norms", guard: "STAFF" },
  { path: "/config/weight-pricing-tiers", guard: "STAFF" },
  { path: "/config/lift-pricing", guard: "STAFF" },
  { path: "/config/ancillary-revenue", guard: "STAFF" },
  { path: "/config/faq-entries", guard: "STRICT_ADMIN" },
  { path: "/config/app-settings", guard: "STRICT_ADMIN" },
  { path: "/config/company-info", guard: "STAFF" },
  { path: "/config/trip-expense", guard: "STAFF" },
  { path: "/config/cap-table", guard: "STAFF" },
  { path: "/config/customers", guard: "STAFF" },
  { path: "/config/salary-periods", guard: "STAFF" },
  { path: "/config/expense-categories", guard: "STAFF" },
  { path: "/config/tire-positions", guard: "OFFICE" },
  { path: "/config/forwarder-expense-types", guard: "STAFF" },
  { path: "/config/debit-note-templates", guard: "OFFICE" },
  { path: "/config/debit-note-templates/new", guard: "OFFICE" },
  { path: "/config/debit-note-templates/:id", guard: "OFFICE" },
  { path: "/suppliers", guard: "STAFF" },
  { path: "/suppliers/:id", guard: "STAFF" },
  { path: "/expenses", guard: "STAFF" },
  { path: "/expenses/new", guard: "STAFF" },
  { path: "/expenses/:id/edit", guard: "STAFF" },
  { path: "/payables", guard: "STAFF" },
  { path: "/payables/:id", guard: "STAFF" },
  { path: "/salary", guard: "STAFF" },
  { path: "/credit-overrides", guard: "OFFICE" },
  { path: "/governance-actions", guard: "OFFICE" },
  { path: "/users", guard: "OFFICE" },
  { path: "/chatbot-monitoring", guard: "STRICT_ADMIN" },
  { path: "/audit-logs", guard: "OFFICE" },
  { path: "/my-trips", guard: "DRIVER" },
  { path: "/my-trips/two-orders", guard: "DRIVER" },
  { path: "/my-trips/:id", guard: "DRIVER" },
  { path: "/my-earnings", guard: "DRIVER" },
  { path: "/my-payslips", guard: "DRIVER" },
  { path: "/my-forwarder-trips", guard: "FORWARDER" },
  { path: "/my-forwarder-trips/:id", guard: "FORWARDER" },
  { path: "/my-advances", guard: "FORWARDER" },
  { path: "/my-settlements", guard: "FORWARDER" },
  { path: "/my-settlements/new", guard: "FORWARDER" },
  { path: "/my-settlements/:id", guard: "FORWARDER" },
  { path: "/settlements/:id", guard: "OFFICE" },
  { path: "/portal/shipments", guard: "CUSTOMER" },
  { path: "/portal/shipments/:id", guard: "CUSTOMER" },
  { path: "/portal/debit-notes", guard: "CUSTOMER" },
  { path: "/portal/statement", guard: "CUSTOMER" },
  { path: "/clerk/shipments/new", guard: "CLERK_ADMIN" },
  { path: "/clerk/shipments/:id/docs", guard: "CLERK_ADMIN" },
]);

const REDIRECT_ROUTES = new Set([
  "/",
  "/routes",
  "/trucks",
  "/drivers",
  "/trailers",
  "/config/llm-settings",
  "/config/onboarding-settings",
  "/config/management-fees",
  "/config/container-types",
  "/config/seal-types",
  "/config/ports",
  "/audit-log",
  "/admin/audit-logs",
  "/admin/audit-log",
  "*",
]);

export const DEFAULT_VIEWPORTS = Object.freeze([
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
]);

const DEFAULT_ACCOUNTS = Object.freeze({
  ADMIN: "admin",
  MANAGER: "giamdoc",
  ACCOUNTANT: "ketoan",
  DRIVER: "laixe",
  FORWARDER: "giaonhan",
  CUSTOMER: "khachhang",
  CLERK: "qa_clerk",
});

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const routePattern = (template) =>
  new RegExp(
    `^${template
      .split("/")
      .map((part) => (part.startsWith(":") ? "[^/]+" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
      .join("/")}$`,
  );

const routeSlug = (route) =>
  route
    .replace(/^\/+/, "")
    .replaceAll("/", "__")
    .replaceAll(":", "_")
    .replace(/[^a-zA-Z0-9_-]/g, "_") || "root";

const normalizePathname = (href, baseUrl) => {
  try {
    const url = new URL(href, baseUrl);
    return url.origin === new URL(baseUrl).origin ? url.pathname : null;
  } catch {
    return null;
  }
};

const isRuntimeErrorText = (text) =>
  [
    "Đã xảy ra lỗi",
    "Something went wrong",
    "Cannot read properties of",
    "Unexpected Application Error",
  ].some((needle) => text.includes(needle));

export async function validateRouteManifest({
  appPath = path.resolve("frontend/src/App.tsx"),
} = {}) {
  const source = await fs.readFile(appPath, "utf8");
  const declared = new Set(
    [...source.matchAll(/<Route[\s\S]*?\bpath="([^"]+)"/g)].map((match) => match[1]),
  );
  const audited = new Set([...ROUTES.map((route) => route.path), ...REDIRECT_ROUTES]);
  const missing = [...declared].filter((route) => !audited.has(route)).sort();
  const stale = [...audited].filter((route) => !declared.has(route)).sort();
  if (missing.length || stale.length) {
    throw new Error(
      `Visual route manifest drift. Missing: ${missing.join(", ") || "none"}. ` +
        `Stale: ${stale.join(", ") || "none"}.`,
    );
  }
  return { declared: declared.size, audited: ROUTES.length, redirects: REDIRECT_ROUTES.size };
}

const resolveDynamicRoute = (template, discoveredPaths, fixtureOverrides) => {
  const override = fixtureOverrides[template];
  if (override) return override;
  const pattern = routePattern(template);
  return [...discoveredPaths]
    .filter((candidate) => pattern.test(candidate))
    .filter((candidate) => !candidate.split("/").some((part) => part === "new"))
    .sort()[0] ?? null;
};

async function login(page, { baseUrl, username, password }) {
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("input", { timeout: 10_000 });
  const usernameSelector =
    'input[id="username-input"], input[id="identifier"], input[placeholder*="Tên đăng nhập"]';
  await page.$eval(usernameSelector, (element) => {
    element.value = "";
  });
  await page.type(usernameSelector, username);
  await page.type('input[type="password"]', password);
  await Promise.all([
    page.click('button[type="submit"]'),
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => null),
  ]);
  await delay(700);
  if (new URL(page.url()).pathname === "/login") {
    const message = await page.evaluate(() => document.body.innerText.slice(0, 400));
    throw new Error(`Login failed for ${username}: ${message}`);
  }
}

async function auditRoute({
  page,
  baseUrl,
  role,
  routeTemplate,
  routePath,
  viewport,
  outputDir,
  discoveredPaths,
}) {
  const runtime = { console: [], page: [], responses: [], requests: [] };
  const onConsole = (message) => {
    if (message.type() === "error") runtime.console.push(message.text());
  };
  const onPageError = (error) => runtime.page.push(error.message);
  const onResponse = (response) => {
    if (response.status() >= 400 && response.url().startsWith(baseUrl)) {
      runtime.responses.push(`${response.status()} ${response.url()}`);
    }
  };
  const onRequestFailed = (request) =>
    runtime.requests.push(`${request.failure()?.errorText ?? "failed"} ${request.url()}`);
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("response", onResponse);
  page.on("requestfailed", onRequestFailed);

  let navigationError = null;
  try {
    await page.goto(`${baseUrl}${routePath}`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    await delay(900);
  } catch (error) {
    navigationError = error.message;
  }

  const state = await page.evaluate(() => {
    const root = document.documentElement;
    return {
      pathname: window.location.pathname,
      clientWidth: root.clientWidth,
      scrollWidth: root.scrollWidth,
      bodyText: document.body.innerText.slice(0, 20_000),
      links: [...document.querySelectorAll("a[href]")]
        .map((link) => link.getAttribute("href"))
        .filter(Boolean),
    };
  });
  for (const href of state.links) {
    const pathname = normalizePathname(href, baseUrl);
    if (pathname) discoveredPaths.add(pathname);
  }

  const screenshotDir = path.join(outputDir, role.toLowerCase(), viewport.name);
  await fs.mkdir(screenshotDir, { recursive: true });
  const screenshotPath = path.join(screenshotDir, `${routeSlug(routeTemplate)}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  page.off("console", onConsole);
  page.off("pageerror", onPageError);
  page.off("response", onResponse);
  page.off("requestfailed", onRequestFailed);

  const failures = [];
  if (navigationError) failures.push(`navigation: ${navigationError}`);
  if (state.pathname !== routePath) {
    failures.push(`unexpected redirect: ${state.pathname}`);
  }
  if (state.scrollWidth > state.clientWidth) {
    failures.push(`horizontal overflow: ${state.scrollWidth} > ${state.clientWidth}`);
  }
  if (isRuntimeErrorText(state.bodyText)) failures.push("visible runtime error boundary");
  if (runtime.console.length) failures.push(`console: ${runtime.console.join(" | ")}`);
  if (runtime.page.length) failures.push(`pageerror: ${runtime.page.join(" | ")}`);
  if (runtime.responses.length) failures.push(`http: ${runtime.responses.join(" | ")}`);
  if (runtime.requests.length) failures.push(`request: ${runtime.requests.join(" | ")}`);

  return {
    role,
    viewport: viewport.name,
    template: routeTemplate,
    path: routePath,
    finalPath: state.pathname,
    screenshot: path.relative(outputDir, screenshotPath),
    clientWidth: state.clientWidth,
    scrollWidth: state.scrollWidth,
    status: failures.length ? "FAIL" : "PASS",
    failures,
  };
}

const clickVisibleButton = async (page, { text, ariaLabel }) =>
  page.evaluate(
    ({ expectedText, expectedAriaLabel }) => {
      const isVisible = (element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0 &&
          rect.bottom > 0 &&
          rect.right > 0 &&
          rect.top < window.innerHeight &&
          rect.left < window.innerWidth
        );
      };
      const button = [...document.querySelectorAll("button")].find((candidate) => {
        if (!isVisible(candidate)) return false;
        if (expectedAriaLabel && candidate.getAttribute("aria-label") === expectedAriaLabel) {
          return true;
        }
        return expectedText && candidate.textContent?.trim().includes(expectedText);
      });
      if (!button) return false;
      button.click();
      return true;
    },
    { expectedText: text ?? null, expectedAriaLabel: ariaLabel ?? null },
  );

async function auditLogout({ page, role, viewport, outputDir }) {
  let clicked = await clickVisibleButton(page, { text: "Đăng xuất" });

  if (!clicked) {
    const accountOpened =
      (await clickVisibleButton(page, { ariaLabel: "Mở menu tài khoản" })) ||
      (await clickVisibleButton(page, { ariaLabel: "Menu người dùng" })) ||
      (await clickVisibleButton(page, { text: "Tài khoản" }));
    if (accountOpened) await delay(250);
    clicked = await clickVisibleButton(page, { text: "Đăng xuất" });
  }

  if (!clicked) {
    const navigationOpened = await clickVisibleButton(page, {
      ariaLabel: "Mở menu điều hướng",
    });
    if (navigationOpened) await delay(250);
    const accountOpened = await clickVisibleButton(page, {
      ariaLabel: "Menu người dùng",
    });
    if (accountOpened) await delay(250);
    clicked = await clickVisibleButton(page, { text: "Đăng xuất" });
  }

  await delay(700);
  const state = await page.evaluate(() => ({
    pathname: window.location.pathname,
    tokenPresent: Boolean(localStorage.getItem("token")),
  }));
  const screenshotDir = path.join(outputDir, role.toLowerCase(), viewport.name);
  await fs.mkdir(screenshotDir, { recursive: true });
  const screenshotPath = path.join(screenshotDir, "__logout__.png");
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const failures = [];
  if (!clicked) failures.push("no visible logout control could be activated");
  if (state.pathname !== "/login") failures.push(`logout did not redirect: ${state.pathname}`);
  if (state.tokenPresent) failures.push("authentication token remained in localStorage");
  return {
    role,
    viewport: viewport.name,
    template: "__logout__",
    path: "__logout__",
    finalPath: state.pathname,
    screenshot: path.relative(outputDir, screenshotPath),
    status: failures.length ? "FAIL" : "PASS",
    failures,
  };
}

export async function runVisualMatrix({
  baseUrl,
  password,
  outputDir,
  accounts = DEFAULT_ACCOUNTS,
  viewports = DEFAULT_VIEWPORTS,
  roles = Object.keys(DEFAULT_ACCOUNTS),
  fixtureOverrides = {},
  logoutOnly = false,
  executablePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
}) {
  if (!baseUrl || !password || !outputDir) {
    throw new Error("baseUrl, password, and outputDir are required");
  }
  const manifest = await validateRouteManifest();
  await fs.mkdir(outputDir, { recursive: true });
  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: ["--no-sandbox"],
  });
  const results = [];
  try {
    for (const role of roles) {
      const username = accounts[role];
      if (!username) throw new Error(`Missing account for ${role}`);
      const templates = ROUTES.filter((route) => ROLE_GUARDS[route.guard].has(role));
      const staticTemplates = templates.filter((route) => !route.path.includes(":"));
      const dynamicTemplates = templates.filter((route) => route.path.includes(":"));
      const resolvedDynamics = new Map();

      for (const viewport of viewports) {
        // A separate browser context is mandatory for every role/viewport.
        // Reusing Puppeteer's default context leaks localStorage/JWT state from
        // the previous account and can turn an RBAC matrix into false positives.
        const browserContext = await browser.createBrowserContext();
        const page = await browserContext.newPage();
        await page.setViewport({
          width: viewport.width,
          height: viewport.height,
          deviceScaleFactor: 1,
          isMobile: viewport.name === "mobile",
          hasTouch: viewport.name !== "desktop",
        });
        await login(page, { baseUrl, username, password });
        const discoveredPaths = new Set();

        if (!logoutOnly) {
          for (const route of staticTemplates) {
            results.push(
              await auditRoute({
                page,
                baseUrl,
                role,
                routeTemplate: route.path,
                routePath: route.path,
                viewport,
                outputDir,
                discoveredPaths,
              }),
            );
          }

          for (const route of dynamicTemplates) {
            const resolved =
              resolvedDynamics.get(route.path) ??
              resolveDynamicRoute(route.path, discoveredPaths, fixtureOverrides);
            if (!resolved) {
              results.push({
                role,
                viewport: viewport.name,
                template: route.path,
                path: null,
                finalPath: null,
                screenshot: null,
                status: "FAIL",
                failures: ["no reachable fixture/link found for dynamic route"],
              });
              continue;
            }
            resolvedDynamics.set(route.path, resolved);
            results.push(
              await auditRoute({
                page,
                baseUrl,
                role,
                routeTemplate: route.path,
                routePath: resolved,
                viewport,
                outputDir,
                discoveredPaths,
              }),
            );
          }
        }
        results.push(await auditLogout({ page, role, viewport, outputDir }));
        await browserContext.close();
      }
    }
  } finally {
    await browser.close();
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    manifest,
    roles,
    viewports,
    total: results.length,
    passed: results.filter((result) => result.status === "PASS").length,
    failed: results.filter((result) => result.status === "FAIL").length,
    results,
  };
  await fs.writeFile(
    path.join(outputDir, "visual-matrix-results.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  return summary;
}
