/**
 * Union read for /fleet/external (card 20260927_66) — a dedicated client
 * module because dispatchPlanningClient.ts sits at its frozen LOC ceiling
 * (structure guard ratchet only shrinks).
 */
import { api } from '../lib/api';

export type ExternalFleetCatalogRow = {
  id: number;
  licensePlate: string;
  isActive: boolean;
  carrierId: number;
  carrierName: string;
  carrierStatus: string;
  updatedAt: string;
};

export type ExternalFleetLinkedTruckRow = {
  id: number;
  licensePlate: string;
  status: string;
  carrierId: number;
  carrierName: string;
  tombstonedAt: string | null;
};

export function listAllExternalFleet() {
  return api.get<{ catalog: ExternalFleetCatalogRow[]; linkedTrucks: ExternalFleetLinkedTruckRow[] }>('/shipments/carrier-fleet-vehicles/all');
}
