import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

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
const catalogCrudRoutePath = path.join(routesRoot, 'config/catalog-crud.routes.ts');
const applicationEntryPath = path.resolve(process.cwd(), 'src/index.ts');

const schemaTables = schema as Record<string, unknown>;

const REVIEWED_NON_MATERIAL_MUTATIONS = new Map<string, string>([
  ['auth.ts|POST|/login', 'Authentication session creation; no business entity mutation.'],
  ['auth.ts|POST|/logout', 'Authentication session revocation; independently token-bound and replay-safe.'],
  ['financial/reports.routes.ts|POST|/reports/distribute-profit/preview', 'Read-only calculation preview.'],
  ['financial/billing-documents.routes.ts|POST|/finance/billing-documents/generate', 'Read-only draft generation preview.'],
  ['forwarder/advances.ts|POST|/advance-settlements/preview', 'Read-only settlement calculation preview.'],
  ['shipments/core.routes.ts|POST|/pricing-preview', 'Read-only shipment pricing calculation preview.'],
  ['notifications.ts|POST|/:id/read', 'Per-user notification read marker.'],
  ['notifications.ts|POST|/read-all', 'Per-user notification read markers.'],
  ['notifications.ts|POST|/subscribe', 'Replaceable per-user browser push subscription.'],
  ['notifications.ts|POST|/unsubscribe', 'Idempotent deletion of a browser push subscription.'],
  ['trips/pod.ts|POST|/:id/pod-recovered', 'O2C POD-recovery flag setter (accountant/CUS); no direct financial mutation — the completion transition that consumes it runs its own durable boundary.'],
  ['trips/pod.ts|POST|/:id/paper-order-collected', 'O2C field-ops hand-off timestamp (Ops); operational marker, no financial mutation.'],
  ['trips/pod.ts|POST|/:id/driver-order-accepted', 'O2C field-ops hand-off timestamp (Driver); operational marker, no financial mutation.'],
  ['driver.ts|PUT|/trips/:tripId/cost-submission-note', 'Driver cost-submission Ghi chú autosave (27.8 §2): replaceable per-trip note column written by full overwrite, replay-safe without a durable boundary; no financial figure mutation.'],
  ['shipments/core.routes.ts|POST|/operational-sites', 'Reference-data CRUD (factory/warehouse master). Upsert keyed by the (customerId, code) partial unique index — replaying the same payload updates the existing row instead of duplicating, so no durable command boundary is needed. No financial or shipment-lifecycle mutation.'],
  ['shipments/core.routes.ts|PATCH|/operational-sites/:id', 'Reference-data CRUD (factory/warehouse master). Version-checked partial update — a replay hits the stale-version 409 guard instead of applying twice, and identity fields (customer, code, site type) are immutable. No financial or shipment-lifecycle mutation.'],
]);

