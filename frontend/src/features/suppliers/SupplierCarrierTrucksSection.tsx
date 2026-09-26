import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api/client';
import { fetchAllPaginated } from '../../lib/http/paginate';
import type { Truck } from '@tingting/shared';
import './SupplierCarrierTrucks.css';

export interface SupplierCarrierTrucksSectionProps {
  supplierName: string;
  /** The supplier's linked customer id — trucks.carrier_id references it. */
  carrierId: number;
}

/** Card 20260926_2 AC1/AC2 — 'Xe của nhà thầu' section: lists the trucks
 *  bound to the supplier's linked carrier customer and drives the existing
 *  /trucks CRUD (plate unique; carrier link validated server-side). */
export function SupplierCarrierTrucksSection({ supplierName, carrierId }: SupplierCarrierTrucksSectionProps) {
  const qc = useQueryClient();
  const listKey = ['suppliers', 'carrier-trucks', carrierId];
  const listQuery = useQuery({
    queryKey: listKey,
    queryFn: () => fetchAllPaginated<Truck>('/trucks', { carrierId: String(carrierId) }),
  });
  const [plateDraft, setPlateDraft] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => { void qc.invalidateQueries({ queryKey: listKey }); };

  const createM = useMutation({
    mutationFn: (licensePlate: string) => api.post('/trucks', { licensePlate, carrierId }),
    onSuccess: () => { setPlateDraft(''); setError(null); invalidate(); },
    onError: (e: Error) => setError(e.message),
  });

  const updateM = useMutation({
    mutationFn: (input: { id: number; licensePlate: string; updatedAt?: string }) =>
      api.put(`/trucks/${input.id}`, { licensePlate: input.licensePlate }, { expectedUpdatedAt: input.updatedAt }),
    onSuccess: () => { setEditingId(null); setError(null); invalidate(); },
    onError: (e: Error) => setError(e.message),
  });

  const deleteM = useMutation({
    mutationFn: (id: number) => api.delete(`/trucks/${id}`),
    onSuccess: () => { setError(null); invalidate(); },
    onError: (e: Error) => setError(e.message),
  });

  const trucks = listQuery.data ?? [];

  return (
    <div className="supplier-carrier-trucks" data-testid={`carrier-trucks-${carrierId}`}>
      <p className="supplier-carrier-trucks__title">Xe của nhà thầu — {supplierName}</p>
      {listQuery.isLoading && <p className="supplier-carrier-trucks__meta">Đang tải…</p>}
      {listQuery.isError && (
        <p className="supplier-carrier-trucks__meta" role="alert">Không tải được danh sách xe. Vui lòng thử lại.</p>
      )}
      {!listQuery.isLoading && !listQuery.isError && (
        <>
          {trucks.length === 0 ? (
            <p className="supplier-carrier-trucks__meta">Chưa có xe nào gán cho nhà thầu này.</p>
          ) : (
            <ul className="supplier-carrier-trucks__list">
              {trucks.map((truck) => (
                <li key={truck.id} className="supplier-carrier-trucks__item">
                  {editingId === truck.id ? (
                    <>
                      <input
                        aria-label="Sửa biển số"
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                      />
                      <button type="button" className="btn btn--primary btn--sm" onClick={() => updateM.mutate({ id: truck.id, licensePlate: editDraft.trim(), updatedAt: truck.updatedAt })}>Lưu</button>
                      <button type="button" className="btn btn--secondary btn--sm" onClick={() => setEditingId(null)}>Hủy</button>
                    </>
                  ) : (
                    <>
                      <span className="supplier-carrier-trucks__plate">{truck.licensePlate}</span>
                      <span className="supplier-carrier-trucks__meta">{truck.status === 'ACTIVE' ? 'Hoạt động' : truck.status === 'MAINTENANCE' ? 'Bảo trì' : 'Ngưng'}</span>
                    </>
                  )}
                  {editingId !== truck.id && (
                    <span className="supplier-carrier-trucks__actions">
                      <button type="button" className="row-action" aria-label={`Sửa biển số ${truck.licensePlate}`} onClick={() => { setEditingId(truck.id); setEditDraft(truck.licensePlate); }}><Pencil size={14} /></button>
                      <button type="button" className="row-action" aria-label={`Xóa biển số ${truck.licensePlate}`} onClick={() => deleteM.mutate(truck.id)}><Trash2 size={14} /></button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {error && (
            <p className="supplier-carrier-trucks__error" role="alert">{error}</p>
          )}
          <div className="supplier-carrier-trucks__add">
            <label htmlFor={`new-plate-${carrierId}`}>Thêm biển số</label>
            <input id={`new-plate-${carrierId}`} aria-label="Biển số mới" value={plateDraft} onChange={(e) => setPlateDraft(e.target.value)} />
            <button type="button" className="btn btn--primary btn--sm" onClick={() => plateDraft.trim() && createM.mutate(plateDraft.trim())}>Thêm</button>
          </div>
        </>
      )}
    </div>
  );
}
