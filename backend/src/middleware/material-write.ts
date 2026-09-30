import type { Request, RequestHandler } from 'express';
import { ApiError } from '../errors';
import {
  IDEMPOTENCY_ENDPOINTS,
  resolveIdempotencyKey,
} from '../services/idempotency.service';

type HttpMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface MaterialWriteRule {
  method: HttpMethod;
  endpoint: string;
  canonicalAliases?: readonly string[];
  pattern: RegExp;
}

function escapeRegexPath(path: string): string {
  return path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Dead rows pruned 2026-09-30 (card 20260930_230): the six salary-periods
// governance-action rows (exclusion/close/reopen -actions check|approve) had
// no mounts anywhere in src/routes — relics of the approval-workflow removal.
const MATERIAL_WRITE_RULES: readonly MaterialWriteRule[] = [
  // Card 20260928_166 AC1 — the 39-truck split. The batch route shipped without
  // this declaration: runShipmentWrite's audit persist found no declared
  // material-write endpoint and every real request 500'd while the
  // service-level suite (which skips the router) stayed green.
  // Card 20260921_21/19/8+13 governance rider: the ten financial-write
  // routes wrapped in runIdempotent (see the accounting routes).
  // Card 20260923_12 — Chọn Debit settlement rounds (đợt chốt) — one more
  // financial write in the runIdempotent family.
  // Card 20260922_57 quotation xlsx import commit — the route already demanded
  // an Idempotency-Key; the durable boundary makes the key real (replays
  // return the stored response instead of always creating a new frame).
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.UPLOAD_TRIP_PHOTO, pattern: /^\/api\/upload$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.UPLOAD_COMPANY_LOGO, pattern: /^\/api\/upload\/company-logo$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.UPLOAD_TRIP_PHOTO_DELETE, pattern: /^\/api\/upload\/trips\/[^/]+\/photos\/[^/]+\/delete$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.OCR_CAPTURE, pattern: /^\/api\/ocr$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.OCR_PERSIST_ONLY, pattern: /^\/api\/ocr\/persist-only$/ },
  { method: 'PATCH', endpoint: 'auth.profile.update', pattern: /^\/api\/auth\/me$/ },
  { method: 'POST', endpoint: 'auth.password.change', pattern: /^\/api\/auth\/change-password$/ },
  { method: 'POST', endpoint: 'auth.users.create', pattern: /^\/api\/auth\/users$/ },
  { method: 'PATCH', endpoint: 'auth.users.update', pattern: /^\/api\/auth\/users\/[^/]+$/ },
  { method: 'DELETE', endpoint: 'auth.users.delete', pattern: /^\/api\/auth\/users\/[^/]+$/ },
  { method: 'POST', endpoint: 'auth.business-units.create', pattern: /^\/api\/auth\/business-units$/ },
  { method: 'PATCH', endpoint: 'auth.business-units.update', pattern: /^\/api\/auth\/business-units\/[^/]+$/ },
  { method: 'DELETE', endpoint: 'auth.business-units.deactivate', pattern: /^\/api\/auth\/business-units\/[^/]+$/ },
  // Ops field-operations portal (OpsVanHanh) — financial cash commands run
  // runIdempotent in routes/ops.ts with these durable endpoints.
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.OPS_EXPENSE_APPROVE, pattern: /^\/api\/ops\/admin\/expenses\/[^/]+\/approve$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.OPS_EXPENSE_REJECT, pattern: /^\/api\/ops\/admin\/expenses\/[^/]+\/reject$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.OPS_SETTLEMENT_APPROVE, pattern: /^\/api\/ops\/admin\/settlements\/[^/]+\/approve$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.OPS_SETTLEMENT_REJECT, pattern: /^\/api\/ops\/admin\/settlements\/[^/]+\/reject$/ },
  { method: 'PUT', endpoint: 'admin.app-settings.email.update', pattern: /^\/api\/admin\/app-settings\/email$/ },
  { method: 'PUT', endpoint: 'admin.app-settings.update', pattern: /^\/api\/admin\/app-settings$/ },
  { method: 'POST', endpoint: 'admin.financial-reporting-policy.request', pattern: /^\/api\/admin\/app-settings\/financial-reporting\/policy$/ },
  { method: 'POST', endpoint: 'admin.truck-financial-profile.request', pattern: /^\/api\/admin\/app-settings\/financial-reporting\/truck-profiles$/ },
  { method: 'PUT', endpoint: 'admin.ocr-settings.update', pattern: /^\/api\/admin\/ocr-settings$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.TRUCK_RESTORE, pattern: /^\/api\/trucks\/restore$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_ACCOUNTING_LOCK_ACTIVATE, pattern: /^\/api\/shipments\/[^/]+\/accounting-lock$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_DELETE_REQUEST_DECISION, pattern: /^\/api\/shipments\/cus-workspace\/[^/]+\/delete-requests\/[^/]+\/decision$/ },
  { method: 'PUT', endpoint: 'expenses.update', pattern: /^\/api\/expenses\/[^/]+$/ },
  { method: 'DELETE', endpoint: 'expenses.delete', pattern: /^\/api\/expenses\/[^/]+$/ },
  { method: 'POST', endpoint: 'geotag.submit', pattern: /^\/api\/geotag$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.PAYMENTS_RECEIVE, pattern: /^\/api\/payments\/receive$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.PAYMENT_REFUNDS_CREATE, pattern: /^\/api\/payments\/receipts\/[^/]+\/refunds$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.PAYMENTS_VENDOR, pattern: /^\/api\/payments\/vendor$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.PAYMENTS_CARRIER, pattern: /^\/api\/payments\/carrier$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.FINANCIAL_ADJUSTMENT_CREATE, pattern: /^\/api\/adjustments$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.COMMISSIONS_CREATE, pattern: /^\/api\/commissions$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.DRIVER_PAYOUT, pattern: /^\/api\/drivers\/[^/]+\/payouts$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.PENALTIES_CREATE, pattern: /^\/api\/penalties$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.PENALTIES_CANCEL, pattern: /^\/api\/penalties\/[^/]+\/cancel$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.DEBT_OFFSET_CREATE, pattern: /^\/api\/finance\/debt-offsets$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.DEBT_OFFSET_CANCEL, pattern: /^\/api\/finance\/debt-offsets\/[^/]+\/cancel$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.SNAPSHOT_AR_RECAPTURE, pattern: /^\/api\/finance\/snapshots\/ar\/[^/]+\/recapture$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.SNAPSHOT_AP_RECAPTURE, pattern: /^\/api\/finance\/snapshots\/ap\/[^/]+\/recapture$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.SNAPSHOT_FUEL_SURCHARGE_RECAPTURE, pattern: /^\/api\/finance\/snapshots\/fuel-surcharge\/[^/]+\/recapture$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.ADVANCE_REQUEST_APPROVE, pattern: /^\/api\/advance-requests\/[^/]+\/approve$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.ADVANCE_DRAFT_RECORD, pattern: /^\/api\/(?:forwarder\/me\/)?advance-requests\/[^/]+\/record$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.ADVANCE_DRAFT_VOID, pattern: /^\/api\/(?:forwarder\/me\/)?advance-requests\/[^/]+\/void$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.ADVANCE_REQUEST_REJECT, pattern: /^\/api\/advance-requests\/[^/]+\/reject$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.ADVANCE_SETTLEMENT_CHECK, pattern: /^\/api\/advance-settlements\/[^/]+\/check$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.ADVANCE_SETTLEMENT_APPROVE, pattern: /^\/api\/advance-settlements\/[^/]+\/approve$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.ADVANCE_SETTLEMENT_REJECT, pattern: /^\/api\/advance-settlements\/[^/]+\/reject$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.ADVANCE_SETTLEMENT_REVERSE, pattern: /^\/api\/advance-settlements\/[^/]+\/reversal$/ },
  { method: 'PUT', endpoint: IDEMPOTENCY_ENDPOINTS.ADVANCE_SETTLEMENT_UPDATE, pattern: /^\/api\/advance-settlements\/[^/]+$/ },
  { method: 'PATCH', endpoint: IDEMPOTENCY_ENDPOINTS.ADVANCE_SETTLEMENT_EXPENSE_ADJUST, pattern: /^\/api\/advance-settlements\/[^/]+\/expenses\/[^/]+$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.BILLING_DOCUMENT_CREATE, pattern: /^\/api\/finance\/billing-documents$/ },
  { method: 'PUT', endpoint: IDEMPOTENCY_ENDPOINTS.BILLING_DOCUMENT_UPDATE, pattern: /^\/api\/finance\/billing-documents\/[^/]+$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.BILLING_DOCUMENT_ADJUSTMENT_REQUEST, pattern: /^\/api\/finance\/billing-documents\/[^/]+\/adjustments$/ },
  { method: 'POST', endpoint: 'billing-documents.send-confirmation', pattern: /^\/api\/finance\/billing-documents\/[^/]+\/send-for-confirmation$/ },
  { method: 'DELETE', endpoint: IDEMPOTENCY_ENDPOINTS.BILLING_DOCUMENT_DELETE, pattern: /^\/api\/finance\/billing-documents\/[^/]+$/ },
  { method: 'PUT', endpoint: 'freight-rate-snapshots.override', pattern: /^\/api\/pricing\/snapshots\/[^/]+\/override$/ },
  // Card 20260922_66/_61: quotation writes are governed (runIdempotent) —
  // declared here so the envelope 400s a key-less write with the VN message
  // instead of the audit guard's raw 500 "Material write audit context is
  // incomplete" (QA staging finding 2026-09-23). Endpoint strings MUST equal
  // the routes' runIdempotent endpoint values.
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.GOVERNANCE_CHECK, pattern: /^\/api\/governance-actions\/[^/]+\/check$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.GOVERNANCE_APPROVE, pattern: /^\/api\/governance-actions\/[^/]+\/approve$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.GOVERNANCE_REJECT, pattern: /^\/api\/governance-actions\/[^/]+\/reject$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.GOVERNANCE_RETURN, pattern: /^\/api\/governance-actions\/[^/]+\/return-for-evidence$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.GOVERNANCE_CANCEL, pattern: /^\/api\/governance-actions\/[^/]+\/cancel$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.PORTAL_DEBIT_NOTE_CONFIRM, pattern: /^\/api\/portal\/debit-notes\/[^/]+\/confirm$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.PORTAL_DEBIT_NOTE_DISPUTE, pattern: /^\/api\/portal\/debit-notes\/[^/]+\/dispute$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.SALARY_PERIOD_CLOSE, pattern: /^\/api\/salary\/periods\/[^/]+\/close$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.SALARY_PERIOD_REOPEN, pattern: /^\/api\/salary\/periods\/[^/]+\/reopen$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.SALARY_PERIOD_ADJUSTMENT, pattern: /^\/api\/salary\/periods\/[^/]+\/adjustments$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.GOVERNANCE_CHECK, pattern: /^\/api\/salary\/periods\/[^/]+\/adjustments\/[^/]+\/check$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.GOVERNANCE_APPROVE, pattern: /^\/api\/salary\/periods\/[^/]+\/adjustments\/[^/]+\/approve$/ },
  { method: 'PUT', endpoint: IDEMPOTENCY_ENDPOINTS.SALARY_WORKDAYS, pattern: /^\/api\/salary\/[^/]+\/[^/]+\/[^/]+\/workdays$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.SALARY_CONFIRM, pattern: /^\/api\/salary\/[^/]+\/[^/]+\/[^/]+\/confirm$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.GOVERNANCE_CHECK, pattern: /^\/api\/salary\/[^/]+\/[^/]+\/[^/]+\/confirm-actions\/[^/]+\/check$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.GOVERNANCE_APPROVE, pattern: /^\/api\/salary\/[^/]+\/[^/]+\/[^/]+\/confirm-actions\/[^/]+\/approve$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.SALARY_UNCONFIRM, pattern: /^\/api\/salary\/[^/]+\/[^/]+\/[^/]+\/unconfirm$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.GOVERNANCE_CHECK, pattern: /^\/api\/salary\/[^/]+\/[^/]+\/[^/]+\/unconfirm-actions\/[^/]+\/check$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.GOVERNANCE_APPROVE, pattern: /^\/api\/salary\/[^/]+\/[^/]+\/[^/]+\/unconfirm-actions\/[^/]+\/approve$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.GOVERNANCE_CHECK, pattern: /^\/api\/salary\/periods\/[^/]+\/close-actions\/[^/]+\/check$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.GOVERNANCE_APPROVE, pattern: /^\/api\/salary\/periods\/[^/]+\/close-actions\/[^/]+\/approve$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.GOVERNANCE_CHECK, pattern: /^\/api\/salary\/periods\/[^/]+\/reopen-actions\/[^/]+\/check$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.GOVERNANCE_APPROVE, pattern: /^\/api\/salary\/periods\/[^/]+\/reopen-actions\/[^/]+\/approve$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.GOVERNANCE_CHECK, pattern: /^\/api\/salary\/periods\/[^/]+\/issue-actions\/[^/]+\/check$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.GOVERNANCE_APPROVE, pattern: /^\/api\/salary\/periods\/[^/]+\/issue-actions\/[^/]+\/approve$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.GOVERNANCE_CHECK, pattern: /^\/api\/salary\/periods\/[^/]+\/post-actions\/[^/]+\/check$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.GOVERNANCE_APPROVE, pattern: /^\/api\/salary\/periods\/[^/]+\/post-actions\/[^/]+\/approve$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_PAIR_CREATE, pattern: /^\/api\/trips\/pairs$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_BULK_FIGURES, pattern: /^\/api\/trips\/bulk-figures$/ },
  { method: 'POST', endpoint: 'trips.create', pattern: /^\/api\/trips$/ },
  { method: 'POST', endpoint: 'trips.copy', pattern: /^\/api\/trips\/[^/]+\/copy$/ },
  { method: 'POST', endpoint: 'trips.transition.in_transit', pattern: /^\/api\/trips\/[^/]+\/dispatch$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_FINANCIAL_CLOSE, pattern: /^\/api\/trips\/[^/]+\/complete$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.DISPATCH_EXTERNAL_FULFILLMENT_COMPLETE, pattern: /^\/api\/trips\/[^/]+\/complete-external$/ },
  { method: 'POST', endpoint: 'trips.transition.locked', pattern: /^\/api\/trips\/[^/]+\/lock$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_COMPLETED_CANCEL, pattern: /^\/api\/trips\/[^/]+\/cancel$/ },
  { method: 'DELETE', endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_DELETE, pattern: /^\/api\/trips\/[^/]+$/ },
  { method: 'PUT', endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_PRE_DEPARTURE, pattern: /^\/api\/trips\/[^/]+\/pre-departure$/ },
  { method: 'PUT', endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_ACTUALS, pattern: /^\/api\/trips\/[^/]+\/actuals$/ },
  { method: 'PATCH', endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_REASSIGN, pattern: /^\/api\/trips\/[^/]+\/reassign$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_UNLOCK, pattern: /^\/api\/trips\/[^/]+\/unlock$/ },
  { method: 'PATCH', endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_DEPARTURE_DATE, pattern: /^\/api\/trips\/[^/]+\/departure-date$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_ADJUSTMENT, pattern: /^\/api\/trips\/[^/]+\/adjustment$/ },
  { method: 'PUT', endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_CONTAINERS, pattern: /^\/api\/trips\/[^/]+\/containers$/ },
  { method: 'PUT', endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_INSTRUCTIONS, pattern: /^\/api\/trips\/[^/]+\/instructions$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_EXPENSE_CREATE, pattern: /^\/api\/trips\/[^/]+\/expenses$/ },
  { method: 'PUT', endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_EXPENSE_UPDATE, pattern: /^\/api\/trips\/[^/]+\/expenses\/[^/]+$/ },
  { method: 'DELETE', endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_EXPENSE_DELETE, pattern: /^\/api\/trips\/[^/]+\/expenses\/[^/]+$/ },
  { method: 'POST', endpoint: 'portal.shipments.customer-events.acknowledge', pattern: /^\/api\/portal\/shipments\/[^/]+\/customer-events\/[^/]+\/acknowledge$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.PORTAL_DELIVERY_RESPONSE, pattern: /^\/api\/portal\/shipments\/[^/]+\/customer-events\/[^/]+\/delivery-response$/ },
  { method: 'POST', endpoint: 'recoverable-costs.rejection-request', pattern: /^\/api\/recoverable-costs\/[^/]+\/request$/ },
  { method: 'PATCH', endpoint: IDEMPOTENCY_ENDPOINTS.TREASURY_ACCOUNT_FUND, pattern: /^\/api\/finance\/treasury\/accounts\/[^/]+\/fund$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.TREASURY_ACCOUNT_SETUP, pattern: /^\/api\/finance\/treasury\/accounts\/setup$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.TREASURY_ACCOUNT_CUTOVER, pattern: /^\/api\/finance\/treasury\/accounts\/[^/]+\/cutover$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.TREASURY_MOVEMENT_REVERSAL, pattern: /^\/api\/finance\/treasury\/movements\/[^/]+\/reversal$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.PROFIT_DISTRIBUTE, pattern: /^\/api\/reports\/distribute-profit$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.DRIVER_PROGRESS, pattern: /^\/api\/driver\/me\/trips\/[^/]+\/progress$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.DRIVER_PROGRESS, pattern: /^\/api\/driver\/me\/fulfillments\/[^/]+\/progress$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_POD_CREATE, pattern: /^\/api\/driver\/me\/fulfillments\/[^/]+\/pod$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_POD_FILE_ATTACH, pattern: /^\/api\/driver\/me\/fulfillments\/[^/]+\/pod\/[^/]+\/files$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_POD_SUBMIT, pattern: /^\/api\/driver\/me\/fulfillments\/[^/]+\/pod\/[^/]+\/submit$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.DRIVER_FULFILLMENT_COMPLETE, pattern: /^\/api\/driver\/me\/fulfillments\/[^/]+\/complete$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.DRIVER_INCIDENTAL_COST, pattern: /^\/api\/driver\/me\/trips\/[^/]+\/incidental-costs$/ },
  { method: 'POST', endpoint: 'driver.containers.create', pattern: /^\/api\/driver\/me\/trips\/[^/]+\/containers$/ },
  { method: 'POST', endpoint: 'driver.fuel-evidence.create', pattern: /^\/api\/driver\/me\/trips\/[^/]+\/fuel-evidence$/ },
  { method: 'PATCH', endpoint: 'driver.containers.update', pattern: /^\/api\/driver\/me\/trips\/[^/]+\/containers\/[^/]+$/ },
  { method: 'PUT', endpoint: 'driver.containers.seals.replace', pattern: /^\/api\/driver\/me\/trips\/[^/]+\/containers\/[^/]+\/seals$/ },
  { method: 'DELETE', endpoint: 'driver.trip-photos.delete', pattern: /^\/api\/driver\/me\/trips\/[^/]+\/photos\/[^/]+$/ },
  { method: 'POST', endpoint: 'forwarder.containers.create', pattern: /^\/api\/forwarder\/me\/trips\/[^/]+\/containers$/ },
  { method: 'POST', endpoint: 'forwarder.expenses.create', pattern: /^\/api\/forwarder\/me\/expenses$/ },
  { method: 'PATCH', endpoint: 'forwarder.expenses.update', pattern: /^\/api\/forwarder\/me\/expenses\/[^/]+$/ },
  { method: 'DELETE', endpoint: 'forwarder.expenses.delete', pattern: /^\/api\/forwarder\/me\/expenses\/[^/]+$/ },
  { method: 'PUT', endpoint: 'forwarder.expense-completion.update', pattern: /^\/api\/forwarder\/me\/trips\/[^/]+\/expense-completion$/ },
  { method: 'POST', endpoint: 'forwarder.advance-requests.create', pattern: /^\/api\/forwarder\/me\/advance-requests$/ },
  { method: 'POST', endpoint: 'forwarder.advance-settlements.create', pattern: /^\/api\/forwarder\/me\/advance-settlements$/ },
  { method: 'POST', endpoint: 'forwarder.expense-photos.create', pattern: /^\/api\/forwarder\/me\/expenses\/[^/]+\/photos$/ },
  { method: 'DELETE', endpoint: 'forwarder.expense-photos.delete', pattern: /^\/api\/forwarder\/me\/expense-photos\/[^/]+$/ },
  { method: 'POST', endpoint: 'forwarder.paper-order.collection', pattern: /^\/api\/forwarder\/me\/trips\/[^/]+\/paper-order-collection$/ },
  { method: 'POST', endpoint: 'forwarder.order-exchange.start', pattern: /^\/api\/forwarder\/me\/shipments\/[^/]+\/order-exchange\/start$/ },
  { method: 'POST', endpoint: 'forwarder.order-exchange.complete', pattern: /^\/api\/forwarder\/me\/shipments\/[^/]+\/order-exchange\/complete$/ },
  { method: 'POST', endpoint: 'credit-overrides.create', pattern: /^\/api\/finance\/credit-overrides$/ },
  { method: 'POST', endpoint: 'fuel-invoices.create', pattern: /^\/api\/finance\/fuel-invoices$/ },
  { method: 'PUT', endpoint: 'fuel-invoices.update', pattern: /^\/api\/finance\/fuel-invoices\/[^/]+$/ },
  { method: 'POST', endpoint: 'fuel-invoices.correction.create', pattern: /^\/api\/finance\/fuel-invoices\/[^/]+\/corrections$/ },
  { method: 'POST', endpoint: 'fuel-invoices.approve', pattern: /^\/api\/finance\/fuel-invoices\/[^/]+\/approve$/ },
  { method: 'POST', endpoint: 'billing-documents.issue.request', pattern: /^\/api\/finance\/billing-documents\/[^/]+\/issue$/ },
  { method: 'POST', endpoint: 'salary-periods.issue', pattern: /^\/api\/salary\/periods\/[^/]+\/issue$/ },
  { method: 'POST', endpoint: 'salary-periods.post', pattern: /^\/api\/salary\/periods\/[^/]+\/post$/ },
  { method: 'POST', endpoint: 'gps.backfill', pattern: /^\/api\/admin\/gps\/backfill$/ },
  { method: 'POST', endpoint: 'gps.recapture', pattern: /^\/api\/admin\/gps\/recapture\/[^/]+$/ },
  { method: 'POST', endpoint: 'ocr.pump', pattern: /^\/api\/ocr\/pump$/ },
];

