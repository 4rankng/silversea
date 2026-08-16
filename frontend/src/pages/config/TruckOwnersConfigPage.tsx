/**
 * F3 — Per-vehicle profit-ownership editor.
 *
 * Each truck has its own owner list (`truck_cap_table`); that truck's quarter
 * profit distributes to its owners by %. The entity distribution is the
 * derived sum across trucks. This page is scoped to one truck via the
 * `/config/trucks/:truckId/owners` route.
 *
 * The backend `/truck-cap` CRUD is a flat list (the factory doesn't
 * filter by truckId), so we fetch all rows and filter client-side. Per-truck
 * cap tables are small, so this is fine; if a truck's owner history grows
 * large, add server-side truckId filtering to the CRUD factory.
 */
import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus } from 'lucide-react';
import { api } from '../../lib/api/client';
import { PageHeader, Panel, useConfirm, StatusPill } from '../../components/UI';
import { InlineForm } from '../../components/config/InlineForm';
import { FormActions } from '../../components/config/FormActions';
import { Field } from '../../components/config/Field';
import { useToast } from '../../components/shared/Toast';
import { DateInput } from '../../design-system/forms/DateInput';
import { usePageAnimations } from '../../hooks/animations';
import { useBackShortcut } from '../../hooks/useBackShortcut';
import type { TruckCapEntry, PaginatedResponse, Truck } from '@tingting/shared';
import { TruckCapRole, TRUCK_CAP_ROLE_LABELS } from '@tingting/shared';
import { qk } from '../../api/keys';
import './config-page.css';

const ENDPOINT = '/truck-cap';

function TruckOwnerForm({ saving, item, onsave, oncancel }: {
  saving: boolean; item?: TruckCapEntry; onsave: (d: Record<string, unknown>) => void; oncancel: () => void;
}) {
  const [partnerName, setPartnerName] = useState(item?.partnerName || '');
  const [percentage, setPercentage] = useState(item ? String(item.percentage) : '');
  const [role, setRole] = useState<TruckCapRole>(item?.role ?? TruckCapRole.INVESTOR);
  const [effectiveDate, setEffectiveDate] = useState(item ? item.effectiveDate.split('T')[0] : '');
  return (
    <InlineForm colSpan={5}>
      <div style={{ flex: 2, minWidth: 180 }}>
        <Field label="Tên đối tác sở hữu">
          <input className="input" value={partnerName} onChange={e => setPartnerName(e.target.value)} placeholder="Nhập tên đối tác…" />
        </Field>
      </div>
      <div style={{ flex: 1, minWidth: 120 }}>
        <Field label="Tỷ lệ sở hữu (%)">
          <input className="input" type="number" step="0.01" min="0" max="100" value={percentage} onChange={e => setPercentage(e.target.value)} placeholder="0" />
        </Field>
      </div>
      <div style={{ flex: 1.2, minWidth: 140 }}>
        <Field label="Vai trò">
          <select className="input" value={role} onChange={e => setRole(e.target.value as TruckCapRole)}>
            <option value={TruckCapRole.INVESTOR}>{TRUCK_CAP_ROLE_LABELS[TruckCapRole.INVESTOR]} (góp vốn)</option>
            <option value={TruckCapRole.DRIVER}>{TRUCK_CAP_ROLE_LABELS[TruckCapRole.DRIVER]}</option>
          </select>
        </Field>
      </div>
      <div style={{ flex: 1.4, minWidth: 150 }}>
        <Field label="Ngày hiệu lực">
          <DateInput className="input" value={effectiveDate} onChange={setEffectiveDate} />
        </Field>
      </div>
      <FormActions saving={saving} isedit={!!item} oncancel={oncancel} onsave={() => {
        if (!partnerName.trim() || percentage === '' || !effectiveDate) return;
        onsave({ partnerName: partnerName.trim(), percentage: Number(percentage), role, effectiveDate });
      }} />
    </InlineForm>
  );
}

