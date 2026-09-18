import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useQueuedSearchParams } from '../hooks/useQueuedSearchParams';
import { tripClient } from '../api/tripClient';
import { listShipmentDebitSummary, type ShipmentDebitLotRow } from '../api/shipmentClient';
import { createDebitNoteBatch, exportDebitNoteFile } from '../api/shipmentDebit';
import { useToast } from '../components/shared/Toast';
import { formatMoney } from '../lib/format';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { Alert } from '../components/shared/Alert';
import { Skeleton } from '../components/shared/Skeleton';
import { Button as UUIButton } from '../components/untitled-ui/base/buttons/button';
import { EmptyState, BufferedUuiDateInput, UuiSelectField } from '../design-system';
import { PageHeader } from '../components/UI';
import { USearchableField } from '../features/shipments/create/uui-searchable-field';
import { Lock, Unlock } from 'lucide-react';
import { ShipmentDebitWorkspace } from '../features/shipments/debit/ShipmentDebitWorkspace';
import './ShipmentDebitPage.css';

const LOCK_FILTERS = [
  { value: 'ALL', label: 'Tất cả' },
  { value: 'OPEN', label: 'Đang mở' },
  { value: 'LOCKED', label: 'Đã khóa' },
];

/** Lot-level settlement row (L1) — identity, money rollup, lock state. */
function DebitLotRow({
  row, expanded, onToggle, onSaved, selected, onSelect,
}: {
  row: ShipmentDebitLotRow;
  expanded: boolean;
  onToggle: () => void;
  onSaved: () => void;
  selected: boolean;
  onSelect: (id: number, next: boolean) => void;
}) {
  return (
    <>
    <tr className="shipment-debit-row" data-locked={row.lockStatus === 'LOCKED' ? '' : undefined}>
      <td>
        <input
          type="checkbox"
          aria-label={`Chọn lô ${row.code}`}
          checked={selected}
          disabled={row.lockStatus !== 'LOCKED'}
          onChange={(event) => onSelect(row.shipmentId, event.target.checked)}
        />
      </td>
      <td className="shipment-debit-row__expand">
        <button
          type="button"
          className="shipment-debit-row__expand-button"
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Đóng' : 'Mở'} chi tiết lô ${row.code}`}
          onClick={onToggle}
        >
          {expanded ? '−' : '+'}
        </button>
      </td>
      <td className="shipment-debit-row__identity">
        <strong>{row.code}</strong>
        <span>{row.customerName}</span>
        {row.factoryName && <span>{row.factoryName}{row.factoryAddress ? ` — ${row.factoryAddress}` : ''}</span>}
        <span><small>Bill/Book:</small> {row.billOrBookNumber}</span>
        <span><small>Tờ khai:</small> {row.customsNumber ?? 'Chưa có'}</span>
      </td>
      <td>{row.documentsSummary ?? 'Chưa xác định'}</td>
      <td className="shipment-debit-row__money">{row.freightAuto == null ? 'Chưa xác định' : formatMoney(row.freightAuto)}</td>
      <td className="shipment-debit-row__money">{row.chiHoTotal == null ? 'Chưa xác định' : formatMoney(row.chiHoTotal)}</td>
      <td className="shipment-debit-row__money">{row.receivableTotal == null ? 'Chưa xác định' : formatMoney(row.receivableTotal)}</td>
      <td className="shipment-debit-row__money">{row.profit == null ? 'Chưa xác định' : formatMoney(row.profit)}</td>
      <td>
        {row.lockStatus === 'LOCKED'
          ? <span className="shipment-debit-row__lock shipment-debit-row__lock--locked"><Lock size={13} aria-hidden="true" />Đã khóa</span>
          : <span className="shipment-debit-row__lock shipment-debit-row__lock--open"><Unlock size={13} aria-hidden="true" />Đang mở</span>}
      </td>
    </tr>
      {expanded && (
        <tr className="shipment-debit-expand">
          <td colSpan={9}>
            <ShipmentDebitWorkspace shipmentId={row.shipmentId} locked={row.lockStatus === 'LOCKED'} onSaved={onSaved} />
          </td>
        </tr>
      )}
    </>
  );
}