const DECLARED_MATERIAL_WRITE_ENDPOINTS = new Set(
  MATERIAL_WRITE_RULES.flatMap((rule) => [rule.endpoint, ...(rule.canonicalAliases ?? [])]),
);

export function listDeclaredMaterialWriteEndpoints(): string[] {
  const endpoints = new Set<string>(DECLARED_MATERIAL_WRITE_ENDPOINTS);
  for (const rule of generatedRules) {
    endpoints.add(rule.endpoint);
    for (const alias of rule.canonicalAliases ?? []) endpoints.add(alias);
  }
  return [...endpoints].sort();
}

export interface MaterialWriteMatch {
  endpoint: string;
  canonicalAliases?: readonly string[];
  method: HttpMethod;
  path: string;
}

export function matchDeclaredMaterialWrite(
  method: string,
  rawPath: string,
): MaterialWriteMatch | null {
  const rawPathWithoutQuery = rawPath.split('?')[0];
  const path = rawPathWithoutQuery.length > 1
    ? rawPathWithoutQuery.replace(/\/+$/, '')
    : rawPathWithoutQuery;
  const upperMethod = method.toUpperCase() as HttpMethod;
  const rule = allRules().find((candidate) => (
    candidate.method === upperMethod && candidate.pattern.test(path)
  ));
  return rule ? { endpoint: rule.endpoint, method: rule.method, path, ...(rule.canonicalAliases ? { canonicalAliases: rule.canonicalAliases } : {}) } : null;
}

