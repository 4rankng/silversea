import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Role, ShipmentStatus } from '@tingting/shared';
import { listShipments } from '../api/shipmentClient';
import { userClient, type UsersResponse } from '../api/userClient';
import { qk } from '../api/keys';
import { useAuth } from '../hooks/useAuth';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { useTableQueryState } from '../design-system/hooks/useTableQueryState';
import { useAllCustomers } from '../hooks/useCatalogQueries';
import { useUserMutations } from '../features/users/hooks/useUserMutations';
import { UserTable } from '../features/users/components/UserTable';
import { AddPanel, EditPanel } from '../features/users/components/UserForm';
import { BUSINESS_UNIT_STATUS_LABELS } from '../features/users/utils';
import type { UserRow, FilterKey } from '../features/users/utils';
import { usePageAnimations } from '../hooks/animations';
import { useToast } from '../components/shared/Toast';
import '../features/users/users.css';

async function loadAllShipmentScopeOptions() {
  const limit = 200;
  let page = 1;
  let total = 0;
  const items: Awaited<ReturnType<typeof listShipments>>['items'] = [];
  do {
    const response = await listShipments({ page, limit });
    total = response.total;
    items.push(...response.items);
    page += 1;
  } while (items.length < total);
  const activeShipmentStatuses = new Set<ShipmentStatus>([
    ShipmentStatus.NEW,
    ShipmentStatus.PENDING_DATE,
    ShipmentStatus.READY_FOR_DISPATCH,
    ShipmentStatus.DISPATCHED,
    ShipmentStatus.IN_TRANSIT,
  ]);
  return {
    items: items.filter(
      (shipment) => activeShipmentStatuses.has(shipment.status),
    ),
  };
}

/** Server-driven filter/sort bag for the users table (search/page/limit owned by the hook). */
type UsersTableFilters = {
  role?: string;
  sortBy?: 'name' | 'role' | 'status' | 'date';
  sortOrder?: 'asc' | 'desc';
};

