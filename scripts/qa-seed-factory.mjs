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

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { api, DEFAULT_BACKEND, login, ROLES, role as getRole } from "./lib/http.mjs";

const BACKEND = process.env.BACKEND ?? DEFAULT_BACKEND;
const ARTIFACTS = process.env.ARTIFACTS ?? `qa/${new Date().toISOString().slice(0, 10)}_seed-factory`;

const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const NO_CREATE = args.includes("--no-create");
const roleArg = args.find((a) => a.startsWith("--role="));
const roleKey = roleArg?.slice("--role=".length) ?? "cus";

const roleDef = getRole(roleKey);
const token = await login(roleKey);
// Reference data (routes, container-types, ports) is gated behind the
// `config` Casbin resource which cus / dieuvan / driver do not have. Use
// an admin token for the lookups; the cus token still owns the shipment
// create (CUS must own its own shipments).
const adminToken = await login("admin");

const log = [];
const scenario = { createdAt: new Date().toISOString(), role: roleKey, username: roleDef.username };

// 1) Look up an active, non-carrier customer (skip test/E2E entries with
//    auto-generated names like "Q23 direct edit customer ..." or
//    "Khách hàng E2E tổng hợp ..."). Heuristic: prefer entries whose name
//    starts with a Vietnamese company prefix (CÔNG TY, CHI NHÁNH, etc.) and
//    has a taxCode. Falls back to the first non-carrier if no real company
//    matches.
{
  const res = await api(adminToken, "GET", "/customers", undefined, { query: { limit: 100 } });
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
    api(adminToken, "GET", "/routes",           undefined, { query: { limit: 50 } }),
    api(adminToken, "GET", "/container-types",  undefined, { query: { limit: 50 } }),
    api(adminToken, "GET", "/ports",            undefined, { query: { limit: 50 } }),
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
  const containerNo = `MSCU${String(Date.now()).slice(-7)}`;
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
  const pickup = tomorrow.toISOString();

  const body = {
    customerId: scenario.customer.id,
    direction: "IMPORT",
    billBookingNumber: code,
    expectedPickupAt: pickup,
    containers: [{
      containerNumber: containerNo,
      containerTypeId: scenario.containerType?.id,
      routeId: scenario.route?.id,
      liftPortId: scenario.ports?.up?.id,
      dischargePortId: scenario.ports?.down?.id,
      weightKg: 25_000,
    }],
  };
  const res = await api(token, "POST", "/shipments", body, {
    headers: { "Idempotency-Key": `qa-seed-factory-${Date.now()}` },
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