export function getMaterialWriteContext(req: Request): {
  endpoint: string;
  idempotencyKey: string;
} | null {
  const match = matchDeclaredMaterialWrite(req.method, req.originalUrl || req.url || '');
  if (!match) return null;
  const body = req.body as Record<string, unknown> | undefined;
  const idempotencyKey = resolveIdempotencyKey({
    headerValue: req.header('Idempotency-Key'),
    requestId: body?._requestId,
  });
  if (!idempotencyKey) {
    throw new ApiError(400, 'Idempotency-Key là bắt buộc cho thao tác ghi dữ liệu này.');
  }
  return {
    endpoint: match.endpoint,
    idempotencyKey,
  };
}

// ── Self-declared material writes ────────────────────────────────────────────
// The registry above is hand-copied from the route files: a mount that ships
// without its row here answers 500 on every live call while service-level
// suites stay green (card 20260928_166). The declaration instead travels with
// the mount and is self-contained — express 5 router layers expose a route's
// own path but NOT the mount prefix a router was mounted under, so
// `declareMaterialWrite('endpoint.label', { path: '/api/things/:id/seal' })`
// carries the full request path (`:param` segments allowed) beside the handler
// it labels, and registers its registry rule at import time. No walk is
// needed for matching; installGeneratedMaterialWriteRules(app) walks only to
// ASSERT coverage: a mounted write route with no declaration and no bridge
// fails boot — the ship-without-declaration class becomes a boot failure
// instead of a 500 on the first live call. During the migration,
// `router.use(legacyMaterialWriteRegistry())` bridges a router whose rows
// still live in the hand-written registry above (their existence stays proven
// by the registry tests until the family migrates); the flag dies with the
// family's rows in the same commit.

