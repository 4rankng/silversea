import { and, eq, isNull } from 'drizzle-orm';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';

type TripGovernanceOperation = 'CLOSE' | 'EDIT_COMPLETED' | 'CANCEL_COMPLETED';

function canonicalizeMutationPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeMutationPayload);
  }
  if (value == null || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalizeMutationPayload(entry)]),
  );
}

function canonicalTripFigurePayload(value: unknown): unknown {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  const figures = Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) =>
        key !== 'expectedVersion'
        && key !== 'userId'
        && key !== 'userRole'),
  );
  return canonicalizeMutationPayload(figures);
}

export async function requirePersistedTripGovernanceAuthorization(input: {
  tx: Tx;
  actionId: number | undefined;
  tripId: number;
  tripVersion: number;
  actorId: number;
  actorRole: string;
  operation: TripGovernanceOperation;
  mutationPayload?: unknown;
}) {
  if (!Number.isInteger(input.actionId) || input.actionId! <= 0) {
    throw new ApiError(409, 'Thiếu yêu cầu quản trị đã được phê duyệt');
  }
  const [action] = await input.tx.select().from(s.governanceActions)
    .where(and(
      eq(s.governanceActions.id, input.actionId!),
      eq(s.governanceActions.status, 'APPROVED'),
      isNull(s.governanceActions.appliedAt),
      isNull(s.governanceActions.applicationResult),
    ))
    .limit(1)
    .for('update');
  const after = action?.afterSnapshot as Record<string, unknown> | null | undefined;
  const expectedKind = input.operation === 'CLOSE'
    ? 'TRIP_FINANCIAL_CLOSE'
    : 'TRIP_FINANCIAL_CHANGE';
  const operationMatches = input.operation === 'CANCEL_COMPLETED'
    ? after?.operation === 'CANCEL_COMPLETED'
    : input.operation === 'EDIT_COMPLETED'
      ? after?.operation !== 'CANCEL_COMPLETED'
      : true;
  const persistedFigures = after?.figures;
  const hasPersistedFigures = persistedFigures != null
    && typeof persistedFigures === 'object'
    && !Array.isArray(persistedFigures);
  if (
    !action
    || action.subjectType !== 'TRIP'
    || action.subjectId !== input.tripId
    || action.actionKind !== expectedKind
    || action.originalVersion !== input.tripVersion
    || action.makerId === action.checkerId
    || action.makerId === action.approverId
    || action.checkerId == null
    || action.checkerId === action.approverId
    || action.approverId !== input.actorId
    || action.approverRole !== input.actorRole
    || action.approvedAt == null
    || action.ledgerEntryId != null
    || !operationMatches
  ) {
    throw new ApiError(
      409,
      'Yêu cầu quản trị không hợp lệ hoặc không còn quyền áp dụng chuyến đi',
    );
  }
  if (
    input.operation === 'EDIT_COMPLETED'
    && (
      !hasPersistedFigures
      || input.mutationPayload == null
      || typeof input.mutationPayload !== 'object'
      || Array.isArray(input.mutationPayload)
      || JSON.stringify(canonicalTripFigurePayload(input.mutationPayload))
        !== JSON.stringify(canonicalTripFigurePayload(persistedFigures))
    )
  ) {
    throw new ApiError(
      409,
      'Dữ liệu áp dụng không khớp với nội dung thay đổi chuyến đi đã được phê duyệt',
    );
  }
  return action;
}
