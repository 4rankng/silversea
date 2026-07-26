export {
  TripStatus, BILLABLE_TRIP_STATUSES, FuelMode, LoadingType, Role, TxnType,
  TrailerType, TrailerStatus, TruckStatus, DriverStatus, CustomerStatus,
  PenaltyStatus, PENALTY_STATUS_LABELS, TRAILER_STATUS_LABELS, TRAILER_TYPE_LABELS,
  TIRE_STATUSES, TIRE_STATUS_LABELS, TIRE_DISPOSAL_REASONS,
  TRIP_STATUS_LABELS, ROLE_LABELS, FUEL_MODE_LABELS, LOADING_TYPE_LABELS,
  TRIP_STATUS_COLORS, DATA_COMPLETENESS_COLORS,
  ShipmentStatus, ShipmentDocumentType,
  SHIPMENT_STATUS_LABELS, SHIPMENT_DOCUMENT_TYPE_LABELS,
  AdvanceRequestStatus, AdvanceSettlementStatus, ExpenseEntryStatus,
  FORWARDER_EXPENSE_TYPE_DEFAULTS, ADVANCE_REQUEST_STATUS_LABELS, ADVANCE_SETTLEMENT_STATUS_LABELS,
  NotificationType, NOTIFICATION_TYPE_LABELS, PUSH_RULES,
  CONFIG, FINANCIAL, REPORTS, DRIVER, SYSTEM, AUTH, TRIPS, CATALOGS, FORWARDER, NOTIFICATIONS, SALARY,
  TRACKING,
  CarrierType, SettlementMethod, ApprovalStatus, DebitNoteMode,
  TruckCapRole,
  CARRIER_TYPE_LABELS, SETTLEMENT_METHOD_LABELS, APPROVAL_STATUS_LABELS,
  TRUCK_CAP_ROLE_LABELS,
  FINANCIAL_ROLES, isFinancialRole,
  TIRES,
  SupplierType, SUPPLIER_TYPES, SUPPLIER_TYPE_LABELS,
} from './constants';

export type { PushAudience, TireStatus } from './constants';

export type {
  User, UserPublic, Driver, Customer, Truck, Trailer, Route, CargoType,
  PricingTable, RoadAllowance, FuelConfig, FuelPriceHistory, PenaltyReason, RoadConfig, AppSetting, CompanyInfo,
  Trip, TripLeg, TripDetail, TripInstruction, LedgerEntry, Penalty,
  CapTableHistory, TruckCapEntry, Distribution, ManagementFee, AuditLog, Notification, PushSubscriptionPayload,
  CreateTripRequest, TripLegInput, UpdateTripFiguresRequest,
  BulkUpdateTripFiguresRequest, BulkUpdateTripFiguresResponse,
  CreatePaymentRequest, CreatePenaltyRequest, CreateAdjustmentRequest,
  LoginResponse, PaginatedResponse, DashboardStats, DashboardDecisionItem, DashboardDecisionKind, DashboardDecisionSeverity, CustomerStatement, AgingBucket, UnpaidTrip, PeriodSummary,
  SalaryPeriod, SalaryPeriodRange, PnlTruck, PnlMaintenanceItem, PnlTripDetail, PnlReport,
  Supplier, ExpenseCategory, Expense, ExpenseWithRefs, PayableSummary, PayablesCategory, SupplierStatement, RenewalReminder, VendorPaymentRequest,
  TripContainer, TripExpense, TripExpenseWithRefs, ForwarderTripDetail, TripExpenseWithSupplier,
  AdvanceRequest, AdvanceRequestWithRefs, AdvanceSettlement, AdvanceSettlementWithRefs,
  ContainerType, Port, SealType,
  DebtOffset,
  ApprovalItemType,
  VehicleAlertField, VehicleAlertStatus, VehicleAlert,
  Tire, TirePosition,
  BillingDocument, BillingDocumentLine, BillingDocumentType, BillingDocumentEntityType,
  BillingLineSourceType, BillingLineType, BillingDraftLine, BillingDocumentDraft,
  BillingLineRenderData, DebitNoteColumnVariable, DebitNoteTemplateColumn,
  DebitNoteTemplate, DebitNoteTemplateSnapshot,
  LiveFleetVehicle, LiveFleetResponse, LiveFleetStatus, LiveFleetDetails, LiveFleetLeg,
  GpsStop,
} from './types';

export { parseThreshold } from './types';

