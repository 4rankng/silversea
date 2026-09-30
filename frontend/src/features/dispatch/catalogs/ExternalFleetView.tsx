/**
 * Xe ngoài — the dispatcher+admin management page for external plates
 * (card 20260927_66, Chief ruling: dedicated /fleet/external page, no
 * schema change, both registries stay underneath).
 *
 * Union of the two registries:
 * - Dispatch catalog (carrier_fleet_vehicles): the plates the dispatch
 *   picker offers — register and toggle active here.
 * - Supplier-linked trucks (trucks.carrier_id): read-only context rows
 *   pointing at the suppliers page; tombstones included, restore lives
 *   there by law (the plate-based restore remedy shipped earlier).
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from '@untitledui/icons';
import { Breadcrumbs } from '../../../components/shared/Breadcrumbs';
import { BadgeWithDot } from '../../../components/untitled-ui/base/badges/badges';
import { Button } from '../../../components/untitled-ui/base/buttons/button';
import { Drawer } from '../../../components/UI';
import { Tabs, type TabItem } from '../../../design-system';
import { UuiSelectField } from '../../../design-system/forms/UuiSelectField';
import {
  createCarrierFleetVehicle,
  listDispatchFleetResources,
  updateCarrierFleetVehicle,
} from '../../../api/dispatchPlanningClient';
import { listAllExternalFleet } from '../../../api/externalFleetClient';
import { qk } from '../../../api/keys';
import { CatalogTableShell } from './CatalogTableShell';
import './catalogs.css';

type CatalogRow = {
  id: number;
  licensePlate: string;
  isActive: boolean;
  carrierId: number;
  carrierName: string;
  carrierStatus: string;
  updatedAt: string;
};

/**
 * Separator-insensitive plate match (15E-016.26 = 15E01626) — mirrors the
 * backend normalizePlate contract so page search agrees with resolve-carrier.
 */
