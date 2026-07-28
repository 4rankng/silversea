ALTER TABLE "governance_actions" DROP CONSTRAINT "governance_actions_subject_type_check";--> statement-breakpoint
ALTER TABLE "governance_actions" DROP CONSTRAINT "governance_actions_action_kind_check";--> statement-breakpoint
ALTER TABLE "governance_actions" ADD CONSTRAINT "governance_actions_subject_type_check" CHECK ("governance_actions"."subject_type" in ('TRIP', 'PAYMENT_RECEIPT', 'PAYMENT_REFUND', 'VENDOR_PAYMENT', 'CARRIER_PAYMENT', 'DRIVER_PAYOUT', 'COMMISSION', 'PENALTY', 'DEBT_OFFSET', 'ADVANCE_REQUEST', 'TRIP_EXPENSE', 'FUEL_INVOICE', 'CREDIT_OVERRIDE', 'COMPANY_EXPENSE', 'BILLING_DOCUMENT', 'SALARY_CONFIRMATION', 'SALARY_PERIOD', 'PROFIT_DISTRIBUTION', 'PRICE_CONFIG', 'ANCILLARY_REVENUE', 'EXCEPTION'));--> statement-breakpoint
ALTER TABLE "governance_actions" ADD CONSTRAINT "governance_actions_action_kind_check" CHECK ("governance_actions"."action_kind" in ('TRIP_AR_ADJUSTMENT', 'TRIP_REOPEN', 'TRIP_EXPENSE_APPROVAL', 'FUEL_INVOICE_CORRECTION', 'CREDIT_OVERRIDE_APPROVAL', 'DEBT_OFFSET_APPROVAL', 'DEBT_OFFSET_CANCEL', 'ADVANCE_REQUEST_APPROVAL', 'PAYMENT_RECEIPT', 'PAYMENT_REFUND', 'VENDOR_PAYMENT', 'CARRIER_PAYMENT', 'DRIVER_PAYOUT', 'COMMISSION', 'PENALTY_CREATE', 'PENALTY_CANCEL', 'COMPANY_EXPENSE', 'PROFIT_DISTRIBUTION', 'TRIP_FINANCIAL_CHANGE', 'TRIP_FINANCIAL_CLOSE', 'DEBIT_NOTE_ISSUE', 'DEBIT_NOTE_ADJUSTMENT', 'SALARY_CONFIRMATION', 'SALARY_REOPEN', 'SALARY_PERIOD_CLOSE', 'SALARY_PERIOD_REOPEN', 'SALARY_PERIOD_ADJUSTMENT', 'PRICE_CONFIG_CHANGE', 'ANCILLARY_REVENUE_CHANGE', 'FINANCIAL_EXCEPTION'));--> statement-breakpoint
INSERT INTO "governance_actions" (
  "subject_type",
  "subject_id",
  "subject_key",
  "action_kind",
  "status",
  "reason",
  "original_version",
  "before_snapshot",
  "after_snapshot",
  "delta_snapshot",
  "maker_id",
  "maker_role"
)
SELECT
  'CREDIT_OVERRIDE',
  request."id",
  'credit-override:' || request."id",
  'CREDIT_OVERRIDE_APPROVAL',
  'PENDING_CHECK',
  request."reason",
  request."version",
  jsonb_build_object(
    'status', request."status",
    'customerId', request."customer_id",
    'creditLimit', request."credit_limit",
    'totalExposure', request."total_exposure",
    'overLimitAmount', request."over_limit_amount",
    'requiredTier', request."required_tier"
  ),
  jsonb_build_object(
    'status', 'APPROVED',
    'proposedAmount', request."proposed_amount",
    'scopeType', request."scope_type",
    'shipmentId', request."shipment_id",
    'expiresAt', request."expires_at"
  ),
  jsonb_build_object(
    'proposedAmount', request."proposed_amount",
    'overLimitAmount', request."over_limit_amount",
    'overLimitRatio', request."over_limit_ratio"
  ),
  request."requested_by",
  request."requested_role"
FROM "credit_override_requests" AS request
WHERE request."status" = 'PENDING'
  AND NOT EXISTS (
    SELECT 1
    FROM "governance_actions" AS action
    WHERE action."subject_type" = 'CREDIT_OVERRIDE'
      AND action."subject_id" = request."id"
      AND action."action_kind" = 'CREDIT_OVERRIDE_APPROVAL'
  );
