// Authorized shipment POD download; the former change-review writer is retired.
import { Role } from '@tingting/shared';
import { ApiError } from '../errors';
import type { AuthUser } from '../middleware/auth';
import { getShipmentPodFileForDownload } from './trip-pod.service';
import { getShipmentDetail } from './shipment-detail-reads.service';

export async function downloadShipmentPodFile(
  shipmentId: number,
  fileId: number,
  actor?: AuthUser,
) {
  try {
    await getShipmentDetail(shipmentId, actor);
  } catch (error) {
    if (actor?.role === Role.CUS && error instanceof ApiError && error.statusCode === 403) {
      throw new ApiError(404, 'Không tìm thấy tệp e-POD.');
    }
    throw error;
  }
  return getShipmentPodFileForDownload({ shipmentId, fileId });
}