const WRITE_METHODS = new Set<HttpMethod>(['POST', 'PUT', 'PATCH', 'DELETE']);

interface WriteDeclaration {
  endpoint?: string;
  nonMaterialReason?: string;
}

const WRITE_DECLARATION = Symbol('materialWriteDeclaration');
const LEGACY_REGISTRY = Symbol('materialWriteLegacyRegistry');

type DeclaredHandler = RequestHandler & {
  [WRITE_DECLARATION]?: WriteDeclaration;
  [LEGACY_REGISTRY]?: boolean;
};

/** Rules generated from mount-site declarations. Additive to the static registry above. */
const generatedRules: MaterialWriteRule[] = [];

function allRules(): readonly MaterialWriteRule[] {
  return [...MATERIAL_WRITE_RULES, ...generatedRules];
}

/** `:param` segments match one path segment; literal segments are escaped — the registry's own encoding. */
function expressPathToPattern(fullPath: string): RegExp {
  const segments = fullPath.split('/').filter((segment) => segment.length > 0);
  const body = segments
    .map((segment) => (segment.startsWith(':') ? '[^/]+' : escapeRegexPath(segment)))
    .join('/');
  return new RegExp(`^/${body}$`);
}

/**
 * Declare a mounted route a material write, with the audit endpoint label the
 * registry must carry. The endpoint MUST equal the route's runIdempotent
 * endpoint (where the route runs one) — the audit record joins on it. `method`
 * and `path` are explicit because express 5 exposes neither the route's HTTP
 * verb nor its mount prefix to middleware; `path` is the FULL request path
 * (mount prefix included, `:param` segments allowed). The registry rule is
 * registered here, at route-module import time.
 */
