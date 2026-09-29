#!/usr/bin/env node
/**
 * Regression test-data factory — produces a known scenario (customer +
 * shipment + container + route) for downstream tests to mutate.
 *
 * Design:
 *   - Reference data (customers, routes, container types, ports) is
 *     LOOKED UP from the existing seed. We never duplicate seed logic.
 *   - Mutable data (shipment, container line) is CREATED with a unique
 *     code per run (timestamp-based) so each regression run is fresh.
 *   - The factory prints the created IDs as a JSON document so the
 *     caller can pipe them into a follow-up test:
 *         node scripts/qa-seed-factory.mjs > /tmp/scenario.json
 *         jq '.shipmentId' /tmp/scenario.json   # use in next script
 *
 * Usage:
 *   node scripts/qa-seed-factory.mjs
 *   node scripts/qa-seed-factory.mjs --json   # pure JSON, no status lines
 *   node scripts/qa-seed-factory.mjs --role cus
 *   node scripts/qa-seed-factory.mjs --no-create   # dry run, only prints
 *                                                   # what WOULD be picked
 *
 * Exit 0 on success, 1 if any required reference data is missing.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { api, DEFAULT_BACKEND, login, ROLES, role as getRole } from "./lib/http.mjs";

const BACKEND = process.env.BACKEND ?? DEFAULT_BACKEND;

// CARD 20260928_197 follow-up. This module read BACKEND from the environment
// and then never used it: every `login()` and `api()` call omitted
// `opts.backend`, so both helpers fell back to DEFAULT_BACKEND
// (http://localhost:3001/api). The factory was therefore hardwired to local dev
// and could not target staging at all — which is why staging has no QA scenario
// and the cost-entry screens could not be driven there.
//
// `apiAt` / `loginAt` inject the resolved origin as the DEFAULT, so an explicit
// `opts.backend` at a call site still wins.
const apiAt = (token, method, path, body, opts = {}) =>
  api(token, method, path, body, { backend: BACKEND, ...opts });
const loginAt = (who, opts = {}) => login(who, { backend: BACKEND, ...opts });

/**
 * Append the correct ISO 6346 check digit to a 10-char container prefix,
 * matching shared/src/calculations/iso6346.ts: the app's format is
 * XXXXNNNNNNN = 4 owner letters + 6 serial digits + 1 check digit = 11
 * characters in TOTAL (no separate category character), and the check digit
 * is computed over the first 10. Remainder 10 maps to 0.
 */
function withCheckDigit(prefix10) {
  const LETTER_MAP = {
    A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 17, H: 18, I: 19, J: 20,
    K: 21, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29, S: 30, T: 31,
    U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38,
  };
  const POWERS_2 = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];
  const body = prefix10.toUpperCase().slice(0, 10);
  let sum = 0;
  for (let i = 0; i < 10; i += 1) {
    const ch = body[i];
    const val = /[0-9]/.test(ch) ? Number(ch) : LETTER_MAP[ch];
    sum += val * POWERS_2[i];
  }
  return `${prefix10.toUpperCase()}${(sum % 11) % 10}`;             // +1 check digit = 11 chars
}
const ARTIFACTS = process.env.ARTIFACTS ?? `qa/${new Date().toISOString().slice(0, 10)}_seed-factory`;

const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const NO_CREATE = args.includes("--no-create");
// Accept BOTH `--role=<value>` and `--role <value>`. Only the equals form used
// to work, so `--role OPS` was silently ignored and everything fell back to
// "cus" — a wrong-account fixture that looks like it worked.
const roleEq = args.find((a) => a.startsWith("--role="));
const roleSpaceIdx = args.indexOf("--role");
const roleSpace = roleSpaceIdx >= 0 ? args[roleSpaceIdx + 1] : undefined;
const roleKey = roleEq?.slice("--role=".length) ?? roleSpace ?? "cus";

const roleDef = getRole(roleKey);   // fallback only; the resolved account is what actually logs in

/**
 * Resolve the account the SAME way the QA harness does: walk the role's
 * candidate list in testaccounts.txt and take the first that authenticates.
 *
 * This matters because the roster is per-environment and the two differ:
 *   local   OPS: giaonhan, hoangnh, …
 *   staging OPS: hoangnh, hungld, …
 * The factory used to take ROLES[role].username unconditionally — i.e. always
 * `giaonhan` — so on staging it created the scenario as an account the harness
 * never logs in as. The harness then drove the app as `hoangnh`, who owns
 * nothing in the scenario, and every write was refused with
 * "Lô này không thuộc xe bạn phụ trách". Seeding under a DIFFERENT account
 * than the one that will drive the page is the single cause behind the blocked
 * rungs on cards 197, 157 and 173.
 *
 * Mirrors createSession in testplan/qa/lib/harness.mjs: same list, same
 * walk, same env-tagged block.
 */
