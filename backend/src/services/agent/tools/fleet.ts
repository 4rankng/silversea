// Agent tools — Fleet, drivers & catalogs domain.
// Casbin `config` / `trips`: OFFICE_ROLES.
import { z } from 'zod';
import { getBootstrapData, getPricing, getFuelConfig, getEffectiveFuelPrice } from '../../config.service';
import { getDriverEarnings, getDriverPenalties } from '../../driver.service';
import { defineReadTool, OFFICE_ROLES, ToolError } from '../tool.types';

export const fleetTools = [
  defineReadTool({
    name: 'fleet.catalog',
    description: 'Danh sách xe đầu kéo, rơ-moóc và tài xế đang hoạt động. Dùng để tra id theo biển số/tên.',
    allowedRoles: OFFICE_ROLES,
    params: z.object({}),
    run: async () => {
      const b = await getBootstrapData();
      return { trucks: b.trucks, trailers: b.trailers, drivers: b.drivers };
    },
    label: () => 'Đội xe',
  }),

  defineReadTool({
    name: 'drivers.list',
    description: 'Danh sách tài xế đang hoạt động.',
    allowedRoles: OFFICE_ROLES,
    params: z.object({}),
    run: async () => (await getBootstrapData()).drivers,
    label: () => 'Tài xế',
  }),

  defineReadTool({
    name: 'drivers.earnings',
    description: 'Thu nhập của một tài xế theo tháng (lương, tạm ứng, phạt, đã thanh toán).',
    allowedRoles: OFFICE_ROLES,
    params: z.object({
      driverId: z.coerce.number().int().positive(),
      month: z.coerce.number().int().min(1).max(12),
      year: z.coerce.number().int().min(2000),
    }),
    run: (args) => getDriverEarnings(args.driverId, args.month, args.year),
    label: () => 'Thu nhập lái xe',
  }),

  defineReadTool({
    name: 'drivers.penalties',
    description: 'Các khoản phạt của một tài xế, có thể lọc theo khoảng ngày.',
    allowedRoles: OFFICE_ROLES,
    params: z.object({
      driverId: z.coerce.number().int().positive(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }),
    run: (args) => getDriverPenalties(args.driverId, args.dateFrom, args.dateTo),
    label: () => 'Kỷ luật lái xe',
  }),

  defineReadTool({
    name: 'catalogs.bootstrap',
    description:
      'Toàn bộ danh mục (khách, xe, tài xế, tuyến, loại hàng, cảng, loại container...). Dùng khi cần tra cứu danh mục chung.',
    allowedRoles: OFFICE_ROLES,
    params: z.object({}),
    run: () => getBootstrapData(),
    label: () => 'Danh mục',
  }),

  defineReadTool({
    name: 'pricing.lookup',
    description: 'Đơn giá áp dụng cho một cặp khách + tuyến tại một ngày.',
    allowedRoles: OFFICE_ROLES,
    params: z.object({
      customerId: z.coerce.number().int().positive(),
      routeId: z.coerce.number().int().positive(),
      date: z.string(),
    }),
    run: async (args) => {
      const result = await getPricing(args.customerId, args.routeId, args.date);
      // getPricing returns { price: null } when no pricing row exists; treat
      // that as not_found so the LLM says "chưa có bảng giá" instead of
      // reporting a bogus 0 VND price.
      if (result.price === null || result.price === undefined) {
        throw new ToolError('Không có bảng giá cho khách/tuyến này', 'not_found');
      }
      return { price: result.price };
    },
    label: () => 'Tra giá',
  }),

  defineReadTool({
    name: 'fuel.config',
    description: 'Cấu hình định mức dầu + đơn giá hiện hành (theo bảng giá hiệu lực hôm nay).',
    allowedRoles: OFFICE_ROLES,
    params: z.object({}),
    run: async () => ({
      config: await getFuelConfig(),
      effectivePriceToday: await getEffectiveFuelPrice(new Date()),
    }),
    label: () => 'Cấu hình dầu',
  }),
] as const;
