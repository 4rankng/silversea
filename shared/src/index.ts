export {
  TripStatus, BILLABLE_TRIP_STATUSES, FuelMode, LoadingType, Role, TxnType,
  TrailerType, TrailerStatus, TruckStatus, DriverStatus, CustomerStatus,
  PenaltyStatus, PENALTY_STATUS_LABELS, TRAILER_STATUS_LABELS, TRAILER_TYPE_LABELS,
  TIRE_STATUSES, TIRE_STATUS_LABELS, TIRE_DISPOSAL_REASONS,
  TRIP_STATUS_LABELS, ROLE_LABELS, FUEL_MODE_LABELS, LOADING_TYPE_LABELS,
  TRIP_STATUS_COLORS, DATA_COMPLETENESS_COLORS,
  ShipmentStatus, ShipmentDocumentType, OperationalSiteType,
  ShipmentCusBucket, ShipmentDocumentCustody,
  MasterImportStatus, MasterImportRowClassification, ShipmentFulfillmentType,
  FulfillmentCancellationDisposition, TripPodStatus, TripPodFileType,
  DriverProgressEventType, DRIVER_PROGRESS_EVENT_LABELS,
  DRIVER_FULFILLMENT_PROGRESS_SEQUENCE, TRIP_POD_REQUIRED_FILE_TYPES,
  DriverIncidentalCostType, DRIVER_INCIDENTAL_COST_LABELS,
  SHIPMENT_STATUS_LABELS, SHIPMENT_DOCUMENT_TYPE_LABELS, canonicalShipmentStatus,
  SHIPMENT_CUS_BUCKET_LABELS, SHIPMENT_DOCUMENT_CUSTODY_LABELS,
  AdvanceRequestStatus, AdvanceSettlementStatus, ExpenseEntryStatus,
  OPS_EXPENSE_TYPE_DEFAULTS, ADVANCE_REQUEST_STATUS_LABELS, ADVANCE_SETTLEMENT_STATUS_LABELS,
  NO_INVOICE_EVIDENCE_TYPES, NO_INVOICE_EVIDENCE_TYPE_LABELS, DEFAULT_NO_INVOICE_EVIDENCE_TYPES, NO_INVOICE_POLICY_DEFAULTS,
  NO_INVOICE_REQUIRED_SCOPE, NO_INVOICE_APPROVAL_TITLES, NO_INVOICE_APPROVAL_TITLE_LABELS, NO_INVOICE_DEFAULT_CATEGORY_ALIASES,
  NotificationType, NOTIFICATION_TYPE_LABELS, PUSH_RULES,
  CONFIG, FINANCIAL, REPORTS, DRIVER, SYSTEM, AUTH, TRIPS, SHIPMENTS, CATALOGS, FORWARDER, PORTAL, WORKSPACES, NOTIFICATIONS, SALARY,
  TRACKING,
  CarrierType, SettlementMethod, ApprovalStatus, DebitNoteMode,
  TruckCapRole,
  CARRIER_TYPE_LABELS, SETTLEMENT_METHOD_LABELS, APPROVAL_STATUS_LABELS,
  TRUCK_CAP_ROLE_LABELS,
  FINANCIAL_ROLES, isFinancialRole,
  TIRES,
  CustomerAccountType, SupplierType, SUPPLIER_TYPES, SUPPLIER_TYPE_LABELS,
  DISPATCH_CLASSIFICATIONS, DISPATCH_CLASSIFICATION_LABELS,
} from './constants';

export type { PushAudience, TireStatus, NoInvoiceEvidenceType, NoInvoiceApprovalTitle, DispatchClassification } from './constants';
export { workInboxItemBaseSchema, workInboxResponseSchema, workInboxPartySchema, workInboxNextActionSchema, workInboxStateSchema, customerDeliveryResponseSchema, operationsWorkInboxItemSchema, driverWorkInboxItemSchema, customerWorkInboxItemSchema, accountantWorkInboxItemSchema, managerWorkInboxItemSchema, adminHealthInboxItemSchema } from './schemas/work-inbox';
export type {
  WorkInboxItemBase,
  WorkInboxResponse,
  WorkInboxResponseOf,
  OperationsWorkInboxItem,
  DriverWorkInboxItem,
  CustomerWorkInboxItem,
  AccountantWorkInboxItem,
  ManagerWorkInboxItem,
  AdminHealthInboxItem,
  CustomerDeliveryResponseInput,
} from './schemas/work-inbox';

