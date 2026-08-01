// Agent tools — semantic data gateway.
// Broad read-only access for app-owned data. These tools intentionally expose
// whitelisted entities/fields instead of arbitrary SQL or DOM/page scraping.
import { z } from 'zod';
import {
  SEMANTIC_ENTITIES,
  getSemanticEntityMeta,
  listSemanticEntities,
  semanticAggregate,
  semanticDetail,
  semanticList,
  semanticSearch,
  semanticTimeline,
} from '../semantic-data.service';
import { defineReadTool, OFFICE_ROLES, ToolError } from '../tool.types';
import { getMetricByEntityField } from '../../metrics/metric-registry';
import { toProvenance } from '../../metrics/metric-types';

const semanticEntitySchema = z.enum(SEMANTIC_ENTITIES);
const semanticEntityInputSchema = z.preprocess(normalizeSemanticEntityInput, semanticEntitySchema);
const filterValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]).optional();
const filtersSchema = z.record(filterValueSchema).optional();

const ENTITY_ALIASES: Record<string, z.infer<typeof semanticEntitySchema>> = {
  trip: 'trips',
  trips: 'trips',
  chuyen: 'trips',
  chuyến: 'trips',
  tire: 'tires',
  tires: 'tires',
  lop: 'tires',
  lốp: 'tires',
  truck: 'trucks',
  trucks: 'trucks',
  xedaukeo: 'trucks',
  trailer: 'trailers',
  trailers: 'trailers',
  romooc: 'trailers',
  driver: 'drivers',
  drivers: 'drivers',
  taixe: 'drivers',
  customer: 'customers',
  customers: 'customers',
  khachhang: 'customers',
  supplier: 'suppliers',
  suppliers: 'suppliers',
  vendor: 'suppliers',
  expense: 'expenses',
  expenses: 'expenses',
  chiphi: 'expenses',
  ledger: 'ledger',
  ledgerrow: 'ledger',
  penalty: 'penalties',
  penalties: 'penalties',
  kyluat: 'penalties',
  debitnotetemplate: 'debitNoteTemplates',
  debitnotetemplates: 'debitNoteTemplates',
  debit_note_template: 'debitNoteTemplates',
  debit_note_templates: 'debitNoteTemplates',
  maubaono: 'debitNoteTemplates',
  auditlog: 'auditLogs',
  auditlogs: 'auditLogs',
  audit_log: 'auditLogs',
  audit_logs: 'auditLogs',
  company: 'companyInfo',
  companyinfo: 'companyInfo',
  companyprofile: 'companyInfo',
  thongtincongty: 'companyInfo',
  congty: 'companyInfo',
  nepo: 'companyInfo',
};

function normalizeSemanticEntityInput(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  const exact = raw as z.infer<typeof semanticEntitySchema>;
  if ((SEMANTIC_ENTITIES as readonly string[]).includes(exact)) return exact;
  const key = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .replace(/[\s_-]+/g, '')
    .toLowerCase();
  return ENTITY_ALIASES[key] ?? raw;
}

export const dataTools = [
  defineReadTool({
    name: 'data.meta',
    description:
      'Mô tả semantic data gateway: danh sách entity, field tìm kiếm/lọc/list/detail, metric aggregate. Gọi khi chưa chắc entity/field nào dùng.',
    allowedRoles: OFFICE_ROLES,
    params: z.object({
      entity: semanticEntityInputSchema.optional(),
    }),
    run: ({ entity }) => entity ? getSemanticEntityMeta(entity) : listSemanticEntities(),
    label: (a) => a.entity ? `Schema ${a.entity}` : 'Schema dữ liệu',
  }),

  defineReadTool({
    name: 'data.search',
    description:
      'Tìm kiếm toàn hệ thống trên dữ liệu nghiệp vụ bằng từ khóa/định danh: số lốp, biển xe, mã chuyến, container, khách hàng, nhà cung cấp, tài xế, mẫu giấy báo nợ, thông tin công ty. Dùng trước khi trả lời câu hỏi factual nếu chưa biết entity/id.',
    allowedRoles: OFFICE_ROLES,
    params: z.object({
      query: z.string().trim().min(1),
      limitPerEntity: z.coerce.number().int().positive().max(8).optional(),
    }),
    run: (args) => semanticSearch(args.query, args.limitPerEntity),
    label: (a) => `Tìm "${a.query}"`,
  }),

  defineReadTool({
    name: 'data.list',
    description:
      'Liệt kê một entity đã whitelist với search/filter/date range. Dùng cho câu hỏi kiểu "các lốp của xe X", "chi phí tháng này", "khách đang active".',
    allowedRoles: OFFICE_ROLES,
    params: z.object({
      entity: semanticEntityInputSchema,
      search: z.string().trim().optional(),
      filters: filtersSchema,
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
    }),
    run: (args) => semanticList(args),
    label: (a) => `Danh sách ${a.entity}`,
  }),

  defineReadTool({
    name: 'data.detail',
    description:
      'Lấy chi tiết một bản ghi theo entity + id, có field enrich tên liên quan. Dùng sau data.search/data.list khi cần trả lời đầy đủ một đối tượng.',
    allowedRoles: OFFICE_ROLES,
    params: z.object({
      entity: semanticEntityInputSchema,
      id: z.coerce.number().int().positive(),
    }),
    run: async (args) => {
      const row = await semanticDetail(args.entity, args.id);
      if (!row) throw new ToolError(`Không tìm thấy ${args.entity} đã chọn`, 'not_found');
      return row;
    },
    label: (a) => `Chi tiết ${a.entity}`,
  }),

  defineReadTool({
    name: 'data.aggregate',
    description:
      'Tổng hợp count/sum theo entity, có thể groupBy field whitelist. Dùng cho câu hỏi tổng số, tổng tiền, top theo trạng thái/khách/xe/nhà cung cấp trong khoảng ngày.',
    allowedRoles: OFFICE_ROLES,
    params: z.object({
      entity: semanticEntityInputSchema,
      metric: z.string().trim().min(1),
      groupBy: z.string().trim().optional(),
      search: z.string().trim().optional(),
      filters: filtersSchema,
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      limit: z.coerce.number().int().positive().max(50).optional(),
    }),
    run: async (args) => {
      const result = await semanticAggregate(args);
      // P4 — attach provenance from the metric registry when the entity+metric
      // matches a registered metric definition. This lets the orchestrator
      // tag widget values with Observed/Calculated/Fored provenance.
      const metricDef = getMetricByEntityField(args.entity, args.metric);
      if (metricDef && result && typeof result === 'object' && !Array.isArray(result)) {
        (result as Record<string, unknown>)._provenance = toProvenance(metricDef);
      }
      return result;
    },
    label: (a) => `Tổng hợp ${a.entity}.${a.metric}`,
  }),

  defineReadTool({
    name: 'data.timeline',
    description:
      'Dòng thời gian/history đọc được cho entity: ngày tạo/cập nhật, ngày nghiệp vụ, audit/ledger movements. Dùng cho câu hỏi "khi nào", "lịch sử", "gần đây".',
    allowedRoles: OFFICE_ROLES,
    params: z.object({
      entity: semanticEntityInputSchema,
      search: z.string().trim().optional(),
      filters: filtersSchema,
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      limit: z.coerce.number().int().positive().max(50).optional(),
    }),
    run: (args) => semanticTimeline(args),
    label: (a) => `Timeline ${a.entity}`,
  }),
] as const;
