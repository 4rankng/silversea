import { Plus } from 'lucide-react';
import type { OperationalSite } from '../../../api/shipmentClient';
import {
  USearchableField as SearchableField,
  UTextField as TextField,
} from './uui-fields';
import { shipmentCreateGridStyle } from './ShipmentCreateSections';
import type { ShipmentCreateFormState } from './shipment-create-model';

type FormState = ShipmentCreateFormState;

export interface ShipmentCreateLclCargoFieldsProps {
  form: FormState;
  update: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  warehouseSites: OperationalSite[];
  sitesLoading: boolean;
  saving: boolean;
  issueByField: Map<string, string>;
  openCreateSiteDialog: (siteType: 'FACTORY' | 'WAREHOUSE') => void;
}

export function ShipmentCreateLclCargoFields({
  form,
  update,
  warehouseSites,
  sitesLoading,
  saving,
  issueByField,
  openCreateSiteDialog,
}: ShipmentCreateLclCargoFieldsProps) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div data-field-id="shipment-pickup-warehouse" style={{ display: 'flex', flexDirection: 'column', gap: 6, alignSelf: 'stretch' }}>
        <SearchableField
          id="shipment-pickup-warehouse"
          label="Kho lấy hàng"
          value={form.pickupWarehouseSiteId}
          onChange={(value) => update('pickupWarehouseSiteId', value)}
          options={warehouseSites.map((site) => ({
            value: String(site.id),
            label: site.shortName || site.name,
            searchText: `${site.code} ${site.name} ${site.address ?? ''}`,
          }))}
          placeholder={sitesLoading ? 'Đang tải…' : !form.customerId ? 'Chọn khách hàng trước' : 'Chọn kho lấy hàng'}
          disabled={!form.customerId || sitesLoading || saving}
          error={issueByField.get('shipment-pickup-warehouse')}
          hint={
            form.customerId && !sitesLoading && warehouseSites.length === 0 ? (
              <>
                Chưa có kho cho khách hàng này.{' '}
                <button
                  type="button"
                  onClick={() => openCreateSiteDialog('WAREHOUSE')}
                  disabled={saving}
                  style={{
                    border: 0,
                    background: 'none',
                    padding: 0,
                    color: 'var(--accent-ink, #00361B)',
                    fontWeight: 700,
                    cursor: 'pointer',
                    fontSize: 'var(--text-control-size)',
                  }}
                >
                  Thêm kho
                </button>
              </>
            ) : undefined
          }
          searchable
          popoverPlacement="top"
        />
        {!sitesLoading && form.customerId ? (
          <button
            type="button"
            onClick={() => openCreateSiteDialog('WAREHOUSE')}
            disabled={saving}
            style={{
              alignSelf: 'start',
              minHeight: 'var(--control-touch-h)',
              padding: '0 14px',
              border: '1px dashed var(--border-2)',
              borderRadius: 8,
              background: 'transparent',
              color: 'var(--accent-ink, #00361B)',
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer',
            }}
          >
            <Plus size={15} aria-hidden="true" style={{ color: 'var(--accent, #2563eb)' }} />Thêm kho
          </button>
        ) : null}
      </div>
      <div style={shipmentCreateGridStyle}>
        <div data-field-id="shipment-package-type">
          <TextField
            id="shipment-package-type"
            label="Quy cách đóng gói"
            value={form.packageType}
            onChange={(event) => update('packageType', event.target.value)}
            maxLength={100}
            placeholder="Ví dụ: Pallet, Roll, Carton, Thùng gỗ, Bao, Can…"
            disabled={saving}
            error={issueByField.get('shipment-package-type')}
          />
        </div>
        <div data-field-id="shipment-package-count">
          <TextField
            id="shipment-package-count"
            label="Số lượng"
            type="number"
            min="1"
            step="1"
            value={form.packageCount}
            onChange={(event) => update('packageCount', event.target.value)}
            disabled={saving}
            error={issueByField.get('shipment-package-count')}
          />
        </div>
        <div data-field-id="shipment-cargo-weight">
          <TextField
            id="shipment-cargo-weight"
            label="Trọng lượng (kg)"
            type="number"
            min="0"
            step="0.01"
            value={form.cargoWeightKg}
            onChange={(event) => update('cargoWeightKg', event.target.value)}
            disabled={saving}
            error={issueByField.get('shipment-cargo-weight')}
          />
        </div>
        <div data-field-id="shipment-cargo-volume">
          <TextField
            id="shipment-cargo-volume"
            label="Thể tích (CBM)"
            type="number"
            min="0"
            step="0.001"
            value={form.cargoVolumeCbm}
            onChange={(event) => update('cargoVolumeCbm', event.target.value)}
            disabled={saving}
            error={issueByField.get('shipment-cargo-volume')}
          />
        </div>
      </div>
    </div>
  );
}