export function ShipmentDebitPage() {
  const [params, setSearchParams] = useQueuedSearchParams();
  const updateParam = (key: string, value: string | null) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (!value) next.delete(key);
      else next.set(key, value);
      return next;
    });
  };
  const customerId = params.get('customer') ?? '';
  const deliveryFrom = params.get('from') ?? '';
  const deliveryTo = params.get('to') ?? '';
  const lockStatus = (params.get('lock') ?? 'ALL') as 'ALL' | 'OPEN' | 'LOCKED';

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [issuing, setIssuing] = useState(false);
  const { toast } = useToast();

  // Xuất Debit Note: ONE issue call carries every selected locked lot id and
  // the backend builds the union document (per-lot line grouping preserved
  // inside). The idempotency key derives from the sorted selection, so
  // re-clicking the same selection replays the same document instead of
  // issuing a duplicate.
  async function exportSelectedLockedLots() {
    const ids = items
      .filter((row) => selectedIds.has(row.shipmentId) && row.lockStatus === 'LOCKED')
      .map((row) => row.shipmentId);
    if (ids.length === 0 || issuing) return;
    setIssuing(true);
    try {
      const selectionKey = `debit-note-${[...ids].sort((x, y) => x - y).join('-')}`;
      const { id: documentId } = await createDebitNoteBatch(ids, selectionKey);
      const blob = await exportDebitNoteFile(ids[0], documentId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `giay-bao-no-${items.find((row) => row.shipmentId === ids[0])?.code ?? ids[0]}.xlsx`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch {
      toast({ kind: 'error', message: 'Không xuất được Debit Note. Vui lòng thử lại.' });
    } finally {
      setIssuing(false);
    }
  }
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const bootstrap = useQuery({ queryKey: ['shipment-debit-bootstrap'], queryFn: () => tripClient.getBootstrap() });
  const summary = useQuery({
    queryKey: ['shipment-debit-summary', customerId, deliveryFrom, deliveryTo, lockStatus],
    queryFn: () => listShipmentDebitSummary({
      customerId: Number(customerId),
      deliveryDateFrom: deliveryFrom || null,
      deliveryDateTo: deliveryTo || null,
      lockStatus,
    }),
    enabled: customerId !== '' && Number.isFinite(Number(customerId)),
  });

  const customers = bootstrap.data?.customers ?? [];
  const items = summary.data?.items ?? [];
  const anyLockedSelected = items.some((row) => selectedIds.has(row.shipmentId) && row.lockStatus === 'LOCKED');

  return (
    <div className="shipment-debit-page">
      <Breadcrumbs items={[{ label: 'Tổng quan lô hàng', to: '/shipments' }, { label: 'Chi phí - Quyết toán' }]} />
      <PageHeader title="Chi phí - Quyết toán" iconName="cargo" description="Tổng hợp doanh thu - chi phí theo lô để quyết toán với khách hàng." />
      {summary.isError && <Alert variant="error">Không thể tải danh sách quyết toán. Vui lòng thử lại.</Alert>}

      <section className="shipment-debit-workspace" aria-label="Danh sách lô quyết toán" aria-busy={summary.isFetching}>
        <div className="shipment-debit-workspace__header">
          <div className="shipment-debit-filters">
            <USearchableField
              id="shipment-debit-customer"
              label="Khách hàng"
              value={customerId}
              onChange={(value) => {
                setSelectedIds(new Set());
                updateParam('customer', value || null);
              }}
              options={customers.map((customer) => ({ value: String(customer.id), label: customer.name }))}
              placeholder="Bắt buộc chọn khách hàng"
              searchable
            />
            <div className="shipment-debit-filters__dates">
              <BufferedUuiDateInput label="Từ ngày giao" size="sm" value={deliveryFrom} onChange={(value) => updateParam('from', value || null)} inputProps={{ max: deliveryTo || undefined }} />
              <BufferedUuiDateInput label="Đến ngày giao" size="sm" value={deliveryTo} onChange={(value) => updateParam('to', value || null)} inputProps={{ min: deliveryFrom || undefined }} />
            </div>
          </div>
          <div className="shipment-debit-toolbar">
            <UuiSelectField
              label="Trạng thái khóa lô"
              value={lockStatus}
              options={LOCK_FILTERS}
              onChange={(event) => { setSelectedIds(new Set()); updateParam('lock', event.target.value === 'ALL' ? null : event.target.value); }}
            />
            <UUIButton size="sm" isDisabled={!anyLockedSelected || issuing} onPress={() => { void exportSelectedLockedLots(); }}>
              Xuất Debit Note
            </UUIButton>
          </div>
        </div>
        {customerId === '' ? (
          <EmptyState title="Chưa chọn khách hàng" description="Chọn khách hàng để xem danh sách lô cần quyết toán." />
        ) : summary.isPending ? (
          <Skeleton height={320} />
        ) : items.length === 0 && !summary.isError ? (
          <EmptyState title="Không có lô nào" description="Không có lô nào khớp bộ lọc hiện tại." />
        ) : (
          <div className="shipment-debit-table-wrap">
            <table className="shipment-debit-table">
              <thead>
                <tr>
                  <th scope="col"><span className="sr-only">Chọn</span></th>
                  <th scope="col"><span className="sr-only">Mở rộng</span></th>
                  <th scope="col">THÔNG TIN LÔ HÀNG</th>
                  <th scope="col">Chứng từ</th>
                  <th scope="col">CƯỚC VẬN TẢI</th>
                  <th scope="col">TỔNG CHI HỘ</th>
                  <th scope="col">TỔNG PHẢI THU KHÁCH</th>
                  <th scope="col">LỢI NHUẬN</th>
                  <th scope="col">TRẠNG THÁI</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <DebitLotRow
                    key={row.shipmentId}
                    row={row}
                    expanded={expandedId === row.shipmentId}
                    onToggle={() => setExpandedId((current) => (current === row.shipmentId ? null : row.shipmentId))}
                    onSaved={() => summary.refetch()}
                    selected={selectedIds.has(row.shipmentId)}
                    onSelect={(id, next) => setSelectedIds((current) => {
                      const set = new Set(current);
                      if (next) set.add(id); else set.delete(id);
                      return set;
                    })}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default ShipmentDebitPage;
