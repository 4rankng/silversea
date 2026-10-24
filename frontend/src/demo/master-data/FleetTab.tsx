/**
 * Tab Đội xe nội bộ (SIL-161, spec PHÂN HỆ 4.1): bảng đầu kéo đội nhà —
 * BKS · tài xế mặc định · SĐT · CCCD · hạng GPL · rơ-moóc — với chips ghép
 * cặp mặc định [Đầu kéo + Rơ-moóc + Tài xế] gắn theo từng xe, tìm kiếm và
 * thêm đầu kéo mới. Demo-only: thêm/sửa nằm trong state fixtures của phiên.
 */
import { useMemo, useState } from 'react';
import { Plus, SearchLg } from '@untitledui/icons';
import { Badge } from '@/components/untitled-ui/base/badges/badges';
import { Button } from '@/components/untitled-ui/base/buttons/button';
import { Input, InputBase } from '@/components/untitled-ui/base/input/input';
import { UuiSelectField } from '@/design-system/forms/UuiSelectField';
import { removeDiacritics } from '@/lib/format';
import { demoDrivers, demoTrucks, type DemoDriver, type DemoTruck } from '../data';

interface FleetTabProps {
  drivers?: readonly DemoDriver[];
}

interface AddFormState {
  plate: string;
  model: string;
  trailerPlate: string;
  defaultDriverId: string;
}

const EMPTY_FORM: AddFormState = { plate: '', model: '', trailerPlate: '', defaultDriverId: '' };

function nextTruckId(existing: readonly DemoTruck[]): string {
  const max = existing.reduce((acc, truck) => {
    const n = Number.parseInt(truck.id.replace(/^TRK-/, ''), 10);
    return Number.isFinite(n) ? Math.max(acc, n) : acc;
  }, 0);
  return `TRK-${String(max + 1).padStart(2, '0')}`;
}

