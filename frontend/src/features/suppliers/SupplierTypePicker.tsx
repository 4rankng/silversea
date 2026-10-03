import { Truck } from 'lucide-react';
import { SupplierType, SUPPLIER_TYPES, SUPPLIER_TYPE_LABELS } from '@tingting/shared';
import { EntityFormSection } from '../../components/shared/EntityFormParts';

/**
 * The supplier type taxonomy as a toggle group.
 *
 * This control is not cosmetic: "Vận chuyển" (CARRIER) is the single
 * discriminator that decides whether the supplier gets a `customers.isCarrier`
 * record and appears in the "Chọn nhà xe" dropdowns. A fuel station or an
 * insurer must never carry it — before 2026-10-03 the mirroring ran on every
 * supplier write regardless of type, which is how Petrolimex ended up
 * selectable as a nhà xe and showed up in the khách hàng list.
 *
 * Extracted from SupplierListPage.tsx to keep that page under its frozen LOC
 * ceiling (frontend/scripts/check-structure.mjs).
 */
export function SupplierTypePicker({ types, onChange }: {
  types: SupplierType[];
  onChange: (types: SupplierType[]) => void;
}) {
  const toggle = (type: SupplierType) => onChange(
    types.includes(type) ? types.filter((t) => t !== type) : [...types, type],
  );
  return (
    <EntityFormSection icon={Truck} label="Phân loại — quyết định nhà xe">
      <div className="col-span-full" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {SUPPLIER_TYPES.map((type) => {
          const active = types.includes(type);
          return (
            <button
              key={type}
              type="button"
              aria-pressed={active}
              onClick={() => toggle(type)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                minHeight: 'var(--control-touch-h)', padding: '0 12px',
                borderRadius: 6,
                border: `1px solid ${active ? 'var(--accent)' : 'var(--border-2)'}`,
                background: active ? 'var(--accent-soft)' : 'transparent',
                color: active ? 'var(--accent-text)' : 'var(--fg-2)',
                fontWeight: active ? 700 : 400, cursor: 'pointer',
              }}
            >
              {type === SupplierType.CARRIER && <Truck size={13} aria-hidden="true" />}
              {SUPPLIER_TYPE_LABELS[type]}
            </button>
          );
        })}
      </div>
      <p className="col-span-full" style={{ margin: 0, fontSize: 'var(--text-caption-size)', color: 'var(--ink-3)' }}>
        Chọn <strong>Vận chuyển</strong> để đối tác này thành nhà xe: hệ thống tự tạo bản ghi liên kết để chọn trong các danh sách “Nhà xe”.
        Không chọn thì đây là nhà cung cấp thuần và sẽ không xuất hiện trong danh sách nhà xe.
      </p>
    </EntityFormSection>
  );
}
