import type { ShipmentCusWorkspaceContainerLine, ShipmentCusWorkspaceDetail } from '@tingting/shared';
import { SearchableSelect } from '../../../design-system';
import { USearchableField } from '../create/uui-fields';

export function ShipmentIdentityEditor({ detail, line, customerName, currentFactoryName, saving, factoryName, setFactoryName, operationalSiteId, setOperationalSiteId, routeId, setRouteId, deliveryLocation, setDeliveryLocation, routeOptions }: {
  detail: ShipmentCusWorkspaceDetail;
  line: ShipmentCusWorkspaceContainerLine;
  customerName: string | null;
  currentFactoryName: string | null;
  saving: boolean;
  factoryName: string;
  setFactoryName: (value: string) => void;
  operationalSiteId: string;
  setOperationalSiteId: (value: string) => void;
  routeId: string;
  setRouteId: (value: string) => void;
  deliveryLocation: string;
  setDeliveryLocation: (value: string) => void;
  routeOptions: Array<{ value: string; label: string; searchText?: string }>;
}) {
  const isFcl = detail.summary.cargoMode === 'FCL';
  const factoryOptions = detail.selectors.operationalSites.filter((site) => site.siteType === 'FACTORY').map((site) => ({ value: String(site.id), label: site.label, searchText: `${site.code} ${site.name}` }));
  // A historical inactive selection must remain visible without offering
  // other inactive/cross-customer sites as new choices.
  if (line.operationalSiteId && !factoryOptions.some((site) => site.value === String(line.operationalSiteId))) {
    factoryOptions.unshift({ value: String(line.operationalSiteId), label: currentFactoryName || 'Nhà máy đã lưu', searchText: currentFactoryName || '' });
  }
  return <div className="shipment-container-ledger__editor-grid">
    <label><span>Khách hàng</span><input value={customerName ?? ''} disabled title={detail.summary.fieldAccess.customerId.reason} /></label>
    {isFcl ? <USearchableField
      label="Nhà máy" size="md" value={operationalSiteId} onChange={setOperationalSiteId} searchable
      options={factoryOptions}
      placeholder="Chọn nhà máy" disabled={saving || line.fieldAccess.operationalSiteId?.mode !== 'DIRECT'}
      hint={line.fieldAccess.operationalSiteId?.mode === 'READ_ONLY' ? line.fieldAccess.operationalSiteId.reason : undefined}
    /> : <>
      <label><span>Nhà máy</span><input value={factoryName} onChange={(event) => setFactoryName(event.target.value)} maxLength={255} disabled={saving || detail.summary.fieldAccess.factoryName.mode === 'READ_ONLY'} /></label>
      <label><span>Tuyến đường</span><SearchableSelect id={`shipment-detail-route-${line.id}`} value={routeId} onChange={setRouteId} options={routeOptions} placeholder="Chọn tuyến đường" searchPlaceholder="Tìm tuyến đường" disabled={saving || detail.summary.fieldAccess.routeId.mode === 'READ_ONLY'} /></label>
      <label><span>Điểm giao</span><input value={deliveryLocation} onChange={(event) => setDeliveryLocation(event.target.value)} maxLength={255} disabled={saving || detail.summary.fieldAccess.deliveryLocation.mode === 'READ_ONLY'} /></label>
    </>}
  </div>;
}