export { canonicalFreightDescription } from './calculations/billingDocument';

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
  tripLegSchema, createTripSchema, updateTripFiguresSchema, bulkUpdateTripFiguresSchema,
  createPaymentSchema, createPenaltySchema, createAdjustmentSchema,
  loginSchema, createUserSchema, updateUserSchema, updateProfileSchema, changePasswordSchema,
  customerSchema, truckSchema, trailerSchema, routeSchema,
  cargoTypeSchema, pricingTableSchema, roadAllowanceSchema,
  fuelConfigSchema, fuelPriceHistorySchema,
  fuelNormSchema, weightPricingTierSchema, liftPricingSchema, ancillaryRevenueSchema,
  companyInfoSchema, penaltyReasonSchema, driverSchema,
  managementFeeSchema, capTableSchema, truckCapSchema,
  salaryPeriodSchema, salaryPeriodDefaultSchema,
  supplierSchema, expenseCategorySchema, expenseSchema, vendorPaymentSchema,
  tripContainerSchema, tripContainerBatchSchema, tripContainerPatchSchema, tripContainerSealSchema, tripContainerSealBatchSchema, tripExpenseSchema, baseTripExpenseSchema, tripExpensePatchSchema, tripExpenseCompletionSchema, accountantSettlementExpensePatchSchema, forwarderExpenseTypeSchema,
  createAdvanceRequestSchema, createAdvanceSettlementSchema, updateAdvanceSettlementSchema,
  upsertTripInstructionsSchema,
  createShipmentSchema, updateShipmentSchema, transitionShipmentStatusSchema,
  attachShipmentDocumentSchema, shipmentContainerBatchSchema, dispatchShipmentSchema,
  containerTypeSchema, portSchema, sealTypeSchema,
  debtOffsetSchema, ANCILLARY_EXPENSE_TYPES,
  commissionSchema,
  driverPayoutSchema,
  tireSchema, installTireSchema, disposeTireSchema, transferTireSchema, tirePositionSchema,
  generateBillingDocumentSchema, saveBillingDocumentSchema, billingDocumentLineSchema,
  debitNoteTemplateSchema, debitNoteColumnSchema, debitNoteColumnVariableSchema, defaultDebitNoteColumns, defaultPaymentStatementColumns,
  bachKhoaVehicleSchema, bachKhoaResponseSchema, parseBachKhoaResponse,
  agentDirectiveSchema, agentWidgetSchema, widgetFormatSchema, agentActionChipSchema,
  agentCitationSchema, provenanceSchema,
  agentResponseSchema, agentMessageSchema, agentConversationSchema, agentEventSchema,
  agentRouteKeySchema, AGENT_ROUTE_KEYS,
  ACKED_DIRECTIVE_KINDS,
  agentActionResultSchema,
  faqEntryCreateSchema, faqEntryUpdateSchema, FAQ_ADMIN_PATHS,
  geotagSchema, GEOTAG_ENTITY_TYPES, GEOTAG_SOURCES, GEOTAG_PATHS,
} from './schemas';

export { appSettingsSchema } from './schemas/app-settings';
export type { AppSettings } from './schemas/app-settings';

export {
  FUEL_PRICE_PER_LITER_FALLBACK,
  FUEL_LOADED_NORM_FALLBACK,
  FUEL_EMPTY_NORM_FALLBACK,
  ROAD_ALLOWANCE_PER_KM_FALLBACK,
} from './calculations/tripFormDefaults';

export type {
  CreateTripInput, UpdateTripFiguresInput, CreatePaymentInput,
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
  GenerateBillingDocumentInput, SaveBillingDocumentInput, BillingDocumentLineInput,
  DebitNoteTemplateInput, DebitNoteColumnInput, DebitNoteColumnVariableInput,
  BachKhoaVehicle,
  AgentDirective, AgentWidget, WidgetFormat, AgentActionChip, AgentCitation, Provenance, AgentTutorialStep, AgentResponse,
  AgentMessage, AgentConversation, AgentEvent, AgentRouteKey,
  AckedDirectiveKind, AgentActionResult,
  FaqEntry, FaqEntryCreate, FaqEntryUpdate, FaqEmbeddingStatus, FaqEntryMutationResponse,
  GeotagInput, GeotagEntityType, GeotagSource, PhotoGeotag,
  CreateShipmentInput, UpdateShipmentInput, TransitionShipmentStatusInput,
  AttachShipmentDocumentInput, ShipmentContainerBatchInput, DispatchShipmentInput,
} from './schemas';

export { round2dp, roundInt } from './calculations/round';
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

// ─── Chatbot (agent) performance monitoring ────────────────────────────────
// Plain TS interfaces + API path constants for the ADMIN aggregation API and
// the dashboard frontend. See ./schemas/chatbot-metrics.ts.
export type {
  ChatbotSlaThresholds,
  ChatbotMetricSummary,
  ChatbotLatencyBreakdown,
  ChatbotMetricDay,
  ChatbotToolStat,
  ChatbotRecentTurn,
} from './schemas/chatbot-metrics';
export { CHATBOT_METRICS_PATHS } from './schemas/chatbot-metrics';

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

// ─── Admin Bách Khoa GPS credentials ────────────────────────────────────────
export { GPS_SETTINGS_PATHS, gpsSettingsUpdateSchema } from './schemas/gps-settings';
export type { GpsSettingsResponse, GpsSettingsUpdate } from './schemas/gps-settings';

// ─── Curated tour catalog (agent-guided walkthroughs) ───────────────────────
// Single source for the backend tours.search tool + the frontend on-demand list
// and TourController. See ./tours/catalog.ts.
export { TOUR_CATALOG, TOUR_IDS, toursForRole, getTour } from './tours';
export type { Tour, TourId } from './tours';

// ─── Onboarding product-event catalog ───────────────────────────────────────
// Closed set of business/UI events the onboarding layer (tour completion steps,
// role checklists, lifecycle analytics) reacts to. See ./onboarding/events.ts.
export { PRODUCT_EVENTS, ONBOARDING_EVENT_NAMES, ONBOARDING_TASKS, tasksForRole, getTask } from './onboarding';
export type { ProductEventName, ProductEventPayloads, PayloadOf, OnboardingEventName, TriggerSource, OnboardingTask, TaskCompletion } from './onboarding';

// ─── Onboarding admin settings (master on/off toggle) ──────────────────────
// DB-backed admin switch for the onboarding tutorial. See ./schemas/onboarding-settings.ts.
export { ONBOARDING_SETTINGS_PATHS } from './schemas/onboarding-settings';
export type { OnboardingSettingsResponse, OnboardingSettingsUpdate } from './schemas/onboarding-settings';
