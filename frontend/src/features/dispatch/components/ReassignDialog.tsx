import { X, Check } from 'lucide-react';
import type { ReassignState, Truck, Driver } from '../utils';
import { UuiSelectField } from '../../../design-system/forms/UuiSelectField';

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
          style={{ flex: 1, padding: '4px', fontSize: 'var(--text-control-size)', borderRadius: 4, border: '1px solid var(--border)', background: reassignState.carrierType === 'OWN' ? 'var(--brand-soft)' : 'var(--surface)', color: reassignState.carrierType === 'OWN' ? 'var(--brand-dark)' : 'var(--text-2)' }}
        >
          Xe nhà
        </button>
        <button
          type="button"
          onClick={() => setReassignState(s => ({ ...s, carrierType: 'EXTERNAL' }))}
          style={{ flex: 1, padding: '4px', fontSize: 'var(--text-control-size)', borderRadius: 4, border: '1px solid var(--border)', background: reassignState.carrierType === 'EXTERNAL' ? 'var(--brand-soft)' : 'var(--surface)', color: reassignState.carrierType === 'EXTERNAL' ? 'var(--brand-dark)' : 'var(--text-2)' }}
        >
          Xe ngoài
        </button>
      </div>

      {reassignState.carrierType === 'OWN' ? (
        <div className="row">
          <UuiSelectField
            label="Chọn xe đầu kéo"
            hideLabel
            value={reassignState.truckId}
            onChange={(e) =>
              setReassignState((s) => ({ ...s, truckId: e.target.value }))
            }
            disabled={reassignState.loading}
            options={[
              { value: '', label: 'Chọn xe đầu kéo' },
              ...trucks
                .filter((t) => t.status !== 'MAINTENANCE')
                .map((t) => ({
                  value: String(t.id),
                  label: t.licensePlate,
                })),
            ]}
            wrapperClassName="input"
          />
          <UuiSelectField
            label="Chọn lái xe"
            hideLabel
            value={reassignState.driverId}
            onChange={(e) =>
              setReassignState((s) => ({ ...s, driverId: e.target.value }))
            }
            disabled={reassignState.loading}
            options={[
              { value: '', label: 'Chọn lái xe' },
              ...drivers.map((d) => ({
                value: String(d.id),
                label: d.name,
              })),
            ]}
            wrapperClassName="input"
          />
        </div>
      ) : (
        <>
          <div className="row">
            <UuiSelectField
              label="Chọn đối tác xe ngoài"
              hideLabel
              value={reassignState.externalCarrierId}
              onChange={(e) => setReassignState((s) => ({ ...s, externalCarrierId: e.target.value }))}
              disabled={reassignState.loading}
              options={[
                { value: '', label: 'Chọn đối tác xe ngoài' },
                ...carrierCustomers.map((c) => ({
                  value: String(c.id),
                  label: c.label,
                })),
              ]}
              wrapperClassName="input"
            />
            <input 
              type="text" 
              placeholder="Biển số xe" 
              value={reassignState.externalPlateNumber} 
              onChange={(e) => setReassignState(s => ({ ...s, externalPlateNumber: e.target.value }))}
              disabled={reassignState.loading}
              style={{ flex: 1, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 4, fontSize: 'var(--control-field-font-size)' }}
            />
          </div>
          <div className="row">
            <input 
              type="text" 
              placeholder="Tên lái xe" 
              value={reassignState.externalDriverName} 
              onChange={(e) => setReassignState(s => ({ ...s, externalDriverName: e.target.value }))}
              disabled={reassignState.loading}
              style={{ flex: 1, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 4, fontSize: 'var(--control-field-font-size)' }}
            />
            <input 
              type="text" 
              placeholder="SĐT lái xe" 
              value={reassignState.externalDriverPhone} 
              onChange={(e) => setReassignState(s => ({ ...s, externalDriverPhone: e.target.value }))}
              disabled={reassignState.loading}
              style={{ flex: 1, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 4, fontSize: 'var(--control-field-font-size)' }}
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
