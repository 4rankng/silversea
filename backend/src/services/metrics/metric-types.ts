// Metric types — P4 Semantic Metric Layer.
//
// The provenance taxonomy (HLD §6): every business number is tagged so users
// can tell observed facts from derived calculations from model forecasts from
// user assumptions. Rendered as colored chips in the InsightCard UI.

/** How a metric value was derived. Drives the provenance chip color. */
export type MetricCategory = 'observed' | 'calculated' | 'forecast' | 'assumption';

/** A declarative metric definition — the single source of truth for a business
 *  number. Consumed by agent tools (data.aggregate, report.run) and eventually
 *  by the reporting service. */
export interface MetricDef {
  /** Stable identifier (e.g. 'gross_profit', 'revenue_ex_vat'). */
  id: string;
  /** Vietnamese display label (e.g. 'Lợi nhuận gộp'). */
  labelVi: string;
  /** Unit: how the value is rendered. */
  unit: 'vnd' | 'percent' | 'number' | 'days';
  /** Provenance category — what kind of number this is. */
  category: MetricCategory;
  /** Human-readable formula description (for tooltips / provenance chips). */
  formula: string;
  /** The backing computation source: which service/function produces this. */
  source: {
    service: string;
    method: string;
  };
  /** The semantic-data entity + field this metric maps to (if applicable).
   *  Lets data.aggregate resolve via the registry. */
  entityField?: {
    entity: string;
    field: string;
  };
  /** Known drift risks (documented for maintainers). */
  driftNote?: string;
}

/** Provenance tag attached to a widget value in the AgentResponse. */
export interface ProvenanceTag {
  /** The metric id from the registry (e.g. 'gross_profit'). */
  metricId?: string;
  /** The provenance category. */
  category: MetricCategory;
  /** Optional formula text for the tooltip. */
  formula?: string;
}

/** Convert a MetricDef to a ProvenanceTag (for widget values). */
export function toProvenance(def: MetricDef): ProvenanceTag {
  return {
    metricId: def.id,
    category: def.category,
    formula: def.formula,
  };
}
