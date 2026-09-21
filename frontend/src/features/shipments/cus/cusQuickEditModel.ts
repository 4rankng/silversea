// Quick-edit domain model for the CUS workspace inline cell editor.
//
// Extracted verbatim from pages/ShipmentsPage.tsx in the 2026-01 structural
// split so the field-gating, draft construction, unchanged-diff and payload
// assembly rules are unit-testable without rendering the workboard.
// Card 20260921_3: the documents mode now manages the lot's FULL declaration
// list — seeded from raw.declarations (id-asc), diffed into ordered durable
// writes (deletes → updates → creates) by the save walk.

import type { ShipmentCusWorkspaceListItem } from '@tingting/shared';
import { CUS_SEARCH_PATTERN } from '@tingting/shared';
import type { updateShipment, updateShipmentDeclaration } from '../../../api/shipmentClient';
import { localDateTimeToIso } from '../../../lib/shipment-operations';
import { scheduleTime, type QuickEditDeclarationRow, type ShipmentQuickEditDraft } from './cusUtils';

export type QuickEditField = ShipmentQuickEditDraft['field'];

/** Shipment PATCH body shape accepted by updateShipment. */
export type QuickEditShipmentPayload = Parameters<typeof updateShipment>[1];
/** Declaration upsert body accepted by updateShipmentDeclaration. */
export type QuickEditDeclarationBody = Parameters<typeof updateShipmentDeclaration>[2];

/** FCL factories belong to individual containers, including undated intake. */
export function factoryDetailPath(item: ShipmentCusWorkspaceListItem): string {
  const params = new URLSearchParams({ dateScope: 'all' });
  const reference = (item.billOrBookNumber || item.declarationNumber || '').toUpperCase();
  if (CUS_SEARCH_PATTERN.test(reference)) params.set('searchSuffix', reference);
  if (item.raw.customerId) params.set('customerId', String(item.raw.customerId));
  return `/shipments-detail?${params}`;
}

/**
 * Field-access keys each edit mode may write, mirroring the seven cell groups.
 * A mode is openable when at least one of its keys is not READ_ONLY.
 */
export function quickEditAccessKeys(field: QuickEditField): readonly (keyof ShipmentCusWorkspaceListItem['fieldAccess'])[] {
  return field === 'identity' ? ['factoryName'] as const
    : field === 'documents' ? ['blNumber', 'bookingRef', 'declarationNumber'] as const
      : field === 'classification' ? ['tradeDirection', 'shippingLineName'] as const
        : field === 'cargo' ? ['packageCount', 'packageType', 'cargoWeightKg', 'cargoVolumeCbm'] as const
          : field === 'schedule' ? ['closingAt', 'plannedReturnAt'] as const
            : ['customerNotes', 'operationalNotes'] as const;
}

/** Seed the documents draft's tờ khai rows (id-asc wire order). */
export function seedDeclarationRows(item: ShipmentCusWorkspaceListItem): QuickEditDeclarationRow[] {
  return (item.raw.declarations ?? []).map((row) => ({
    id: row.id,
    declarationNumber: row.declarationNumber ?? '',
    declarationChannel: row.channel ?? '',
    declarationIssuedAt: row.issuedAt ?? null,
    declarationScope: row.scope ?? null,
    declarationNote: row.note ?? null,
  }));
}

/** The durable declaration writes the save walk issues, in order:
 * deletes first (a number moving between lots frees its claim before reuse),
 * then updates, then creates. */
export interface QuickEditDeclarationDiff {
  deletes: number[];
  updates: Array<{ id: number; body: QuickEditDeclarationBody }>;
  creates: QuickEditDeclarationBody[];
}

/** Row body for PUT/POST — mirrors the API's whole-row PUT contract: number
 * trim-to-null, '' channel → null, metadata resent verbatim. */
function declarationRowBody(row: QuickEditDeclarationRow): QuickEditDeclarationBody {
  return {
    declarationNumber: row.declarationNumber.trim() || null,
    channel: row.declarationChannel || null,
    issuedAt: row.declarationIssuedAt,
    scope: row.declarationScope ?? undefined,
    note: row.declarationNote,
  };
}