export function FleetTab({ drivers = demoDrivers }: FleetTabProps) {
  const [trucks, setTrucks] = useState<readonly DemoTruck[]>(demoTrucks);
  const [query, setQuery] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<AddFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  const driverById = useMemo(
    () => new Map(drivers.map((driver) => [driver.id, driver])),
    [drivers],
  );

  const filtered = useMemo(() => {
    const needle = removeDiacritics(query.trim().toLowerCase());
    if (needle === '') return trucks;
    return trucks.filter((truck) => {
      const driver = driverById.get(truck.defaultDriverId);
      const haystack = removeDiacritics(
        [truck.plate, truck.model, truck.trailerPlate, driver?.fullName, driver?.phone]
          .filter(Boolean)
          .join(' ')
          .toLowerCase(),
      );
      return haystack.includes(needle);
    });
  }, [trucks, query, driverById]);

  const submitAdd = () => {
    const plate = form.plate.trim();
    const trailerPlate = form.trailerPlate.trim();
    if (!plate || !trailerPlate || !form.defaultDriverId) {
      setFormError('Vui lòng nhập BKS đầu kéo, BKS rơ-moóc và chọn tài xế mặc định.');
      return;
    }
    const duplicate = trucks.find(
      (truck) => truck.plate === plate || truck.trailerPlate === trailerPlate,
    );
    if (duplicate) {
      setFormError(
        duplicate.plate === plate
          ? `BKS đầu kéo ${plate} đã tồn tại trong đội xe.`
          : `BKS rơ-moóc ${trailerPlate} đã tồn tại trong đội xe.`,
      );
      return;
    }
    const truck: DemoTruck = {
      id: nextTruckId(trucks),
      plate,
      model: form.model.trim() || 'Chưa rõ model',
      trailerPlate,
      defaultDriverId: form.defaultDriverId,
    };
    setTrucks((current) => [...current, truck]);
    setForm(EMPTY_FORM);
    setFormError(null);
    setFormOpen(false);
  };

  return (
    <section aria-label="Đội xe nội bộ" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full sm:w-72">
          <InputBase
            icon={SearchLg}
            size="sm"
            placeholder="Tìm BKS, tài xế, SĐT, rơ-moóc…"
            aria-label="Tìm kiếm đầu kéo"
            data-testid="fleet-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <p className="text-sm text-tertiary" data-testid="fleet-count">
          {filtered.length}/{trucks.length} đầu kéo
        </p>
        <Button
          color="primary"
          iconLeading={Plus}
          className="ml-auto"
          data-testid="fleet-add-toggle"
          onPress={() => {
            setFormOpen((open) => !open);
            setFormError(null);
          }}
        >
          Thêm đầu kéo
        </Button>
      </div>

      {formOpen && (
        <form
          data-testid="fleet-add-form"
          className="grid gap-3 rounded-xl border border-secondary_alt bg-primary p-4 shadow-xs sm:grid-cols-2 xl:grid-cols-5"
          onSubmit={(event) => {
            event.preventDefault();
            submitAdd();
          }}
        >
          <Input
            size="sm"
            label="BKS đầu kéo"
            placeholder="51C-000.00"
            data-testid="fleet-add-plate"
            value={form.plate}
            onChange={(value) => setForm((current) => ({ ...current, plate: value }))}
          />
          <Input
            size="sm"
            label="Model"
            placeholder="Hino 700"
            data-testid="fleet-add-model"
            value={form.model}
            onChange={(value) => setForm((current) => ({ ...current, model: value }))}
          />
          <Input
            size="sm"
            label="BKS rơ-moóc"
            placeholder="51R-000.00"
            data-testid="fleet-add-trailer"
            value={form.trailerPlate}
            onChange={(value) => setForm((current) => ({ ...current, trailerPlate: value }))}
          />
          <UuiSelectField
            label="Tài xế mặc định"
            size="sm"
            searchable={false}
            placeholder="— Chọn tài xế —"
            value={form.defaultDriverId}
            onChange={(event) =>
              setForm((current) => ({ ...current, defaultDriverId: event.target.value }))
            }
            options={[
              { label: '— Chọn tài xế —', value: '' },
              ...drivers.map((driver) => ({ label: driver.fullName, value: driver.id })),
            ]}
          />
          <div className="flex items-end gap-2">
            <Button type="submit" color="primary" data-testid="fleet-add-submit">
              Thêm
            </Button>
            <Button
              color="tertiary"
              data-testid="fleet-add-cancel"
              onPress={() => {
                setFormOpen(false);
                setFormError(null);
              }}
            >
              Hủy
            </Button>
          </div>
          {formError && (
            <p className="text-sm text-error-primary sm:col-span-2 xl:col-span-5" data-testid="fleet-add-error" role="alert">
              {formError}
            </p>
          )}
        </form>
      )}

      <div className="overflow-x-auto rounded-xl border border-secondary_alt bg-primary shadow-xs">
        <table className="w-full min-w-[880px] border-collapse text-left" data-testid="fleet-table">
          <thead>
            <tr className="border-b border-secondary_alt bg-secondary text-tertiary">
              <th className="px-4 py-2.5">Đầu kéo</th>
              <th className="px-4 py-2.5">Tài xế mặc định</th>
              <th className="px-4 py-2.5">SĐT</th>
              <th className="px-4 py-2.5">CCCD</th>
              <th className="px-4 py-2.5">Hạng GPL</th>
              <th className="px-4 py-2.5">Rơ-moóc</th>
              <th className="px-4 py-2.5">Cặp mặc định</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((truck) => {
              const driver = driverById.get(truck.defaultDriverId);
              return (
                <tr
                  key={truck.id}
                  data-testid={`fleet-row-${truck.plate}`}
                  className="border-b border-secondary_alt last:border-b-0 hover:bg-secondary_hover"
                >
                  <td className="px-4 py-2.5">
                    <div className="flex flex-col">
                      <span className="font-semibold text-primary">{truck.plate}</span>
                      <span className="text-xs text-tertiary">{truck.model}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-secondary">{driver?.fullName ?? '—'}</td>
                  <td className="px-4 py-2.5 tabular-nums text-secondary">{driver?.phone ?? '—'}</td>
                  <td className="px-4 py-2.5 tabular-nums text-secondary">{driver?.idNumber ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    {driver && (
                      <Badge type="pill-color" color="brand" size="sm">
                        Hạng {driver.licenseClass}
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-secondary">{truck.trailerPlate}</td>
                  <td className="px-4 py-2.5">
                    <div
                      className="flex flex-wrap items-center gap-1.5"
                      data-testid={`fleet-pair-${truck.plate}`}
                      aria-label={`Cặp mặc định ${truck.plate}`}
                    >
                      <Badge type="pill-color" color="gray" size="sm">{truck.plate}</Badge>
                      <span aria-hidden="true" className="text-quaternary">+</span>
                      <Badge type="pill-color" color="gray" size="sm">{truck.trailerPlate}</Badge>
                      <span aria-hidden="true" className="text-quaternary">+</span>
                      <Badge type="pill-color" color="success" size="sm">{driver?.fullName ?? '—'}</Badge>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-tertiary" data-testid="fleet-empty">
                  Không có đầu kéo nào khớp “{query}”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-quaternary">
        Chips ghép cặp mặc định tự động điền khi điều vận phân xe — dữ liệu demo, chỉ lưu trong phiên.
      </p>
    </section>
  );
}