export default function UsersPage() {
  const { user: me } = useAuth();
  const canManage = me?.capabilities
    ? me.capabilities.includes('manage_users')
    : me?.role === Role.ADMIN || me?.role === Role.MANAGER;
  const canManageClerkScope = me?.role === Role.ADMIN;
  const canManageBusinessUnits = me?.role === Role.ADMIN;
  const canDelete = me?.role === Role.ADMIN;
  // Accountants get scoped /users access: read-only except DRIVER rows (salary/truck/contact).
  const canEditDriversOnly = !canManage && me?.role === Role.ACCOUNTANT;
  const { toast } = useToast();

  const usersTable = useTableQueryState<UserRow, UsersTableFilters, UsersResponse>({
    endpoint: (params) => userClient.getUsers(params),
    queryKey: qk.catalogs.users,
    defaultPageSize: 10,
  });
  const { rows: paginated, total: filteredTotal, query: usersQuery } = usersTable;
  const usersData = usersQuery.data;
  const loading = usersTable.isLoading;
  const refetchUsers = usersQuery.refetch;
  const businessUnits = useMemo(() => usersData?.businessUnits ?? [], [usersData]);
  const counts = usersData?.counts;
  const { rootRef } = usePageAnimations({ ready: !loading });

  // Load trucks once for the driver "Xe phân công" field + the table "Xe" plate
  // column — reuses the combined trucks+drivers cache (qk.catalogs.trucksDrivers).
  const { data: customerList = [] } = useAllCustomers();
  const { data: shipmentScopeData } = useQuery({
    queryKey: qk.catalogs.userScopeShipments,
    queryFn: loadAllShipmentScopeOptions,
    staleTime: 60 * 1000,
    enabled: canManageClerkScope,
  });
  const shipmentOptions = shipmentScopeData?.items ?? [];
  const businessUnitMap = useMemo(
    () => new Map(businessUnits.map((unit) => [unit.id, unit.name])),
    [businessUnits],
  );

  const {
    saving, panelError, deleting, confirmDialog,
    doCreate, doUpdate, doDelete, clearPanelError,
  } = useUserMutations(refetchUsers);

  // Filter/sort/search/page state lives in usersTable; search is debounced and
  // every filter/sort change resets to page 1 inside the hook.
  const filter = (usersTable.filters.role as FilterKey | undefined) ?? 'all';
  const search = usersTable.search;
  const sortBy = usersTable.filters.sortBy ?? null;
  const sortOrder = usersTable.filters.sortOrder ?? 'asc';
  const currentPage = usersTable.page;
  const pageSize = usersTable.pageSize;

  const [showAdd, setShowAdd] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [unitDraft, setUnitDraft] = useState({ code: '', name: '' });
  const [editingUnitId, setEditingUnitId] = useState<number | null>(null);
  const [savingUnit, setSavingUnit] = useState(false);
  const [unitError, setUnitError] = useState<string | null>(null);

  const handleFilterChange = (f: FilterKey) => {
    usersTable.setFilter('role', f === 'all' ? undefined : f);
  };

  const handleSearchChange = usersTable.setSearch;

  const handleSort = (field: 'name' | 'role' | 'status' | 'date') => {
    const nextOrder = sortBy === field
      ? (sortOrder === 'asc' ? 'desc' : 'asc')
      : 'asc';
    usersTable.setFilters({ ...usersTable.filters, sortBy: field, sortOrder: nextOrder });
  };

  const openEdit = (u: UserRow) => { clearPanelError(); setEditingUser(u); setShowAdd(false); };
  const openAdd  = () => { clearPanelError(); setShowAdd(true); setEditingUser(null); };
  const closeAdd  = () => { setShowAdd(false); clearPanelError(); };
  const closeEdit = () => { setEditingUser(null); clearPanelError(); };

  async function handleSaveBusinessUnit() {
    if (!canManageBusinessUnits) return;
    if (!unitDraft.name.trim()) {
      setUnitError('Tên đơn vị là bắt buộc.');
      return;
    }
    setSavingUnit(true);
    setUnitError(null);
    try {
      if (editingUnitId != null) {
        await userClient.updateBusinessUnit(editingUnitId, {
          code: unitDraft.code.trim() || null,
          name: unitDraft.name.trim(),
        });
        toast({ kind: 'success', message: 'Đã cập nhật đơn vị phụ trách' });
      } else {
        await userClient.createBusinessUnit({
          code: unitDraft.code.trim() || null,
          name: unitDraft.name.trim(),
        });
        toast({ kind: 'success', message: 'Đã tạo đơn vị phụ trách' });
      }
      setUnitDraft({ code: '', name: '' });
      setEditingUnitId(null);
      await refetchUsers();
    } catch (err) {
      setUnitError(err instanceof Error ? err.message : 'Không thể lưu đơn vị phụ trách');
    } finally {
      setSavingUnit(false);
    }
  }

  async function handleDeactivateBusinessUnit(id: number) {
    if (!canManageBusinessUnits) return;
    setSavingUnit(true);
    setUnitError(null);
    try {
      await userClient.deactivateBusinessUnit(id);
      toast({ kind: 'success', message: 'Đã ngưng sử dụng đơn vị phụ trách' });
      if (editingUnitId === id) {
        setEditingUnitId(null);
        setUnitDraft({ code: '', name: '' });
      }
      await refetchUsers();
    } catch (err) {
      setUnitError(err instanceof Error ? err.message : 'Không thể ngưng sử dụng đơn vị phụ trách');
    } finally {
      setSavingUnit(false);
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
        <div className="spin" style={{ width: 28, height: 28, border: '3px solid var(--line-2)', borderTopColor: 'var(--brand)', borderRadius: '50%' }} />
      </div>
    );
  }

  return (
    <div className="users-admin-page" style={{ paddingBottom: 40 }} ref={rootRef}>
      <Breadcrumbs
        className="users-admin-page__crumbs"
        items={[
          { label: 'Tổng quan', to: '/dashboard' },
          { label: 'Người dùng' },
        ]}
      />
      <UserTable
        paginated={paginated}
        filteredTotal={filteredTotal}
        roleCounts={counts?.byRole}
        total={counts?.total ?? filteredTotal}
        staffCount={counts?.staffCount ?? 0}
        driverCount={counts?.driverCount ?? 0}
        inactiveCount={counts?.inactiveCount ?? 0}
        filter={filter}
        search={search}
        canManage={canManage}
        canDelete={canDelete}
        canEditDriversOnly={canEditDriversOnly}
        businessUnitMap={businessUnitMap}
        deleting={deleting}
        currentUserId={me?.userId}
        onFilterChange={handleFilterChange}
        onSearchChange={handleSearchChange}
        onEdit={openEdit}
        onDelete={doDelete}
        onAdd={openAdd}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSort={handleSort}
        currentPage={currentPage}
        pageSize={pageSize}
        onPageChange={usersTable.setPage}
      />

      <AddPanel
        isOpen={showAdd}
        saving={saving}
        error={panelError}
        customerList={customerList}
        businessUnits={businessUnits}
        shipmentOptions={shipmentOptions}
        canManageClerkScope={canManageClerkScope}
        onClose={closeAdd}
        onSave={doCreate}
      />
      {editingUser && (
        <EditPanel
          isOpen={!!editingUser}
          user={editingUser}
          isMe={editingUser.id === me?.userId}
          saving={saving}
          error={panelError}
          customerList={customerList}
          businessUnits={businessUnits}
          shipmentOptions={shipmentOptions}
          canManageClerkScope={canManageClerkScope}
          canEditDriversOnly={canEditDriversOnly}
          onClose={closeEdit}
          onSave={doUpdate}
        />
      )}

      {canManageBusinessUnits && (
        <section className="business-units">
          <div className="business-units__header">
            <div>
              <h2 className="business-units__title">Đơn vị phụ trách</h2>
              <p className="business-units__subtitle">
                Ngừng sử dụng để ẩn đơn vị khỏi các lựa chọn mới. Lịch sử và các liên kết hiện có vẫn được giữ nguyên.
              </p>
            </div>
          </div>

          <div className="business-units__form-grid">
            <label className="business-units__form-label">
              <span>Mã đơn vị</span>
              <input
                className="input"
                value={unitDraft.code}
                onChange={(event) => setUnitDraft((current) => ({ ...current, code: event.target.value }))}
                placeholder="Ví dụ: HCM"
                disabled={savingUnit}
              />
            </label>
            <label className="business-units__form-label">
              <span>Tên đơn vị</span>
              <input
                className="input"
                value={unitDraft.name}
                onChange={(event) => setUnitDraft((current) => ({ ...current, name: event.target.value }))}
                placeholder="Ví dụ: Điều hành miền Nam"
                disabled={savingUnit}
              />
            </label>
          </div>

          <div className="business-units__actions">
            <button type="button" onClick={handleSaveBusinessUnit} disabled={savingUnit} className="btn btn-primary">
              {editingUnitId != null ? 'Lưu đơn vị' : 'Tạo đơn vị'}
            </button>
            {editingUnitId != null && (
              <button
                type="button"
                onClick={() => {
                  setEditingUnitId(null);
                  setUnitDraft({ code: '', name: '' });
                  setUnitError(null);
                }}
                disabled={savingUnit}
                className="btn btn-ghost"
              >
                Hủy sửa
              </button>
            )}
          </div>

          {unitError && <div className="users-error-banner">{unitError}</div>}

          <div className="business-units__list">
            {businessUnits.map((unit) => (
              <article
                key={unit.id}
                className="business-units__card"
              >
                <div>
                  <strong>{unit.name}</strong>
                  <div className="business-units__card-meta">
                    {unit.code ? `Mã ${unit.code}` : 'Không có mã'} · {BUSINESS_UNIT_STATUS_LABELS[unit.status]}
                  </div>
                </div>
                <div className="business-units__card-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      setEditingUnitId(unit.id);
                      setUnitDraft({ code: unit.code ?? '', name: unit.name });
                      setUnitError(null);
                    }}
                    disabled={savingUnit}
                  >
                    Sửa
                  </button>
                  {unit.status === 'ACTIVE' && (
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => handleDeactivateBusinessUnit(unit.id)}
                      disabled={savingUnit}
                    >
                      Ngưng dùng
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {confirmDialog}
    </div>
  );
}
