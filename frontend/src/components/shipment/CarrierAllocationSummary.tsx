import './CarrierAllocationSummary.css';

export type CarrierAssignmentType = 'OWN' | 'EXTERNAL';

export interface CarrierAllocationOption {
  key: string;
  label: string;
  carrierType: CarrierAssignmentType;
  externalCarrierId: number | null;
  isActive?: boolean;
  searchText?: string;
}

export interface CarrierAllocationValue {
  carrierType: CarrierAssignmentType;
  externalCarrierId: number | null;
  carrierLabel: string;
  count20: number;
  count40: number;
}

export interface CarrierAllocationDemand {
  count20: number;
  count40: number;
}

export interface CarrierAllocationValidation {
  assigned20: number;
  assigned40: number;
  isExact: boolean;
  errors: string[];
}

function asInt(value: number | string): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 ? value : null;
  }
  if (value.trim() === '') return 0;
  if (!/^\d+$/.test(value.trim())) return null;
  return Number(value.trim());
}

export function carrierOptionKey(carrierType: CarrierAssignmentType, externalCarrierId: number | null): string {
  return carrierType === 'OWN' ? 'OWN' : `EXTERNAL:${externalCarrierId ?? 'missing'}`;
}

export function validateCarrierAllocations(
  rows: ReadonlyArray<{
    carrierKey: string;
    count20: number | string;
    count40: number | string;
  }>,
  demand: CarrierAllocationDemand,
  options: ReadonlyArray<CarrierAllocationOption>,
  /**
   * EXACT (default, clerk submit flow): totals must match demand exactly.
   * MAX (dispatch master-plan): under-allocation is allowed — only overflow
   * (docx rule B: tổng phân bổ > tổng lô hàng) is an error.
   */
  mode: 'EXACT' | 'MAX' = 'EXACT',
): CarrierAllocationValidation {
  const errors: string[] = [];
  const seenCarrierKeys = new Set<string>();
  const optionByKey = new Map(options.map((option) => [option.key, option]));
  let assigned20 = 0;
  let assigned40 = 0;

  rows.forEach((row) => {
    const option = optionByKey.get(row.carrierKey);
    const parsed20 = asInt(row.count20);
    const parsed40 = asInt(row.count40);
    if (!row.carrierKey || !option) {
      errors.push('Cần chọn nhà xe hợp lệ cho từng dòng.');
      return;
    }
    if (seenCarrierKeys.has(row.carrierKey)) {
      errors.push(`Nhà xe "${option.label}" đang bị lặp. Mỗi nhà xe chỉ được nhập một dòng.`);
    }
    seenCarrierKeys.add(row.carrierKey);
    if (option.isActive === false) {
      errors.push(`Nhà xe "${option.label}" đang ngưng hoạt động.`);
    }
    if (parsed20 == null || parsed40 == null) {
      errors.push(`Số lượng của "${option.label}" phải là số nguyên không âm.`);
      return;
    }
    if (parsed20 === 0 && parsed40 === 0) {
      errors.push(`Dòng "${option.label}" phải có ít nhất một số lượng 20' hoặc 40'.`);
      return;
    }
    assigned20 += parsed20;
    assigned40 += parsed40;
  });

  if (mode === 'EXACT') {
    if (assigned20 !== demand.count20) {
      errors.push(`Container 20' đang gán ${assigned20}/${demand.count20}.`);
    }
    if (assigned40 !== demand.count40) {
      errors.push(`Container 40' đang gán ${assigned40}/${demand.count40}.`);
    }
  } else {
    if (assigned20 > demand.count20) {
      errors.push(`Container 20' vượt số lượng: gán ${assigned20}/${demand.count20}.`);
    }
    if (assigned40 > demand.count40) {
      errors.push(`Container 40' vượt số lượng: gán ${assigned40}/${demand.count40}.`);
    }
  }

  return {
    assigned20,
    assigned40,
    isExact: errors.length === 0,
    errors,
  };
}

export function summarizeCarrierAllocations(rows: ReadonlyArray<CarrierAllocationValue>): string {
  return rows
    .map((row) => {
      const parts = [
        row.count20 > 0 ? `${row.count20}x20'` : null,
        row.count40 > 0 ? `${row.count40}x40'` : null,
      ].filter(Boolean);
      return `${row.carrierLabel} ${parts.join(' · ')}`.trim();
    })
    .join(', ');
}

interface CarrierAllocationSummaryProps {
  allocations: CarrierAllocationValue[];
  demand?: CarrierAllocationDemand | null;
  warning?: string | null;
  emptyLabel?: string;
  className?: string;
}

export function CarrierAllocationSummary({
  allocations,
  demand = null,
  warning = null,
  emptyLabel = 'Chưa gán nhà xe',
  className = '',
}: CarrierAllocationSummaryProps) {
  const validation = demand ? validateCarrierAllocations(
    allocations.map((row) => ({
      carrierKey: carrierOptionKey(row.carrierType, row.externalCarrierId),
      count20: row.count20,
      count40: row.count40,
    })),
    demand,
    allocations.map((row) => ({
      key: carrierOptionKey(row.carrierType, row.externalCarrierId),
      label: row.carrierLabel,
      carrierType: row.carrierType,
      externalCarrierId: row.externalCarrierId,
      isActive: true,
    })),
  ) : null;

  return (
    <div className={['carrier-allocation-summary', className].filter(Boolean).join(' ')}>
      {allocations.length > 0 ? (
        <div className="carrier-allocation-summary__chips" aria-label="Tóm tắt nhà xe đã gán">
          {allocations.map((row) => (
            <span
              key={carrierOptionKey(row.carrierType, row.externalCarrierId)}
              className="carrier-allocation-summary__chip"
            >
              <strong>{row.carrierLabel}</strong>
              <span>
                {[
                  row.count20 > 0 ? `${row.count20}x20'` : null,
                  row.count40 > 0 ? `${row.count40}x40'` : null,
                ].filter(Boolean).join(' · ')}
              </span>
            </span>
          ))}
        </div>
      ) : (
        <p className="carrier-allocation-summary__empty">{emptyLabel}</p>
      )}

      {demand ? (
        <p className={`carrier-allocation-summary__progress${validation?.isExact ? '' : ' is-warning'}`}>
          20': {validation?.assigned20 ?? 0}/{demand.count20} · 40': {validation?.assigned40 ?? 0}/{demand.count40}
        </p>
      ) : null}

      {warning ? <p className="carrier-allocation-summary__warning">{warning}</p> : null}
    </div>
  );
}