export type {
  User, UserPublic, Driver, Customer, Truck, Trailer, Route, CargoType,
  PricingTable, RoadAllowance, FuelConfig, FuelPriceHistory, PenaltyReason, RoadConfig, AppSetting, CompanyInfo,
  Trip, TripLeg, TripDetail, TripInstruction, ShipmentAccountingLockSummary, LedgerEntry, Penalty,
  TripPairSummary, TripPairRecord, TripPairStatus, TripPairBreakReason, DriverOrderedPairView,
  CapTableHistory, TruckCapEntry, Distribution, ManagementFee, AuditLog, Notification, PushSubscriptionPayload,
  CreateTripRequest, CreateTripPairRequest, TripPairDraftInput, TripLegInput, UpdateTripFiguresRequest,
  BulkUpdateTripFiguresRequest, BulkUpdateTripFiguresResponse,
  CreatePaymentRequest, PaymentAllocationMethod, PaymentReceiptAllocation,
  PaymentReceiptResult, PaymentReceiptResponse, CreatePenaltyRequest, CreateAdjustmentRequest,
  LoginResponse, PaginatedResponse, CursorPaginatedResponse, DashboardStats, DashboardDecisionItem, DashboardDecisionKind, DashboardDecisionSeverity, CustomerStatement, AgingBucket, UnpaidTrip, PeriodSummary,
  TreasuryAccountPosition, TreasuryPosition, CustomerVisibleEventDto, RecoverableCostEligibility,
  ProfitabilityReportRow, ProfitabilityReport, LowMarginState, DashboardWidgets, DashboardFleetAttentionItem,
  SalaryPeriod, SalaryPeriodRange, PnlTruck, PnlMaintenanceItem, PnlTripDetail, PnlReport,
  Supplier, ExpenseCategory, Expense, ExpenseWithRefs, PayableSummary, PayablesCategory, SupplierStatement, RenewalReminder, VendorPaymentRequest,
  TripContainer, TripExpense, TripExpenseWithRefs, ForwarderTripSummary, ForwarderTripDetail, ShipmentOrderExchangeStatus, TripExpenseWithSupplier,
  NoInvoicePolicySnapshot,
  AdvanceRequest, AdvanceRequestWithRefs, AdvanceSettlement, AdvanceSettlementWithRefs,
  ContainerType, Port, SealType,
  DebtOffset,
  ApprovalItemType,
  VehicleAlertField, VehicleAlertStatus, VehicleAlert,
  Tire, TirePosition,
  BillingDocument, BillingDocumentOfficialIdentitySnapshot, BillingDocumentLine, BillingDocumentType, BillingDocumentEntityType,
  BillingLineSourceType, BillingLineType, BillingVatTreatment, BillingVatRate,
  BillingDraftBlockedTrip, BillingDraftEligibilitySummary, BillingDraftLine, BillingDocumentDraft,
  BillingLineProvenance, BillingLineProvenanceStatus, BillingDocumentAuthorityState, BillingDocumentCorrection,
  BillingDocumentAdjustmentRequest,
  BillingLineRenderData, DebitNoteColumnVariable, DebitNoteTemplateColumn,
  DebitNoteTemplate, DebitNoteTemplateSnapshot,
  LiveFleetVehicle, LiveFleetResponse, LiveFleetStatus, LiveFleetDetails, LiveFleetLeg,
  GpsStop,
  DispatchCarrierKey, DispatchSummary, DispatchPortOption, TruckSuggestion,
} from './types';

export { parseThreshold } from './types';

export { canonicalFreightDescription } from './calculations/billingDocument';
export { isCompanyInfoConfigured } from './company-info';

