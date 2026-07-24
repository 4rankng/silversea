// Agent tool registry — assembles every domain's tools and filters per role.
//
// `getToolsForRole` is the single entry the orchestrator calls to get the
// tool list advertised to MiniMax. Filtering here keeps the per-call tool list
// small: the semantic-data gateway (`data.*`) + `report.run` now cover the
// plain reads and money reports that the legacy per-entity tools duplicated, so
// those are RETIRED from the advertised surface via RETIRED_TOOL_NAMES below
// (the tool files stay compiled; only the advertised list shrinks). Every tool
// ALSO re-checks role inside execute (defense in depth).
import { Role } from '@tingting/shared';
import type { AgentToolDef } from './tool.types';
import { tripTools } from './tools/trips';
import { receivablesTools } from './tools/receivables';
import { payablesTools } from './tools/payables';
import { financeTools } from './tools/finance';
import { expenseTools } from './tools/expenses';
import { advanceTools } from './tools/advances';
import { salaryTools } from './tools/salary';
import { fleetTools } from './tools/fleet';
import { approvalTools } from './tools/approvals';
import { ledgerTools } from './tools/ledger';
import { auditTools } from './tools/audit';
import { analyzerTools } from './tools/analyzers';
import { dataTools } from './tools/data';
import { reportTools } from './tools/reports';
import { uiTools } from './tools/ui';
import { toursTools } from './tools/tours';
import { knowledgeTools } from './tools/knowledge';

// Tools no longer advertised to the LLM because the semantic gateway (`data.*`)
// or `report.run` now covers them with parity (same backing service fn, or an
// equivalent entity read). Each was audited: a money/report tool maps 1:1 to a
// report.run key that calls the SAME service fn; a read tool maps to a data.*
// entity operation. Tools with NO gateway/report equivalent (live GPS, advances
// entity, pricing/fuel config, single-entity balances, renewal reminders) are
// intentionally NOT listed here and stay advertised. Advertised surface: 52→25.
const RETIRED_TOOL_NAMES = new Set<string>([
  // — covered by data.list / data.detail / data.aggregate on the same entity —
  'trips.list', 'trips.detail', 'trips.summary', 'trips.expenses', 'trips.adjustments',
  'customers.list', 'suppliers.list',
  'fleet.catalog', 'drivers.list', 'drivers.penalties',
  'expenses.list', 'expenses.detail',
  'ledger.entries', 'audit.logs',
  // — covered by report.run (same backing service fn) —
  'profit.report', 'fuel.variance', // finance.ts → report.run profit_report / fuel_variance
  'salary.compute', 'salary.all_drivers', 'salary.attendance', // → salary_driver / all / attendance
  'customers.statement', 'receivables.summary', 'receivables.aging', // → customer_statement / receivables_summary / aging
  'payables.summary', // → payables_summary
  // — analyzers.ts: pre-report.run layer, now fully redundant with report.run —
  'profit.breakdown', 'receivables.debt_insight', 'fuel.anomalies', 'expense.anomalies',
]);

// The full library. Order matters only for readability of any debug dump;
// the LLM selects by name+description, not position.
const ALL_TOOLS: AgentToolDef[] = [
  ...dataTools,
  ...reportTools,
  ...uiTools,
  ...toursTools,
  ...knowledgeTools,
  ...tripTools,
  ...receivablesTools,
  ...payablesTools,
  ...financeTools,
  ...expenseTools,
  ...advanceTools,
  ...salaryTools,
  ...fleetTools,
  ...approvalTools,
  ...ledgerTools,
  ...auditTools,
  ...analyzerTools,
].filter((t) => !RETIRED_TOOL_NAMES.has(t.name));

// v1: office staff only. DRIVER / FORWARDER get an empty list (their portal
// tool sets are Phase 2). ADMIN/MANAGER/ACCOUNTANT see the full set today;
// the per-tool allowedRoles still gates anything narrower later.
const V1_ALLOWED_ROLES = new Set<Role>([Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT]);

export function getToolsForRole(role: Role): AgentToolDef[] {
  if (!V1_ALLOWED_ROLES.has(role)) return [];
  return ALL_TOOLS.filter((t) => t.allowedRoles.includes(role));
}

/** Lookup by name (orchestrator resolves an LLM tool_call to its def). */
export function findTool(name: string): AgentToolDef | undefined {
  return ALL_TOOLS.find((t) => t.name === name);
}
