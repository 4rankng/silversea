/**
 * RBAC for the GPS route-DB admin endpoints (gps-admin action). Backfill +
 * recapture are office-only (ADMIN + MANAGER); field roles (DRIVER, FORWARDER)
 * and ACCOUNTANT must be DENIED — a driver/forwarder must never be able to
 * trigger a fleet-wide backfill or rewrite captured routes.
 *
 * Loads the real model.conf + policy.csv into a throwaway enforcer so the
 * assertion reflects the shipped policy exactly (no running server needed).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newEnforcer, type Enforcer } from 'casbin';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modelPath = path.resolve(__dirname, '../casbin/model.conf');
const policyPath = path.resolve(__dirname, '../casbin/policy.csv');

let enforcerPromise: Promise<Enforcer> | null = null;
const enforcer = () => (enforcerPromise ??= newEnforcer(modelPath, policyPath));
const canWrite = async (role: string) => (await enforcer()).enforce(role, 'gps-admin', 'write');

describe('gps-admin RBAC (office-only backfill/recapture)', () => {
  test('ADMIN is allowed (wildcard)', async () => {
    assert.equal(await canWrite('ADMIN'), true);
  });
  test('MANAGER is allowed', async () => {
    assert.equal(await canWrite('MANAGER'), true);
  });
  test('ACCOUNTANT is denied', async () => {
    assert.equal(await canWrite('ACCOUNTANT'), false);
  });
  test('DRIVER is denied', async () => {
    assert.equal(await canWrite('DRIVER'), false);
  });
  test('FORWARDER is denied', async () => {
    assert.equal(await canWrite('FORWARDER'), false);
  });
});