/**
 * Diff the draft rows against the stored rows (card 20260921_3). Existing rows
 * PUT the whole row when number or channel changed; brand-new rows POST only
 * when they carry a number or a channel (a fully blank added row is a modal-
 * local no-op); stored ids missing from the draft delete.
 */
export function diffQuickEditDeclarations(draft: ShipmentQuickEditDraft, item: ShipmentCusWorkspaceListItem): QuickEditDeclarationDiff {
  const stored = item.raw.declarations ?? [];
  const storedById = new Map(stored.map((row) => [row.id, row]));
  const diff: QuickEditDeclarationDiff = { deletes: [], updates: [], creates: [] };
  const keptIds = new Set<number>();
  for (const row of draft.declarations) {
    const number = row.declarationNumber.trim();
    if (row.id == null) {
      if (number || row.declarationChannel) diff.creates.push(declarationRowBody(row));
      continue;
    }
    if (!storedById.has(row.id)) continue; // stale id: the refetch reconciles
    keptIds.add(row.id);
    const source = storedById.get(row.id)!;
    const changed = number !== (source.declarationNumber ?? '')
      || (row.declarationChannel || null) !== (source.channel ?? null);
    if (changed) diff.updates.push({ id: row.id, body: declarationRowBody(row) });
  }
  // Deletes come from the SEED ids the modal opened with: a stored id the
  // user removed in the modal deletes; a row added concurrently by someone
  // else never enters the seed, so a stale modal can never destroy it.
  const draftIds = new Set(draft.declarations.flatMap((row) => (row.id == null ? [] : [row.id])));
  for (const id of draft.declarationSeedIds) {
    if (!draftIds.has(id)) diff.deletes.push(id);
  }
  return diff;
}

/** True when the declaration diff carries at least one durable write. */
function hasDeclarationDiff(draft: ShipmentQuickEditDraft, item: ShipmentCusWorkspaceListItem): boolean {
  const diff = diffQuickEditDeclarations(draft, item);
  return diff.deletes.length > 0 || diff.updates.length > 0 || diff.creates.length > 0;
}

/** Seed the editable draft from the row's current values (verbatim seed rules). */
export function buildQuickEditDraft(item: ShipmentCusWorkspaceListItem, field: QuickEditField): ShipmentQuickEditDraft {
  return {
    shipmentId: item.id,
    field,
    date: item.transportDate ?? '',
    time: scheduleTime(item),
    customerNote: item.customerNotes ?? '',
    operationalNote: item.operationalNotes ?? '',
    factoryName: item.raw.factoryName ?? '',
    blNumber: item.raw.blNumber ?? '',
    bookingRef: item.raw.bookingRef ?? '',
    declarations: seedDeclarationRows(item),
    declarationSeedIds: (item.raw.declarations ?? []).map((row) => row.id),
    tradeDirection: item.raw.tradeDirection ?? '',
    shippingLineName: item.raw.shippingLineName ?? '',
    packageCount: item.raw.packageCount == null ? '' : String(item.raw.packageCount),
    packageType: item.raw.packageType ?? '',
    cargoWeightKg: item.raw.cargoWeightKg ?? '',
    cargoVolumeCbm: item.raw.cargoVolumeCbm ?? '',
  };
}

/**
 * True when the draft matches the row on every field its mode writes, so the
 * save can be skipped entirely (no version bump, no change-request
 * bookkeeping). Field-by-field because each mode seeds a different subset.
 */
