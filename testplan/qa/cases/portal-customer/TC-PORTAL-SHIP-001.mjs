// testplan/qa/cases/portal-customer/TC-PORTAL-SHIP-001.mjs
// CUSTOMER portal (/portal/shipments) opens, lists ONLY this customer's lots,
// and refuses another customer's lot — row-scoped, no leak.
//
// Card 20260928_157. The CUSTOMER role had zero harness coverage: it was
// missing from testaccounts.txt AND from smoke.mjs, so /portal/shipments,
// /portal/debit-notes and /portal/statement sat outside the harness while
// roles/07-khachhang.md made them look covered. CUSTOMER is LOCAL-ONLY by
// design — prod has no customer-portal users, so `make stgdb` mirrors none to
// staging; there the runner reports the role BLOCKED (lib/env.mjs
// blockedForMissingRole) instead of dying with FATAL.
//
// Row-scoping is proved with TWO real customer logins: the session's own
// candidate (ctx.username) and the OTHER CUSTOMER candidate read from the same
// role list the harness uses — no username is hardcoded here.
//
// Mutation surface: NONE — read-only. The browser only navigates; nothing is
// submitted, no row action is tapped.
//
// Verdict: PASS when the portal shell renders for the customer, the customer's
// own lot list is non-empty, the two customers' lot id sets are disjoint, a
// cross-customer `customerId` is refused with 404, the own lot detail renders,
// and another customer's lot detail does NOT render. BLOCKED (naming the env)
// when the env has no second CUSTOMER account or the seed carries no lot for
// this customer.

const PORTAL_SHELL = '.customer-shell';
const PORTAL_INBOX = '.role-work-inbox--customer';
const OFFICE_SHELL = '.app-main';
const DETAIL_EYEBROW = '.portal-page__eyebrow';

export const caseId = 'TC-PORTAL-SHIP-001';
export const role = 'CUSTOMER';

/** Portal API with an explicit bearer token (the second login is not the session's). */
async function portalGet(env, token, path) {
  const r = await fetch(`${env.api.replace(/\/$/, '')}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await r.text();
  return { status: r.status, body: (() => { try { return JSON.parse(text); } catch { return text; } })() };
}

async function loginAs(env, username) {
  const r = await fetch(`${env.api.replace(/\/$/, '')}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: username, password: env.password }),
  });
  if (!r.ok) return null;
  const { token, user } = await r.json();
  return { username, token, user };
}

