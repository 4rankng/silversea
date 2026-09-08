import { Calendar, Plus, Trash2 } from 'lucide-react';
import type { CarrierAllocationOption } from '../../../components/shipment/CarrierAllocationSummary';
import { Button as UUIButton } from '../../../components/untitled-ui/base/buttons/button';
import { Input as UUIInput } from '../../../components/untitled-ui/base/input/input';
import { UuiSelectField } from '../../../design-system';
import type { AllocationDayGroup, AllocationRow, DayValidationResult } from './allocationDayHelpers';

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
}

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
}: DispatchAllocationDaySectionProps) {
  const dayState = validation.state;
  const usedKeys = new Set(day.rows.map((r) => r.carrierKey));
  const canAddRow = !optionsLoading && options.some((opt) => opt.isActive !== false && !usedKeys.has(opt.key));

  return (
    <section
      className={`dispatch-allocation-popover__day-section ${isMultiDay ? 'is-multi' : ''}`}
      aria-label={isMultiDay ? `Phân bổ ngày ${day.dateLabel}` : 'Phân bổ theo nhà xe'}
    >
      {isMultiDay && (
        <div className="dispatch-allocation-popover__day-header">
          <div className="dispatch-allocation-popover__day-title-wrap">
            <Calendar size={16} className="dispatch-allocation-popover__day-icon" aria-hidden="true" />
            <h4 className="dispatch-allocation-popover__day-title">
              {day.dateLabel === 'Chưa chốt ngày đóng/trả' ? 'Chưa chốt ngày đóng/trả' : `Ngày ${day.dateLabel}`}
            </h4>
            {day.factoryName && (
              <span className="dispatch-allocation-popover__day-factory">· {day.factoryName}</span>
            )}
            <span className="dispatch-allocation-popover__day-demand-chip">
              Nhu cầu: {[
                day.demand.count20 > 0 ? `${day.demand.count20}x20'` : null,
                day.demand.count40 > 0 ? `${day.demand.count40}x40'` : null,
              ].filter(Boolean).join(' + ') || '0'}
            </span>
          </div>
          <span className={`dispatch-allocation-popover__state is-${dayState}`} aria-live="polite">
            {dayState === 'error' ? 'Cần điều chỉnh' : dayState === 'complete' ? 'Đã phân đủ' : 'Chưa phân đủ'}
          </span>
        </div>
      )}

      {isMultiDay && (
        <div className="dispatch-allocation-popover__day-balance" role="table" aria-label={`Nhu cầu container ngày ${day.dateLabel}`}>
          <div className="dispatch-allocation-popover__balance-header" role="row">
            <span role="columnheader">Loại</span>
            <span role="columnheader">Nhu cầu</span>
            <span role="columnheader">Đã phân</span>
            <span role="columnheader">Còn lại</span>
          </div>
          <div className="dispatch-allocation-popover__balance-row" role="row">
            <strong role="rowheader">20'</strong>
            <span role="cell">{day.demand.count20}</span>
            <span role="cell">{validation.assigned20}</span>
            <strong role="cell">{dayState === 'error' ? validation.remaining20 : Math.max(0, validation.remaining20)}</strong>
          </div>
          <div className="dispatch-allocation-popover__balance-row" role="row">
            <strong role="rowheader">40'</strong>
            <span role="cell">{day.demand.count40}</span>
            <span role="cell">{validation.assigned40}</span>
            <strong role="cell">{dayState === 'error' ? validation.remaining40 : Math.max(0, validation.remaining40)}</strong>
          </div>
        </div>
      )}

      <div className="dispatch-allocation-popover__rows" role="list" aria-label={`Các dòng phân bổ nhà xe ${isMultiDay ? day.dateLabel : ''}`}>
        {day.rows.map((row, rowIndex) => {
          const rowNum = globalRowOffset + rowIndex + 1;
          const issue = validation.rowIssues[rowIndex];

          return (
            <div
              key={row.key}
              className="dispatch-allocation-popover__row"
              role="listitem"
              data-allocation-row={isMultiDay ? `${dayIndex}-${rowIndex}` : rowIndex}
            >
              <div className="dispatch-allocation-popover__row-head">
                <strong>Phân bổ {isMultiDay ? `${day.dateLabel} #${rowIndex + 1}` : rowIndex + 1}</strong>
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
              <div className="dispatch-allocation-popover__fields">
                <UuiSelectField
                  wrapperClassName="dispatch-allocation-popover__carrier"
                  controlClassName="dispatch-allocation-popover__control"
                  label="Nhà xe"
                  hint={issue?.carrier ?? (optionsLoading ? 'Đang tải danh sách nhà xe…' : undefined)}
                  value={row.carrierKey}
                  onChange={(event) => onUpdateRow(dayIndex, rowIndex, { carrierKey: event.target.value })}
                  ariaLabel={`Nhà xe dòng ${rowNum}`}
                  invalid={Boolean(issue?.carrier)}
                  disabled={optionsLoading}
                  options={options.map((option) => ({
                    label: option.label,
                    value: option.key,
                    disabled: option.isActive === false,
                  }))}
                />
                <UUIInput
                  className="dispatch-allocation-popover__count"
                  inputClassName="dispatch-allocation-popover__control"
                  type="number"
                  size="sm"
                  label="Container 20'"
                  placeholder="0"
                  hint={issue?.count20 ?? undefined}
                  isInvalid={Boolean(issue?.count20)}
                  value={row.count20}
                  onChange={(value) => onUpdateRow(dayIndex, rowIndex, { count20: value })}
                  aria-label={`Số container 20' dòng ${rowNum}`}
                  inputProps={{ min: 0, step: 1, inputMode: 'numeric' }}
                />
                <UUIInput
                  className="dispatch-allocation-popover__count"
                  inputClassName="dispatch-allocation-popover__control"
                  type="number"
                  size="sm"
                  label="Container 40'"
                  placeholder="0"
                  hint={issue?.count40 ?? undefined}
                  isInvalid={Boolean(issue?.count40)}
                  value={row.count40}
                  onChange={(value) => onUpdateRow(dayIndex, rowIndex, { count40: value })}
                  aria-label={`Số container 40' dòng ${rowNum}`}
                  inputProps={{ min: 0, step: 1, inputMode: 'numeric' }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <UUIButton
        type="button"
        size="sm"
        color="secondary"
        className="dispatch-allocation-popover__add"
        iconLeading={<Plus size={16} aria-hidden="true" />}
        onPress={() => onAddRow(dayIndex)}
        isDisabled={!canAddRow}
      >
        {isMultiDay ? `Thêm nhà xe (${day.dateLabel})` : 'Thêm nhà xe'}
      </UUIButton>
    </section>
  );
}