/**
 * The role's candidate usernames for the environment `BACKEND` points at,
 * parsed from testplan/testaccounts.txt — the same roster the harness reads.
 * The block is chosen by host: localhost => `local`, anything else => `staging`.
 */
function roleCandidates(roleName, backend) {
  try {
    const text = readFileSync(
      resolve(process.cwd(), 'testplan', 'testaccounts.txt'), 'utf8');
    const host = (new URL(backend).hostname || '').toLowerCase();
    const env = host === 'localhost' || host === '127.0.0.1' ? 'local' : 'staging';
    const block = text.split(/\n(?=[a-z]+:\s*$)/m).find((b) => b.startsWith(`${env}:`));
    if (!block) return [];
    const m = block.match(new RegExp(`^\\s*${roleName}:\\s*(.*)$`, 'm'));
    if (!m) return [];
    return m[1]
      .replace(/\([^)]*\)/g, ' ')          // drop (NV003) provenance notes
      .split(',')
      .map((n) => n.trim())
      .filter((n) => /^[a-z][a-z0-9-]*$/i.test(n));
  } catch {
    return [];
  }
}

async function resolveLogin(roleName) {
  const override = process.env[`QA_USER_${String(roleName).toUpperCase()}`];
  // The factory's `--role` keys are PERSONA names (ROLES keys: cus, giaonhan,
  // laixe, …), while testaccounts.txt is keyed by ROLE (OPS, CUS, DRIVER, …).
  // Bridge the two, or the roster lookup finds nothing and silently falls back.
  const rosterRole = (() => {
    try { return getRole(roleName).role; } catch { return roleName; }
  })();
  const candidates = override ? [override] : roleCandidates(rosterRole, BACKEND);
  if (candidates.length === 0) {
    // No roster list for this role — fall back to the legacy single mapping.
    return { token: await loginAt(roleName), username: getRole(roleName).username, tried: [getRole(roleName).username] };
  }
  const tried = [];
  for (const username of candidates) {
    tried.push(username);
    const tok = await tryLogin(username);
    if (tok) return { token: tok, username, tried };
  }
  return { token: null, username: candidates[0], tried };
}

async function tryLogin(username) {
  try {
    const c = await loginAt(username, { password: process.env.PASSWORD ?? 'Abc123' });
    return c && c.token ? c.token : null;
  } catch {
    return null;
  }
}
const { token: resolvedToken, username: resolvedUsername, tried: triedLogins } = await resolveLogin(roleKey);
if (!resolvedToken) {
  throw new Error(`no usable account for role ${roleKey}; tried ${triedLogins.join(', ')}`);
}
const token = resolvedToken;
const account = resolvedUsername;
// Reference data (routes, container-types, ports) is gated behind the
// `config` Casbin resource which cus / dieuvan / driver do not have. Use
// an admin token for the lookups; the cus token still owns the shipment
// create (CUS must own its own shipments).
const adminToken = await loginAt("admin");

const log = [];
const scenario = { createdAt: new Date().toISOString(), role: roleKey, username: account };

// 1) Look up an active, non-carrier customer (skip test/E2E entries with
//    auto-generated names like "Q23 direct edit customer ..." or
//    "Khách hàng E2E tổng hợp ..."). Heuristic: prefer entries whose name
//    starts with a Vietnamese company prefix (CÔNG TY, CHI NHÁNH, etc.) and
//    has a taxCode. Falls back to the first non-carrier if no real company
//    matches.
{
  const res = await apiAt(adminToken, "GET", "/customers", undefined, { query: { limit: 100 } });
  if (!res.ok) throw new Error(`/customers: status=${res.status} body=${JSON.stringify(res.data).slice(0, 200)}`);
  const items = res.data?.items ?? [];
  const nonCarrier = items.filter((c) => c.status === "ACTIVE" && !c.isCarrier);
  const isRealCompany = (c) => /^(CÔNG TY|CHI NHÁNH|MST|TẬP ĐOÀN|CỬA HÀNG|HỢP TÁC XÃ)/i.test(c.name ?? "")
                            && !!c.taxCode
                            && !/E2E|Q\d+|tổng hợp|test/i.test(c.name ?? "");
  const customer = nonCarrier.find(isRealCompany) ?? nonCarrier[0] ?? items[0];
  if (!customer) throw new Error("no customer found in seed");
  scenario.customer = { id: customer.id, name: customer.name };
  log.push(`customer: ${customer.id} ${customer.name}`);
}