export function declareMaterialWrite(
  endpoint: string,
  options: { method: HttpMethod; path: string; canonicalAliases?: readonly string[] },
): RequestHandler {
  const { method, path, canonicalAliases } = options;
  if (typeof endpoint !== 'string' || endpoint.length === 0) {
    throw new Error(`declareMaterialWrite: endpoint must be a non-empty string, got ${JSON.stringify(endpoint)}`);
  }
  if (!WRITE_METHODS.has(method)) {
    throw new Error(`declareMaterialWrite('${endpoint}'): method must be one of POST/PUT/PATCH/DELETE, got ${JSON.stringify(method)}`);
  }
  if (typeof path !== 'string' || !path.startsWith('/api/')) {
    throw new Error(
      `declareMaterialWrite('${endpoint}'): path must be the FULL request path starting with /api/, got ${JSON.stringify(path)}`,
    );
  }
  const pattern = expressPathToPattern(path);
  if (!generatedRules.some((rule) => rule.method === method && rule.endpoint === endpoint && rule.pattern.source === pattern.source)) {
    generatedRules.push({
      method,
      endpoint,
      ...(canonicalAliases ? { canonicalAliases } : {}),
      pattern,
    });
  }
  const middleware: RequestHandler = (_req, _res, next) => { next(); };
  (middleware as DeclaredHandler)[WRITE_DECLARATION] = { endpoint };
  return middleware;
}

