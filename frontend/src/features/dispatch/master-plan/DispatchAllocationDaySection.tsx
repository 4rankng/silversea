import { Calendar, Plus, Trash2 } from 'lucide-react';
import type { CarrierAllocationOption } from '../../../components/shipment/CarrierAllocationSummary';
import { Button as UUIButton } from '../../../components/untitled-ui/base/buttons/button';
import { DisabledActionTip } from '../../../components/shared/DisabledActionTip';
import { QuickAddButton } from '../../../components/shared/QuickAddButton';
import { Input as UUIInput } from '../../../components/untitled-ui/base/input/input';
import { UuiSelectField } from '../../../design-system';
import {
  type AllocationDayGroup,
  type DayValidationResult,
  type AllocationRow,
  formatContainerCounts,
  formatShortDateVi,
  isNamedDateKey,
  formatWeekdayVi,
} from './allocationDayHelpers';

interface DispatchAllocationDaySectionProps {
  day: AllocationDayGroup;
  dayIndex: number;
  isMultiDay: boolean;
  validation: DayValidationResult;
  options: CarrierAllocationOption[];
  optionsLoading: boolean;
  globalRowOffset: number;
  onUpdateRow: (dayIndex: number, rowIndex: number, patch: Partial<AllocationRow>) => void;
  onAddRow: (dayIndex: number) => void;
  onRemoveRow: (dayIndex: number, rowIndex: number) => void;
  /** SIL-390 — the row's chosen carrierKey, for the "+ Thêm nhanh biển số
   *  xe" affordance beside the carrier select (owner law 2026-11-07). */
  onQuickAddCarrier: (carrierKey: string) => void;
}

/**
 * One flat day group of the carrier-allocation table (TC-DV-DISPATCH-043):
 * a full-width day header row (weekday + date, factory, demand chip, state
 * chip) followed by carrier rows, plus a per-day add button. The day header
 * carries the date context for the whole group — carrier rows do not repeat
 * it. Rendered as an ARIA rowgroup of the single dialog table — no nested
 * cards.
 */