export {
  financialReportingPolicyRequestSchema,
  financialReportingPolicyStateSchema,
  truckFinancialProfileRequestSchema,
  truckFinancialProfileStateSchema,
} from './schemas/financial-reporting-policy';
export type {
  FinancialReportingPolicyRequest,
  FinancialReportingPolicyState,
  TruckFinancialProfileRequest,
  TruckFinancialProfileState,
} from './schemas/financial-reporting-policy';

// ─── Navigation catalog (single source for SPA paths/titles + agent search) ──
export { PAGE_CATALOG } from './navigation/pageCatalog';
export type {
  PageCatalogEntry,
  StaticPageEntry,
  DynamicPageEntry,
  PageCatalogKey,
  PageSection,
  PageAgentMeta,
} from './navigation/pageCatalog';

export {
  tripLegSchema, createTripSchema, createTripPairSchema, updateTripFiguresSchema, bulkUpdateTripFiguresSchema,
  createPaymentSchema, createPenaltySchema, createAdjustmentSchema, tripReopenRequestSchema,
  loginSchema, createUserSchema, updateUserSchema, updateProfileSchema, changePasswordSchema,
  customerSchema, customerUpdateSchema, paymentDatePolicySchema, businessCalendarDaySchema,
  truckSchema, trailerSchema, routeSchema,
  cargoTypeSchema, pricingTableSchema, roadAllowanceSchema,
  fuelConfigSchema, fuelPriceHistorySchema,
  fuelNormSchema, weightPricingTierSchema, liftPricingSchema, ancillaryRevenueSchema,
  companyInfoSchema, penaltyReasonSchema, driverSchema,
  managementFeeSchema, capTableSchema, truckCapSchema,
  salaryPeriodSchema, salaryPeriodDefaultSchema,
  supplierSchema, expenseCategorySchema, expenseSchema, vendorPaymentSchema,
  tripContainerSchema, tripContainerBatchSchema, tripContainerPatchSchema, tripContainerSealSchema, tripContainerSealBatchSchema, tripExpenseSchema, baseTripExpenseSchema, tripExpensePatchSchema, tripExpenseCompletionSchema, accountantSettlementExpensePatchSchema, forwarderExpenseTypeSchema,
  noInvoiceEvidenceTypeSchema, noInvoiceEvidenceTypesSchema,
  createAdvanceRequestSchema, createAdvanceSettlementSchema, advanceMutationVersionSchema, updateAdvanceSettlementSchema,
  upsertTripInstructionsSchema,
  createShipmentSchema, quickCreateShipmentSchema, updateShipmentSchema, transitionShipmentStatusSchema,
  attachShipmentDocumentSchema, shipmentContainerBatchSchema, dispatchShipmentSchema,
  operationalSiteSchema, decomposeShipmentFulfillmentsSchema,
  submitShipmentForDispatchSchema, assignShipmentCarriersSchema, shipmentCarrierAllocationSchema,
  carrierFleetVehicleSchema, shipmentAccountingLockSchema,
  cancelShipmentFulfillmentSchema, atomicDispatchPlanEditSchema, tripPodFileMetadataSchema,
  driverProgressSchema, driverIncidentalCostSchema,
  containerTypeSchema, portSchema, sealTypeSchema,
  dispatchZoneSchema, dispatchZoneUpdateSchema,
  debtOffsetSchema, ANCILLARY_EXPENSE_TYPES,
  commissionSchema,
  driverPayoutSchema,
  tireSchema, installTireSchema, disposeTireSchema, transferTireSchema, tirePositionSchema,
  generateBillingDocumentSchema, saveBillingDocumentSchema, billingDocumentLineSchema, billingDocumentAdjustmentRequestSchema, billingDocumentIssueRequestSchema,
  debitNoteTemplateSchema, debitNoteColumnSchema, debitNoteColumnVariableSchema, defaultDebitNoteColumns, defaultPaymentStatementColumns,
  bachKhoaVehicleSchema, bachKhoaResponseSchema, parseBachKhoaResponse,
  agentDirectiveSchema, agentWidgetSchema, widgetFormatSchema, agentActionChipSchema,
  agentCitationSchema, provenanceSchema,
  agentResponseSchema, agentMessageSchema, agentConversationSchema, agentEventSchema,
  agentRouteKeySchema, AGENT_ROUTE_KEYS,
  ACKED_DIRECTIVE_KINDS,
  agentActionResultSchema,
  geotagSchema, GEOTAG_ENTITY_TYPES, GEOTAG_SOURCES, GEOTAG_PATHS,
  customerVisibleEventContentSchema, createCustomerVisibleEventSchema,
  acknowledgeCustomerEventSchema, recoverableCostListQuerySchema,
  recoverableCostRequestSchema, sendDebitNoteForConfirmationSchema,
  portalDebitNoteDecisionSchema, directMoneyTreasurySchema,
  profitabilityReportQuerySchema, CUSTOMER_VISIBLE_EVENT_TYPES,
  PROFITABILITY_DIMENSIONS, accountingTransportRegisterQuerySchema,
  accountingTransportRegisterRowSchema, accountingTransportRegisterResponseSchema,
  ACCOUNTING_TRANSPORT_OWNERSHIP, ACCOUNTING_TRANSPORT_READINESS,
} from './schemas';