export default async function (ctx) {
  const { page } = ctx;
  const envTag = `[${ctx.env.env}]`;
  const errors = [];

  // --- 1. The portal shell renders for this customer (no office chrome) ---
  await ctx.goto('/portal/shipments');
  await page.waitForSelector(PORTAL_SHELL, { timeout: 15000 });
  await ctx.screenshot('01_portal_shipments_open');

  const shell = await page.evaluate(() => ({
    portalShell: Boolean(document.querySelector('.customer-shell')),
    inbox: Boolean(document.querySelector('.role-work-inbox--customer')),
    inboxHeading: document.querySelector('.role-work-inbox--customer h1')?.innerText?.trim() ?? null,
    officeShell: Boolean(document.querySelector('.app-main')),
    navLabel: document.querySelector('nav[aria-label="Khu vực khách hàng"]') != null,
    identity: document.querySelector('.customer-shell__identity')?.innerText?.trim()?.slice(0, 80) ?? null,
    unlinked: Boolean(document.querySelector('.customer-shell__unlinked')),
    scopeError: document.querySelector('.customer-shell__scope-error')?.innerText?.trim() ?? null,
  }));
  if (!shell.portalShell || !shell.inbox) {
    errors.push(`${envTag} /portal/shipments did not render the customer portal shell (customer-shell=${shell.portalShell}, inbox=${shell.inbox})`);
  }
  if (shell.officeShell) {
    errors.push(`${envTag} the office shell (.app-main) rendered inside the customer portal — the portal must not expose the office workspace`);
  }
  if (shell.unlinked) {
    return {
      verdict: 'BLOCKED',
      errors: [`${envTag} this CUSTOMER account is not linked to a customer row ("Tài khoản chưa được liên kết khách hàng") — the portal rungs need a linked account`],
      shell,
    };
  }

  // --- 2. Own scope + own lot list (the portal's own list endpoint) ---
  const scope = await ctx.apiGet('/portal/customer-scope');
  const ownCustomerId = scope.body?.primaryCustomerId ?? scope.body?.customers?.[0]?.id ?? null;
  if (!ownCustomerId) {
    return { verdict: 'BLOCKED', errors: [`${envTag} /portal/customer-scope returned no linked customer for ${ctx.username}`], shell, scope };
  }

  const own = await portalGet(ctx.env, ctx.token, '/portal/shipments?limit=100');
  const ownItems = Array.isArray(own.body?.items) ? own.body.items : [];
  if (ownItems.length === 0) {
    return {
      verdict: 'BLOCKED',
      errors: [`${envTag} customer ${ownCustomerId} (${ctx.username}) has no lot on /portal/shipments — the row-scope rungs need at least one seeded lot for this customer`],
      shell, ownCustomerId, ownStatus: own.status,
    };
  }
  const ownIds = ownItems.map((item) => item.id);

  // --- 3. A SECOND real customer login, for the cross-scope proof ---
  const otherCandidates = ctx.env.candidatesFor('CUSTOMER').filter((u) => u !== ctx.username);
  let other = null;
  for (const candidate of otherCandidates) {
    other = await loginAs(ctx.env, candidate);
    if (other) break;
  }
  if (!other) {
    return {
      verdict: 'BLOCKED',
      errors: [`${envTag} row-scoping needs a second CUSTOMER account in this env; candidates other than ${ctx.username}: [${otherCandidates.join(', ') || 'none'}] none could log in`],
      shell, ownCustomerId, ownCount: ownItems.length,
    };
  }
  const otherScope = await portalGet(ctx.env, other.token, '/portal/customer-scope');
  const otherCustomerId = otherScope.body?.primaryCustomerId ?? otherScope.body?.customers?.[0]?.id ?? null;
  const otherList = await portalGet(ctx.env, other.token, '/portal/shipments?limit=100');
  const otherItems = Array.isArray(otherList.body?.items) ? otherList.body.items : [];
  const otherIds = otherItems.map((item) => item.id);

  if (otherCustomerId == null || otherIds.length === 0) {
    return {
      verdict: 'BLOCKED',
      errors: [`${envTag} the second customer (${other.username}) has no lot on /portal/shipments — the disjointness proof needs a lot on both sides`],
      shell, ownCustomerId, otherUsername: other.username, otherCustomerId, otherCount: otherIds.length,
    };
  }

  // --- 4. Row-scoping: the two customers' lot sets must not intersect ---
  const otherIdSet = new Set(otherIds);
  const leaked = ownIds.filter((id) => otherIdSet.has(id));
  const ownIdSet = new Set(ownIds);
  const reverseLeaked = otherIds.filter((id) => ownIdSet.has(id));
  if (leaked.length > 0 || reverseLeaked.length > 0) {
    errors.push(`${envTag} /portal/shipments leaked lots across customers: ${ctx.username}→${JSON.stringify(leaked)}, ${other.username}→${JSON.stringify(reverseLeaked)}`);
  }

  // --- 5. A cross-customer customerId is refused, not served ---
  const crossScope = await portalGet(ctx.env, ctx.token, `/portal/shipments?limit=100&customerId=${otherCustomerId}`);
  await ctx.screenshot('02_cross_scope_probe');
  if (crossScope.status !== 404) {
    errors.push(`${envTag} ${ctx.username} requesting customerId=${otherCustomerId} must be refused with 404, got ${crossScope.status}`);
  }

  // --- 5b. The portal's own list renders in the DOM, scoped ---
  // The customer inbox deliberately excludes NEW/PENDING_DATE/CANCELED lots and
  // its default queue is "Cần xác nhận", so walk every queue tab (read-only
  // navigation) before judging. The inbox is only required to list a row when
  // the customer owns at least one lot outside those excluded statuses.
  const inboxable = ownItems.filter((item) => !['NEW', 'PENDING_DATE', 'CANCELED'].includes(item.status));
  await ctx.goto('/portal/shipments');
  await page.waitForSelector(PORTAL_INBOX, { timeout: 15000 });
  const tabCount = await page.$$eval('[role="tab"]', (els) => els.length);
  const domRowKeys = new Set();
  const rowsByTab = [];
  for (let i = 0; i < Math.max(tabCount, 1); i += 1) {
    await page.evaluate((idx) => {
      const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
      if (tabs[idx]) tabs[idx].click();
    }, i);
    await new Promise((r) => setTimeout(r, 900));
    const keys = await page.$$eval(
      '.role-work-inbox__table tr[data-row-key]',
      (rows) => rows.map((row) => row.getAttribute('data-row-key')),
    );
    rowsByTab.push(keys.length);
    for (const key of keys) domRowKeys.add(key);
  }
  // Re-select the queue that actually listed lots, so the screenshot shows the
  // customer's own rows instead of whatever queue the loop happened to end on.
  const bestTab = rowsByTab.indexOf(Math.max(...rowsByTab, 0));
  if (bestTab > 0) {
    await page.evaluate((idx) => {
      const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
      if (tabs[idx]) tabs[idx].click();
    }, bestTab);
    await new Promise((r) => setTimeout(r, 900));
  }
  await ctx.screenshot('03_inbox_queues_walked');

  const domIds = [...domRowKeys]
    .map((key) => Number(String(key).replace(/^shipment:/, '')))
    .filter((id) => Number.isInteger(id) && id > 0);
  const domForeign = domIds.filter((id) => otherIdSet.has(id));
  const domNotOwn = domIds.filter((id) => !ownIdSet.has(id));
  if (inboxable.length > 0 && domIds.length === 0) {
    errors.push(`${envTag} ${ctx.username} owns ${inboxable.length} lot(s) the inbox is meant to list, but no queue rendered a lot row`);
  }
  if (domForeign.length > 0) {
    errors.push(`${envTag} the customer inbox listed ${other.username}'s lot(s) ${JSON.stringify(domForeign)} for ${ctx.username} — cross-customer leak`);
  }
  if (domNotOwn.length > 0) {
    errors.push(`${envTag} the customer inbox listed lot(s) ${JSON.stringify(domNotOwn)} that /portal/shipments does not return for ${ctx.username}`);
  }

  // --- 6. The customer's own lot detail renders ---
  const ownId = ownIds[0];
  await ctx.goto(`/portal/shipments/${ownId}`);
  await page.waitForSelector('.portal-page', { timeout: 15000 });
  await page.waitForFunction((sel) => {
    const eyebrow = document.querySelector(sel);
    return eyebrow && eyebrow.innerText.trim().length > 0;
  }, { timeout: 15000 }, DETAIL_EYEBROW).catch(() => {});
  await ctx.screenshot('04_own_lot_detail');

  const ownDetail = await page.evaluate((sel) => ({
    eyebrow: document.querySelector(sel)?.innerText?.trim() ?? null,
    heading: document.querySelector('.portal-page__header h1')?.innerText?.trim() ?? null,
    hasError: Boolean(document.querySelector('.portal-page [role="alert"]')),
  }), DETAIL_EYEBROW);
  const ownRef = ownItems[0].blNumber ?? ownItems[0].bookingRef ?? null;
  // innerText is the RENDERED text: the eyebrow's CSS uppercases it, so compare
  // case-insensitively rather than pinning the visual casing.
  const isDetailEyebrow = (text) => (text ?? '').toLowerCase() === 'chi tiết lô hàng';
  if (!isDetailEyebrow(ownDetail.eyebrow) || ownDetail.hasError) {
    errors.push(`${envTag} lot #${ownId} of ${ctx.username} did not render its portal detail (eyebrow="${ownDetail.eyebrow}", error=${ownDetail.hasError})`);
  } else if (ownRef && ownDetail.heading !== ownRef) {
    errors.push(`${envTag} lot #${ownId} detail heading "${ownDetail.heading}" ≠ the portal list's ref "${ownRef}"`);
  }

  // --- 7. Another customer's lot detail must NOT render ---
  const foreignId = otherIds[0];
  await ctx.goto(`/portal/shipments/${foreignId}`);
  await page.waitForSelector('.portal-page', { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 1200));
  await ctx.screenshot('04_foreign_lot_detail');

  const foreignDetail = await page.evaluate((sel) => ({
    eyebrow: document.querySelector(sel)?.innerText?.trim() ?? null,
    alert: document.querySelector('.portal-page [role="alert"]')?.innerText?.trim()?.slice(0, 120) ?? null,
  }), DETAIL_EYEBROW);
  if (isDetailEyebrow(foreignDetail.eyebrow)) {
    errors.push(`${envTag} lot #${foreignId} belongs to ${other.username} but ${ctx.username} rendered its detail — cross-customer leak`);
  }
  if (!foreignDetail.alert) {
    errors.push(`${envTag} lot #${foreignId} (${other.username}) should surface the portal's error/empty state for ${ctx.username}, found no [role=alert]`);
  }

  return {
    verdict: errors.length > 0 ? 'FAIL' : 'PASS',
    username: ctx.username,
    ownCustomerId,
    otherUsername: other.username,
    otherCustomerId,
    ownLotCount: ownIds.length,
    otherLotCount: otherIds.length,
    crossScopeStatus: crossScope.status,
    shell,
    ownDetail,
    foreignDetail,
    errors,
  };
}
