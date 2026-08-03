import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Eye, Plus, Send, Trash2 } from 'lucide-react';
import { EmptyState, SearchableSelect, SelectField, TextField } from '../../design-system';
import { tripClient, type CatalogData } from '../../api/tripClient';
import {
  listOperationalSites,
  createShipmentDeclaration,
  quickCreateShipment,
  saveShipmentContainers,
  submitShipmentForDispatch,
  type OperationalSite,
} from '../../api/shipmentClient';
import { localDateTimeToIso } from '../../lib/shipment-operations';
import { OperationalSiteDetailsDialog } from '../../components/shipment/OperationalSiteDetailsDialog';

type CargoMode = 'FCL' | 'LCL';
type SaveIntent = 'DRAFT' | 'SUBMIT';

interface FormState {
  customerId: string;
  routeId: string;
  bookingRef: string;
  blNumber: string;
  declarationNumber: string;
  tradeDirection: '' | 'IMPORT' | 'EXPORT';
  cargoMode: CargoMode;
  operationalSiteId: string;
  pickupWarehouseSiteId: string;
  customsCutoffAt: string;
  closingAt: string;
  plannedReturnAt: string;
  expectedDeliveryDate: string;
  cargoWeightKg: string;
  cargoVolumeCbm: string;
  packageCount: string;
  packageType: string;
  operationalNotes: string;
}

interface ContainerRow {
  key: string;
  containerNumber: string;
  containerTypeId: string;
  shippingLineName: string;
  pickupPortId: string;
  dropoffPortId: string;
  cargoWeightKg: string;
}

const EMPTY_FORM: FormState = {
  customerId: '', routeId: '', bookingRef: '', blNumber: '', declarationNumber: '',
  tradeDirection: '', cargoMode: 'FCL', operationalSiteId: '', pickupWarehouseSiteId: '',
  customsCutoffAt: '', closingAt: '', plannedReturnAt: '', expectedDeliveryDate: '', cargoWeightKg: '',
  cargoVolumeCbm: '', packageCount: '', packageType: '', operationalNotes: '',
};

function newContainer(): ContainerRow {
  return { key: crypto.randomUUID(), containerNumber: '', containerTypeId: '', shippingLineName: '', pickupPortId: '', dropoffPortId: '', cargoWeightKg: '' };
}

function uuidv4(): string {
  return crypto.randomUUID();
}

const sectionStyle: React.CSSProperties = {
  border: '1px solid var(--border-2)', borderRadius: 10, padding: 16,
  display: 'grid', gap: 16, background: 'var(--surface-1)', minWidth: 0,
};

const gridStyle: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: 16, minWidth: 0,
};

interface SearchableFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string; searchText?: string }>;
  placeholder: string;
  disabled?: boolean;
  required?: boolean;
}

function SearchableField({
  id,
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled,
  required,
}: SearchableFieldProps) {
  return (
    <label htmlFor={id} style={{ display: 'grid', gap: 8, alignContent: 'start', fontSize: 14, fontWeight: 600 }}>
      <span>{label}{required ? ' *' : ''}</span>
      <SearchableSelect
        id={id}
        value={value}
        onChange={onChange}
        options={options}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
      />
    </label>
  );
}