export function DispatchAllocationDaySection({
  day,
  dayIndex,
  isMultiDay,
  validation,
  options,
  optionsLoading,
  globalRowOffset,
  onUpdateRow,
  onAddRow,
  onRemoveRow,
  onQuickAddCarrier,
}: DispatchAllocationDaySectionProps) {
  const dayState = validation.state;
  const usedKeys = new Set(day.rows.map((r) => r.carrierKey));
  const canAddRow = !optionsLoading && options.some((opt) => opt.isActive !== false && !usedKeys.has(opt.key));
  const named = isNamedDateKey(day.dateKey);
  // The '__ALL__' fallback with a real delivery date still yields a real row
  // date and weekday; only true sentinels get the dash / no weekday.
  const labelDate = /^\d{2}\/\d{2}\/\d{4}$/.test(day.dateLabel) ? day.dateLabel : null;
  const shortDate = named ? formatShortDateVi(day.dateKey) : (labelDate ? labelDate.slice(0, 5) : '—');
  const weekday = named
    ? formatWeekdayVi(day.dateKey)
    : (labelDate ? formatWeekdayVi(labelDate.split('/').reverse().join('-')) : '');
  const addLabel = named ? `Thêm nhà xe ngày ${shortDate}` : 'Thêm nhà xe (chưa chốt ngày)';

  return (
    <div
      role="rowgroup"
      className={`dispatch-allocation-popover__day-group is-${dayState} ${isMultiDay ? 'is-multi' : ''}`}
      aria-label={isMultiDay ? (named ? `Phân bổ ngày ${day.dateLabel}` : `Phân bổ ${day.dateLabel}`) : undefined}
    >
      <div role="row" className="dispatch-allocation-popover__day-header-row">
        <div role="cell" aria-colspan={4} className="dispatch-allocation-popover__day-header-cell">
          <Calendar size={15} className="dispatch-allocation-popover__day-icon" aria-hidden="true" />
          <h4 className="dispatch-allocation-popover__day-title">
            <span>{named ? `Ngày ${day.dateLabel}` : day.dateLabel}</span>
            {weekday ? (
              <span className="dispatch-allocation-popover__day-weekday"> · {weekday}</span>
            ) : null}
          </h4>
          {day.factoryName && (
            <span className="dispatch-allocation-popover__day-factory">· {day.factoryName}</span>
          )}
          <span className="dispatch-allocation-popover__day-demand-chip">
            Nhu cầu: {formatContainerCounts(day.demand)}
          </span>
          <span className="dispatch-allocation-popover__state" aria-live="polite">
            {dayState === 'error' ? 'Cần điều chỉnh' : dayState === 'complete' ? 'Đã phân đủ' : 'Chưa phân đủ'}
          </span>
        </div>
      </div>

      {day.rows.map((row, rowIndex) => {
        const rowNum = globalRowOffset + rowIndex + 1;
        const issue = validation.rowIssues[rowIndex];

        return (
          <div
            role="row"
            key={row.key}
            className="dispatch-allocation-popover__row"
            data-allocation-row={isMultiDay ? `${dayIndex}-${rowIndex}` : `${rowIndex}`}
          >
            <div role="cell" className="dispatch-allocation-popover__row-carrier">
              {/* SIL-390 (owner law 2026-11-07, KB chương 3) — once the row
                  has a chosen nhà xe (fresh rows default to đội xe nội bộ),
                  the shared "+ Thêm nhanh" affordance rides the carrier cell:
                  it registers a brand-new plate into THAT carrier's catalog
                  without leaving the Phân bổ nhà xe flow. */}
              <div className="dispatch-allocation-popover__carrier-quick">
                <UuiSelectField
                  label="Nhà xe"
                  hideLabel
                  ariaLabel={`Nhà xe dòng ${rowNum}`}
                  wrapperClassName="dispatch-allocation-popover__carrier"
                  controlClassName="dispatch-allocation-popover__control"
                  popoverClassName="dispatch-allocation-popover__carrier-dropdown ds-uui-select__popover"
                  /* SIL-707 r2 (QA 07/11) — open UPWARD: a row-1 picker must
                     never cover the row below's combobox or escape the dialog's
                     bottom edge (no-overlap doctrine). */
                  popoverPlacement="top"
                  value={row.carrierKey}
                  onChange={(event) => onUpdateRow(dayIndex, rowIndex, { carrierKey: event.target.value })}
                  hint={issue?.carrier ?? (optionsLoading ? 'Đang tải danh sách nhà xe…' : undefined)}
                  invalid={Boolean(issue?.carrier)}
                  disabled={optionsLoading}
                  options={options.map((option) => ({
                    label: option.label,
                    value: option.key,
                    disabled: option.isActive === false,
                  }))}
                />
                {options.some((option) => option.key === row.carrierKey) && (
                  <QuickAddButton onClick={() => onQuickAddCarrier(row.carrierKey)} />
                )}
              </div>
            </div>
            <div role="cell" className="dispatch-allocation-popover__row-count" data-label="Container 20'">
              <UUIInput
                className="dispatch-allocation-popover__count"
                inputClassName="dispatch-allocation-popover__control"
                type="number"
                size="sm"
                placeholder="0"
                hint={issue?.count20 ?? undefined}
                isInvalid={Boolean(issue?.count20)}
                value={row.count20}
                onChange={(value) => onUpdateRow(dayIndex, rowIndex, { count20: value })}
                aria-label={`Số container 20' dòng ${rowNum}`}
                inputProps={{ min: 0, step: 1, inputMode: 'numeric' }}
              />
            </div>
            <div role="cell" className="dispatch-allocation-popover__row-count" data-label="Container 40'">
              <UUIInput
                className="dispatch-allocation-popover__count"
                inputClassName="dispatch-allocation-popover__control"
                type="number"
                size="sm"
                placeholder="0"
                hint={issue?.count40 ?? undefined}
                isInvalid={Boolean(issue?.count40)}
                value={row.count40}
                onChange={(value) => onUpdateRow(dayIndex, rowIndex, { count40: value })}
                aria-label={`Số container 40' dòng ${rowNum}`}
                inputProps={{ min: 0, step: 1, inputMode: 'numeric' }}
              />
            </div>
            <div role="cell" className="dispatch-allocation-popover__row-remove">
              {day.rows.length > 1 && (
                <button
                  type="button"
                  className="dispatch-allocation-popover__remove"
                  onClick={() => onRemoveRow(dayIndex, rowIndex)}
                  aria-label={`Xóa dòng ${rowNum}`}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        );
      })}

      <div role="row" className="dispatch-allocation-popover__day-add-row">
        <div role="cell" aria-colspan={4} className="dispatch-allocation-popover__day-add-cell">
          <DisabledActionTip
            id="dispatch-allocation-add-carrier"
            reason={!canAddRow
              ? (optionsLoading ? 'Đang tải danh sách nhà xe…' : 'Đã gán hết nhà xe khả dụng cho ngày này.')
              : null}
          >
            <UUIButton
              type="button"
              size="sm"
              color="secondary"
              className="dispatch-allocation-popover__add"
              iconLeading={<Plus size={16} aria-hidden="true" />}
              onPress={() => { if (!canAddRow) return; onAddRow(dayIndex); }}
              aria-disabled={!canAddRow || undefined}
            >
              {addLabel}
            </UUIButton>
          </DisabledActionTip>
        </div>
      </div>
    </div>
  );
}
