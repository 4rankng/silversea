// Agent tools — curated tour discovery.
//
// `tours.search` is a READ tool: it returns the role-visible tours from the
// shared catalog whose title/summary/description/aliases match a Vietnamese
// query, so the LLM can resolve "hướng dẫn tạo chuyến" → tourId before emitting
// a {type:'start_tour',tourId} final answer. Mirrors `ui.search_pages`.
//
// NOTE on the missing `tours.start` tool: the final response is produced by
// produceFinalAnswer (an LLM JSON call), not by a tool — tools emit live
// `directive` events mid-loop, they don't author the terminal response. So the
// LLM emits {type:'start_tour'} directly as its final answer, and the
// orchestrator's `synthesizeStartTourFromResponse` net validates it (role +
// existence) and catches rambled freeform tutorials. That net subsumes what a
// separate `tours.start` tool would have done, with one fewer round-trip.
import { z } from 'zod';
import { Role, toursForRole } from '@tingting/shared';
import { OFFICE_ROLES, type AgentToolDef } from '../tool.types';
import { normalizeText as normalizeSearchText } from '../text';

// OFFICE_ROLES is a readonly tuple of specific enum members; widen to Role[] so
// .includes(ctx.role) type-checks (ctx.role is the full Role union). Mirrors ui.ts.
const OFFICE_ROLE_SET: readonly Role[] = OFFICE_ROLES;

export const toursTools: AgentToolDef[] = [
  {
    name: 'tours.search',
    description:
      'Tìm hướng dẫn (tour) có sẵn theo từ khoá tiếng Việt (VD "tạo chuyến", "chốt chuyến", "định mức dầu"). Trả về danh sách {tourId, title, summary} các hướng dẫn phù hợp với vai trò. Sau khi chọn tourId, trả lời cuối cùng PHẢI là {"type":"start_tour","tourId":"..."}.',
    allowedRoles: OFFICE_ROLES,
    params: z.object({ query: z.string().min(1) }),
    async execute(rawArgs, ctx) {
      if (!OFFICE_ROLE_SET.includes(ctx.role)) return { data: [] };
      const { query } = z.object({ query: z.string().min(1) }).parse(rawArgs);
      const q = normalizeSearchText(query);
      // toursForRole handles the enum-tuple widening + role filter (single source).
      const matches = toursForRole(ctx.role)
        .filter((t) =>
          normalizeSearchText(`${t.title} ${t.summary} ${t.description} ${t.aliases.join(' ')}`).includes(q),
        )
        .map((t) => ({ tourId: t.id, title: t.title, summary: t.summary }));
      return { data: matches, label: `${matches.length} hướng dẫn phù hợp` };
    },
  },
];
