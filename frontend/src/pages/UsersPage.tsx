import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Role, ShipmentStatus } from '@tingting/shared';
import type { Customer, Truck } from '@tingting/shared';
import { listShipments } from '../api/shipmentClient';
import { userClient } from '../api/userClient';
import { useAuth } from '../hooks/useAuth';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { useUsers } from '../hooks/useCatalogQueries';
import { configClient } from '../api/configClient';
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

  const { data: usersData, isLoading: loading, refetch: refetchUsers } = useUsers();
  const { rootRef } = usePageAnimations({ ready: !loading });
  const users = useMemo(() => (usersData?.items ?? []) as UserRow[], [usersData]);
  const businessUnits = useMemo(() => usersData?.businessUnits ?? [], [usersData]);

  // Load trucks once for the driver "Xe phân công" field + the table "Xe" plate column.
  // Shares cache with useTrucksAndDrivers by using a common query key prefix.
  const { data: truckList = [] } = useQuery<Truck[]>({
    // eslint-disable-next-line @tingting/no-bare-query-key -- standalone trucks list; no matching qk domain key exists
    queryKey: ['trucks'],
    queryFn: () => configClient.getTrucks(),
    staleTime: 5 * 60 * 1000,
  });
  const { data: customerList = [] } = useQuery<Customer[]>({
    // eslint-disable-next-line @tingting/no-bare-query-key -- user-scope catalog has no dedicated qk domain key
    queryKey: ['customers', 'user-scope'],
    queryFn: () => configClient.getAllCustomers(),
    staleTime: 5 * 60 * 1000,
  });
  const { data: shipmentScopeData } = useQuery({
    // eslint-disable-next-line @tingting/no-bare-query-key -- admin-only drawer assignment options are local to the users page
    queryKey: ['shipments', 'user-scope'],
    queryFn: loadAllShipmentScopeOptions,
    staleTime: 60 * 1000,
    enabled: canManageClerkScope,
  });
  const shipmentOptions = shipmentScopeData?.items ?? [];
  const truckMap = useMemo(() => {
    const m = new Map<number, string>();
    truckList.forEach(t => m.set(t.id, t.licensePlate));
    return m;
  }, [truckList]);
  const customerMap = useMemo(
    () => new Map(customerList.map(customer => [customer.id, customer.name])),
    [customerList],
  );
  const businessUnitMap = useMemo(
    () => new Map(businessUnits.map((unit) => [unit.id, unit.name])),
    [businessUnits],
  );

  const {
    saving, panelError, deleting, confirmDialog,
    doCreate, doUpdate, doDelete, clearPanelError,
  } = useUserMutations(refetchUsers);

  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [unitDraft, setUnitDraft] = useState({ code: '', name: '' });
  const [editingUnitId, setEditingUnitId] = useState<number | null>(null);
  const [savingUnit, setSavingUnit] = useState(false);
  const [unitError, setUnitError] = useState<string | null>(null);

  // Sorting and pagination state
  const [sortBy, setSortBy] = useState<'name' | 'role' | 'status' | 'date' | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  const handleFilterChange = (f: FilterKey) => {
    setFilter(f);
    setCurrentPage(1);
  };

  const handleSearchChange = (s: string) => {
    setSearch(s);
    setCurrentPage(1);
  };

  const handleSort = (field: 'name' | 'role' | 'status' | 'date') => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
    setCurrentPage(1);
  };

  const { total, staffCount, driverCount, inactiveCount, filtered, paginated } = useMemo(() => {
    const total        = users.length;
    const staffCount   = users.filter(u => [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT].includes(u.role)).length;
    const driverCount  = users.filter(u => u.role === Role.DRIVER).length;
    const inactiveCount = users.filter(u => u.status !== 'ACTIVE').length;

    let filtered = users
      .filter(u => filter === 'all' || u.role === filter)
      .filter(u => {
        if (!search) return true;
        const q = search.toLowerCase();
        return (u.username || '').toLowerCase().includes(q)
          || (u.fullName || '').toLowerCase().includes(q)
          || (u.email || '').toLowerCase().includes(q)
          || (u.phone || '').includes(q);
      });

    if (sortBy) {
      filtered = [...filtered].sort((a, b) => {
        let valA: string | number = '';
        let valB: string | number = '';
        if (sortBy === 'name') {
          valA = (a.fullName || a.username || '').toLowerCase();
          valB = (b.fullName || b.username || '').toLowerCase();
        } else if (sortBy === 'role') {
          valA = a.role;
          valB = b.role;
        } else if (sortBy === 'status') {
          valA = a.status;
          valB = b.status;
        } else if (sortBy === 'date') {
          valA = new Date(a.createdAt).getTime();
          valB = new Date(b.createdAt).getTime();
        }

        if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
        if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
        return 0;
      });
    }

    const startIndex = (currentPage - 1) * pageSize;
    const paginated = filtered.slice(startIndex, startIndex + pageSize);

    return { total, staffCount, driverCount, inactiveCount, filtered, paginated };
  }, [users, filter, search, sortBy, sortOrder, currentPage]);

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
        users={users}
        filtered={filtered}
        paginated={paginated}
        total={total}
        staffCount={staffCount}
        driverCount={driverCount}
        inactiveCount={inactiveCount}
        filter={filter}
        search={search}
        canManage={canManage}
        canDelete={canDelete}
        canEditDriversOnly={canEditDriversOnly}
        truckMap={truckMap}
        customerMap={customerMap}
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
        onPageChange={setCurrentPage}
      />

      <AddPanel
        isOpen={showAdd}
        saving={saving}
        error={panelError}
        truckList={truckList}
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
          truckList={truckList}
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
        <section
          style={{
            marginTop: 24,
            padding: 16,
            borderRadius: 12,
            border: '1px solid var(--line-2)',
            background: 'var(--panel, #fff)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Đơn vị phụ trách</h2>
              <p style={{ margin: '4px 0 0', color: 'var(--fg-3)', fontSize: 14 }}>
                Ngừng sử dụng để ẩn đơn vị khỏi các lựa chọn mới. Lịch sử và các liên kết hiện có vẫn được giữ nguyên.
              </p>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginBottom: 12 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span>Mã đơn vị</span>
              <input
                className="input"
                value={unitDraft.code}
                onChange={(event) => setUnitDraft((current) => ({ ...current, code: event.target.value }))}
                placeholder="Ví dụ: HCM"
                disabled={savingUnit}
              />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
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

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
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

          <div style={{ display: 'grid', gap: 10 }}>
            {businessUnits.map((unit) => (
              <article
                key={unit.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: 12,
                  borderRadius: 10,
                  border: '1px solid var(--line-2)',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}
              >
                <div>
                  <strong>{unit.name}</strong>
                  <div style={{ color: 'var(--fg-3)', fontSize: 13 }}>
                    {unit.code ? `Mã ${unit.code}` : 'Không có mã'} · {BUSINESS_UNIT_STATUS_LABELS[unit.status]}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
