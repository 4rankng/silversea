import type { AgentToolDef } from './tool.types.js';
import { normalizeText } from './text.js';

const DATA_TOOLS = new Set(['data.search', 'data.list', 'data.detail', 'data.aggregate', 'data.timeline', 'data.meta']);

function matches(name: string, exact: ReadonlySet<string>, prefixes: readonly string[]): boolean {
  return exact.has(name) || prefixes.some((prefix) => name.startsWith(prefix));
}

/**
 * Advertise only intent-relevant schemas. The selector is deliberately
 * conservative: an unclassified request keeps the full role-filtered surface,
 * while recognized domains retain data.*, navigation, and their specialist
 * tools. This cuts prompt tokens without making an unknown request incapable.
 */
export function selectToolsForMessage(tools: AgentToolDef[], message: string): AgentToolDef[] {
  const text = normalizeText(message);

  // Greetings and conversational memory questions require no external data.
  if (/^(hi|hello|hey|xin chao|chao|cam on|thanks|thank you)[!.?\s]*$/i.test(text)
    || /(dang noi ve gi|vua noi gi|what have we been talking about)/i.test(text)) {
    return [];
  }

  // Retain the complete implemented navigation surface. A request can combine
  // domain analysis with "mở báo cáo cho tôi" in the same turn.
  const coreUi = new Set(['ui.search_pages', 'ui.navigate', 'ui.focus']);
  const keep = new Set<string>(coreUi);
  const prefixes: string[] = [];
  let classified = false;

  if (/(huong dan|cach lam|tutorial|tung buoc|lam the nao)/i.test(text)) {
    keep.add('knowledge.search');
    classified = true;
  }

  if (/(loi nhuan|doanh thu|tai chinh|cong no|phai thu|phai tra|luong|dau|nhien lieu|chi phi|aging|bao cao|p&l)/i.test(text)) {
    for (const name of DATA_TOOLS) keep.add(name);
    keep.add('report.run');
    keep.add('customer.balance');
    keep.add('supplier.balance');
    keep.add('supplier.statement');
    keep.add('receivables.top_overdue');
    keep.add('fuel.config');
    keep.add('pricing.lookup');
    classified = true;
  }

  if (/(chuyen|xe|dau keo|ro mooc|tai xe|lai xe|bien so|container|seal|fleet|doi xe|dang chay|lop)/i.test(text)) {
    for (const name of DATA_TOOLS) keep.add(name);
    keep.add('trips.live_fleet');
    keep.add('trips.containers');
    keep.add('drivers.earnings');
    keep.add('fuel.config');
    keep.add('pricing.lookup');
    classified = true;
  }

  if (/(tam ung|hoan ung|quyet toan|phe duyet|duyet|approval)/i.test(text)) {
    prefixes.push('advances.', 'approvals.');
    for (const name of DATA_TOOLS) keep.add(name);
    classified = true;
  }

  if (/(kiem toan|nhat ky|audit|lich su thay doi)/i.test(text)) {
    for (const name of DATA_TOOLS) keep.add(name);
    keep.add('knowledge.search');
    classified = true;
  }

  if (!classified) return tools;
  return tools.filter((tool) => matches(tool.name, keep, prefixes));
}

/** Intent-dependent cap for the sequential reasoning loop. */
export function iterationBudgetFor(message: string, selectedToolCount: number): number {
  const text = normalizeText(message);
  if (selectedToolCount === 0) return 1;
  if (/(huong dan|cach lam|tutorial|tung buoc)/i.test(text)) return 2;
  if (/(tai sao|vi sao|so voi|tung xe|(?:^|\s)xe\s+[0-9]|khach hang|nha cung cap|thang\s+[0-9]|quy\s+[1-4]|nam\s+20\d{2})/i.test(text)) return 4;
  if (/(loi nhuan|doanh thu|tai chinh|cong no|phai thu|phai tra|luong|dau|nhien lieu|chi phi|bao cao)/i.test(text)) return 3;
  return 4;
}

/** Stable cache key for duplicate read calls inside one turn. */
export function readonlyToolCacheKey(name: string, args: unknown): string {
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, stable(child)]));
    }
    return value;
  };
  return `${name}:${JSON.stringify(stable(args))}`;
}