const REVIEWED_SERVICE_DURABLE_BOUNDARIES = new Map<string, {
  serviceFile: string;
  marker: string;
}>([
  ['config/master-data-import.routes.ts|POST|/:id/apply', {
    serviceFile: path.resolve(process.cwd(), 'src/services/master-data-import.service.ts'),
    marker: 'endpoint: MASTER_IMPORT_APPLY_ENDPOINT',
  }],
  ['config/master-data-import.routes.ts|POST|/analyze', {
    serviceFile: path.resolve(process.cwd(), 'src/services/master-data-import.service.ts'),
    marker: 'export async function analyzeMasterWorkbook(',
  }],
  ['config/master-data-import.routes.ts|POST|/dry-run', {
    serviceFile: path.resolve(process.cwd(), 'src/services/master-data-import.service.ts'),
    marker: 'export async function analyzeMasterWorkbook(',
  }],
  ['config/master-data-import.routes.ts|POST|/:id/reject', {
    serviceFile: path.resolve(process.cwd(), 'src/services/master-data-import.service.ts'),
    marker: 'endpoint: MASTER_IMPORT_REJECT_ENDPOINT',
  }],
  ['config/driver-user-binding.routes.ts|POST|/:driverId', {
    serviceFile: path.resolve(process.cwd(), 'src/services/driver-user-binding.service.ts'),
    marker: 'endpoint: DRIVER_USER_BIND_ENDPOINT',
  }],
  ['driver.ts|POST|/trips/:tripId/progress', {
    serviceFile: path.resolve(process.cwd(), 'src/services/driver.service.ts'),
    marker: 'endpoint: IDEMPOTENCY_ENDPOINTS.DRIVER_PROGRESS',
  }],
  ['driver.ts|POST|/fulfillments/:fulfillmentId/progress', {
    serviceFile: path.resolve(process.cwd(), 'src/services/driver-fulfillment.service.ts'),
    marker: 'endpoint: IDEMPOTENCY_ENDPOINTS.DRIVER_PROGRESS',
  }],
  ['driver.ts|POST|/fulfillments/:fulfillmentId/pod', {
    serviceFile: path.resolve(process.cwd(), 'src/services/trip-pod.service.ts'),
    marker: 'endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_POD_CREATE',
  }],
  ['driver.ts|POST|/fulfillments/:fulfillmentId/pod/:submissionId/files', {
    serviceFile: path.resolve(process.cwd(), 'src/services/trip-pod.service.ts'),
    marker: 'endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_POD_FILE_ATTACH',
  }],
  ['driver.ts|POST|/fulfillments/:fulfillmentId/pod/:submissionId/submit', {
    serviceFile: path.resolve(process.cwd(), 'src/services/trip-pod.service.ts'),
    marker: 'endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_POD_SUBMIT',
  }],
  ['driver.ts|POST|/fulfillments/:fulfillmentId/complete', {
    serviceFile: path.resolve(process.cwd(), 'src/services/driver-fulfillment.service.ts'),
    marker: 'endpoint: IDEMPOTENCY_ENDPOINTS.DRIVER_FULFILLMENT_COMPLETE',
  }],
  ['driver.ts|POST|/trips/:tripId/incidental-costs', {
    serviceFile: path.resolve(process.cwd(), 'src/services/driver-fulfillment.service.ts'),
    marker: 'endpoint: IDEMPOTENCY_ENDPOINTS.DRIVER_INCIDENTAL_COST',
  }],
  ['driver.ts|POST|/trips/:tripId/fuel-evidence', {
    serviceFile: path.resolve(process.cwd(), 'src/routes/driver.ts'),
    marker: 'DRIVER_IDEMPOTENCY_ENDPOINTS.FUEL_EVIDENCE_CREATE',
  }],
  ['forwarder/order-exchange.ts|POST|/trips/:tripId/paper-order-collection', {
    serviceFile: path.resolve(process.cwd(), 'src/routes/forwarder/order-exchange.ts'),
    marker: 'FORWARDER_IDEMPOTENCY_ENDPOINTS.PAPER_ORDER_COLLECTION',
  }],
  ['forwarder/order-exchange.ts|POST|/shipments/:shipmentId/order-exchange/start', {
    serviceFile: path.resolve(process.cwd(), 'src/routes/forwarder/order-exchange.ts'),
    marker: 'FORWARDER_IDEMPOTENCY_ENDPOINTS.ORDER_EXCHANGE_START',
  }],
  ['forwarder/order-exchange.ts|POST|/shipments/:shipmentId/order-exchange/complete', {
    serviceFile: path.resolve(process.cwd(), 'src/routes/forwarder/order-exchange.ts'),
    marker: 'FORWARDER_IDEMPOTENCY_ENDPOINTS.ORDER_EXCHANGE_COMPLETE',
  }],
  ['forwarder/expenses.ts|POST|/expenses', {
    serviceFile: path.resolve(process.cwd(), 'src/services/forwarder-expense-commands.service.ts'),
    marker: 'endpoint: FORWARDER_IDEMPOTENCY_ENDPOINTS.EXPENSE_CREATE',
  }],
  ['forwarder/expenses.ts|PATCH|/expenses/:id', {
    serviceFile: path.resolve(process.cwd(), 'src/services/forwarder-expense-commands.service.ts'),
    marker: 'endpoint: FORWARDER_IDEMPOTENCY_ENDPOINTS.EXPENSE_UPDATE',
  }],
  ['forwarder/expenses.ts|PUT|/trips/:tripId/expense-completion', {
    serviceFile: path.resolve(process.cwd(), 'src/services/forwarder-expense-commands.service.ts'),
    marker: 'endpoint: FORWARDER_IDEMPOTENCY_ENDPOINTS.EXPENSE_COMPLETION',
  }],
  ['forwarder/expenses.ts|DELETE|/expenses/:id', {
    serviceFile: path.resolve(process.cwd(), 'src/services/forwarder-expense-commands.service.ts'),
    marker: 'endpoint: FORWARDER_IDEMPOTENCY_ENDPOINTS.EXPENSE_DELETE',
  }],
  ['financial/payments.routes.ts|POST|/finance/treasury/accounts/setup', {
    serviceFile: path.resolve(process.cwd(), 'src/services/treasury.service.ts'),
    marker: 'export async function requestTreasuryAccountSetup(',
  }],
  ['financial/payments.routes.ts|POST|/finance/treasury/accounts/:id/cutover', {
    serviceFile: path.resolve(process.cwd(), 'src/services/treasury.service.ts'),
    marker: 'export async function requestTreasuryCutover(',
  }],
  ['financial/payments.routes.ts|POST|/finance/treasury/movements/:id/reversal', {
    serviceFile: path.resolve(process.cwd(), 'src/services/treasury.service.ts'),
    marker: 'export async function requestTreasuryMovementReversal(',
  }],
  ['portal/index.ts|POST|/shipments/:id/customer-events/:eventId/acknowledge', {
    serviceFile: path.resolve(process.cwd(), 'src/services/shipment-coordination.service.ts'),
    marker: 'export async function acknowledgeCustomerVisibleEvent(',
  }],
  ['portal/index.ts|POST|/shipments/:id/customer-events/:eventId/delivery-response', {
    serviceFile: path.resolve(process.cwd(), 'src/services/customer-delivery-response.service.ts'),
    marker: 'endpoint: IDEMPOTENCY_ENDPOINTS.PORTAL_DELIVERY_RESPONSE',
  }],
  ['work-inbox.ts|POST|/delivery-disputes/:responseId/resolve', {
    serviceFile: path.resolve(process.cwd(), 'src/services/customer-delivery-response.service.ts'),
    marker: 'export async function resolveCustomerDeliveryDispute(',
  }],
  ['ocr.ts|POST|/fuel-evidence-reviews/:id/decision', {
    serviceFile: path.resolve(process.cwd(), 'src/routes/ocr.ts'),
    marker: 'ocr.fuel-evidence-reviews.decision',
  }],
  ['shipments/coordination.routes.ts|POST|/:id/customer-events', {
    serviceFile: path.resolve(process.cwd(), 'src/services/shipment-coordination.service.ts'),
    marker: 'export async function createCustomerVisibleEvent(',
  }],
  ['shipments/coordination.routes.ts|POST|/:id/dispatch-handoffs', {
    serviceFile: path.resolve(process.cwd(), 'src/services/dispatch-handoff.service.ts'),
    marker: 'export async function createHandoff(',
  }],
  ['shipments/coordination.routes.ts|POST|/:id/dispatch-handoffs/:handoffId/resolve', {
    serviceFile: path.resolve(process.cwd(), 'src/services/dispatch-handoff.service.ts'),
    marker: 'export async function resolveHandoff(',
  }],
  ['shipments/core.routes.ts|POST|/:id/submit-for-dispatch', {
    serviceFile: path.resolve(process.cwd(), 'src/services/shipment-intake.service.ts'),
    marker: 'endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_SUBMIT_FOR_DISPATCH',
  }],
  ['shipments/core.routes.ts|POST|/:id/dispatch', {
    serviceFile: path.resolve(process.cwd(), 'src/services/dispatch-planning-commands.service.ts'),
    marker: 'endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_DISPATCH',
  }],
  ['shipments/dispatch-planning.routes.ts|PATCH|/dispatch-detail-plan-rows/:fulfillmentId/plate', {
    serviceFile: path.resolve(process.cwd(), 'src/services/dispatch-planning-detail-plan.service.ts'),
    marker: 'endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_FULFILLMENT_PLATE_ASSIGN',
  }],
  ['shipments/dispatch-planning.routes.ts|PATCH|/dispatch-detail-plan-rows/:fulfillmentId/estimates', {
    serviceFile: path.resolve(process.cwd(), 'src/services/dispatch-planning-detail-plan.service.ts'),
    marker: 'endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_FULFILLMENT_ESTIMATES_UPDATE',
  }],
  ['shipments/dispatch-planning.routes.ts|PATCH|/dispatch-detail-plan-rows/:fulfillmentId/plan', {
    serviceFile: path.resolve(process.cwd(), 'src/services/dispatch-planning-detail-plan.service.ts'),
    marker: 'endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_FULFILLMENT_PLAN_UPDATE',
  }],
  ['shipments/pod.routes.ts|POST|/:id/pod-reviews/:submissionId/review', {
    serviceFile: path.resolve(process.cwd(), 'src/services/shipment-review.service.ts'),
    marker: 'endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_POD_REVIEW',
  }],
  ['shipments/core.routes.ts|POST|/:id/complete', {
    serviceFile: path.resolve(process.cwd(), 'src/services/shipment-lifecycle.service.ts'),
    marker: 'endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_COMPLETE',
  }],
  ['shipments/core.routes.ts|POST|/:id/fulfillments/:fulfillmentId/cancellation-disposition', {
    serviceFile: path.resolve(process.cwd(), 'src/services/shipment-lifecycle.service.ts'),
    marker: 'endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_FULFILLMENT_CANCEL',
  }],
  ['shipments/cus-workspace.routes.ts|POST|/cus-workspace/:id/delete-request', {
    serviceFile: path.resolve(process.cwd(), 'src/services/shipment-governance.service.ts'),
    marker: 'endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_DELETE_REQUEST',
  }],
  ['shipments/cus-workspace.routes.ts|POST|/cus-workspace/:id/delete-requests/:actionId/decision', {
    serviceFile: path.resolve(process.cwd(), 'src/services/shipment-governance.service.ts'),
    marker: 'endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_DELETE_REQUEST_DECISION',
  }],
  ['shipments/cus-workspace.routes.ts|POST|/cus-workspace/:id/container-edit-request', {
    serviceFile: path.resolve(process.cwd(), 'src/services/shipment-governance.service.ts'),
    marker: 'endpoint: IDEMPOTENCY_ENDPOINTS.CONTAINER_EDIT_REQUEST',
  }],
  ['shipments/cus-workspace.routes.ts|POST|/cus-workspace/:id/container-edit-requests/:actionId/decision', {
    serviceFile: path.resolve(process.cwd(), 'src/services/shipment-governance.service.ts'),
    marker: 'endpoint: IDEMPOTENCY_ENDPOINTS.CONTAINER_EDIT_REQUEST_DECISION',
  }],
]);

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

