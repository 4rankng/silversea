import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

import { getTableName } from 'drizzle-orm';

import * as schema from '../db/schema';
import {
  IDEMPOTENCY_ENDPOINTS,
  buildCrudIdempotencyEndpoint,
} from '../services/idempotency.service';
import {
  listDeclaredMaterialWriteEndpoints,
  matchDeclaredMaterialWrite,
} from '../middleware/material-write';

const routesRoot = path.resolve(process.cwd(), 'src/routes');
const configRoutePath = path.join(routesRoot, 'config.ts');

const schemaTables = schema as Record<string, unknown>;

function walkTsFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkTsFiles(fullPath));
      continue;
    }
    if (entry.isFile() && fullPath.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

function extractConstObject(source: string, constantName: string): Record<string, string> {
  const blockMatch = source.match(new RegExp(`const ${constantName} = \\{([\\s\\S]*?)\\} as const;`));
  if (!blockMatch) return {};
  return Object.fromEntries(
    [...blockMatch[1].matchAll(/([A-Z0-9_]+):\s*'([^']+)'/g)].map((match) => [match[1], match[2]]),
  );
}

function extractConstString(source: string, constantName: string): string[] {
  const match = source.match(new RegExp(`const ${constantName} = '([^']+)'`));
  return match ? [match[1]] : [];
}

function extractExpectedEndpointsFromRouteFile(filePath: string): string[] {
  const source = fs.readFileSync(filePath, 'utf8');
  const endpoints = new Set<string>();

  for (const match of source.matchAll(/endpoint:\s*'([^']+)'/g)) {
    endpoints.add(match[1]);
  }

  for (const match of source.matchAll(/IDEMPOTENCY_ENDPOINTS\.([A-Z0-9_]+)/g)) {
    const value = IDEMPOTENCY_ENDPOINTS[match[1] as keyof typeof IDEMPOTENCY_ENDPOINTS];
    if (value) endpoints.add(value);
  }

  for (const constantName of [
    'AUTH_COMMANDS',
    'APP_SETTINGS_COMMANDS',
    'CONFIG_COMMANDS',
    'COMMANDS',
    'FORWARDER_IDEMPOTENCY_ENDPOINTS',
  ]) {
    const values = extractConstObject(source, constantName);
    for (const match of source.matchAll(new RegExp(`endpoint:\\s*${constantName}\\.([A-Z0-9_]+)`, 'g'))) {
      const value = values[match[1]];
      if (value) endpoints.add(value);
    }
  }

  for (const constantName of ['GPS_SETTINGS_COMMAND', 'LLM_SETTINGS_COMMAND']) {
    const values = extractConstString(source, constantName);
    for (const match of source.matchAll(new RegExp(`endpoint:\\s*${constantName}\\b`, 'g'))) {
      if (match[0]) {
        for (const value of values) endpoints.add(value);
      }
    }
  }

  return [...endpoints];
}

function extractGeneratedCrudEndpoints(): string[] {
  const source = fs.readFileSync(configRoutePath, 'utf8');
  const endpoints = new Set<string>();
  const addCrudEndpoints = (basePath: string, tableKey: string, disableDelete = false) => {
    const table = schemaTables[tableKey];
    assert.ok(table, `missing schema table for ${tableKey}`);
    const resource = getTableName(table as Parameters<typeof getTableName>[0]);
    endpoints.add(buildCrudIdempotencyEndpoint(resource, 'create'));
    endpoints.add(buildCrudIdempotencyEndpoint(resource, 'update'));
    if (!disableDelete) {
      endpoints.add(buildCrudIdempotencyEndpoint(resource, 'delete'));
    }
    void basePath;
  };

  addCrudEndpoints('/business-calendar', 'businessCalendarDays');
  addCrudEndpoints('/ancillary-revenue', 'ancillaryRevenue');

  for (const match of source.matchAll(/router\.use\('([^']+)',\s*createCrudRouter\(s\.([A-Za-z0-9]+),/g)) {
    addCrudEndpoints(match[1], match[2], match[2] === 'drivers');
  }

  return [...endpoints];
}