/**
 * Declare a mounted write route deliberately NON-material, with the reason.
 * Replaces the hand-maintained exemption list in the registry-exhaustive test:
 * the reviewed justification lives beside the mount it excuses.
 */
export function declareNonMaterialWrite(reason: string): RequestHandler {
  if (typeof reason !== 'string' || reason.length === 0) {
    throw new Error(`declareNonMaterialWrite: reason must be a non-empty string, got ${JSON.stringify(reason)}`);
  }
  const middleware: RequestHandler = (_req, _res, next) => { next(); };
  (middleware as DeclaredHandler)[WRITE_DECLARATION] = { nonMaterialReason: reason };
  return middleware;
}

/**
 * Migration bridge: `router.use(legacyMaterialWriteRegistry())` marks a router
 * whose material-write rows still live in the hand-written registry above.
 * Flagged routers pass the coverage walk; the registry tests keep proving the
 * rows exist. Delete the flag in the same commit that migrates the family's
 * rows to declareMaterialWrite markers.
 */
export function legacyMaterialWriteRegistry(): RequestHandler {
  const middleware: RequestHandler = (_req, _res, next) => { next(); };
  (middleware as DeclaredHandler)[LEGACY_REGISTRY] = true;
  return middleware;
}

// Minimal structural types for the express internals the walker reads: layers
// of a router's stack and the route a terminal layer carries. express exports
// no public types for these.
interface WalkerLayer {
  route?: {
    path: unknown;
    methods: Record<string, boolean>;
    stack?: { handle?: unknown }[];
  };
  handle?: unknown;
}