export {
  shipmentCusWorkspaceQuerySchema,
  shipmentCusContainerQuerySchema,
  shipmentCusMissingFieldSchema,
  SHIPMENT_CUS_MISSING_FIELD_CODES,
  SHIPMENT_CUS_MISSING_FIELD_LABELS,
  shipmentCusWorkspaceOperationalSummarySchema,
  shipmentCusWorkspaceFinanceSummarySchema,
  shipmentCusWorkspaceDocumentCustodySchema,
  shipmentCusWorkspaceAccountingConfirmationSchema,
  shipmentCusWorkspaceActionSchema,
  shipmentCusWorkspaceActiveLockSchema,
  shipmentCusWorkspaceListItemSchema,
  shipmentCusWorkspacePassThroughChargeSchema,
  shipmentCusWorkspaceRecoveryFactSchema,
  shipmentCusWorkspaceContainerLineSchema,
  shipmentCusWorkspaceDetailSchema,
  shipmentCusWorkspaceListResponseSchema,
  shipmentCusContainerFlatRowSchema,
  shipmentCusContainerFlatResponseSchema,
  shipmentCusFinanceConfirmationCreateSchema,
  shipmentCusDocumentCustodyUpdateSchema,
  shipmentCusLockSchema,
  shipmentCusReopenRequestSchema,
  shipmentCusReopenDecisionSchema,
  shipmentCusContainerLineUpdateSchema,
  shipmentCusContainerLineUpdateResultSchema,
  shipmentRecoveryRecordSchema,
  shipmentRecoveryRecordResultSchema,
} from './schemas/cus-shipment-workspace';
export type {
  ShipmentCusWorkspaceQuery,
  ShipmentCusContainerQuery,
  ShipmentCusMissingField,
  ShipmentCusMissingFieldCode,
  ShipmentCusWorkspaceOperationalSummary,
  ShipmentCusWorkspaceFinanceSummary,
  ShipmentCusWorkspaceDocumentCustody,
  ShipmentCusWorkspaceAccountingConfirmation,
  ShipmentCusWorkspaceAction,
  ShipmentCusWorkspaceFieldAccess,
  ShipmentCusWorkspaceActiveLock,
  ShipmentCusWorkspaceListItem,
  ShipmentCusWorkspacePassThroughCharge,
  ShipmentCusWorkspaceRecoveryFact,
  ShipmentCusWorkspaceContainerLine,
  ShipmentCusWorkspaceDetail,
  ShipmentCusWorkspaceListResponse,
  ShipmentCusContainerFlatRow,
  ShipmentCusContainerFlatResponse,
  ShipmentCusFinanceConfirmationCreateInput,
  ShipmentCusDocumentCustodyUpdateInput,
  ShipmentCusLockInput,
  ShipmentCusReopenRequestInput,
  ShipmentCusReopenDecisionInput,
  ShipmentCusContainerLineUpdateInput,
  ShipmentCusContainerLineUpdateResult,
  ShipmentRecoveryRecordInput,
  ShipmentRecoveryRecordResult,
} from './schemas/cus-shipment-workspace';
export {
  shipmentChargeProposalFieldSchema,
  shipmentChargeProposalReviewSchema,
} from './schemas/shipment-charge-proposal-link';
export type {
  ShipmentChargeProposalField,
  ShipmentChargeProposalReviewInput,
} from './schemas/shipment-charge-proposal-link';

