/**
 * Bộ lọc & tác vụ (spec §1.1, SIL-156): 3 dropdown (khách hàng, loại hình,
 * nguồn xe) + ô tìm kiếm (Số Cont / Booking / Biển số) + view switcher
 * (Lưới Điều Hành | Lịch Trình Đầu Xe) + nút Tạo Chuyến Mới.
 */
import { Calendar, LayoutGrid01, Plus, SearchLg } from '@untitledui/icons';
import { Button } from '@/components/untitled-ui/base/buttons/button';
import { InputBase } from '@/components/untitled-ui/base/input/input';
import { UuiSelectField } from '@/design-system/forms/UuiSelectField';
import { cx } from '@/utils/cx';
import { demoCustomers } from '../data/seed';
import type { DispatchFilters } from './dispatch-model';

export type DispatchView = 'grid' | 'timeline';

const customerOptions = [
  { label: 'Tất cả khách hàng', value: 'all' },
  ...demoCustomers.map((c) => ({ label: `${c.code} — ${c.name}`, value: c.id })),
];

const flowOptions = [
  { label: 'Mọi loại hình', value: 'all' },
  { label: 'Hàng Xuất', value: 'export' },
  { label: 'Hàng Nhập', value: 'import' },
];

const sourceOptions = [
  { label: 'Mọi nguồn xe', value: 'all' },
  { label: 'Xe nhà', value: 'inhouse' },
  { label: 'Xe ngoài', value: 'vendor' },
];

function FilterSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { label: string; value: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="w-44">
      <UuiSelectField
        label={label}
        ariaLabel={`Lọc ${label.toLowerCase()}`}
        hideLabel
        searchable={false}
        options={options}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function DispatchFilters({
  filters,
  onFiltersChange,
  view,
  onViewChange,
  onCreate,
}: {
  filters: DispatchFilters;
  onFiltersChange: (next: DispatchFilters) => void;
  view: DispatchView;
  onViewChange: (view: DispatchView) => void;
  onCreate: () => void;
}) {
  const patch = (part: Partial<DispatchFilters>) => onFiltersChange({ ...filters, ...part });

  return (
    <div className="flex flex-wrap items-center gap-2.5" data-testid="demo-dispatch-filters">
      <FilterSelect
        label="Khách hàng"
        options={customerOptions}
        value={filters.customerId}
        onChange={(customerId) => patch({ customerId })}
      />
      <FilterSelect
        label="Loại hình"
        options={flowOptions}
        value={filters.flow}
        onChange={(flow) => patch({ flow: flow as DispatchFilters['flow'] })}
      />
      <FilterSelect
        label="Nguồn xe"
        options={sourceOptions}
        value={filters.source}
        onChange={(source) => patch({ source: source as DispatchFilters['source'] })}
      />
      <div className="w-full sm:w-72">
        <InputBase
          icon={SearchLg}
          placeholder="Số Cont / Mã Booking / Biển số…"
          aria-label="Tìm chuyến"
          value={filters.query}
          onChange={(e) => patch({ query: e.target.value })}
        />
      </div>

      <div className="ml-auto flex items-center gap-2.5">
        <div
          className="inline-flex items-center gap-1 rounded-xl bg-secondary p-1"
          role="tablist"
          aria-label="Chế độ hiển thị"
        >
          {(
            [
              { key: 'grid', label: 'Lưới Điều Hành', Icon: LayoutGrid01 },
              { key: 'timeline', label: 'Lịch Trình Đầu Xe', Icon: Calendar },
            ] as const
          ).map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              data-testid={`demo-view-${key}`}
              onClick={() => onViewChange(key)}
              className={cx(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                view === key
                  ? 'bg-primary text-primary shadow-xs'
                  : 'text-tertiary hover:bg-primary_hover hover:text-primary',
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              <span className="hidden md:inline">{label}</span>
            </button>
          ))}
        </div>
        <Button
          color="primary"
          iconLeading={Plus}
          onPress={onCreate}
          data-testid="demo-dispatch-create"
        >
          Tạo Chuyến Mới
        </Button>
      </div>
    </div>
  );
}