export default function ClerkShipmentCreatePage() {
  const navigate = useNavigate();
  const [catalogs, setCatalogs] = useState<CatalogData | null>(null);
  const [sites, setSites] = useState<OperationalSite[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [containers, setContainers] = useState<ContainerRow[]>([newContainer()]);
  const [loading, setLoading] = useState(true);
  const [sitesLoading, setSitesLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState<SaveIntent | null>(null);
  const [detailSite, setDetailSite] = useState<OperationalSite | null>(null);

  useEffect(() => {
    let cancelled = false;
    tripClient.getBootstrap()
      .then((value) => { if (!cancelled) setCatalogs(value); })
      .catch(() => { if (!cancelled) setLoadError('Không thể tải dữ liệu danh mục'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!form.customerId) { setSites([]); return; }
    let cancelled = false;
    setSitesLoading(true);
    listOperationalSites(Number(form.customerId))
      .then((value) => { if (!cancelled) setSites(value); })
      .catch(() => { if (!cancelled) setSubmitError('Không thể tải danh sách nhà máy của khách hàng'); })
      .finally(() => { if (!cancelled) setSitesLoading(false); });
    return () => { cancelled = true; };
  }, [form.customerId]);

  const operationalSites = useMemo(() => sites.filter((site) => site.siteType === 'FACTORY'), [sites]);
  const warehouseSites = useMemo(() => sites.filter((site) => site.siteType === 'WAREHOUSE'), [sites]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setSubmitError(null);
  }

  function selectCustomer(value: string) {
    setForm((current) => ({ ...current, customerId: value, operationalSiteId: '', pickupWarehouseSiteId: '' }));
    setSites([]);
    setSubmitError(null);
  }

  function selectOperationalSite(value: string) {
    update('operationalSiteId', value);
    const selected = sites.find((site) => String(site.id) === value) ?? null;
    if (selected) setDetailSite(selected);
  }

  function changeMode(next: CargoMode) {
    if (next === form.cargoMode) return;
    const hasModeData = form.cargoMode === 'LCL'
      ? Boolean(form.packageType || form.packageCount || form.cargoVolumeCbm)
      : containers.some((row) => Object.entries(row).some(([key, value]) => key !== 'key' && value));
    if (hasModeData && !window.confirm(`Chuyển sang ${next} sẽ xóa dữ liệu hàng hóa đã nhập. Tiếp tục?`)) return;
    setForm((current) => ({ ...current, cargoMode: next, cargoVolumeCbm: '', packageCount: '', packageType: '', cargoWeightKg: '' }));
    setContainers([newContainer()]);
  }

  function updateContainer(key: string, field: keyof Omit<ContainerRow, 'key'>, value: string) {
    setContainers((current) => current.map((row) => row.key === key ? { ...row, [field]: value } : row));
    setSubmitError(null);
  }

  function validate(intent: SaveIntent): string | null {
    if (!form.customerId) return 'Vui lòng chọn khách hàng';
    if (intent === 'DRAFT') return null;
    if (!form.bookingRef && !form.blNumber) return 'Vui lòng nhập Số Bill hoặc Số Booking';
    if (!form.routeId) return 'Vui lòng chọn tuyến đường';
    // FCL requires a delivery factory; LCL does not (delivery goes to warehouse pickup).
    if (form.cargoMode === 'FCL' && !form.operationalSiteId) {
      return 'Vui lòng chọn nhà máy';
    }
    if (form.cargoMode === 'FCL') {
      const incomplete = containers.some((row) => !row.containerNumber || !row.containerTypeId || !row.shippingLineName || !row.pickupPortId || !row.dropoffPortId);
      if (incomplete) return 'Vui lòng nhập đủ số container, loại container, hãng tàu, cảng nâng và cảng hạ';
    } else if (!form.pickupWarehouseSiteId || !form.packageType || !form.packageCount || !form.cargoWeightKg || !form.cargoVolumeCbm || !form.expectedDeliveryDate) {
      return 'Vui lòng nhập đủ kho lấy hàng, quy cách, số lượng, trọng lượng, thể tích và ngày giao dự kiến';
    }
    return null;
  }

  async function save(intent: SaveIntent) {
    const validationError = validate(intent);
    if (validationError) { setSubmitError(validationError); return; }
    setSaving(intent);
    setSubmitError(null);
    try {
      const firstContainer = containers[0];
      const shipment = await quickCreateShipment({
        customerId: Number(form.customerId),
        routeId: form.routeId ? Number(form.routeId) : null,
        bookingRef: form.bookingRef || null,
        blNumber: form.blNumber || null,
        tradeDirection: form.tradeDirection || null,
        cargoMode: form.cargoMode,
        operationalSiteId: form.operationalSiteId ? Number(form.operationalSiteId) : null,
        pickupWarehouseSiteId: form.pickupWarehouseSiteId ? Number(form.pickupWarehouseSiteId) : null,
        factoryName: sites.find((site) => String(site.id) === form.operationalSiteId)?.name ?? null,
        shippingLineName: form.cargoMode === 'FCL' ? firstContainer?.shippingLineName || null : null,
        customsCutoffAt: localDateTimeToIso(form.customsCutoffAt),
        closingAt: localDateTimeToIso(form.closingAt),
        plannedReturnAt: localDateTimeToIso(form.plannedReturnAt),
        expectedDeliveryDate: form.expectedDeliveryDate || null,
        cargoWeightKg: form.cargoMode === 'LCL' ? form.cargoWeightKg || null : null,
        cargoVolumeCbm: form.cargoMode === 'LCL' ? form.cargoVolumeCbm || null : null,
        packageCount: form.cargoMode === 'LCL' && form.packageCount ? Number(form.packageCount) : null,
        packageType: form.cargoMode === 'LCL' ? form.packageType || null : null,
        operationalNotes: [form.declarationNumber ? `Số tờ khai: ${form.declarationNumber}` : '', form.operationalNotes].filter(Boolean).join('\n') || null,
      }, uuidv4());

      let version = shipment.version;
      if (form.declarationNumber) {
        await createShipmentDeclaration(shipment.id, {
          declarationNumber: form.declarationNumber,
          scope: 'SINGLE',
        });
      }
      if (form.cargoMode === 'FCL') {
        const rowsToSave = containers.filter((row) => Object.entries(row).some(([key, value]) => key !== 'key' && value));
        if (rowsToSave.length > 0) {
          const result = await saveShipmentContainers(shipment.id, {
            expectedVersion: version,
            containers: rowsToSave.map((row) => ({
              containerNumber: row.containerNumber || null,
              containerTypeId: row.containerTypeId ? Number(row.containerTypeId) : null,
              shippingLineName: row.shippingLineName || null,
              pickupPortId: row.pickupPortId ? Number(row.pickupPortId) : null,
              dropoffPortId: row.dropoffPortId ? Number(row.dropoffPortId) : null,
              cargoWeightKg: row.cargoWeightKg || null,
            })),
          });
          version = result.shipmentVersion;
        }
      }
      if (intent === 'SUBMIT') {
        await submitShipmentForDispatch(shipment.id, { expectedVersion: version, operationalNote: form.operationalNotes || null }, uuidv4());
      }
      navigate(`/clerk/shipments/${shipment.id}/docs`);
    } catch (error) {
      setSubmitError(error instanceof Error && error.message.trim() ? error.message : 'Không thể lưu lô hàng. Vui lòng thử lại.');
    } finally {
      setSaving(null);
    }
  }

  if (loading) return <div style={{ padding: 48, textAlign: 'center', color: 'var(--fg-3)' }}>Đang tải…</div>;
  if (loadError) return <div role="alert" style={{ padding: 24, color: 'var(--danger)' }}>{loadError}</div>;
  if (!catalogs?.customers.length) return <EmptyState title="Chưa có khách hàng" description="Cần ít nhất một khách hàng trước khi tạo lô hàng." />;

  return (
    <div style={{ padding: 16, maxWidth: 1120, margin: '0 auto', minWidth: 0 }}>
      <button type="button" onClick={() => navigate(-1)} aria-label="Quay lại" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 44, padding: '8px 4px', border: 0, background: 'none', color: 'var(--fg-2)', cursor: 'pointer' }}>
        <ArrowLeft size={18} /> Quay lại
      </button>
      <h1 style={{ fontSize: 24, margin: '8px 0 4px' }}>Tạo lô hàng mới</h1>
      <p style={{ color: 'var(--fg-3)', margin: '0 0 20px' }}>Lưu nháp để bổ sung sau, hoặc nhập đủ thông tin và gửi sang bảng điều phối.</p>

      <form onSubmit={(event) => { event.preventDefault(); void save('DRAFT'); }} style={{ display: 'grid', gap: 16 }}>
        <section style={sectionStyle}>
          <h2 style={{ fontSize: 17, margin: 0 }}>Thông tin chung</h2>
          <div style={gridStyle}>
            <SearchableField
              id="shipment-customer"
              label="Khách hàng"
              required
              value={form.customerId}
              onChange={selectCustomer}
              options={catalogs.customers.map((item) => ({ value: String(item.id), label: item.name }))}
              placeholder="Chọn khách hàng"
              disabled={Boolean(saving)}
            />
            <SearchableField
              id="shipment-route"
              label="Tuyến đường"
              value={form.routeId}
              onChange={(value) => update('routeId', value)}
              options={(catalogs.routes ?? []).map((item) => ({ value: String(item.id), label: item.name }))}
              placeholder="Chọn tuyến đường"
              disabled={Boolean(saving)}
            />
            <TextField label="Số booking" value={form.bookingRef} onChange={(event) => update('bookingRef', event.target.value)} maxLength={100} disabled={Boolean(saving)} />
            <TextField label="Số vận đơn (B/L)" value={form.blNumber} onChange={(event) => update('blNumber', event.target.value)} maxLength={100} disabled={Boolean(saving)} />
            <TextField label="Số tờ khai" value={form.declarationNumber} onChange={(event) => update('declarationNumber', event.target.value)} maxLength={100} disabled={Boolean(saving)} />
            <SelectField label="Chiều hàng" value={form.tradeDirection} onChange={(event) => update('tradeDirection', event.target.value as FormState['tradeDirection'])} disabled={Boolean(saving)}>
              <option value="">— Chọn chiều hàng —</option><option value="IMPORT">Nhập khẩu</option><option value="EXPORT">Xuất khẩu</option>
            </SelectField>
          </div>
          {form.cargoMode === 'FCL' && (
            <div style={gridStyle}>
              <SearchableField
                id="shipment-operational-site"
                label="Nhà máy"
                value={form.operationalSiteId}
                onChange={selectOperationalSite}
                options={operationalSites.map((site) => ({ value: String(site.id), label: site.name, searchText: site.address ?? '' }))}
                placeholder={sitesLoading ? 'Đang tải…' : 'Chọn nhà máy'}
                disabled={!form.customerId || sitesLoading || Boolean(saving)}
              />
              {form.operationalSiteId && <button type="button" onClick={() => setDetailSite(sites.find((site) => String(site.id) === form.operationalSiteId) ?? null)} style={{ alignSelf: 'end', minHeight: 44, border: '1px solid var(--border-2)', borderRadius: 8, background: 'var(--surface-1)', color: 'var(--fg-1)', fontWeight: 600, cursor: 'pointer' }}><Eye size={17} style={{ verticalAlign: 'middle', marginRight: 7 }} />Xem thông tin nhà máy</button>}
            </div>
          )}
        </section>

        <section style={sectionStyle}>
          <h2 style={{ fontSize: 17, margin: 0 }}>Hình thức hàng</h2>
          <SelectField label="Loại lô hàng" value={form.cargoMode} onChange={(event) => changeMode(event.target.value as CargoMode)} disabled={Boolean(saving)}>
            <option value="FCL">Hàng nguyên container (FCL)</option><option value="LCL">Hàng lẻ (LCL)</option>
          </SelectField>
          {form.cargoMode === 'FCL' ? (
            <div style={{ display: 'grid', gap: 12 }}>
              {containers.map((row, index) => (
                <div key={row.key} style={{ border: '1px solid var(--border-2)', borderRadius: 8, padding: 14, display: 'grid', gap: 12, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><strong>Container {index + 1}</strong>{containers.length > 1 && <button type="button" aria-label={`Xóa container ${index + 1}`} onClick={() => setContainers((current) => current.filter((item) => item.key !== row.key))} style={{ minWidth: 44, minHeight: 44, border: 0, background: 'none', color: 'var(--danger)', cursor: 'pointer' }}><Trash2 size={18} /></button>}</div>
                  <div style={gridStyle}>
                    <TextField label="Số container" value={row.containerNumber} onChange={(event) => updateContainer(row.key, 'containerNumber', event.target.value.toUpperCase())} disabled={Boolean(saving)} />
                    <SelectField label="Loại container" value={row.containerTypeId} onChange={(event) => updateContainer(row.key, 'containerTypeId', event.target.value)} disabled={Boolean(saving)}><option value="">— Chọn loại —</option>{(catalogs.containerTypes ?? []).map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</SelectField>
                    <TextField label="Hãng tàu" value={row.shippingLineName} onChange={(event) => updateContainer(row.key, 'shippingLineName', event.target.value)} disabled={Boolean(saving)} />
                    <SearchableField id={`container-${row.key}-pickup-port`} label="Cảng nâng" value={row.pickupPortId} onChange={(value) => updateContainer(row.key, 'pickupPortId', value)} options={(catalogs.ports ?? []).map((item) => ({ value: String(item.id), label: item.name }))} placeholder="Chọn cảng nâng" disabled={Boolean(saving)} />
                    <SearchableField id={`container-${row.key}-dropoff-port`} label="Cảng hạ" value={row.dropoffPortId} onChange={(value) => updateContainer(row.key, 'dropoffPortId', value)} options={(catalogs.ports ?? []).map((item) => ({ value: String(item.id), label: item.name }))} placeholder="Chọn cảng hạ" disabled={Boolean(saving)} />
                    <TextField label="Trọng lượng (kg)" type="number" min="0" step="0.01" value={row.cargoWeightKg} onChange={(event) => updateContainer(row.key, 'cargoWeightKg', event.target.value)} disabled={Boolean(saving)} />
                  </div>
                </div>
              ))}
              <button type="button" onClick={() => setContainers((current) => [...current, newContainer()])} disabled={Boolean(saving)} style={{ minHeight: 44, border: '1px dashed var(--border-2)', borderRadius: 8, background: 'transparent', color: 'var(--accent, #2563eb)', fontWeight: 700, cursor: 'pointer' }}><Plus size={18} style={{ verticalAlign: 'middle', marginRight: 7 }} />Thêm container</button>
            </div>
          ) : (
            <div style={gridStyle}>
              <SearchableField id="shipment-pickup-warehouse" label="Kho lấy hàng" value={form.pickupWarehouseSiteId} onChange={(value) => update('pickupWarehouseSiteId', value)} options={warehouseSites.map((site) => ({ value: String(site.id), label: site.name, searchText: site.address ?? '' }))} placeholder="Chọn kho lấy hàng" disabled={sitesLoading || Boolean(saving)} />
              <TextField label="Quy cách đóng gói" value={form.packageType} onChange={(event) => update('packageType', event.target.value)} placeholder="Pallet, carton…" disabled={Boolean(saving)} />
              <TextField label="Số lượng" type="number" min="1" step="1" value={form.packageCount} onChange={(event) => update('packageCount', event.target.value)} disabled={Boolean(saving)} />
              <TextField label="Trọng lượng (kg)" type="number" min="0" step="0.01" value={form.cargoWeightKg} onChange={(event) => update('cargoWeightKg', event.target.value)} disabled={Boolean(saving)} />
              <TextField label="Thể tích (CBM)" type="number" min="0" step="0.001" value={form.cargoVolumeCbm} onChange={(event) => update('cargoVolumeCbm', event.target.value)} disabled={Boolean(saving)} />
            </div>
          )}
        </section>

        <section style={sectionStyle}>
          <h2 style={{ fontSize: 17, margin: 0 }}>Mốc thời gian và lưu ý</h2>
          <div style={gridStyle}>
            <TextField label="Cut-off tờ khai" type="datetime-local" value={form.customsCutoffAt} onChange={(event) => update('customsCutoffAt', event.target.value)} disabled={Boolean(saving)} />
            <TextField label="Giờ đóng hàng" type="datetime-local" value={form.closingAt} onChange={(event) => update('closingAt', event.target.value)} disabled={Boolean(saving)} />
            <TextField label="Thời gian trả" type="datetime-local" value={form.plannedReturnAt} onChange={(event) => update('plannedReturnAt', event.target.value)} disabled={Boolean(saving)} />
            <TextField label="Ngày giao dự kiến" type="date" value={form.expectedDeliveryDate} onChange={(event) => update('expectedDeliveryDate', event.target.value)} disabled={Boolean(saving)} />
          </div>
          <label style={{ display: 'grid', gap: 8, fontSize: 14, fontWeight: 600 }}>Ghi chú điều xe<textarea value={form.operationalNotes} onChange={(event) => update('operationalNotes', event.target.value)} rows={4} maxLength={2000} disabled={Boolean(saving)} style={{ width: '100%', minHeight: 96, resize: 'vertical', border: '1px solid var(--border-2)', borderRadius: 8, padding: 12, color: 'var(--fg-1)', background: 'var(--surface-1)', font: 'inherit' }} /></label>
        </section>

        {submitError && <div role="alert" style={{ color: 'var(--danger)', background: 'var(--danger-bg, rgba(220,38,38,.08))', padding: '12px 16px', borderRadius: 8 }}>{submitError}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: 12 }}>
          <button type="submit" disabled={Boolean(saving)} style={{ minHeight: 48, border: '1px solid var(--border-2)', borderRadius: 8, background: 'var(--surface-1)', color: 'var(--fg-1)', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer' }}><Check size={18} style={{ verticalAlign: 'middle', marginRight: 8 }} />{saving === 'DRAFT' ? 'Đang lưu…' : 'Lưu bản nháp'}</button>
          <button type="button" onClick={() => void save('SUBMIT')} disabled={Boolean(saving)} style={{ minHeight: 48, border: 0, borderRadius: 8, background: 'var(--accent, #2563eb)', color: '#fff', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer' }}><Send size={18} style={{ verticalAlign: 'middle', marginRight: 8 }} />{saving === 'SUBMIT' ? 'Đang gửi…' : 'Gửi sang điều phối'}</button>
        </div>
      </form>
      <OperationalSiteDetailsDialog site={detailSite} isOpen={Boolean(detailSite)} onClose={() => setDetailSite(null)} />
    </div>
  );
}