interface WalkerRouter {
  stack?: WalkerLayer[];
}

function isRouterLike(handle: unknown): handle is WalkerRouter {
  return typeof handle === 'function' && Array.isArray((handle as WalkerRouter).stack);
}

function declarationOf(route: NonNullable<WalkerLayer['route']>): WriteDeclaration | null {
  let found: WriteDeclaration | null = null;
  for (const layer of route.stack ?? []) {
    const declaration = (layer.handle as DeclaredHandler | undefined)?.[WRITE_DECLARATION];
    if (declaration) found = declaration;
  }
  return found;
}

function isLegacyBridged(router: WalkerRouter): boolean {
  return (router.stack ?? []).some(
    (layer) => (layer.handle as DeclaredHandler | undefined)?.[LEGACY_REGISTRY] === true,
  );
}

interface WalkedWriteRoute {
  method: HttpMethod;
  routePath: string;
  declared: boolean;
}

function walkWriteRoutes(stack: WalkerLayer[], legacyBridged: boolean, out: WalkedWriteRoute[]): void {
  for (const layer of stack) {
    if (layer.route) {
      const routePaths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      for (const routePath of routePaths) {
        if (typeof routePath !== 'string') continue;
        for (const method of Object.keys(layer.route.methods)) {
          const upperMethod = method.toUpperCase() as HttpMethod;
          if (!WRITE_METHODS.has(upperMethod)) continue;
          const declaration = declarationOf(layer.route);
          out.push({
            method: upperMethod,
            routePath,
            declared: legacyBridged || declaration !== null,
          });
        }
      }
      continue;
    }
    if (isRouterLike(layer.handle)) {
      walkWriteRoutes(layer.handle.stack ?? [], legacyBridged || isLegacyBridged(layer.handle), out);
    }
  }
}

