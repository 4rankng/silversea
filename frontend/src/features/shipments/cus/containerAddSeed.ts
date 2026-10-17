import type { ShipmentCusContainerFlatRow, ShipmentCusWorkspaceContainerLine } from '@tingting/shared';
import { formatVietnamDateTimeInput } from '../../../lib/shipment-operations';

/**
 * FB-111 (card 171026122120) — one rule for every "add a container to an
 * existing lot" surface: the new row starts from the container above it.
 *
 * Every field inherits EXCEPT the two physical identifiers — `containerNumber`
 * and `containerTypeId`. Those are per-container facts the user must type: a
 * copied number would collide with its own lot (the endpoint rejects duplicates)
 * and a copied type reads as stray text in the fresh row. This is the same
 * split the create form already draws in `createContainerFromPrevious`
 * (card 071026100800), so "thêm container" means one thing across the app.
 *
 * The rule lives here, not in the three call sites: the drawer add row, the
 * `/shipments-detail` add form and the lot-detail dialog each hold their own
 * field shape, and a per-surface copy is exactly how they drifted apart.
 */

/** The add-row draft of the `/shipments` drawer table (CusContainerAddRow). */
export interface ContainerAddFields {
  containerNumber: string;
  containerTypeId: string;
  /** Tuyến đường — inherited, editable, and an override of the lot default. */
  routeId: string;
  /** Cảng nâng / Cảng hạ — likewise; the add endpoint maps them to the ports. */
  liftSiteId: string;
  dropoffSiteId: string;
  cargoWeightKg: string;
  customerAppointmentAt: string;
}

/** The add-form draft of the `/shipments-detail` ledger (AddContainerRowForm). */
export interface LedgerContainerAddFields {
  containerNumber: string;
  cargoWeightKg: string;
  cargoVolumeCbm: string;
  /** Split date/time because that form drives the segmented time field. */
  appointmentDate: string;
  appointmentTime: string;
}

/**
 * Seed the drawer add row from a workspace container line.
 *
 * `routeId`/`liftSiteId`/`dropoffSiteId` are copied so the operator SEES the
 * operational points the new container inherits and can override them, instead
 * of discovering them only after the write.
 */
export function addFieldsFromContainerLine(line: ShipmentCusWorkspaceContainerLine): ContainerAddFields {
  return {
    containerNumber: '',
    containerTypeId: '',
    routeId: line.routeId == null ? '' : String(line.routeId),
    liftSiteId: line.liftSiteId == null ? '' : String(line.liftSiteId),
    dropoffSiteId: line.dropoffSiteId == null ? '' : String(line.dropoffSiteId),
    cargoWeightKg: line.raw.cargoWeightKg ?? '',
    customerAppointmentAt: formatVietnamDateTimeInput(line.customerAppointmentAt),
  };
}

/**
 * Seed the `/shipments-detail` add form from the flat row it was opened on.
 *
 * The ledger's flat rows carry lift/drop and route as LABELS, not ids, so the
 * form seeds what it can name (weight, volume, appointment) and leaves the
 * endpoint's per-column lot inheritance to fill the operating points. The
 * number stays blank; the type is set on the row editor after the write, which
 * is why this form has no type field at all.
 */
export function ledgerAddFieldsFromRow(row: ShipmentCusContainerFlatRow): LedgerContainerAddFields {
  const local = formatVietnamDateTimeInput(row.customerAppointmentAt);
  return {
    containerNumber: '',
    cargoWeightKg: row.raw.cargoWeightKg ?? '',
    cargoVolumeCbm: row.raw.cargoVolumeCbm ?? '',
    appointmentDate: local.slice(0, 10),
    appointmentTime: local.length >= 16 ? local.slice(11, 16) : '',
  };
}