export { appSettingsSchema } from './schemas/app-settings';
export type { AppSettings } from './schemas/app-settings';

// ─── Admin outbound-email credential ───────────────────────────────────────
export { EMAIL_SETTINGS_PATHS, emailSettingsUpdateSchema } from './schemas/email-settings';
export type { EmailSettingsResponse, EmailSettingsUpdate } from './schemas/email-settings';

export {
  FUEL_PRICE_PER_LITER_FALLBACK,
  FUEL_LOADED_NORM_FALLBACK,
  FUEL_EMPTY_NORM_FALLBACK,
  ROAD_ALLOWANCE_PER_KM_FALLBACK,
} from './calculations/tripFormDefaults';

export type {
  CreateTripInput, CreateTripPairInput, UpdateTripFiguresInput, CreatePaymentInput,
  CreatePenaltyInput, CreateAdjustmentInput, LoginInput,
  CustomerInput, TruckInput, TrailerInput, TirePositionInput, RouteInput,
  CargoTypeInput, PricingTableInput, RoadAllowanceInput,
  FuelConfigInput, CompanyInfoInput, PenaltyReasonInput, DriverInput,
  ManagementFeeInput, CapTableInput, TruckCapInput,
  SalaryPeriodInput, SalaryPeriodDefaultInput,
  SupplierInput, ExpenseCategoryInput, ExpenseInput, VendorPaymentInput,
  CreateUserInput, UpdateUserInput,
  TripContainerInput, TripExpenseInput,
  CreateAdvanceRequestInput, CreateAdvanceSettlementInput, UpdateAdvanceSettlementInput,
  ContainerTypeInput, PortInput, SealTypeInput,
  AncillaryExpenseType,
  UpdateProfileInput,
  CommissionInput,
  TireInput, InstallTireInput,
  GenerateBillingDocumentInput, SaveBillingDocumentInput, BillingDocumentAdjustmentRequestInput, BillingDocumentLineInput,
  DebitNoteTemplateInput, DebitNoteColumnInput, DebitNoteColumnVariableInput,
  BachKhoaVehicle,
  AgentDirective, AgentWidget, WidgetFormat, AgentActionChip, AgentCitation, Provenance, AgentResponse,
  AgentMessage, AgentConversation, AgentEvent, AgentRouteKey,
  AckedDirectiveKind, AgentActionResult,
  GeotagInput, GeotagEntityType, GeotagSource, PhotoGeotag,
  CreateShipmentInput, UpdateShipmentInput, TransitionShipmentStatusInput,
  AttachShipmentDocumentInput, ShipmentContainerBatchInput, DispatchShipmentInput,
  OperationalSiteInput, DecomposeShipmentFulfillmentsInput,
  SubmitShipmentForDispatchInput, AssignShipmentCarriersInput,
  CarrierFleetVehicleInput, ShipmentAccountingLockInput,
  CancelShipmentFulfillmentInput, TripPodFileMetadataInput,
  CustomerVisibleEventContent, CreateCustomerVisibleEventInput,
  AcknowledgeCustomerEventInput, RecoverableCostListQuery,
  RecoverableCostRequestInput, SendDebitNoteForConfirmationInput,
  PortalDebitNoteDecisionInput, DirectMoneyTreasuryInput,
  ProfitabilityDimension, ProfitabilityReportQuery,
  AccountingTransportOwnership, AccountingTransportReadiness,
  AccountingTransportRegisterQuery, AccountingTransportRegisterRow,
  AccountingTransportRegisterResponse,
} from './schemas';

