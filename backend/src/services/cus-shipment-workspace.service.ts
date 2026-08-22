/**
 * CUS shipment workspace — facade.
 *
 * Compatibility re-export module: the implementation lives in
 * `cus-shipment-workspace-reads.service.ts` (read model: formatting/compute
 * helpers, SQL fragment builders, read-model builders, list/detail reads) and
 * `cus-shipment-workspace-writes.service.ts` (write commands, which import
 * the reads module — writes → reads only). Existing importers keep targeting
 * this file unchanged; the exported surface is identical to the pre-split
 * service.
 */
export {
  getCusShipmentWorkspaceDetail,
  listCusShipmentContainers,
  listCusShipmentWorkspace,
} from './cus-shipment-workspace-reads.service';
export { updateCusShipmentContainerLine } from './cus-shipment-workspace-writes.service';
