import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { configClient } from '../api/configClient';
import { qk } from '../api/keys';
import type { Driver, PenaltyReason, Truck, PenaltyStatus } from '@tingting/shared';

interface PenaltyRow {
  id: number;
  driverId: number;
  tripId: number | null;
  reasonId: number | null;
  customReason: string | null;
  amount: string;
  date: string;
  status: PenaltyStatus;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  driverName?: string;
  reasonText?: string;
  tripCode?: string | null;
}

export function usePenalties() {
  return useQuery<PenaltyRow[]>({
    queryKey: qk.penalties.list,
    queryFn: async () => {
      const data = await api.get<{ items: PenaltyRow[] } | PenaltyRow[]>('/penalties');
      const raw: PenaltyRow[] = Array.isArray(data) ? data : data.items ?? [];
      return raw;
    },
  });
}

export function usePenaltyCatalogs() {
  return useQuery<{
    drivers: Driver[];
    reasons: PenaltyReason[];
    trucks: Truck[];
  }>({
    queryKey: qk.penalties.catalogs,
    queryFn: async () => {
      const [drivers, reasons, trucks] = await Promise.all([
        configClient.getDrivers(),
        configClient.getPenaltyReasons(),
        configClient.getTrucks(),
      ]);
      return {
        drivers: drivers.filter((x: Driver) => x.status === 'ACTIVE'),
        reasons,
        trucks,
      };
    },
  });
}

export type { PenaltyRow };