export { round2dp, roundInt } from './calculations/round';
export { computeFuelSurcharge } from './calculations/fuelSurcharge';
export type {
  ComputeFuelSurchargeInput,
  ComputeFuelSurchargeResult,
  FuelSurchargeSnapshot,
} from './calculations/fuelSurcharge';
export { computeTripDriverSalary, resolveTripDriverSalary, TRIP_SALARY_WORK_DAYS } from './calculations/tripDriverSalary';
export {
  normalizeContainerNumber,
  validateContainerFormat,
  calculateCheckDigit,
  validateCheckDigit,
  validateContainerNumber,
  suggestCorrections,
} from './calculations/iso6346';
export { computeTripTotals, computeRoadAllowance } from './calculations/tripTotals';
export type { ComputeTripTotalsInput, ComputeTripTotalsOutput } from './calculations/tripTotals';
export { computeFifoAging } from './calculations/fifoAging';
export type { FifoAgingInput, AgingBuckets, OpenInvoice } from './calculations/fifoAging';
export { computeVehicleAlerts, VEHICLE_ALERT_LABELS } from './calculations/vehicleAlerts';
export type { VehicleAlertInput } from './calculations/vehicleAlerts';

// ─── Admin LLM provider settings (MiniMax / OpenRouter) ─────────────────────
// ADMIN-only settings API + frontend config page. See ./schemas/llm-settings.ts.
export {
  LLM_PROVIDERS,
  LLM_PROVIDER_MODELS,
  LLM_PROVIDER_LABELS,
  LLM_SETTINGS_PATHS,
  llmSettingsUpdateSchema,
} from './schemas/llm-settings';
export type {
  LlmProvider,
  LlmSettingsResponse,
  LlmSettingsUpdate,
} from './schemas/llm-settings';

// ─── Admin OCR settings (independent OCR enablement + provider keys) ───────
export {
  OCR_SETTINGS_PATHS,
  ocrSettingsUpdateSchema,
} from './schemas/ocr-settings';
export type {
  OcrSettingsResponse,
  OcrSettingsUpdate,
} from './schemas/ocr-settings';

// ─── Admin Bách Khoa GPS credentials ────────────────────────────────────────
export { GPS_SETTINGS_PATHS, gpsSettingsUpdateSchema } from './schemas/gps-settings';
export type { GpsSettingsResponse, GpsSettingsUpdate } from './schemas/gps-settings';

// ─── Q22 source/dependent authority policy ─────────────────────────────────
export {
  SOURCE_AUTHORITY_KINDS,
  DEPENDENT_AUTHORITY_KINDS,
  AUTHORITY_FIELD_FAMILIES,
  AUTHORITY_MILESTONES,
  SOURCE_AUTHORITY_ACTIONS,
  SOURCE_AUTHORITY_PAIR_IDS,
  SOURCE_AUTHORITY_CATALOG,
  SOURCE_AUTHORITY_POLICIES,
  findSourceAuthorityPolicy,
  getSourceAuthorityActions,
  isSourceAuthorityActionAllowed,
} from './governance/source-authority';

// ─── Q15 maker/checker/approver governance contracts ───────────────────────
export {
  GOVERNANCE_SUBJECT_TYPES,
  GOVERNANCE_ACTION_KINDS,
  GOVERNANCE_ACTION_STATUSES,
  GOVERNANCE_CAPABILITIES,
  GOVERNANCE_ALLOWED_ACTIONS,
  governanceActionVersionSchema,
  governanceActionDecisionSchema,
  governanceActionListQuerySchema,
} from './schemas/governance-action';
export type {
  GovernanceSubjectType,
  GovernanceActionKind,
  GovernanceActionStatus,
  GovernanceCapability,
  GovernanceAllowedAction,
  GovernanceActionVersionInput,
  GovernanceActionDecisionInput,
  GovernanceActionListQuery,
} from './schemas/governance-action';
export type {
  SourceAuthorityKind,
  DependentAuthorityKind,
  AuthorityFieldFamily,
  AuthorityMilestone,
  SourceAuthorityAction,
  SourceAuthorityPairId,
  AuthorityPhase,
  SourceAuthorityPolicy,
} from './governance/source-authority';

export {
  SHIPMENT_BUSINESS_TIME_ZONE,
  resolveEffectiveFactory,
  resolveEffectiveFulfillmentDate,
  localDateInBusinessZone,
} from './shipment-effective';
export type {
  EffectiveFactory,
  EffectiveFactoryInput,
  EffectiveDateInput,
} from './shipment-effective';
