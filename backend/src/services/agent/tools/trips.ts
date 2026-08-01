// Agent tools — Trips domain.
// Thin read-only wrappers over the trip query services. Each returns the
// service's structured rows; the LLM composes answers / shapes insight cards
// from them. Every tool is office-staff only (Casbin `trips`: MANAGER r/w/d,
// ACCOUNTANT r/w) and re-checks role inside execute (defense in depth).
import { z } from 'zod';
import { TripStatus } from '@tingting/shared';
import { db } from '../../../db';
import { getTrips, getTripsSummary, getTripById } from '../../trip-queries.service';
import { getTripExpenses } from '../../forwarder.service';
import { listTripContainers } from '../../forwarder-container.service';
import { getTripAdjustments } from '../../financial.service';
import { getLiveFleet } from '../../gps.service';
import { defineReadTool, OFFICE_ROLES, ToolError } from '../tool.types';

// Derive from the shared TripStatus enum (single source of truth) instead of
// re-declaring the literals — a new status can't silently drift out of sync.
const tripStatusSchema = z.nativeEnum(TripStatus);

export const tripTools = [
  defineReadTool({
    name: 'trips.list',
    description:
      'Tìm và lọc danh sách lệnh vận chuyển (chuyến xe). Dùng khi người hỏi tìm chuyến của khách/lái xe/xe/ngày/trạng thái cụ thể. Trả về danh sách phân trang kèm tên khách, tài xế, xe, tuyến.',
    allowedRoles: OFFICE_ROLES,
    params: z.object({
      customerId: z.coerce.number().int().positive().optional(),
      driverId: z.coerce.number().int().positive().optional(),
      truckId: z.coerce.number().int().positive().optional(),
      status: tripStatusSchema.optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      search: z.string().optional(),
      page: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
    }),
    run: (args) => getTrips(args),
    label: (a) =>
      a.search
        ? `Tìm "${a.search}"`
        : a.customerId
          ? 'Chuyến theo khách'
          : 'Danh sách chuyến',
  }),

  defineReadTool({
    name: 'trips.detail',
    description:
      'Chi tiết đầy đủ của một lệnh vận chuyển theo id: các chặng (legs), số liệu tài chính, container, ghi chú. Dùng sau trips.list khi cần xem 1 chuyến.',
    allowedRoles: OFFICE_ROLES,
    params: z.object({ id: z.coerce.number().int().positive() }),
    run: async (args) => {
      const trip = await getTripById(args.id);
      if (!trip) {
        throw new ToolError('Không tìm thấy chuyến đã chọn', 'not_found');
      }
      return trip;
    },
    label: () => 'Chi tiết chuyến đi',
  }),

  defineReadTool({
    name: 'trips.summary',
    description:
      'Tổng hợp số chuyến theo trạng thái + tổng doanh thu/chi phí vận chuyển trong khoảng ngày. Dùng cho câu hỏi "tháng này có bao nhiêu chuyến / doanh thu bao nhiêu".',
    allowedRoles: OFFICE_ROLES,
    params: z.object({
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }),
    run: (args) => getTripsSummary(args.dateFrom, args.dateTo),
    label: () => 'Tổng hợp chuyến',
  }),

  defineReadTool({
    name: 'trips.expenses',
    description: 'Các chi phí phát sinh (container/seal/cẩu...) của một chuyến.',
    allowedRoles: OFFICE_ROLES,
    params: z.object({ tripId: z.coerce.number().int().positive() }),
    run: (args) => getTripExpenses(db, args.tripId),
    label: () => 'Chi phí chuyến đi',
  }),

  defineReadTool({
    name: 'trips.containers',
    description: 'Danh sách container + seal của một chuyến.',
    allowedRoles: OFFICE_ROLES,
    params: z.object({ tripId: z.coerce.number().int().positive() }),
    run: (args) => listTripContainers(args.tripId),
    label: () => 'Container của chuyến đi',
  }),

  defineReadTool({
    name: 'trips.adjustments',
    description: 'Các bút toán điều chỉnh (adjustment) trên sổ cái của một chuyến.',
    allowedRoles: OFFICE_ROLES,
    params: z.object({ tripId: z.coerce.number().int().positive() }),
    run: (args) => getTripAdjustments(args.tripId),
    label: () => 'Điều chỉnh chuyến đi',
  }),

  defineReadTool({
    name: 'trips.live_fleet',
    description:
      'Vị trí hiện tại của các xe đang chạy (IN_TRANSIT) từ GPS Bách Khoa. Dùng cho "xe nào đang chạy, ở đâu".',
    allowedRoles: OFFICE_ROLES,
    params: z.object({}),
    run: () => getLiveFleet(),
    label: () => 'Vị trí xe thực thời',
  }),
] as const;
