import type { Request } from 'express';
import { ApiError } from '../errors';
import {
  IDEMPOTENCY_ENDPOINTS,
  buildCrudIdempotencyEndpoint,
  resolveIdempotencyKey,
} from '../services/idempotency.service';

type HttpMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface MaterialWriteRule {
  method: HttpMethod;
  endpoint: string;
  pattern: RegExp;
}

interface CrudMaterialWriteSpec {
  basePath: string;
  resource: string;
  disableDelete?: boolean;
}

function escapeRegexPath(path: string): string {
  return path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createCrudMaterialWriteRules(spec: CrudMaterialWriteSpec): MaterialWriteRule[] {
  const escapedBasePath = escapeRegexPath(`/api${spec.basePath}`);
  const rules: MaterialWriteRule[] = [
    {
      method: 'POST',
      endpoint: buildCrudIdempotencyEndpoint(spec.resource, 'create'),
      pattern: new RegExp(`^${escapedBasePath}$`),
    },
    {
      method: 'PUT',
      endpoint: buildCrudIdempotencyEndpoint(spec.resource, 'update'),
      pattern: new RegExp(`^${escapedBasePath}/[^/]+$`),
    },
  ];
  if (!spec.disableDelete) {
    rules.push({
      method: 'DELETE',
      endpoint: buildCrudIdempotencyEndpoint(spec.resource, 'delete'),
      pattern: new RegExp(`^${escapedBasePath}/[^/]+$`),
    });
  }
  return rules;
}

const CONFIG_CRUD_MATERIAL_WRITE_SPECS: readonly CrudMaterialWriteSpec[] = [
  { basePath: '/business-calendar', resource: 'business_calendar_days' },
  { basePath: '/customers', resource: 'customers' },
  { basePath: '/trucks', resource: 'trucks' },
  { basePath: '/trailers', resource: 'trailers' },
  { basePath: '/routes', resource: 'routes' },
  { basePath: '/cargo-types', resource: 'cargo_types' },
  { basePath: '/container-types', resource: 'container_types' },
  { basePath: '/seal-types', resource: 'seal_types' },
  { basePath: '/ports', resource: 'ports' },
  { basePath: '/forwarder-expense-types', resource: 'forwarder_expense_types' },
  { basePath: '/pricing-tables', resource: 'pricing_tables' },
  { basePath: '/road-allowances', resource: 'road_allowances' },
  { basePath: '/fuel-norms', resource: 'fuel_norms' },
  { basePath: '/weight-pricing-tiers', resource: 'weight_pricing_tiers' },
  { basePath: '/lift-pricing', resource: 'lift_pricing' },
  { basePath: '/ancillary-revenue', resource: 'ancillary_revenue' },
  { basePath: '/penalty-reasons', resource: 'penalty_reasons' },
  { basePath: '/management-fees', resource: 'management_fees' },
  { basePath: '/cap-table', resource: 'cap_table_history' },
  { basePath: '/truck-cap', resource: 'truck_cap_table' },
  { basePath: '/suppliers', resource: 'suppliers' },
  { basePath: '/expense-categories', resource: 'expense_categories' },
  { basePath: '/tire-positions', resource: 'tire_positions' },
  { basePath: '/drivers', resource: 'drivers', disableDelete: true },
  { basePath: '/fleet/tires', resource: 'tires' },
];

const MATERIAL_WRITE_RULES: readonly MaterialWriteRule[] = [
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
  { method: 'POST', endpoint: 'master-data-import.apply', pattern: /^\/api\/config\/master-data-imports\/[^/]+\/apply$/ },
  { method: 'POST', endpoint: 'master-data-import.reject', pattern: /^\/api\/config\/master-data-imports\/[^/]+\/reject$/ },
  { method: 'POST', endpoint: 'master-data-import.analyze', pattern: /^\/api\/config\/master-data-imports\/(analyze|dry-run)$/ },
  { method: 'POST', endpoint: 'config.driver-user-bindings.bind', pattern: /^\/api\/config\/driver-user-bindings\/[^/]+$/ },
  { method: 'PUT', endpoint: 'admin.app-settings.email.update', pattern: /^\/api\/admin\/app-settings\/email$/ },
  { method: 'PUT', endpoint: 'admin.app-settings.update', pattern: /^\/api\/admin\/app-settings$/ },
  { method: 'PUT', endpoint: 'admin.gps-settings.update', pattern: /^\/api\/admin\/gps-settings$/ },
  { method: 'PUT', endpoint: 'admin.llm-settings.update', pattern: /^\/api\/admin\/llm-settings$/ },
  { method: 'PUT', endpoint: 'admin.ocr-settings.update', pattern: /^\/api\/admin\/ocr-settings$/ },
  { method: 'POST', endpoint: 'expenses.governed-create', pattern: /^\/api\/expenses$/ },
  { method: 'PUT', endpoint: 'expenses.governed-update', pattern: /^\/api\/expenses\/[^/]+$/ },
  { method: 'PUT', endpoint: 'expenses.update', pattern: /^\/api\/expenses\/[^/]+$/ },
  { method: 'DELETE', endpoint: 'expenses.governed-delete', pattern: /^\/api\/expenses\/[^/]+$/ },
  { method: 'DELETE', endpoint: 'expenses.delete', pattern: /^\/api\/expenses\/[^/]+$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.EXPENSE_PHOTO_CREATE, pattern: /^\/api\/expenses\/[^/]+\/photos$/ },
  { method: 'DELETE', endpoint: IDEMPOTENCY_ENDPOINTS.EXPENSE_PHOTO_DELETE, pattern: /^\/api\/expenses\/[^/]+\/photos\/[^/]+$/ },
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
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.DEBT_OFFSET_APPROVE, pattern: /^\/api\/finance\/debt-offsets\/[^/]+\/approve$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.DEBT_OFFSET_CANCEL, pattern: /^\/api\/finance\/debt-offsets\/[^/]+\/cancel$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.SNAPSHOT_AR_RECAPTURE, pattern: /^\/api\/finance\/snapshots\/ar\/[^/]+\/recapture$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.SNAPSHOT_AP_RECAPTURE, pattern: /^\/api\/finance\/snapshots\/ap\/[^/]+\/recapture$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.SNAPSHOT_FUEL_SURCHARGE_RECAPTURE, pattern: /^\/api\/finance\/snapshots\/fuel-surcharge\/[^/]+\/recapture$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.ADVANCE_REQUEST_APPROVE, pattern: /^\/api\/advance-requests\/[^/]+\/approve$/ },
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
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_EXPENSE_APPROVE, pattern: /^\/api\/trips\/[^/]+\/expenses\/[^/]+\/approve$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_EXPENSE_REJECT, pattern: /^\/api\/trips\/[^/]+\/expenses\/[^/]+\/reject$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_QUICK_CREATE, pattern: /^\/api\/shipments\/quick$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_CREATE, pattern: /^\/api\/shipments$/ },
  { method: 'PUT', endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_UPDATE, pattern: /^\/api\/shipments\/[^/]+$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_TRANSITION, pattern: /^\/api\/shipments\/[^/]+\/transition$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_COMPLETE, pattern: /^\/api\/shipments\/[^/]+\/complete$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_DISPATCH, pattern: /^\/api\/shipments\/[^/]+\/dispatch$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_POD_REVIEW, pattern: /^\/api\/shipments\/[^/]+\/pod-reviews\/[^/]+\/review$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_FULFILLMENT_CANCEL, pattern: /^\/api\/shipments\/[^/]+\/fulfillments\/[^/]+\/cancellation-disposition$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_SUBMIT_FOR_DISPATCH, pattern: /^\/api\/shipments\/[^/]+\/submit-for-dispatch$/ },
  { method: 'POST', endpoint: 'shipments.customer-events.create', pattern: /^\/api\/shipments\/[^/]+\/customer-events$/ },
  { method: 'POST', endpoint: 'shipments.dispatch-handoffs.create', pattern: /^\/api\/shipments\/[^/]+\/dispatch-handoffs$/ },
  { method: 'POST', endpoint: 'shipments.dispatch-handoffs.resolve', pattern: /^\/api\/shipments\/[^/]+\/dispatch-handoffs\/[^/]+\/resolve$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_DOCUMENT_ATTACH, pattern: /^\/api\/shipments\/[^/]+\/documents$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_DOCUMENT_REPLACE, pattern: /^\/api\/shipments\/[^/]+\/documents\/[^/]+\/replace$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_DECLARATION_CREATE, pattern: /^\/api\/shipments\/[^/]+\/declarations$/ },
  { method: 'PUT', endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_DECLARATION_UPDATE, pattern: /^\/api\/shipments\/[^/]+\/declarations\/[^/]+$/ },
  { method: 'PUT', endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_CONTAINERS_RECONCILE, pattern: /^\/api\/shipments\/[^/]+\/containers$/ },
  { method: 'POST', endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_CHANGE_REQUEST_REVIEW, pattern: /^\/api\/shipments\/[^/]+\/change-requests\/[^/]+\/review$/ },
  { method: 'DELETE', endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_DELETE, pattern: /^\/api\/shipments\/[^/]+$/ },
  { method: 'POST', endpoint: 'portal.shipments.customer-events.acknowledge', pattern: /^\/api\/portal\/shipments\/[^/]+\/customer-events\/[^/]+\/acknowledge$/ },
  { method: 'POST', endpoint: 'recoverable-costs.approval-request', pattern: /^\/api\/recoverable-costs\/[^/]+\/request$/ },
  { method: 'POST', endpoint: 'recoverable-costs.rejection-request', pattern: /^\/api\/recoverable-costs\/[^/]+\/request$/ },
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
  { method: 'POST', endpoint: 'config.tires.install', pattern: /^\/api\/fleet\/tires\/[^/]+\/install$/ },
  { method: 'POST', endpoint: 'config.tires.remove', pattern: /^\/api\/fleet\/tires\/[^/]+\/remove$/ },
  { method: 'POST', endpoint: 'config.tires.dispose', pattern: /^\/api\/fleet\/tires\/[^/]+\/dispose$/ },
  { method: 'POST', endpoint: 'config.tires.transfer', pattern: /^\/api\/fleet\/tires\/[^/]+\/transfer$/ },
  { method: 'PUT', endpoint: 'config.road-config.update', pattern: /^\/api\/road-config$/ },
  { method: 'PUT', endpoint: 'config.fuel-config.update', pattern: /^\/api\/fuel-config$/ },
  { method: 'PUT', endpoint: 'config.company-info.update', pattern: /^\/api\/company-info$/ },
  { method: 'PUT', endpoint: 'config.salary-periods.default.update', pattern: /^\/api\/salary-periods\/default$/ },
  { method: 'POST', endpoint: 'config.salary-periods.override.create', pattern: /^\/api\/salary-periods$/ },
  { method: 'PUT', endpoint: 'config.salary-periods.override.update', pattern: /^\/api\/salary-periods\/[^/]+$/ },
  { method: 'DELETE', endpoint: 'config.salary-periods.override.delete', pattern: /^\/api\/salary-periods\/[^/]+$/ },
  { method: 'POST', endpoint: 'config.salary-periods.exclusion.create', pattern: /^\/api\/salary-periods\/[^/]+\/exclusions$/ },
  { method: 'POST', endpoint: 'config.salary-periods.exclusion.check', pattern: /^\/api\/salary-periods\/[^/]+\/exclusions\/[^/]+\/check$/ },
  { method: 'POST', endpoint: 'config.salary-periods.exclusion.approve', pattern: /^\/api\/salary-periods\/[^/]+\/exclusions\/[^/]+\/approve$/ },
  { method: 'POST', endpoint: 'config.salary-periods.exclusion.followup.complete', pattern: /^\/api\/salary-periods\/[^/]+\/exclusions\/[^/]+\/complete-followup$/ },
  { method: 'POST', endpoint: 'config.salary-periods.close.request', pattern: /^\/api\/salary-periods\/[^/]+\/close$/ },
  { method: 'POST', endpoint: 'config.salary-periods.close.check', pattern: /^\/api\/salary-periods\/[^/]+\/close-actions\/[^/]+\/check$/ },
  { method: 'POST', endpoint: 'config.salary-periods.close.approve', pattern: /^\/api\/salary-periods\/[^/]+\/close-actions\/[^/]+\/approve$/ },
  { method: 'POST', endpoint: 'config.salary-periods.reopen.request', pattern: /^\/api\/salary-periods\/[^/]+\/reopen$/ },
  { method: 'POST', endpoint: 'config.salary-periods.reopen.check', pattern: /^\/api\/salary-periods\/[^/]+\/reopen-actions\/[^/]+\/check$/ },
  { method: 'POST', endpoint: 'config.salary-periods.reopen.approve', pattern: /^\/api\/salary-periods\/[^/]+\/reopen-actions\/[^/]+\/approve$/ },
  { method: 'POST', endpoint: 'config.debit-note-templates.create', pattern: /^\/api\/debit-note-templates$/ },
  { method: 'PUT', endpoint: 'config.debit-note-templates.update', pattern: /^\/api\/debit-note-templates\/[^/]+$/ },
  { method: 'DELETE', endpoint: 'config.debit-note-templates.delete', pattern: /^\/api\/debit-note-templates\/[^/]+$/ },
  { method: 'POST', endpoint: 'credit-overrides.create', pattern: /^\/api\/finance\/credit-overrides$/ },
  { method: 'POST', endpoint: 'credit-overrides.check', pattern: /^\/api\/finance\/credit-overrides\/[^/]+\/check$/ },
  { method: 'POST', endpoint: 'credit-overrides.approve', pattern: /^\/api\/finance\/credit-overrides\/[^/]+\/approve$/ },
  { method: 'POST', endpoint: 'credit-overrides.reject', pattern: /^\/api\/finance\/credit-overrides\/[^/]+\/reject$/ },
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
  ...CONFIG_CRUD_MATERIAL_WRITE_SPECS.flatMap(createCrudMaterialWriteRules),
];

const DECLARED_MATERIAL_WRITE_ENDPOINTS = new Set(
  MATERIAL_WRITE_RULES.map((rule) => rule.endpoint),
);

export function listDeclaredMaterialWriteEndpoints(): string[] {
  return [...DECLARED_MATERIAL_WRITE_ENDPOINTS].sort();
}

export interface MaterialWriteMatch {
  endpoint: string;
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
  const rule = MATERIAL_WRITE_RULES.find((candidate) => (
    candidate.method === upperMethod && candidate.pattern.test(path)
  ));
  return rule ? { endpoint: rule.endpoint, method: rule.method, path } : null;
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
