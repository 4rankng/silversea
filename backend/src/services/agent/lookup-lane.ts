// Lookup Lane (P1 Lane 2) — single-entity lookup with ONE tool call.
//
// When the intent router detects a lookup query ("Số lốp 136.31", "khách hàng
// vietsun"), this lane executes ONE data.search call and synthesizes a short
// text answer from the results. This is faster than a full ReAct loop because:
//   1. Only ONE LLM call (synthesis) instead of N iterations.
//   2. The tool call is deterministic (no model deciding which tool to use).
//   3. The synthesis prompt is tiny (just the search results + the question).
//
// Fail-open: if the search returns nothing or the synthesis fails, the lane
// falls back to a "not found" text answer (the user can rephrase or the
// orchestrator can retry with the full ReAct loop).

import type { AgentResponse, AgentRouteKey } from '@tingting/shared';
import { semanticSearch } from './semantic-data.service.js';

export interface LookupResult {
  response: AgentResponse;
  lookupMs: number;
  toolCallCount: number;
}

/**
 * Run the lookup lane: ONE data.search call + format the results into a text
 * response. If the search returns results, synthesize a concise Vietnamese
 * summary. If empty, return a "not found" text.
 *
 * NOTE: This lane uses NO LLM call in v1 — it formats the search results
 * deterministically into a text answer. When a fast model becomes available
 * (P0.4), a synthesis pass can be added here. For now, the deterministic
 * formatting is correct and fast (0 LLM).
 */
export async function runLookup(query: string, _role: string): Promise<LookupResult> {
  const start = performance.now();

  // Execute ONE data.search call.
  const searchResults = await semanticSearch(query, 5);
  const toolCallCount = 1;

  const response = formatLookupResponse(query, searchResults);

  return {
    response,
    lookupMs: performance.now() - start,
    toolCallCount,
  };
}

/** Format search results into a concise text response. Deterministic — no LLM. */
function formatLookupResponse(query: string, results: unknown): AgentResponse {
  // The search results are an object with per-entity arrays.
  const data = results as Record<string, unknown[]>;
  if (!data || typeof data !== 'object') {
    return { type: 'text', content: `Không tìm thấy dữ liệu cho "${query}".` };
  }

  // Flatten results across entities, take top matches.
  const allResults: { entity: string; row: Record<string, unknown> }[] = [];
  for (const [entity, rows] of Object.entries(data)) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (row && typeof row === 'object') {
        allResults.push({ entity, row: row as Record<string, unknown> });
      }
    }
  }

  if (allResults.length === 0) {
    return { type: 'text', content: `Không tìm thấy dữ liệu cho "${query}". Bạn có thể thử lại với từ khóa khác.` };
  }

  // Format the top 3 results into a concise Vietnamese summary.
  const lines: string[] = [];
  lines.push(`Tìm thấy ${allResults.length} kết quả cho "${query}":`);

  for (const { entity, row } of allResults.slice(0, 3)) {
    // Pick the most informative fields from the row.
    const name = String(row.name ?? row.title ?? row.customerName ?? row.truckPlate ?? row.tripCode ?? row.id ?? '');
    const entityLabel = ENTITY_LABELS_VI[entity] ?? entity;
    const detail = formatRowDetail(entity, row);
    lines.push(`\n**${entityLabel}**: ${name}${detail ? ` — ${detail}` : ''}`);
  }

  if (allResults.length > 3) {
    lines.push(`\n... và ${allResults.length - 3} kết quả khác.`);
  }

  return {
    type: 'text',
    content: lines.join('\n'),
    actions: buildLookupActions(allResults),
  };
}

function formatRowDetail(entity: string, row: Record<string, unknown>): string {
  const parts: string[] = [];
  // Entity-specific detail fields.
  const detailFields: Record<string, string[]> = {
    trips: ['status', 'revenue', 'departureDate'],
    trucks: ['plate', 'status'],
    tires: ['position', 'status'],
    customers: ['phone', 'creditLimit'],
    drivers: ['phone', 'status'],
  };
  const fields = detailFields[entity] ?? [];
  for (const f of fields) {
    if (row[f] != null && row[f] !== '') {
      parts.push(`${f}: ${row[f]}`);
    }
  }
  return parts.join(', ');
}

const ENTITY_LABELS_VI: Record<string, string> = {
  trips: 'Chuyến',
  trucks: 'Đầu kéo',
  trailers: 'Rơ-mooc',
  tires: 'Lốp',
  customers: 'Khách hàng',
  suppliers: 'Nhà cung cấp',
  drivers: 'Tài xế',
  expenses: 'Chi phí',
  ledger: 'Sổ cái',
  penalties: 'Kỷ luật',
};

/** Build action chips for lookup results (navigate to the entity's page). */
function buildLookupActions(results: { entity: string; row: Record<string, unknown> }[]):
  { label: string; directive: { kind: 'navigate'; routeKey: AgentRouteKey } }[] {
  // Map entity → routeKey for navigation.
  const entityToRoute: Partial<Record<string, AgentRouteKey>> = {
    trips: 'trips',
    trucks: 'fleet',
    tires: 'fleetTires',
    customers: 'customers',
    drivers: 'salary',
  };
  const actions: { label: string; directive: { kind: 'navigate'; routeKey: AgentRouteKey } }[] = [];
  const seen = new Set<string>();
  for (const { entity } of results) {
    const routeKey = entityToRoute[entity];
    if (!routeKey || seen.has(routeKey)) continue;
    seen.add(routeKey);
    const label = ENTITY_LABELS_VI[entity] ?? entity;
    actions.push({ label: `Mở trang ${label}`, directive: { kind: 'navigate', routeKey } });
  }
  return actions.slice(0, 3);
}
