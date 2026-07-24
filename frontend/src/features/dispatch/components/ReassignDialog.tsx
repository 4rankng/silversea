import { X, Check } from 'lucide-react';
import type { ReassignState, Truck, Driver } from '../utils';

interface ReassignDialogProps {
  reassignState: ReassignState;
  setReassignState: React.Dispatch<React.SetStateAction<ReassignState>>;
  trucks: Truck[];
  drivers: Driver[];
  carrierCustomers: { id: number; label: string }[];
  onSave: () => void;
  onCancel: () => void;
}

export function ReassignDialog({
  reassignState,
  setReassignState,
  trucks,
  drivers,
  carrierCustomers,
  onSave,
  onCancel,
}: ReassignDialogProps) {
  return (
    <div className="o-assign-editor" style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
        <button
          type="button"
          onClick={() => setReassignState(s => ({ ...s, carrierType: 'OWN' }))}
          style={{ flex: 1, padding: '4px', fontSize: 12, borderRadius: 4, border: '1px solid var(--border)', background: reassignState.carrierType === 'OWN' ? 'var(--brand-soft)' : '#fff', color: reassignState.carrierType === 'OWN' ? 'var(--brand-dark)' : 'var(--text-2)' }}
        >
          Xe nhà
        </button>
        <button
          type="button"
          onClick={() => setReassignState(s => ({ ...s, carrierType: 'EXTERNAL' }))}
          style={{ flex: 1, padding: '4px', fontSize: 12, borderRadius: 4, border: '1px solid var(--border)', background: reassignState.carrierType === 'EXTERNAL' ? 'var(--brand-soft)' : '#fff', color: reassignState.carrierType === 'EXTERNAL' ? 'var(--brand-dark)' : 'var(--text-2)' }}
        >
          Xe ngoài
        </button>
      </div>

      {reassignState.carrierType === 'OWN' ? (
        <div className="row">
          <select
            value={reassignState.truckId}
            onChange={(e) =>
              setReassignState((s) => ({ ...s, truckId: e.target.value }))
            }
            disabled={reassignState.loading}
          >
            <option value="">Chọn xe đầu kéo</option>
            {trucks
              .filter((t) => t.status !== 'MAINTENANCE')
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.licensePlate}
                </option>
              ))}
          </select>
          <select
            value={reassignState.driverId}
            onChange={(e) =>
              setReassignState((s) => ({ ...s, driverId: e.target.value }))
            }
            disabled={reassignState.loading}
          >
            <option value="">Chọn lái xe</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <>
          <div className="row">
            <select
              value={reassignState.externalCarrierId}
              onChange={(e) => setReassignState((s) => ({ ...s, externalCarrierId: e.target.value }))}
              disabled={reassignState.loading}
            >
              <option value="">Chọn đối tác xe ngoài</option>
              {carrierCustomers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <input 
              type="text" 
              placeholder="Biển số xe" 
              value={reassignState.externalPlateNumber} 
              onChange={(e) => setReassignState(s => ({ ...s, externalPlateNumber: e.target.value }))}
              disabled={reassignState.loading}
              style={{ flex: 1, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 4, fontSize: 13 }}
            />
          </div>
          <div className="row">
            <input 
              type="text" 
              placeholder="Tên lái xe" 
              value={reassignState.externalDriverName} 
              onChange={(e) => setReassignState(s => ({ ...s, externalDriverName: e.target.value }))}
              disabled={reassignState.loading}
              style={{ flex: 1, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 4, fontSize: 13 }}
            />
            <input 
              type="text" 
              placeholder="SĐT lái xe" 
              value={reassignState.externalDriverPhone} 
              onChange={(e) => setReassignState(s => ({ ...s, externalDriverPhone: e.target.value }))}
              disabled={reassignState.loading}
              style={{ flex: 1, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 4, fontSize: 13 }}
            />
          </div>
        </>
      )}

      {reassignState.error && (
        <div className="err">{reassignState.error}</div>
      )}
      <div className="acts">
        <button
          type="button"
          className="save"
          onClick={onSave}
          disabled={reassignState.loading}
        >
          {reassignState.loading ? (
            <div
              className="spin"
              style={{
                width: 10,
                height: 10,
                border: '2px solid #fff',
                borderTopColor: 'transparent',
                borderRadius: '50%',
              }}
            />
          ) : (
            <Check size={12} />
          )}
          Lưu
        </button>
        <button
          type="button"
          className="cancel"
          onClick={onCancel}
          disabled={reassignState.loading}
        >
          <X size={12} />
          Hủy
        </button>
      </div>
    </div>
  );
}
