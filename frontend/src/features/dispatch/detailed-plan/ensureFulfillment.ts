import { decomposeDispatchDetailBranch } from '../../../api/dispatchDetailBranch';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';

/** Fulfillment-less branch rows (READY_FOR_DISPATCH containers without a
 *  fulfillment) have no editor identity — decompose the container first and
 *  hand back the fresh row so the editor targets the created fulfillment.
 *  Extracted from useDispatchDetailPlan (ratchet ticket 2026.9 (1)._4 item 7;
 *  ceiling returns to 515 with this module). */
export async function ensureFulfillmentFor(
  row: DispatchDetailPlanRow,
  options: {
    patchItems: (map: (previous: DispatchDetailPlanRow[]) => DispatchDetailPlanRow[]) => void;
    onError: (message: string) => void;
  },
): Promise<DispatchDetailPlanRow | null> {
  if (row.shipmentContainerId == null) {
    // No container id (serializer gap) — never no-op silently.
    options.onError('Dòng này không mang mã container — không thể tạo tác vụ. Vui lòng tải lại trang.');
    return null;
  }
  try {
    const outcome = await decomposeDispatchDetailBranch({
      shipmentId: row.shipmentId,
      containerId: row.shipmentContainerId,
      expectedShipmentVersion: row.shipmentVersion,
    });
    const fresh: DispatchDetailPlanRow = {
      ...row,
      fulfillmentId: outcome.fulfillmentId,
      version: outcome.fulfillmentVersion,
      shipmentVersion: outcome.shipmentVersion,
    };
    options.patchItems((previous) => previous.map((item) => (
      item.fulfillmentId == null && item.shipmentContainerId === row.shipmentContainerId ? fresh : item
    )));
    return fresh;
  } catch {
    options.onError('Không thể tạo tác vụ điều xe cho container này. Vui lòng thử lại.');
    return null;
  }
}
