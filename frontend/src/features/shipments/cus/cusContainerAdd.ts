// SIL-717 (id 837) — the CUS Tổng quan wire adapter of the container-add
// copy law.
//
// THE LAW lives in `../containerCopyLaw` (one shared owner — see that file's
// header for why). This module only adapts the CUS workspace line to it and
// builds the wire body of `POST /shipments/cus-workspace/:id/containers`.
//
// The server owns HALF the law (backend/src/services/
// cus-shipment-workspace-writes.service.ts): it inherits every column from the
// lot's sibling rows when the wire leaves it undefined. Two columns therefore
// need the FE half:
//
//   1. Số container — never inherited: it is the operator's own entry.
//   2. Loại container — the server WOULD inherit it (undefined = the lot's
//      default), so the FE sends an EXPLICIT `containerTypeId: null` to keep
//      the type empty for the operator's own pick.
//   3. Trọng lượng / thể tích — the server does NOT inherit cargo metrics
//      (they stay per-container facts), so the FE sends them, copied from the
//      row above.
//
// The FE sends the row above's values EXPLICITLY (route, nhà máy, cảng nâng/hạ,
// ngày giờ đóng trả) so the copy follows the row DIRECTLY ABOVE the new one
// (the sheet's last row) instead of the lot's oldest non-null sibling: on the
// server an explicit value wins, and an explicit null is a deliberate clear
// (UNDEFINED = inherit, EXPLICIT NULL = clear).

import type { ShipmentCusWorkspaceContainerLine } from '@tingting/shared';
import {
  containerAddCopy,
  type ContainerAddCopy,
} from '../containerCopyLaw';
import type { ContainerAddEntry } from '../ContainerAddForm';

export type { ContainerAddCopy };

/** The copy seed of ONE row above the new one, read from the CUS line. */
export function cusContainerAddCopy(
  previous?: ShipmentCusWorkspaceContainerLine | null,
): ContainerAddCopy {
  if (!previous) return containerAddCopy(null);
  return containerAddCopy({
    cargoWeightKg: previous.raw.cargoWeightKg ?? null,
    cargoVolumeCbm: previous.raw.cargoVolumeCbm ?? null,
    routeId: previous.routeId ?? previous.raw.routeId ?? null,
    operationalSiteId: previous.operationalSiteId ?? null,
    liftSiteId: previous.liftSiteId ?? null,
    dropoffSiteId: previous.dropoffSiteId ?? null,
    customerAppointmentAt: previous.customerAppointmentAt ?? null,
  });
}

/** The wire body of `POST /shipments/cus-workspace/:id/containers`. */
export interface CusContainerAddPayload {
  expectedShipmentVersion: number;
  containerNumber: string;
  containerTypeId: number | null;
  cargoWeightKg: string | null;
  cargoVolumeCbm: string | null;
  routeId: number | null;
  operationalSiteId: number | null;
  liftSiteId: number | null;
  dropoffSiteId: number | null;
  customerAppointmentAt: string | null;
}

export function cusContainerAddPayload(
  copy: ContainerAddCopy,
  entry: ContainerAddEntry,
  expectedShipmentVersion: number,
): CusContainerAddPayload {
  const number = entry.containerNumber.trim();
  const type = entry.containerTypeId.trim();
  const weight = entry.cargoWeightKg.trim();
  return {
    expectedShipmentVersion,
    containerNumber: number,
    containerTypeId: type === '' ? null : Number(type),
    cargoWeightKg: weight === '' ? null : weight,
    cargoVolumeCbm: copy.cargoVolumeCbm,
    routeId: copy.routeId,
    operationalSiteId: copy.operationalSiteId,
    liftSiteId: copy.liftSiteId,
    dropoffSiteId: copy.dropoffSiteId,
    customerAppointmentAt: copy.customerAppointmentAt,
  };
}