export function isQuickEditUnchanged(draft: ShipmentQuickEditDraft, item: ShipmentCusWorkspaceListItem): boolean {
  return draft.field === 'identity'
    ? draft.factoryName.trim() === (item.raw.factoryName ?? '')
    : draft.field === 'documents'
      ? draft.blNumber.trim() === (item.raw.blNumber ?? '') && draft.bookingRef.trim() === (item.raw.bookingRef ?? '')
        && (item.fieldAccess.declarationNumber.mode === 'READ_ONLY'
          || !hasDeclarationDiff(draft, item))
      : draft.field === 'classification'
        ? draft.tradeDirection === (item.raw.tradeDirection ?? '') && draft.shippingLineName.trim() === (item.raw.shippingLineName ?? '')
        : draft.field === 'cargo'
          ? draft.packageCount === (item.raw.packageCount == null ? '' : String(item.raw.packageCount))
            && draft.packageType.trim() === (item.raw.packageType ?? '')
            && draft.cargoWeightKg === (item.raw.cargoWeightKg ?? '')
            && draft.cargoVolumeCbm === (item.raw.cargoVolumeCbm ?? '')
          : draft.field === 'schedule'
            ? draft.date === (item.transportDate ?? '') && draft.time === scheduleTime(item)
            : draft.customerNote.trim() === (item.customerNotes ?? '').trim()
              && draft.operationalNote.trim() === (item.operationalNotes ?? '').trim();
}

/** Stable identity for the in-flight save guard (latest save wins). */
export function quickEditSaveIdentity(draft: ShipmentQuickEditDraft, item: ShipmentCusWorkspaceListItem): string {
  return `${draft.field}:${draft.shipmentId}:${item.version}`;
}

/**
 * Build the shipment PATCH body for the draft's mode. Direction and
 * field-access gate which keys ship; empty strings become null so the API can
 * distinguish "cleared" from "unchanged".
 */
export function buildQuickEditPayload(draft: ShipmentQuickEditDraft, item: ShipmentCusWorkspaceListItem): QuickEditShipmentPayload {
  const scheduleValue = draft.date && draft.time
    ? localDateTimeToIso(`${draft.date}T${draft.time}`)
    : null;
  return draft.field === 'identity' ? {
    expectedVersion: item.version,
    ...(item.cargoMode !== 'FCL' ? { factoryName: draft.factoryName.trim() || null } : {}),
  } : draft.field === 'documents' ? {
    expectedVersion: item.version,
    ...(draft.tradeDirection === 'IMPORT' && item.fieldAccess.blNumber.mode !== 'READ_ONLY' ? {
      blNumber: draft.blNumber.trim() || null,
      bookingRef: null,
    } : draft.tradeDirection === 'EXPORT' && item.fieldAccess.bookingRef.mode !== 'READ_ONLY' ? {
      bookingRef: draft.bookingRef.trim() || null,
      blNumber: null,
    } : {}),
  } : draft.field === 'classification' ? {
    expectedVersion: item.version,
    tradeDirection: draft.tradeDirection || null,
    shippingLineName: draft.shippingLineName.trim() || null,
  } : draft.field === 'cargo' ? {
    expectedVersion: item.version,
    packageCount: draft.packageCount ? Number(draft.packageCount) : null,
    packageType: draft.packageType.trim() || null,
    ...(item.fieldAccess.cargoWeightKg.mode !== 'READ_ONLY' ? { cargoWeightKg: draft.cargoWeightKg || null } : {}),
    ...(item.fieldAccess.cargoVolumeCbm.mode !== 'READ_ONLY' ? { cargoVolumeCbm: draft.cargoVolumeCbm || null } : {}),
  } : draft.field === 'schedule' ? {
        expectedVersion: item.version,
        expectedDeliveryDate: draft.date || null,
        ...(item.direction === 'IMPORT'
          ? { plannedReturnAt: scheduleValue }
          : { closingAt: scheduleValue }),
      } : {
        expectedVersion: item.version,
        driverNotes: draft.operationalNote.trim() || null,
        customerNotes: draft.customerNote.trim() || null,
      };
}

/**
 * Declaration lives in its own table behind its own endpoints; when the
 * declaration LIST differs from the stored rows and the actor may write it,
 * the save walk issues the diff's ordered writes.
 */
export function quickEditDeclarationChanged(draft: ShipmentQuickEditDraft, item: ShipmentCusWorkspaceListItem): boolean {
  return draft.field === 'documents'
    && item.fieldAccess.declarationNumber.mode !== 'READ_ONLY'
    && hasDeclarationDiff(draft, item);
}