// 2) Look up a route, container type, and ports (reference data — admin only)
{
  const [routes, ctypes, ports] = await Promise.all([
    apiAt(adminToken, "GET", "/routes",           undefined, { query: { limit: 50 } }),
    apiAt(adminToken, "GET", "/container-types",  undefined, { query: { limit: 50 } }),
    apiAt(adminToken, "GET", "/ports",            undefined, { query: { limit: 50 } }),
  ]);
  if (routes.ok) {
    const all = routes.data?.items ?? routes.data ?? [];
    const r = all.find((x) => /KCN|TUYẾN|M57|HN|HCM/i.test(`${x.code ?? ""} ${x.name ?? ""}`)) ?? all[0];
    if (r) scenario.route = { id: r.id, code: r.code, name: r.name };
  }
  if (ctypes.ok) {
    const all = ctypes.data?.items ?? ctypes.data ?? [];
    const t = all.find((x) => /40/.test(x.code ?? x.name ?? "")) ?? all[0];
    if (t) scenario.containerType = { id: t.id, code: t.code, name: t.name };
  }
  if (ports.ok) {
    const all = ports.data?.items ?? ports.data ?? [];
    // Prefer two distinct ports for the "up" and "down" so the shipment
    // is valid; fall back to the same port if there's only one.
    scenario.ports = { up: all[0], down: all[1] ?? all[0] };
  }
  log.push(`route: ${scenario.route?.id ?? "(none)"} · containerType: ${scenario.containerType?.id ?? "(none)"} · ports: ${scenario.ports?.up?.id ?? "-"}→${scenario.ports?.down?.id ?? "-"}`);
}

