/**
 * RBAC for the Wave 0 shipment/customer-portal resources (`shipments` and
 * `customer_portal` actions). Asserts the CUSTOMER and CLERK roles added in
 * Wave 0 behave per the phase-01 architecture block:
 *
 *   - CUSTOMER: customer_portal read + write (read own rows; write only the
 *     dedicated confirmation/dispute actions). Denied shipments + everything
 *     else — a customer must never touch operator shipment CRUD.
 *   - CLERK (nhân viên chứng từ, M10): shipments read|write + customer_portal
 *     read. Denied trips/financial/users/gps-admin — clerks are document
 *     clerks, not operators or accountants.
 *
 * Loads the real model.conf + policy.csv into a throwaway enforcer so the
 * assertion reflects the shipped policy exactly (no running server needed).
 * Mirrors gps-admin.rbac.test.ts.
 *
 * This test ALSO serves as a smoke check that policy.csv parses cleanly —
 * if a `//` comment line were ever misinterpreted as a policy row, the
 * enforcer would either fail to load or report a wrong policy count.
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

describe('Wave 0 CUSTOMER role RBAC (portal-only)', () => {
  test('CUSTOMER can read customer_portal', async () => {
    assert.equal(await (await enforcer()).enforce('CUSTOMER', 'customer_portal', 'read'), true);
  });
  test('CUSTOMER can write dedicated customer_portal actions', async () => {
    assert.equal(await (await enforcer()).enforce('CUSTOMER', 'customer_portal', 'write'), true);
  });
  test('CUSTOMER cannot delete through customer_portal', async () => {
    assert.equal(await (await enforcer()).enforce('CUSTOMER', 'customer_portal', 'delete'), false);
  });
  test('CUSTOMER is denied shipments read', async () => {
    assert.equal(await (await enforcer()).enforce('CUSTOMER', 'shipments', 'read'), false);
  });
  test('CUSTOMER is denied shipments write', async () => {
    assert.equal(await (await enforcer()).enforce('CUSTOMER', 'shipments', 'write'), false);
  });
  test('CUSTOMER is denied trips (operator scope)', async () => {
    assert.equal(await (await enforcer()).enforce('CUSTOMER', 'trips', 'read'), false);
  });
  test('CUSTOMER is denied financial', async () => {
    assert.equal(await (await enforcer()).enforce('CUSTOMER', 'financial', 'read'), false);
  });
});

describe('Wave 0 CLERK role RBAC (document clerk, M10)', () => {
  test('CLERK can read shipments', async () => {
    assert.equal(await (await enforcer()).enforce('CLERK', 'shipments', 'read'), true);
  });
  test('CLERK can write shipments', async () => {
    assert.equal(await (await enforcer()).enforce('CLERK', 'shipments', 'write'), true);
  });
  test('CLERK can read customer_portal', async () => {
    assert.equal(await (await enforcer()).enforce('CLERK', 'customer_portal', 'read'), true);
  });
  test('CLERK is denied shipments delete', async () => {
    assert.equal(await (await enforcer()).enforce('CLERK', 'shipments', 'delete'), false);
  });
  test('CLERK is denied trips (operator scope)', async () => {
    assert.equal(await (await enforcer()).enforce('CLERK', 'trips', 'read'), false);
  });
  test('CLERK is denied financial', async () => {
    assert.equal(await (await enforcer()).enforce('CLERK', 'financial', 'read'), false);
  });
  test('CLERK is denied users', async () => {
    assert.equal(await (await enforcer()).enforce('CLERK', 'users', 'read'), false);
  });
  test('CLERK is denied gps-admin backfill', async () => {
    assert.equal(await (await enforcer()).enforce('CLERK', 'gps-admin', 'write'), false);
  });
});

describe('Wave 0: existing roles unchanged (regression guard)', () => {
  test('ADMIN still wildcard-allowed', async () => {
    assert.equal(await (await enforcer()).enforce('ADMIN', 'shipments', 'write'), true);
    assert.equal(await (await enforcer()).enforce('ADMIN', 'customer_portal', 'read'), true);
  });
  test('DRIVER still denied shipments (no new privilege leak)', async () => {
    assert.equal(await (await enforcer()).enforce('DRIVER', 'shipments', 'read'), false);
  });
  test('FORWARDER still denied shipments', async () => {
    assert.equal(await (await enforcer()).enforce('FORWARDER', 'shipments', 'read'), false);
  });
});

// Wave 0 (shipment-routes slice): MANAGER + ACCOUNTANT shipments policy rows
// added alongside the existing CLERK rows. These assertions guard the RBAC
// surface that `/api/shipments` relies on.
describe('Wave 0 MANAGER/ACCOUNTANT shipments RBAC (route mount surface)', () => {
  test('MANAGER can read shipments', async () => {
    assert.equal(await (await enforcer()).enforce('MANAGER', 'shipments', 'read'), true);
  });
  test('MANAGER can write shipments', async () => {
    assert.equal(await (await enforcer()).enforce('MANAGER', 'shipments', 'write'), true);
  });
  test('MANAGER can delete shipments', async () => {
    assert.equal(await (await enforcer()).enforce('MANAGER', 'shipments', 'delete'), true);
  });
  test('ACCOUNTANT can read shipments', async () => {
    assert.equal(await (await enforcer()).enforce('ACCOUNTANT', 'shipments', 'read'), true);
  });
  test('ACCOUNTANT is denied shipments write (read-only)', async () => {
    assert.equal(await (await enforcer()).enforce('ACCOUNTANT', 'shipments', 'write'), false);
  });
  test('ACCOUNTANT is denied shipments delete', async () => {
    assert.equal(await (await enforcer()).enforce('ACCOUNTANT', 'shipments', 'delete'), false);
  });
});
