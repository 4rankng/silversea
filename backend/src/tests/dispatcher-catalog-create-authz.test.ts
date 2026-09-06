import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import { Role, routeSchema, customerSchema } from '@tingting/shared';
import { initEnforcer } from '../casbin/enforcer';
import { casbinAuthz } from '../middleware/casbin';
import { restrictRouteCreateForIntake } from '../services/route-intake.service';
import { restrictCustomerCreateForIntake } from '../services/customer-intake.service';

function request(role: Role, method: string, path: string): Request {
  return {
    method,
    path,
    user: {
      userId: 1,
      username: 'dispatch-catalog-authz',
      email: null,
      fullName: 'Dispatcher Catalog Authz',
      role,
    },
  } as Request;
}

async function authorize(role: Role, method: string, path: string, resource = 'config') {
  let nextCalled = false;
  let statusCode = 200;
  const response = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json() {
      return this;
    },
  } as unknown as Response;
  await casbinAuthz(resource)(
    request(role, method, path),
    response,
    (() => { nextCalled = true; }) as NextFunction,
  );
  return { nextCalled, statusCode };
}

describe('Dispatcher resource-catalog create authorization', () => {
  before(async () => {
    await initEnforcer();
  });

  describe('Casbin config gate', () => {
    it('lets DISPATCHER create trucks, drivers, suppliers, and shipment routes', async () => {
      for (const path of ['/trucks', '/drivers', '/suppliers', '/routes']) {
        assert.deepEqual(await authorize(Role.DISPATCHER, 'POST', path), {
          nextCalled: true,
          statusCode: 200,
        }, path);
      }
    });

    it('lets DISPATCHER create customers from the catalog page (create-only)', async () => {
      // The dispatch catalog pages are create-only for this role: POST passes
      // (intake strips financially material fields server-side) while PUT/
      // DELETE stay Casbin-denied, unlike CUS which owns the full allowance.
      assert.deepEqual(await authorize(Role.DISPATCHER, 'POST', '/customers'), {
        nextCalled: true,
        statusCode: 200,
      });
      for (const [method, path] of [
        ['PUT', '/customers/1'],
        ['DELETE', '/customers/1'],
        ['PUT', '/routes/1'],
        ['DELETE', '/routes/1'],
      ] as const) {
        assert.deepEqual(await authorize(Role.DISPATCHER, method, path), {
          nextCalled: false,
          statusCode: 403,
        }, `${method} ${path}`);
      }
    });

    it('keeps DISPATCHER mutations closed everywhere else', async () => {
      // Same three tables — update/delete are not route-scoped allowances.
      for (const [method, path] of [
        ['PUT', '/trucks'],
        ['DELETE', '/trucks'],
        ['PUT', '/drivers'],
        ['DELETE', '/drivers'],
        ['PUT', '/suppliers'],
        ['DELETE', '/suppliers'],
      ] as const) {
        assert.deepEqual(await authorize(Role.DISPATCHER, method, path), {
          nextCalled: false,
          statusCode: 403,
        }, `${method} ${path}`);
      }
      // Other config catalogs stay fully read-only for DISPATCHER.
      for (const [method, path] of [
        ['POST', '/pricing-tables'],
        ['POST', '/expense-categories'],
      ] as const) {
        assert.deepEqual(await authorize(Role.DISPATCHER, method, path), {
          nextCalled: false,
          statusCode: 403,
        }, `${method} ${path}`);
      }
    });

    it('keeps read access unchanged for DISPATCHER', async () => {
      assert.deepEqual(await authorize(Role.DISPATCHER, 'GET', '/trucks'), {
        nextCalled: true,
        statusCode: 200,
      });
    });

    it('does not leak the allowance to other roles', async () => {
      for (const role of [Role.DRIVER, Role.OPS, Role.CUSTOMER, Role.CUS]) {
        assert.deepEqual(await authorize(role, 'POST', '/trucks'), {
          nextCalled: false,
          statusCode: 403,
        }, role);
      }
    });

    it('lets CUS create, update, and delete customers and routes from intake', async () => {
      // POST — create (existing allowance)
      assert.deepEqual(await authorize(Role.CUS, 'POST', '/routes'), {
        nextCalled: true,
        statusCode: 200,
      });
      assert.deepEqual(await authorize(Role.CUS, 'POST', '/customers'), {
        nextCalled: true,
        statusCode: 200,
      });
      // PUT — update identity fields (new allowance)
      assert.deepEqual(await authorize(Role.CUS, 'PUT', '/routes/1'), {
        nextCalled: true,
        statusCode: 200,
      });
      assert.deepEqual(await authorize(Role.CUS, 'PUT', '/customers/1'), {
        nextCalled: true,
        statusCode: 200,
      });
      // DELETE — allowed at Casbin level; age gate enforced in beforeDelete hook
      assert.deepEqual(await authorize(Role.CUS, 'DELETE', '/routes/1'), {
        nextCalled: true,
        statusCode: 200,
      });
      assert.deepEqual(await authorize(Role.CUS, 'DELETE', '/customers/1'), {
        nextCalled: true,
        statusCode: 200,
      });
      // Other config writes stay denied
      for (const [method, path] of [
        ['POST', '/trucks'],
        ['POST', '/pricing-tables'],
      ] as const) {
        assert.deepEqual(await authorize(Role.CUS, method, path), {
          nextCalled: false,
          statusCode: 403,
        }, `${method} ${path}`);
      }
    });

    it('lets CUS and Dispatchers add the missing customer from shipment intake', async () => {
      for (const role of [Role.CUS, Role.DISPATCHER]) {
        assert.deepEqual(await authorize(role, 'POST', '/customers'), {
          nextCalled: true,
          statusCode: 200,
        }, role);
      }
      // CUS may update and delete customers (identity fields stripped by intake
      // service; age gate enforced in beforeDelete hook).
      assert.deepEqual(await authorize(Role.CUS, 'PUT', '/customers/1'), {
        nextCalled: true,
        statusCode: 200,
      });
      assert.deepEqual(await authorize(Role.CUS, 'DELETE', '/customers/1'), {
        nextCalled: true,
        statusCode: 200,
      });
      // DISPATCHER update/delete stay Casbin-denied.
      for (const [method, path] of [
        ['PUT', '/customers/1'],
        ['DELETE', '/customers/1'],
      ] as const) {
        assert.deepEqual(await authorize(Role.DISPATCHER, method, path), {
          nextCalled: false,
          statusCode: 403,
        }, `DISPATCHER ${method} ${path}`);
      }
    });

    it('strips route cost and itinerary fields from CUS and Dispatcher payloads', () => {
      const payload = routeSchema.parse({
        name: 'Cảng Cát Lái — KCN Sóng Thần',
        shortName: 'Cát Lái — Sóng Thần',
        distanceKm: 32,
        isMountain: true,
        fixedFuelAllowance: 90,
        tollsStations: 4,
        driverSalary: 750000,
        defaultLegs: [{ origin: 'Cát Lái', destination: 'Sóng Thần', km: 32, loadingType: 'HANG' }],
      });

      for (const role of [Role.CUS, Role.DISPATCHER]) {
        assert.deepEqual(restrictRouteCreateForIntake(payload, role), {
          name: 'Cảng Cát Lái — KCN Sóng Thần',
          shortName: 'Cát Lái — Sóng Thần',
          distanceKm: 32,
          isMountain: false,
        });
      }
      assert.deepEqual(restrictRouteCreateForIntake(payload, Role.MANAGER), payload);
    });

    it('strips credit and billing fields from CUS and Dispatcher customer payloads', () => {
      const payload = customerSchema.parse({
        name: 'Công ty TNHH Thương mại Phú Cường',
        shortName: 'Phú Cường',
        taxCode: '0312345678',
        contactPerson: 'Chị Lan',
        phone: '0909123456',
        creditLimit: 500000000,
        creditWarningThreshold: 0.8,
        paymentTermDays: 30,
        fuelSurchargeSharePct: 50,
        debitNoteTemplateId: 2,
      });
      // Zod defaults materialize paymentDatePolicy/debitNoteMode on every
      // parse; the intake strip must drop them as absent keys so the create
      // also bypasses the materiality-gated maker-checker flow.
      for (const role of [Role.CUS, Role.DISPATCHER]) {
        const restricted = restrictCustomerCreateForIntake(payload, role);
        assert.deepEqual(restricted, {
          name: 'Công ty TNHH Thương mại Phú Cường',
          shortName: 'Phú Cường',
          taxCode: '0312345678',
          contactPerson: 'Chị Lan',
          phone: '0909123456',
          // status/isCarrier stay absent: the intake strip drops lifecycle
          // gating and carrier-flag material fields with the billing keys
          // (see restrictCustomerCreateForIntake) so CUS/Dispatcher creates
          // keep bypassing the maker-checker gate.
        });
        for (const key of ['creditLimit', 'creditWarningThreshold', 'paymentTermDays',
          'paymentDatePolicy', 'fuelSurchargeSharePct', 'debitNoteMode', 'debitNoteTemplateId']) {
          assert.ok(!(key in restricted), `${role} ${key}`);
        }
      }
      assert.deepEqual(restrictCustomerCreateForIntake(payload, Role.MANAGER), payload);
    });

    it('leaves MANAGER/ACCOUNTANT config writes exactly as before', async () => {
      assert.deepEqual(await authorize(Role.MANAGER, 'POST', '/routes'), {
        nextCalled: true,
        statusCode: 200,
      });
      assert.deepEqual(await authorize(Role.ACCOUNTANT, 'PUT', '/trucks'), {
        nextCalled: true,
        statusCode: 200,
      });
    });
  });

  describe('catalog create gate stays open for base config write roles', () => {
    it('admits the casbin config write roles on catalog POSTs', async () => {
      for (const role of [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT]) {
        assert.deepEqual(await authorize(role, 'POST', '/trucks'), {
          nextCalled: true,
          statusCode: 200,
        }, role);
      }
    });

    it('does not broaden Dispatcher create access to unrelated catalogs', async () => {
      assert.deepEqual(await authorize(Role.DISPATCHER, 'POST', '/pricing-tables'), {
        nextCalled: false,
        statusCode: 403,
      });
    });
  });

  describe('intake port create (Cảng nâng/hạ)', () => {
    it('lets CUS and DISPATCHER add a missing port inline', async () => {
      for (const role of [Role.CUS, Role.DISPATCHER]) {
        assert.deepEqual(await authorize(role, 'POST', '/ports'), {
          nextCalled: true,
          statusCode: 200,
        }, role);
      }
    });

    it('keeps every other port verb and role Casbin-governed', async () => {
      assert.deepEqual(await authorize(Role.CUS, 'PUT', '/ports/12'), {
        nextCalled: false,
        statusCode: 403,
      });
      assert.deepEqual(await authorize(Role.CUS, 'DELETE', '/ports/12'), {
        nextCalled: false,
        statusCode: 403,
      });
      // OPS has no config grants at all — the allowance must not leak beyond
      // CUS/DISPATCHER. (ADMIN/MANAGER/ACCOUNTANT legitimately POST via their
      // casbin config:write policy.)
      assert.deepEqual(await authorize(Role.OPS, 'POST', '/ports'), {
        nextCalled: false,
        statusCode: 403,
      });
    });
  });
});