describe('material-write registry coverage', () => {
  test('declares every current HTTP runIdempotent command endpoint', () => {
    const declared = new Set(listDeclaredMaterialWriteEndpoints());
    const expected = new Set<string>(extractGeneratedCrudEndpoints());

    for (const filePath of walkTsFiles(routesRoot)) {
      const source = fs.readFileSync(filePath, 'utf8');
      if (!source.includes('runIdempotent(')) continue;
      for (const endpoint of extractExpectedEndpointsFromRouteFile(filePath)) {
        expected.add(endpoint);
      }
    }

    const missing = [...expected].filter((endpoint) => !declared.has(endpoint)).sort();
    assert.deepEqual(missing, []);
  });

  test('matches every newly added auth/settings/config route to its declared endpoint', () => {
    const cases = [
      ['PATCH', '/api/auth/me', 'auth.profile.update'],
      ['POST', '/api/auth/change-password', 'auth.password.change'],
      ['POST', '/api/auth/users', 'auth.users.create'],
      ['PATCH', '/api/auth/users/17', 'auth.users.update'],
      ['DELETE', '/api/auth/users/17', 'auth.users.delete'],
      ['POST', '/api/auth/business-units', 'auth.business-units.create'],
      ['PATCH', '/api/auth/business-units/8', 'auth.business-units.update'],
      ['DELETE', '/api/auth/business-units/8', 'auth.business-units.deactivate'],
      ['PUT', '/api/admin/app-settings/email', 'admin.app-settings.email.update'],
      ['PUT', '/api/admin/app-settings', 'admin.app-settings.update'],
      ['PUT', '/api/admin/gps-settings', 'admin.gps-settings.update'],
      ['PUT', '/api/admin/llm-settings', 'admin.llm-settings.update'],
      ['POST', '/api/suppliers', 'config.suppliers.create'],
      ['PUT', '/api/suppliers/11', 'config.suppliers.update'],
      ['DELETE', '/api/suppliers/11', 'config.suppliers.delete'],
      ['POST', '/api/expense-categories', 'config.expense_categories.create'],
      ['PUT', '/api/expense-categories/11', 'config.expense_categories.update'],
      ['DELETE', '/api/expense-categories/11', 'config.expense_categories.delete'],
      ['POST', '/api/debit-note-templates', 'config.debit-note-templates.create'],
      ['PUT', '/api/debit-note-templates/5', 'config.debit-note-templates.update'],
      ['DELETE', '/api/debit-note-templates/5', 'config.debit-note-templates.delete'],
      ['PUT', '/api/salary-periods/default', 'config.salary-periods.default.update'],
      ['POST', '/api/salary-periods', 'config.salary-periods.override.create'],
      ['PUT', '/api/salary-periods/2026-07', 'config.salary-periods.override.update'],
      ['DELETE', '/api/salary-periods/2026-07', 'config.salary-periods.override.delete'],
      ['POST', '/api/business-calendar', 'config.business_calendar_days.create'],
      ['PUT', '/api/business-calendar/3', 'config.business_calendar_days.update'],
      ['DELETE', '/api/business-calendar/3', 'config.business_calendar_days.delete'],
      ['POST', '/api/ancillary-revenue', 'config.ancillary_revenue.create'],
      ['PUT', '/api/ancillary-revenue/3', 'config.ancillary_revenue.update'],
      ['DELETE', '/api/ancillary-revenue/3', 'config.ancillary_revenue.delete'],
    ] as const;

    for (const [method, routePath, endpoint] of cases) {
      assert.equal(matchDeclaredMaterialWrite(method, routePath)?.endpoint, endpoint, `${method} ${routePath}`);
    }
  });

  test('normalizes trailing slashes before matching a material write', () => {
    assert.equal(
      matchDeclaredMaterialWrite('POST', '/api/shipments/')?.endpoint,
      IDEMPOTENCY_ENDPOINTS.SHIPMENT_CREATE,
    );
    assert.equal(
      matchDeclaredMaterialWrite('POST', '/api/shipments///?source=test')?.endpoint,
      IDEMPOTENCY_ENDPOINTS.SHIPMENT_CREATE,
    );
  });
});