if (NO_CREATE) {
  scenario.dryRun = true;
  log.push("(dry run: no shipment created)");
} else {
  // 3) Create a fresh FCL shipment for the customer
  const code = `BK-QA-${Date.now()}`;
  // A container number must satisfy ISO 6346, and the deployed API enforces it
  // ("Sai số kiểm tra — định dạng đúng nhưng mã kiểm tra không khớp"). The old
  // `MSCU<7 digits>` had a structurally valid but arithmetically wrong check
  // digit, so every run was rejected. Derive the real one.
  const containerPrefix = `MSCU${String(Date.now()).slice(-6)}`;   // 4 owner + 6 serial = 10
  const containerNo = withCheckDigit(containerPrefix);
  const today = new Date().toISOString().slice(0, 10);

  // Containers are NO LONGER accepted on create: the deployed API answers
  // "Tạo lô hàng không nhập kèm danh sách container — tạo lô rồi dùng
  // PUT /api/shipments/{id}/containers". This factory still sent them inline,
  // so every run against a current API failed at step 3. Create the shipment,
  // then declare the container on its own endpoint.
  // Field names must match `createShipmentBaseSchema` (shared/src/schemas/
  // index.ts:1625). This factory had drifted from it, and zod strips unknown
  // keys SILENTLY — the shipment was created every time with those columns null
  // and nothing ever reported an error:
  //   direction         -> tradeDirection
  //   billBookingNumber -> blNumber
  //   expectedPickupAt  -> not a create field at all
  // cargoMode was never sent, though several surfaces read it.
  const body = {
    customerId: scenario.customer.id,
    tradeDirection: "IMPORT",
    cargoMode: "FCL",
    // IMPORT carries a Bill number only; EXPORT a Booking number only.
    // Sending both is refused: "Một lô hàng chỉ có Số Bill (hàng Nhập) hoặc
    // Số Booking (hàng Xuất)".
    blNumber: code,
    expectedDeliveryDate: today,
  };
  const idem = `qa-seed-factory-${Date.now()}`;
  const res = await apiAt(token, "POST", "/shipments", body, {
    headers: { "Idempotency-Key": idem },
  });
  if (!res.ok) {
    log.push(`shipment create FAILED: ${res.status} ${JSON.stringify(res.data).slice(0, 300)}`);
    scenario.shipmentError = { status: res.status, body: res.data };
  } else {
    const s = res.data?.shipment ?? res.data;
    scenario.shipment = {
      id: s.id ?? s.shipmentId,
      code: code,
      billBookingNumber: code,
      status: s.status,
    };
    log.push(`shipment: ${scenario.shipment.id} (${code}) status=${scenario.shipment.status}`);

    // 3b) Declare the container on its own endpoint, now that create no longer takes it.
    // The endpoint is optimistic-concurrency gated: it refuses without
    // `expectedVersion` ("expectedVersion là bắt buộc để kiểm soát đồng thời"), so
    // read the shipment's current version first rather than assuming 0.
    const cur = await apiAt(token, "GET", `/shipments/${scenario.shipment.id}`);
    const currentVersion = cur?.data?.version ?? cur?.data?.shipment?.version ?? 0;
    const cont = await apiAt(token, "PUT", `/shipments/${scenario.shipment.id}/containers`, {
      expectedVersion: currentVersion,
      containers: [{
        containerNumber: containerNo,
        containerTypeId: scenario.containerType?.id,
        routeId: scenario.route?.id,
        liftPortId: scenario.ports?.up?.id,
        dischargePortId: scenario.ports?.down?.id,
        weightKg: 25_000,
      }],
    }, { headers: { "Idempotency-Key": `${idem}-container` } });
    if (!cont.ok) {
      log.push(`container create FAILED: ${cont.status} ${JSON.stringify(cont.data).slice(0, 300)}`);
      scenario.containerError = { status: cont.status, body: cont.data };
    } else {
      scenario.container = { number: containerNo };
      log.push(`container: ${containerNo}`);

      // Card 20260929_203: PUT /shipments/:id/containers RE-DERIVES
      // expectedDeliveryDate and overwrites the value create had stored, leaving
      // it NULL when no container carries a customerAppointmentAt. So the date
      // has to be re-asserted AFTER the container, not before it — otherwise the
      // scenario is invisible in the OPS work queue, which filters on exactly
      // this column.
      const after = await apiAt(token, "GET", `/shipments/${scenario.shipment.id}`);
      const v = after?.data?.version ?? after?.data?.shipment?.version ?? currentVersion;
      // Use the ADMIN token: the forwarder/ops role that owns the scenario cannot
      // PATCH a shipment (403 "Không có quyền truy cập"), and the date is
      // account-independent reference data the fixture legitimately needs set.
      const fix = await apiAt(adminToken, "PUT", `/shipments/${scenario.shipment.id}`, {
        expectedVersion: v,
        expectedDeliveryDate: today,
      }, { headers: { "Idempotency-Key": `${idem}-delivery-date` } });
      if (!fix.ok) {
        log.push(`expectedDeliveryDate re-assert FAILED: ${fix.status} ${JSON.stringify(fix.data).slice(0, 200)}`);
        scenario.dateError = { status: fix.status, body: fix.data };
      } else {
        scenario.expectedDeliveryDate = today;
        log.push(`expectedDeliveryDate re-asserted to ${today} (container write had cleared it)`);
      }
    }
  }
}

// 4) Save the scenario
mkdirSync(ARTIFACTS, { recursive: true });
const outPath = resolve(ARTIFACTS, "scenario.json");
writeFileSync(outPath, `${JSON.stringify({ ...scenario, log }, null, 2)}\n`);

// 5) Save a qa-aggregate-compatible report.json. The "result" is the
//    shipment create: PASS if the shipment id is present, FAIL otherwise.
const passed = !!scenario.shipment?.id;
const report = {
  generatedAt: scenario.createdAt,
  scope: "seed-factory",
  allPassed: passed,
  total: 1,
  passed: passed ? 1 : 0,
  failed: passed ? 0 : 1,
  results: [{
    label: "shipment create",
    ok: passed,
    detail: passed
      ? { shipmentId: scenario.shipment.id, code: scenario.shipment.code, customer: scenario.customer }
      : { error: scenario.shipmentError },
  }],
};
writeFileSync(resolve(ARTIFACTS, "report.json"), `${JSON.stringify(report, null, 2)}\n`);

if (JSON_OUT) {
  console.log(JSON.stringify({ ...scenario, log }, null, 2));
} else {
  for (const line of log) console.log(`  ${line}`);
  console.log(`\nScenario saved: ${outPath}`);
  if (scenario.shipment?.id) {
    console.log(`  → use shipment ${scenario.shipment.id} (${scenario.shipment.code}) in your regression test`);
  } else if (scenario.dryRun) {
    console.log(`  → dry run: re-run without --no-create to actually create the shipment`);
  }
}

process.exit(scenario.shipment?.id || NO_CREATE ? 0 : 1);