function normalizeRouteSample(mountPrefix: string, localPath: string): string {
  const joined = `${mountPrefix.replace(/\/$/, '')}/${localPath.replace(/^\//, '')}`
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
  return joined.replace(/:[A-Za-z0-9_]+/g, '123');
}

type RouterImport = {
  filePath: string;
  exportName: string;
};

type ParsedModule = {
  source: string;
  sourceFile: ts.SourceFile;
  imports: Map<string, RouterImport>;
};

const parsedModuleCache = new Map<string, ParsedModule>();

function resolveLocalModule(importerPath: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(importerPath), specifier);
  for (const candidate of [`${base}.ts`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function parseModule(filePath: string): ParsedModule {
  const cached = parsedModuleCache.get(filePath);
  if (cached) return cached;
  const source = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const imports = new Map<string, RouterImport>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)
      || !ts.isStringLiteral(statement.moduleSpecifier)
      || !statement.importClause) {
      continue;
    }
    const importedFile = resolveLocalModule(filePath, statement.moduleSpecifier.text);
    if (!importedFile || !importedFile.startsWith(routesRoot)) continue;
    if (statement.importClause.name) {
      imports.set(statement.importClause.name.text, {
        filePath: importedFile,
        exportName: 'default',
      });
    }
    const bindings = statement.importClause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        imports.set(element.name.text, {
          filePath: importedFile,
          exportName: element.propertyName?.text ?? element.name.text,
        });
      }
    }
  }
  const parsed = { source, sourceFile, imports };
  parsedModuleCache.set(filePath, parsed);
  return parsed;
}

