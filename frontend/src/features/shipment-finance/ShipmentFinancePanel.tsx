import { qk } from '../../api/keys';
import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Role, type ContainerDepositRecord } from '@tingting/shared';
import { shipmentFinanceClient } from '../../api/shipmentFinanceClient';
import { DateField, TextField } from '../../design-system';
import { UuiSelectField } from '../../design-system/forms/UuiSelectField';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../components/shared/Toast';
import { formatDate } from '../../lib/format';
import { ShipmentFinanceForm, type FinanceEditor } from './ShipmentFinanceForm';
import './ShipmentFinancePanel.css';

const money = (value: string) => `${Number(value).toLocaleString('vi-VN')} đ`;
const statusLabels: Record<ContainerDepositRecord['status'], string> = {
  WAITING_DOCUMENTS: 'Chưa nộp chứng từ', WAITING_REFUND: 'Chờ hoàn cược', PARTIAL: 'Đã hoàn một phần', REFUNDED: 'Đã hoàn đủ',
};

export function ShipmentFinancePanel({ shipmentId, readOnly = false, accountingLocked = false }: { shipmentId?: number; readOnly?: boolean; accountingLocked?: boolean }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const cache = useQueryClient();
  const financial = user?.role === Role.ADMIN || user?.role === Role.MANAGER || user?.role === Role.ACCOUNTANT;
  const [view, setView] = useState<'invoice' | 'deposit'>('invoice');
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [depositState, setDepositState] = useState('');
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<FinanceEditor | null>(null);
  const filters = { shipmentId, search, from, to, page, depositState: depositState ? depositState as 'OPEN' | 'REFUNDED' : undefined };
  const query = useQuery({ queryKey: qk.shipmentFinance.list(filters), queryFn: () => shipmentFinanceClient.list(filters), placeholderData: keepPreviousData });
  const activeView = financial ? view : 'invoice';
  const count = activeView === 'invoice' ? query.data?.invoiceTotal ?? 0 : query.data?.depositTotal ?? 0;
  const pageSize = query.data?.pageSize ?? 25;
  const canFollowUp = financial && query.data?.canWrite && !readOnly;
  const editable = canFollowUp && !accountingLocked;
  const openEditor = (next: FinanceEditor) => { if (editable || (canFollowUp && next.kind === 'deposit' && next.record)) setEditor(next); };

  return <section className="shipment-finance" aria-label="Hóa đơn và cược container">
    <header className="shipment-finance__header">
      <h3>{shipmentId ? 'Hồ sơ chi phí' : 'Hóa đơn & cược container'}</h3>
      {editable && <button className="btn btn--primary btn--sm" type="button" onClick={() => openEditor({ kind: activeView })}>
        {activeView === 'invoice' ? 'Thêm hóa đơn' : 'Thêm cược'}
      </button>}
    </header>
    {financial && <div className="shipment-finance__tabs" role="group" aria-label="Loại hồ sơ">
      <button type="button" aria-pressed={activeView === 'invoice'} onClick={() => { setView('invoice'); setPage(1); }}>Hóa đơn kết hợp</button>
      <button type="button" aria-pressed={activeView === 'deposit'} onClick={() => { setView('deposit'); setPage(1); }}>Cược container</button>
    </div>}
    <form className="shipment-finance__filters" onSubmit={(event) => { event.preventDefault(); setSearch(searchDraft.trim()); setPage(1); }}>
      <TextField controlSize="sm" className="shipment-finance__search" label="Tìm hồ sơ" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder={activeView === 'invoice' ? 'Số hóa đơn, Bill, khách hàng' : 'Bill, hãng tàu, khách hàng'} />
      <DateField controlSize="sm" label={activeView === 'invoice' ? 'Ngày hóa đơn từ' : 'Ngày cược từ'} value={from} onChange={(value) => { setFrom(value); setPage(1); }} />
      <DateField controlSize="sm" label="Đến ngày" value={to} onChange={(value) => { setTo(value); setPage(1); }} />
      {activeView === 'deposit' && <UuiSelectField label="Trạng thái" value={depositState} onChange={(event) => { setDepositState(event.target.value); setPage(1); }}
        options={[{ value: '', label: 'Tất cả' }, { value: 'OPEN', label: 'Chưa hoàn đủ' }, { value: 'REFUNDED', label: 'Đã hoàn đủ' }]} />}
      <button type="submit" className="btn btn--secondary btn--sm">Tìm</button>
      {(search || from || to || depositState) && <button type="button" className="btn btn--ghost btn--sm" onClick={() => {
        setSearch(''); setSearchDraft(''); setFrom(''); setTo(''); setDepositState(''); setPage(1);
      }}>Xóa lọc</button>}
    </form>
    {query.isError ? <p role="alert">Không tải được hồ sơ. <button type="button" className="btn btn--ghost" onClick={() => void query.refetch()}>Thử lại</button></p>
      : query.isPending ? <p role="status">Đang tải hồ sơ…</p>
        : <div aria-busy={query.isFetching}>
          <p className="shipment-finance__count">{count} hồ sơ{query.isFetching ? ' · Đang cập nhật…' : ''}</p>
          {count === 0 ? <p className="shipment-finance__hint">Chưa có {activeView === 'invoice' ? 'hóa đơn' : 'hồ sơ cược'} phù hợp.</p>
            : <div className="shipment-finance__rows">
              {activeView === 'invoice' ? query.data.invoices.map((record) => <article className="shipment-finance__row" key={record.id}>
                <div><strong>{record.invoiceNumber}</strong><span>{formatDate(record.invoiceDate)} · {record.supplierName}</span>
                  {!shipmentId && <Link to={`/shipments/${record.shipmentId}`}>{record.shipmentCode ?? `Lô ${record.shipmentId}`} · {record.customerName ?? 'Chưa có khách'}</Link>}</div>
                <dl><div><dt>Giá trị hóa đơn</dt><dd>{money(record.faceAmount)}</dd></div><div><dt>Chi phí hóa đơn</dt><dd>{money(record.supplierFeeAmount)}</dd></div></dl>
                {record.note && <p>{record.note}</p>}
                {editable && <button type="button" className="btn btn--ghost btn--sm" onClick={() => openEditor({ kind: 'invoice', record })}>Sửa hóa đơn {record.invoiceNumber}</button>}
              </article>) : query.data.deposits.map((record) => <article className="shipment-finance__row" key={record.id}>
                <div><strong>{record.billNumber}</strong><span>{record.shippingLineName} · {record.customerName ?? 'Chưa có khách'}</span>
                  {!shipmentId && <Link to={`/shipments/${record.shipmentId}`}>{record.shipmentCode ?? `Lô ${record.shipmentId}`}</Link>}
                  <span className={record.status === 'REFUNDED' ? 'shipment-finance__settled' : ''}>{statusLabels[record.status]}</span></div>
                <dl><div><dt>Tiền cược</dt><dd>{money(record.amount)}</dd></div><div><dt>Đã hoàn</dt><dd>{money(record.recoveredAmount)}</dd></div><div><dt>Còn lại</dt><dd>{money(record.outstandingAmount)}</dd></div></dl>
                <dl><div><dt>Ngày cược</dt><dd>{formatDate(record.depositDate)}</dd></div><div><dt>Nộp chứng từ</dt><dd>{formatDate(record.documentsSubmittedDate)}</dd></div><div><dt>Tiền về</dt><dd>{formatDate(record.refundReceivedDate)}</dd></div></dl>
                {record.note && <p>{record.note}</p>}
                {canFollowUp && <button type="button" className="btn btn--ghost btn--sm" onClick={() => openEditor({ kind: 'deposit', record })}>Cập nhật cược {record.billNumber}</button>}
              </article>)}
            </div>}
          {count > pageSize && <nav className="shipment-finance__pagination" aria-label="Trang hồ sơ">
            <button type="button" className="btn btn--ghost btn--sm" disabled={page === 1 || query.isFetching} onClick={() => setPage(page - 1)}>Trước</button>
            <span>Trang {page} / {Math.ceil(count / pageSize)}</span>
            <button type="button" className="btn btn--ghost btn--sm" disabled={page * pageSize >= count || query.isFetching} onClick={() => setPage(page + 1)}>Sau</button>
          </nav>}
        </div>}
    {editor && <ShipmentFinanceForm principalLocked={accountingLocked} editor={editor} shipmentId={shipmentId} onClose={() => setEditor(null)} onSaved={() => {
      setEditor(null); toast({ message: 'Đã lưu hồ sơ', kind: 'success' });
      void cache.invalidateQueries({ queryKey: qk.shipmentFinance.all });
      void cache.invalidateQueries({ queryKey: qk.expenseAccounting.all });
    }} />}
  </section>;
}