/** Active snapshot ids for a truck: latest effectiveDate ≤ today, dedupe by partner (newest createdAt). */
function computeActiveIds(items: TruckCapEntry[]): Set<number> {
  if (!items.length) return new Set();
  const today = new Date().toISOString().slice(0, 10);
  const reached = items.filter(c => c.effectiveDate <= today);
  const pool = reached.length > 0 ? reached : items;
  const latestDate = pool.reduce((a, c) => (c.effectiveDate > a ? c.effectiveDate : a), pool[0].effectiveDate);
  const byName = new Map<string, TruckCapEntry>();
  for (const row of pool.filter(c => c.effectiveDate === latestDate)) {
    const prev = byName.get(row.partnerName);
    if (!prev || new Date(row.createdAt) > new Date(prev.createdAt)) byName.set(row.partnerName, row);
  }
  return new Set(Array.from(byName.values(), r => r.id));
}

export default function TruckOwnersConfigPage() {
  const { truckId } = useParams<{ truckId: string }>();
  const navigate = useNavigate();
  const handleBack = () => navigate('/config/trucks');
  useBackShortcut(handleBack);
  const id = Number(truckId);
  const { confirm, dialog } = useConfirm();
  const { toast: showToast } = useToast();
  const queryClient = useQueryClient();
  const { rootRef: pageRef } = usePageAnimations({ ready: true, selectors: ['.cfg-row'] });

  const [editingId, setEditingId] = useState<number | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [saving, setSaving] = useState(false);

  // Truck catalog (for the header plate).
  const { data: truck } = useQuery<Truck | undefined>({
    queryKey: qk.catalogs.truckDetail(id),
    queryFn: async () => {
      const r = await api.get<Truck | { items: Truck[] }>(`/trucks/${id}`);
      // The factory's GET /:id returns the row directly.
      return r as Truck;
    },
    enabled: !!id && !Number.isNaN(id),
  });

  const { data: all = [], refetch } = useQuery<TruckCapEntry[]>({
    queryKey: qk.crud.entity(ENDPOINT),
    queryFn: async () => {
      const r = await api.get<PaginatedResponse<TruckCapEntry>>(ENDPOINT);
      return r.items;
    },
  });

  // Scope to this truck (factory doesn't filter by truckId server-side).
  const items = all.filter(r => r.truckId === id);
  const activeIds = computeActiveIds(items);

  const sorted = [...items].sort((a, b) => {
    if (a.effectiveDate !== b.effectiveDate) return a.effectiveDate < b.effectiveDate ? 1 : -1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const refresh = useCallback(async () => { await refetch(); }, [refetch]);

  const doCreate = async (body: Record<string, unknown>) => {
    setSaving(true);
    try {
      await api.post(ENDPOINT, { ...body, truckId: id });
      setShowAddForm(false);
      await refresh();
    } catch (e) {
      showToast({ kind: 'error', message: e instanceof Error ? e.message : 'Lỗi lưu' });
    } finally {
      setSaving(false);
    }
  };

  const doUpdate = async (rowId: number, body: Record<string, unknown>) => {
    setSaving(true);
    try {
      await api.put(`${ENDPOINT}/${rowId}`, { ...body, truckId: id });
      setEditingId(null);
      await refresh();
    } catch (e) {
      showToast({ kind: 'error', message: e instanceof Error ? e.message : 'Lỗi cập nhật' });
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async (rowId: number) => {
    if (!await confirm('Xóa đối tác sở hữu này?')) return;
    try {
      await api.delete(`${ENDPOINT}/${rowId}`);
      await refresh();
      // Invalidate catalog caches so distribution preview picks up the change.
      await queryClient.invalidateQueries({ queryKey: qk.dashboard.distributionHistory });
    } catch (e) {
      showToast({ kind: 'error', message: e instanceof Error ? e.message : 'Lỗi xóa' });
    }
  };

  const activeOwners = sorted.filter(r => activeIds.has(r.id));
  const totalPct = activeOwners.reduce((s, r) => s + (parseFloat(r.percentage) || 0), 0);
  const pctBalanced = Math.abs(totalPct - 100) < 0.01;

  return (
    <div ref={pageRef}>
      <PageHeader
        title={truck?.licensePlate ? `Sở hữu xe — ${truck.licensePlate}` : 'Sở hữu xe'}
        iconName="equity-ownership"
        description="Danh sách đối tác sở hữu xe và tỷ lệ chia lợi nhuận của xe này."
      />

      <div style={{ marginBottom: 16 }}>
        <button className="btn btn--secondary" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', gap: 8 }} onClick={handleBack}>
          <ArrowLeft size={14} /> Quay lại danh sách xe
        </button>
      </div>

      {!pctBalanced && activeOwners.length > 0 && (
        <div style={{ padding: 12, background: 'var(--warn-soft)', color: 'var(--warn)', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
          ⚠️ Tổng tỷ lệ đang là <strong>{totalPct.toFixed(2)}%</strong> — nên bằng 100% để lợi nhuận xe được phân phối đầy đủ.
        </div>
      )}

      <Panel>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 13, color: 'var(--fg-3)' }}>
            Hiện tại: <strong style={{ color: 'var(--fg-1)' }}>{activeOwners.length}</strong> đối tác · {items.length - activeOwners.length} bản ghi lịch sử
          </div>
          {!showAddForm && (
            <button className="btn btn--primary" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={() => setShowAddForm(true)}>
              <Plus size={14} /> Thêm đối tác
            </button>
          )}
        </div>

        <table className="cfg-table" style={{ width: '100%', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-2)', color: 'var(--fg-3)' }}>
              <th style={{ textAlign: 'left', padding: '8px 16px' }}>Đối tác</th>
              <th style={{ textAlign: 'right', padding: '8px 16px' }}>Tỷ lệ (%)</th>
              <th style={{ textAlign: 'left', padding: '8px 16px' }}>Vai trò</th>
              <th style={{ textAlign: 'left', padding: '8px 16px' }}>Ngày hiệu lực</th>
              <th style={{ textAlign: 'right', padding: '8px 16px' }}></th>
            </tr>
          </thead>
          <tbody>
            {showAddForm && (
              <tr><td colSpan={5} style={{ padding: 0 }}>
                <TruckOwnerForm saving={saving} onsave={doCreate} oncancel={() => setShowAddForm(false)} />
              </td></tr>
            )}
            {sorted.map((r) => {
              const isActive = activeIds.has(r.id);
              if (editingId === r.id) {
                return (
                  <tr key={r.id} className="cfg-row"><td colSpan={5} style={{ padding: 0 }}>
                    <TruckOwnerForm saving={saving} item={r} onsave={(d) => doUpdate(r.id, d)} oncancel={() => setEditingId(null)} />
                  </td></tr>
                );
              }
              const isDriver = (r.role ?? TruckCapRole.INVESTOR) === TruckCapRole.DRIVER;
              return (
                <tr key={r.id} className="cfg-row" style={{ borderBottom: '1px solid var(--border-3)', opacity: isActive ? 1 : 0.55 }}>
                  <td style={{ padding: '10px 16px', fontWeight: 600, color: 'var(--fg-1)' }}>
                    <span style={{ marginRight: 8 }}>{r.partnerName}</span>
                    {isActive && <StatusPill variant="success">HIỆN TẠI</StatusPill>}
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600, color: isActive ? 'var(--brand)' : 'var(--fg-2)' }}>
                    {parseFloat(r.percentage).toFixed(2)}%
                  </td>
                  <td style={{ padding: '10px 16px' }}>
                    <StatusPill variant={isDriver ? 'warn' : 'neutral'}>
                      {TRUCK_CAP_ROLE_LABELS[r.role ?? TruckCapRole.INVESTOR]}
                    </StatusPill>
                  </td>
                  <td style={{ padding: '10px 16px' }}>{new Date(r.effectiveDate).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</td>
                  <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                    <button className="btn btn--secondary" style={{ padding: '0 12px', marginRight: 6 }} onClick={() => setEditingId(r.id)}>Sửa</button>
                    <button className="btn btn--danger" style={{ padding: '0 12px' }} onClick={() => doDelete(r.id)}>Xóa</button>
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && !showAddForm && (
              <tr><td colSpan={5} style={{ padding: 32, textAlign: 'center', color: 'var(--fg-3)' }}>
                Chưa có đối tác sở hữu cho xe này. Thêm đối tác để bắt đầu phân chia lợi nhuận theo xe.
              </td></tr>
            )}
          </tbody>
        </table>
      </Panel>
      {dialog}
    </div>
  );
}
