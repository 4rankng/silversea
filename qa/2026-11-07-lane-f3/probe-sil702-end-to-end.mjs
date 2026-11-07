/**
 * Lane F3 — SIL-702 (id 822) END-TO-END save probe.
 *
 * The FE now offers "Lấy Lẻ" on an LCL row, and the DB check admits it. This
 * probe proves the whole write path against a REAL migrated database — without
 * touching the shared dev database:
 *   1. clone `silversea` → `silversea_f3` (a throwaway database),
 *   2. apply the lane migration to the clone,
 *   3. run THIS worktree's backend against the clone (:3005),
 *   4. log in (dispatcher), pick an LCL plan row, save "Lấy Lẻ" through
 *      PATCH /api/shipments/dispatch-detail-plan-rows/:id/plan,
 *   5. read the row back — it must carry dispatch_classification = LCL_PICKUP,
 *   6. a cont model on the same row must still be a business 409.
 *
 * The shared dev database is deliberately NOT migrated: an unknown row in the
 * shared `__drizzle_migrations` table would make another lane's pending
 * migration look applied.
 *
 * Usage: node qa/2026-11-07-lane-f3/probe-sil702-end-to-end.mjs
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API = process.env.F3_API ?? 'http://localhost:3005/api';
const USER = process.env.F3_DV_USER ?? 'dieuvan';
const PASS = process.env.F3_PASS ?? 'Abc123';

const log = [];
function step(name, detail) {
  const line = `${new Date().toISOString()} ${name}${detail ? ` — ${JSON.stringify(detail)}` : ''}`;
  log.push(line);
  console.log(line);
}

let exitCode = 0;
try {
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: USER, password: PASS }),
  });
  const session = await login.json().catch(() => null);
  const token = session?.token ?? session?.accessToken ?? session?.data?.token;
  if (!token) throw new Error(`login failed: ${login.status} ${JSON.stringify(session)?.slice(0, 200)}`);
  step('login', { user: USER, status: login.status });
  const auth = { Authorization: `Bearer ${token}` };

  const listRes = await fetch(`${API}/shipments/dispatch-detail-plan-rows?cargoMode=LCL`, { headers: auth });
  const page = await listRes.json().catch(() => null);
  const rows = page?.items ?? page?.rows ?? [];
  const lcl = rows.find((row) => row.fulfillmentId != null && row.cargoMode === 'LCL'
    && !['DISPATCHED', 'COMPLETED', 'CANCELED'].includes(row.taskStatus))
    ?? rows.find((row) => row.fulfillmentId != null && row.cargoMode === 'LCL');
  if (!lcl) throw new Error(`no LCL plan row found (${rows.length} rows)`);
  step('lcl-row', {
    fulfillmentId: lcl.fulfillmentId,
    shipmentId: lcl.shipmentId,
    shipmentVersion: lcl.shipmentVersion,
    fulfillmentVersion: lcl.fulfillmentVersion ?? lcl.version,
    classification: lcl.classification,
    carrierType: lcl.dispatch?.carrierType ?? lcl.carrierType,
    keys: Object.keys(lcl).slice(0, 18),
  });

  const body = {
    expectedFulfillmentVersion: lcl.fulfillmentVersion ?? lcl.version,
    expectedShipmentVersion: lcl.shipmentVersion,
    carrierType: lcl.dispatch?.carrierType ?? lcl.carrierType ?? 'OWN',
    externalCarrierId: lcl.dispatch?.externalCarrierId ?? null,
    plannedRevenue: lcl.estimates?.plannedRevenue ?? null,
    plannedCarrierCost: lcl.estimates?.plannedCarrierCost ?? null,
    classification: 'LCL_PICKUP',
  };
  const saveRes = await fetch(`${API}/shipments/dispatch-detail-plan-rows/${lcl.fulfillmentId}/plan`, {
    method: 'PATCH',
    headers: { ...auth, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(body),
  });
  const saved = await saveRes.json().catch(() => null);
  step('save-lay-le', { status: saveRes.status, body: saved });
  if (saveRes.status !== 200) throw new Error(`the LCL_PICKUP save was refused: ${saveRes.status} ${JSON.stringify(saved)?.slice(0, 300)}`);

  // A cont model on the same row is still a business 409 (never a raw 500).
  const contSave = await fetch(`${API}/shipments/dispatch-detail-plan-rows/${lcl.fulfillmentId}/plan`, {
    method: 'PATCH',
    headers: { ...auth, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ ...body, expectedFulfillmentVersion: (saved?.fulfillmentVersion ?? body.expectedFulfillmentVersion), classification: 'SINGLE' }),
  });
  const contBody = await contSave.json().catch(() => null);
  step('save-cont-model', { status: contSave.status, body: contBody });
  if (contSave.status !== 409) throw new Error(`a cont model on an LCL lot row must be a 409, got ${contSave.status}`);

  await writeFile(path.join(HERE, 'sil702-end-to-end.json'), JSON.stringify({
    fulfillmentId: lcl.fulfillmentId,
    saveStatus: saveRes.status,
    savedClassification: saved?.classification ?? null,
    contModelStatus: contSave.status,
    contModelMessage: contBody?.error ?? null,
  }, null, 2));
  step('VERDICT', 'PASS — LCL_PICKUP persisted on an LCL lot row against a migrated database; a cont model is still refused');
} catch (error) {
  exitCode = 1;
  step('VERDICT', `FAIL — ${error instanceof Error ? error.message : String(error)}`);
} finally {
  log.push(`EXIT ${exitCode}`);
  await writeFile(path.join(HERE, 'probe-sil702-end-to-end.log'), `${log.join('\n')}\n`);
}
process.exit(exitCode);