function plateNeedle(needle: string): string {
  return needle.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function ExternalFleetView() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'down'>('all');
  const [registerOpen, setRegisterOpen] = useState(false);
  const [draftPlate, setDraftPlate] = useState('');
  const [draftCarrier, setDraftCarrier] = useState('');
  const [formError, setFormError] = useState('');

  const fleet = useQuery({
    queryKey: qk.externalFleet.union,
    queryFn: listAllExternalFleet,
  });

  const carriers = useQuery({
    queryKey: qk.externalFleet.carrierOptions,
    queryFn: () => listDispatchFleetResources('EXTERNAL_CARRIER', { limit: 100 }),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: qk.externalFleet.union });

  const register = useMutation({
    mutationFn: () => createCarrierFleetVehicle({
      carrierId: Number(draftCarrier),
      licensePlate: draftPlate,
    }),
    onSuccess: () => {
      setRegisterOpen(false);
      setDraftPlate('');
      setDraftCarrier('');
      setFormError('');
      invalidate();
    },
    onError: (error: unknown) => {
      setFormError(error instanceof Error ? error.message : 'Không thể thêm xe.');
    },
  });

  const toggle = useMutation({
    mutationFn: (row: CatalogRow) => updateCarrierFleetVehicle(row.id, { isActive: !row.isActive }),
    onSuccess: invalidate,
  });

  const carrierOptions = carriers.data?.items ?? [];
  const rows = fleet.data?.catalog ?? [];
  const linked = fleet.data?.linkedTrucks ?? [];

  const filtered = useMemo(() => {
    const needle = plateNeedle(search);
    const text = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter === 'active' && !row.isActive) return false;
      if (statusFilter === 'down' && row.isActive) return false;
      // Plate and carrier name are two ways to find the same row, so a query
      // matches EITHER. The branches used to be exclusive (`if (needle) …
      // else if (text) …`), and plateNeedle() is non-empty for any letters or
      // digits — so typing a carrier name ("Vận tải Hải An") took the plate
      // branch and always returned zero rows.
      if (text) {
        const plateHit = needle.length > 0 && plateNeedle(row.licensePlate).includes(needle);
        const carrierHit = row.carrierName.toLowerCase().includes(text);
        if (!plateHit && !carrierHit) return false;
      }
      return true;
    });
  }, [rows, search, statusFilter]);

  const statusTabs = useMemo<TabItem[]>(() => [
    { id: 'all', label: 'Tất cả', count: rows.length },
    { id: 'active', label: 'Hoạt động', count: rows.filter((r) => r.isActive).length, countTone: 'accent' },
    { id: 'down', label: 'Ngưng', count: rows.filter((r) => !r.isActive).length, countTone: 'warning' },
  ], [rows]);

  const openRegister = () => {
    setFormError('');
    setRegisterOpen(true);
  };

  const submitRegister = () => {
    if (!draftCarrier) {
      setFormError('Chọn nhà xe trước.');
      return;
    }
    if (plateNeedle(draftPlate).length < 5) {
      setFormError('Biển số xe không hợp lệ.');
      return;
    }
    register.mutate();
  };

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Điều độ' }, { label: 'Xe ngoài' }]} />
      {fleet.error && <div className="dispatch-catalogs__error">Không thể tải dữ liệu</div>}
      <CatalogTableShell
        title="Xe ngoài"
        tabs={(
          <Tabs
            tabs={statusTabs}
            value={statusFilter}
            onChange={(id) => setStatusFilter(id as 'all' | 'active' | 'down')}
            variant="boxed"
            ariaLabel="Lọc theo trạng thái xe ngoài"
          />
        )}
        actions={(
          <Button size="sm" color="primary" iconLeading={Plus} onPress={openRegister}>
            Thêm xe ngoài
          </Button>
        )}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Tìm biển số hoặc nhà xe…"
        totalLabel={`${filtered.length}/${rows.length} xe`}
        hasActiveFilters={statusFilter !== 'all' || search.trim() !== ''}
        onReset={() => { setStatusFilter('all'); setSearch(''); }}
      >
        {fleet.isLoading ? (
          <div className="dispatch-catalogs__empty">Đang tải…</div>
        ) : filtered.length === 0 ? (
          <div className="dispatch-catalogs__empty">
            {search.trim() ? 'Không có xe ngoài khớp tìm kiếm' : 'Chưa có xe ngoài nào trong danh mục điều phối'}
          </div>
        ) : (
          <table className="dispatch-catalogs__table">
            <thead>
              <tr>
                <th>Biển số</th>
                <th>Nhà xe</th>
                <th>Trạng thái</th>
                <th aria-label="Thao tác" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={`cat-${row.id}`}>
                  <td>{row.licensePlate}</td>
                  <td>{row.carrierName}</td>
                  <td>
                    {row.isActive
                      ? <BadgeWithDot color="success">Hoạt động</BadgeWithDot>
                      : <BadgeWithDot color="warning">Ngưng</BadgeWithDot>}
                  </td>
                  <td>
                    <Button
                      size="xs"
                      color="secondary"
                      onPress={() => toggle.mutate(row)}
                      isDisabled={toggle.isPending}
                    >
                      {row.isActive ? 'Ngưng hoạt động' : 'Kích hoạt lại'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CatalogTableShell>

      {linked.length > 0 && (
        <section>
          <h2 className="dispatch-catalogs__title" style={{ margin: '16px 0 8px', fontSize: 14, fontWeight: 600 }}>
            Xe nội bộ liên kết nhà thầu — quản lý tại trang Nhà thầu phụ
          </h2>
          <table className="dispatch-catalogs__table">
            <thead>
              <tr>
                <th>Biển số</th>
                <th>Nhà thầu</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {linked.map((row) => (
                <tr key={`truck-${row.id}`}>
                  <td>{row.licensePlate}</td>
                  <td>{row.carrierName}</td>
                  <td>
                    {row.tombstonedAt
                      ? <BadgeWithDot color="warning">Đã xóa — khôi phục tại Nhà thầu phụ</BadgeWithDot>
                      : row.status === 'ACTIVE'
                        ? <BadgeWithDot color="success">Hoạt động</BadgeWithDot>
                        : <BadgeWithDot color="warning">Ngưng</BadgeWithDot>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: 12, color: 'var(--text-secondary, #64748b)', margin: '8px 0 0' }}>
            Xe của nhà thầu được liên kết ở trang Nhà thầu phụ; trang này chỉ đọc.
          </p>
        </section>
      )}

      <Drawer
        isOpen={registerOpen}
        onClose={() => setRegisterOpen(false)}
        title="Thêm xe ngoài"
        subtitle="Xe ngoài khả dụng ngay cho picker điều phối"
        className="dispatch-catalogs__dialog"
        footer={(
          <>
            <Button size="sm" color="secondary" onPress={() => setRegisterOpen(false)}>Hủy</Button>
            <Button size="sm" color="primary" onPress={submitRegister} isDisabled={register.isPending}>Thêm</Button>
          </>
        )}
      >
        {formError && <div className="dispatch-catalogs__error">{formError}</div>}
        <UuiSelectField
          label="Nhà xe"
          hideLabel
          ariaLabel="Nhà xe"
          wrapperClassName="dispatch-catalogs__drawer-select"
          value={draftCarrier}
          onChange={(e) => setDraftCarrier(e.target.value)}
          options={[
            { value: '', label: 'Nhà xe: Chọn nhà xe' },
            ...carrierOptions.map((c) => ({ value: String(c.id), label: c.name })),
          ]}
        />
        <input
          className="dispatch-catalogs__input"
          placeholder="Biển số (VD: 29A-12.34)"
          value={draftPlate}
          onChange={(e) => setDraftPlate(e.target.value)}
        />
      </Drawer>
    </div>
  );
}