function returnedRouterIdentifiers(node: ts.Node): string[] {
  const identifiers = new Set<string>();
  const visit = (child: ts.Node) => {
    if (ts.isReturnStatement(child) && child.expression && ts.isIdentifier(child.expression)) {
      identifiers.add(child.expression.text);
      return;
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return [...identifiers];
}

function resolveReexportedRouterIdentifiers(
  filePath: string,
  exportName: string,
  seen: Set<string>,
): Array<{ file: string; name: string }> {
  const results: Array<{ file: string; name: string }> = [];
  const { sourceFile } = parseModule(filePath);
  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement)
      || !statement.exportClause
      || !ts.isNamedExports(statement.exportClause)
      || !statement.moduleSpecifier
      || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const target = resolveLocalModule(filePath, statement.moduleSpecifier.text);
    if (!target || seen.has(target)) continue;
    seen.add(target);
    for (const element of statement.exportClause.elements) {
      if (element.name.text !== exportName) continue;
      const inner = element.propertyName?.text ?? element.name.text;
      // The defining module either declares the router itself or re-exports it
      // again (chained aggregator); try direct resolution first, then recurse.
      const local = resolveExportedRouterIdentifiers(target, inner);
      if (local.length > 0) {
        results.push(...local);
      } else {
        results.push(...resolveReexportedRouterIdentifiers(target, inner, seen));
      }
    }
  }
  return results;
}

