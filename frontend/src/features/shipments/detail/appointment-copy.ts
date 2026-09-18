// Bulk appointment copy for the container ledgers (2026-09-18).
//
// Customer request (relayed 2026-09-18): a lot entered without a schedule is
// often delivered on one day, but every container carried its own appointment
// editor, so "bổ sung lịch giao" meant one entry per container. A row that
// already has an appointment writes that datetime to every container of its own
// lot that is still empty.
//
// The detail workboard's affordance is source-gated, not target-count gated:
// that page is a cross-lot board whose search and date filters (and pagination)
// can hide a lot's other containers, so "how many empties are on screen" is not
// a faithful signal — the lot itself is. The write resolves its targets from
// the lot read and reports how many it filled.
//
// Lives beside the ledger (not in the CUS model) because the ledger module is
// what renders the affordance and the model already imports the ledger's types
// — the other direction would be an import cycle.

import type { ShipmentCusContainerFlatRow } from '@tingting/shared';
import { formatISODate } from '../../../lib/format';
import { formatVietnamDateTimeInput } from '../../../lib/shipment-operations';

/** The affordance's label: the source row's appointment on the Vietnam wall
 *  clock, printed exactly like the ledger's schedule cell ({time} {date}) so
 *  what the tooltip promises is what the cell shows. */
export function appointmentCopyLabel(row: ShipmentCusContainerFlatRow): string {
  const input = formatVietnamDateTimeInput(row.customerAppointmentAt);
  return input ? `${input.slice(11, 16)} ${formatISODate(input.slice(0, 10))}` : '';
}
