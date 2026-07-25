export const AuditEvent = {
  // Trip lifecycle
  TRIP_CREATED: 'TRIP_CREATED',
  TRIP_DISPATCHED: 'TRIP_DISPATCHED',
  TRIP_UPDATED_PRE_DEPARTURE: 'TRIP_UPDATED_PRE_DEPARTURE',
  TRIP_UPDATED_ACTUALS: 'TRIP_UPDATED_ACTUALS',
  TRIP_COMPLETED: 'TRIP_COMPLETED',
  TRIP_LOCKED: 'TRIP_LOCKED',
  TRIP_CANCELED: 'TRIP_CANCELED',
  TRIP_UNLOCKED: 'TRIP_UNLOCKED',
  TRIP_DEPARTURE_DATE_CHANGED: 'TRIP_DEPARTURE_DATE_CHANGED',

  // Shipment lifecycle (Wave 0 — lô hàng)
  SHIPMENT_CREATED: 'SHIPMENT_CREATED',
  SHIPMENT_UPDATED: 'SHIPMENT_UPDATED',
  SHIPMENT_STATUS_CHANGED: 'SHIPMENT_STATUS_CHANGED',
  SHIPMENT_DISPATCHED: 'SHIPMENT_DISPATCHED',
  SHIPMENT_DELETED: 'SHIPMENT_DELETED',
  SHIPMENT_DOCUMENT_UPLOADED: 'SHIPMENT_DOCUMENT_UPLOADED',
  SHIPMENT_CONTAINERS_UPDATED: 'SHIPMENT_CONTAINERS_UPDATED',

  // Financial
  PAYMENT_RECEIVED: 'PAYMENT_RECEIVED',
  ADJUSTMENT_CREATED: 'ADJUSTMENT_CREATED',
  PENALTY_CREATED: 'PENALTY_CREATED',
  PENALTY_CANCELED: 'PENALTY_CANCELED',
  DRIVER_SALARY_RECORDED: 'DRIVER_SALARY_RECORDED',
  PROFIT_DISTRIBUTED: 'PROFIT_DISTRIBUTED',

  // Config CRUD
  ENTITY_CREATED: 'ENTITY_CREATED',
  ENTITY_UPDATED: 'ENTITY_UPDATED',
  ENTITY_DELETED: 'ENTITY_DELETED',

  // Trip Expenses Approval/Rejection
  TRIP_EXPENSE_APPROVED: 'TRIP_EXPENSE_APPROVED',
  TRIP_EXPENSE_REJECTED: 'TRIP_EXPENSE_REJECTED',

  // Auth
  USER_LOGIN: 'USER_LOGIN',
  USER_LOGOUT: 'USER_LOGOUT',
  LOGIN_FAILED: 'LOGIN_FAILED',
  ACCESS_DENIED: 'ACCESS_DENIED',
} as const;

export type AuditEventType = (typeof AuditEvent)[keyof typeof AuditEvent];

export interface AuditPayload {
  event: AuditEventType;
  entityType: string;
  entityId?: number;
  actorRole?: string;
  actorEmail?: string;
  /** Human-readable Vietnamese name shown in the audit log ("Lê Văn Tỉnh"). */
  actorName?: string;
  /**
   * Human-readable identifier of the entity acted on (e.g. "TRP-202606-0086",
   * "30A-12345", "Công ty CP Vận tải ABC"). Preferred over the numeric id in
   * audit messages — readers should never see "chuyến #76".
   */
  entityKey?: string;
  metadata?: Record<string, unknown>;
}