function resolveExportedRouterIdentifiers(filePath: string, exportName: string): Array<{ file: string; name: string }> {
  const { sourceFile } = parseModule(filePath);
  const localNames = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (exportName === 'default' && ts.isExportAssignment(statement)) {
      if (ts.isIdentifier(statement.expression)) {
        localNames.add(statement.expression.text);
      } else if (ts.isCallExpression(statement.expression)
        && ts.isIdentifier(statement.expression.expression)) {
        const factoryName = statement.expression.expression.text;
        const factory = sourceFile.statements.find(
          (candidate): candidate is ts.FunctionDeclaration =>
            ts.isFunctionDeclaration(candidate) && candidate.name?.text === factoryName,
        );
        if (factory) {
          for (const identifier of returnedRouterIdentifiers(factory)) localNames.add(identifier);
        }
      }
    }
    if (ts.isVariableStatement(statement)
      && statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === exportName) {
          localNames.add(declaration.name.text);
        }
      }
    }
    if (ts.isExportDeclaration(statement)
      && statement.exportClause
      && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        if (element.name.text === exportName) {
          localNames.add(element.propertyName?.text ?? element.name.text);
        }
      }
    }
  }
  if (localNames.size === 0) {
    // Aggregator re-export (`export { X } from './mod'` with no local binding):
    // follow the chain to the module that actually declares the router.
    const viaReexport = resolveReexportedRouterIdentifiers(filePath, exportName, new Set([filePath]));
    if (viaReexport.length > 0) return viaReexport;
  }
  assert.ok(
    localNames.size > 0,
    `cannot resolve mounted router export ${exportName} from ${path.relative(routesRoot, filePath)}`,
  );
  const results: Array<{ file: string; name: string }> = [];
  for (const name of localNames) {
    // Plain re-export of an imported binding (`import {X} from './mod'; export {X};`):
    // the routes are declared in the source module, not this aggregator.
    const imported = parseModule(filePath).imports.get(name);
    if (imported && imported.filePath !== filePath) {
      results.push(...resolveExportedRouterIdentifiers(imported.filePath, imported.exportName));
    } else {
      results.push({ file: filePath, name });
    }
  }
  return results;
}

