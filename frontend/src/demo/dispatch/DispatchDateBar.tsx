/**
 * Thanh ngày điều vận (spec §1.1): tab ngang Hôm qua | Hôm nay | Ngày mai
 * quanh ngày demo cố định 2026-10-24, kèm nhãn thứ/ngày. SIL-156.
 */
import { Calendar } from '@untitledui/icons';
import { cx } from '@/utils/cx';
import { dateTabs, dayLabel, type DateTab } from './dispatch-model';

export function DispatchDateBar({
  todayIso,
  selectedDate,
  onSelect,
}: {
  todayIso: string;
  selectedDate: string;
  onSelect: (date: string) => void;
}) {
  const tabs: DateTab[] = dateTabs(todayIso);
  return (
    <div
      className="flex flex-wrap items-center gap-3"
      data-testid="demo-dispatch-datebar"
      role="tablist"
      aria-label="Ngày làm việc"
    >
      <div className="inline-flex items-center gap-1 rounded-xl bg-secondary p-1">
        {tabs.map((tab) => {
          const active = tab.date === selectedDate;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(tab.date)}
              className={cx(
                'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                active
                  ? 'bg-primary text-primary shadow-xs'
                  : 'text-tertiary hover:bg-primary_hover hover:text-primary',
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <span className="inline-flex items-center gap-1.5 text-sm text-tertiary">
        <Calendar className="size-4 text-quaternary" aria-hidden="true" />
        <span data-testid="demo-dispatch-day-label">{dayLabel(selectedDate)}</span>
      </span>
    </div>
  );
}