const installedApps = new WeakSet<object>();

/**
 * Walk a mounted express app and THROW when a write route declares nothing:
 * every mounted write route must carry a mount-site declaration
 * (declareMaterialWrite / declareNonMaterialWrite) or ride a router flagged
 * legacyMaterialWriteRegistry. Idempotent per app. index.ts calls this at
 * boot; the audit middleware installs lazily on the first request so per-file
 * test harnesses (which mount a subset of routers) get the same guarantee
 * without importing the application entry.
 */
export function installGeneratedMaterialWriteRules(app: unknown): void {
  if (app == null) return;
  if (installedApps.has(app)) return;
  installedApps.add(app);

  const appRouter = (app as WalkerRouter).stack
    ? (app as WalkerRouter)
    : (app as { router?: WalkerRouter }).router;
  if (!appRouter?.stack) return;

  const walked: WalkedWriteRoute[] = [];
  walkWriteRoutes(appRouter.stack, isLegacyBridged(appRouter), walked);

  const violations = walked
    .filter((route) => !route.declared)
    .map((route) => (
      `${route.method} (router path ${route.routePath}) is a mounted write route with no material-write declaration — ` +
      'add declareMaterialWrite(\'<endpoint>\', { path: \'/api/…\' }) beside the mount, ' +
      'declareNonMaterialWrite(\'<reason>\') if the write is deliberately non-material, ' +
      'or router.use(legacyMaterialWriteRegistry()) while the family still rides the hand-written registry'
    ));
  if (violations.length > 0) {
    throw new Error(
      `[material-write] ${violations.length} mounted write route(s) lack a declaration:\n  - ${violations.join('\n  - ')}`,
    );
  }
}