function staticTemplateExpressionValues(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
): string[] {
  if (!ts.isPropertyAccessExpression(expression) || !ts.isIdentifier(expression.expression)) {
    return [];
  }
  let owner: ts.Node | undefined = expression;
  while (owner && !ts.isFunctionDeclaration(owner)) owner = owner.parent;
  if (!owner?.name) return [];
  const values = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === owner.name?.text
      && node.arguments[0]
      && ts.isObjectLiteralExpression(node.arguments[0])) {
      for (const property of node.arguments[0].properties) {
        if (ts.isPropertyAssignment(property)
          && property.name.getText(sourceFile) === expression.name.text
          && ts.isStringLiteral(property.initializer)) {
          values.add(property.initializer.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...values];
}

function literalPathArguments(call: ts.CallExpression, sourceFile: ts.SourceFile): string[] {
  const first = call.arguments[0];
  if (first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) {
    return [first.text];
  }
  if (first && ts.isTemplateExpression(first)) {
    let values = [first.head.text];
    for (const span of first.templateSpans) {
      const replacements = staticTemplateExpressionValues(span.expression, sourceFile);
      assert.ok(
        replacements.length > 0,
        `mounted mutation template expression must resolve from static router registration: ${call.getText()}`,
      );
      values = values.flatMap((prefix) =>
        replacements.map((replacement) => `${prefix}${replacement}${span.literal.text}`));
    }
    return values;
  }
  assert.ok(
    false,
    `mounted mutation path must be a static literal: ${call.getText()}`,
  );
  return [];
}

function extractMountedMutationRoutes(): Array<{
  sourceKey: string;
  method: string;
  routePath: string;
  sourceBody: string;
}> {
  const routes: Array<{
    sourceKey: string;
    method: string;
    routePath: string;
    sourceBody: string;
  }> = [];
  const visited = new Set<string>();

  const scanRouter = (
    filePath: string,
    routerIdentifier: string,
    mountPrefix: string,
  ) => {
    const visitKey = `${filePath}|${routerIdentifier}|${mountPrefix}`;
    if (visited.has(visitKey)) return;
    visited.add(visitKey);
    const { sourceFile, imports } = parseModule(filePath);
    const relativePath = path.relative(routesRoot, filePath);

    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression)
        && node.expression.expression.text === routerIdentifier) {
        const operation = node.expression.name.text.toLowerCase();
        if (['post', 'put', 'patch', 'delete'].includes(operation)) {
          for (const localPath of literalPathArguments(node, sourceFile)) {
            routes.push({
              sourceKey: `${relativePath}|${operation.toUpperCase()}|${localPath}`,
              method: operation.toUpperCase(),
              routePath: normalizeRouteSample(mountPrefix, localPath),
              sourceBody: node.getText(sourceFile),
            });
          }
        } else if (operation === 'use') {
          const first = node.arguments[0];
          const localMount = first
            && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))
            ? first.text
            : '';
          const nestedPrefix = normalizeRouteSample(mountPrefix, localMount);
          for (const argument of node.arguments) {
            if (!ts.isIdentifier(argument)) continue;
            const imported = imports.get(argument.text);
            if (imported) {
              for (const nested of resolveExportedRouterIdentifiers(
                imported.filePath,
                imported.exportName,
              )) {
                scanRouter(nested.file, nested.name, nestedPrefix);
              }
            } else if (argument.text !== routerIdentifier) {
              scanRouter(filePath, argument.text, nestedPrefix);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  };

  const entry = parseModule(applicationEntryPath);
  const visitEntry = (node: ts.Node) => {
    if (ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === 'app'
      && node.expression.name.text === 'use') {
      const first = node.arguments[0];
      const mountPrefix = first
        && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))
        ? first.text
        : '';
      for (const argument of node.arguments) {
        if (!ts.isIdentifier(argument)) continue;
        const imported = entry.imports.get(argument.text);
        if (!imported) continue;
        for (const resolved of resolveExportedRouterIdentifiers(
          imported.filePath,
          imported.exportName,
        )) {
          scanRouter(resolved.file, resolved.name, mountPrefix);
        }
      }
    }
    ts.forEachChild(node, visitEntry);
  };
  visitEntry(entry.sourceFile);

  return routes;
}

function extractConstObject(source: string, constantName: string): Record<string, string> {
  const blockMatch = source.match(new RegExp(`const ${constantName} = \\{([\\s\\S]*?)\\} as const;`));
  if (!blockMatch) return {};
  return Object.fromEntries(
    [...blockMatch[1].matchAll(/([A-Z0-9_]+):\s*'([^']+)'/g)].map((match) => [match[1], match[2]]),
  );
}

function extractConstStrings(source: string): Record<string, string> {
  return Object.fromEntries(
    [...source.matchAll(/const\s+([A-Z0-9_]+)\s*=\s*'([^']+)'/g)].map((match) => [match[1], match[2]]),
  );
}

function extractExpectedEndpointsFromRouteFile(filePath: string): string[] {
  const source = fs.readFileSync(filePath, 'utf8');
  const endpoints = new Set<string>();
  const constStrings = extractConstStrings(source);

  for (const match of source.matchAll(/endpoint:\s*'([^']+)'/g)) {
    endpoints.add(match[1]);
  }

  for (const match of source.matchAll(/endpoint:\s*([A-Z0-9_]+)\b/g)) {
    const value = constStrings[match[1]];
    if (value) endpoints.add(value);
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
    const value = constStrings[constantName];
    for (const match of source.matchAll(new RegExp(`endpoint:\\s*${constantName}\\b`, 'g'))) {
      if (match[0] && value) {
        endpoints.add(value);
      }
    }
  }

  return [...endpoints];
}

function extractGeneratedCrudEndpoints(): string[] {
  const source = fs.readFileSync(catalogCrudRoutePath, 'utf8');
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
  test('discovers named and nested routers from the production mount topology', () => {
    const routes = extractMountedMutationRoutes();
    const discovered = new Map(routes.map((route) => [route.sourceKey, route.routePath]));
    const expected = new Map([
      ['app-settings.ts|PUT|/', '/api/admin/app-settings'],
      ['upload.ts|POST|/company-logo', '/api/upload/company-logo'],
      ['financial/payments.routes.ts|POST|/payments/receive', '/api/payments/receive'],
      ['config/salary-periods-config.routes.ts|POST|/:period/exclusions', '/api/salary-periods/123/exclusions'],
    ]);
    for (const [sourceKey, routePath] of expected) {
      assert.equal(discovered.get(sourceKey), routePath, `missing mounted route ${sourceKey}`);
    }
  });

  test('independently inventories every mounted mutation route', () => {
    const uncovered: string[] = [];
    for (const route of extractMountedMutationRoutes()) {
      if (REVIEWED_NON_MATERIAL_MUTATIONS.has(route.sourceKey)) continue;
      if (!matchDeclaredMaterialWrite(route.method, route.routePath)) {
        uncovered.push(`${route.sourceKey} => ${route.method} ${route.routePath}`);
      }
    }
    assert.deepEqual(uncovered.sort(), []);
  });

  test('every inventoried material mutation reaches a reviewed durable command boundary', () => {
    for (const route of extractMountedMutationRoutes()) {
      if (REVIEWED_NON_MATERIAL_MUTATIONS.has(route.sourceKey)) continue;
      const delegated = REVIEWED_SERVICE_DURABLE_BOUNDARIES.get(route.sourceKey);
      if (delegated) {
        const source = fs.readFileSync(delegated.serviceFile, 'utf8');
        assert.ok(
          source.includes(delegated.marker),
          `${route.sourceKey}: missing service durability marker ${delegated.marker}`,
        );
        continue;
      }
      assert.match(
        route.sourceBody,
        /\b(runIdempotent|runShipmentWrite|createShipmentIdempotent|runDurableGpsCommand|[A-Za-z]+WriteCommand)\b/,
        `${route.sourceKey}: no reviewed durable command boundary`,
      );
    }
  });

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
      ['PUT', '/api/admin/ocr-settings', 'admin.ocr-settings.update'],
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
      ['POST', '/api/salary-periods/2026-07/exclusions', 'config.salary-periods.exclusion.create'],
      ['POST', '/api/salary-periods/2026-07/exclusions/9/check', 'config.salary-periods.exclusion.check'],
      ['POST', '/api/salary-periods/2026-07/exclusions/9/approve', 'config.salary-periods.exclusion.approve'],
      ['POST', '/api/salary-periods/2026-07/exclusions/9/complete-followup', 'config.salary-periods.exclusion.followup.complete'],
      ['POST', '/api/salary-periods/2026-07/close', 'config.salary-periods.close.request'],
      ['POST', '/api/salary-periods/2026-07/close-actions/9/check', 'config.salary-periods.close.check'],
      ['POST', '/api/salary-periods/2026-07/close-actions/9/approve', 'config.salary-periods.close.approve'],
      ['POST', '/api/salary-periods/2026-07/reopen', 'config.salary-periods.reopen.request'],
      ['POST', '/api/salary-periods/2026-07/reopen-actions/9/check', 'config.salary-periods.reopen.check'],
      ['POST', '/api/salary-periods/2026-07/reopen-actions/9/approve', 'config.salary-periods.reopen.approve'],
      ['POST', '/api/salary/periods/2026-07/issue-actions/9/check', IDEMPOTENCY_ENDPOINTS.GOVERNANCE_CHECK],
      ['POST', '/api/salary/periods/2026-07/issue-actions/9/approve', IDEMPOTENCY_ENDPOINTS.GOVERNANCE_APPROVE],
      ['POST', '/api/salary/periods/2026-07/post-actions/9/check', IDEMPOTENCY_ENDPOINTS.GOVERNANCE_CHECK],
      ['POST', '/api/salary/periods/2026-07/post-actions/9/approve', IDEMPOTENCY_ENDPOINTS.GOVERNANCE_APPROVE],
      ['POST', '/api/business-calendar', 'config.business_calendar_days.create'],
      ['PUT', '/api/business-calendar/3', 'config.business_calendar_days.update'],
      ['DELETE', '/api/business-calendar/3', 'config.business_calendar_days.delete'],
      ['POST', '/api/ancillary-revenue', 'config.ancillary_revenue.create'],
      ['PUT', '/api/ancillary-revenue/3', 'config.ancillary_revenue.update'],
      ['DELETE', '/api/ancillary-revenue/3', 'config.ancillary_revenue.delete'],
      ['POST', '/api/finance/fuel-invoices/123/corrections', 'fuel-invoices.correction.create'],
      ['POST', '/api/shipments/123/complete', IDEMPOTENCY_ENDPOINTS.SHIPMENT_COMPLETE],
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
