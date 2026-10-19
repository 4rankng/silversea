import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  createPhoiPhieuVoucher, getPhoiPhieuPartyLots, listPhoiPhieuStk,
  type PhoiPhieuPartyLot,
} from '../../api/phoiPhieuClient';
import { qk } from '../../api/keys';
import { billBookingReference } from '../../lib/business-reference';
import { formatCurrency, formatDate, formatMoney } from '../../lib/format';
import { Drawer } from '../../components/UI';
import { UuiSelectField } from '../../design-system';
import { Table } from '../../components/untitled-ui/application/table/table';
import { I18nProvider } from 'react-aria-components';
import type { Selection } from 'react-aria-components';

/** Card 191026160000 — the report row's drill-down ("bảng các lô chưa thanh
 *  toán" of the clicked khách hàng / nhà xe). Selection issues ONE batch phiếu
 *  through the same consolidated endpoint the board toolbar uses, so the quỹ
 *  engine — not this drawer — owns the postings. Table = the vendored Untitled
 *  UI PRO table (its own select-all header checkbox + per-row checkboxes). */
export function PhoiPhieuPartyLotsDrawer({ kind, party, dateFrom, dateTo, scope, onClose, onIssued }: {
  kind: 'THU' | 'TRA';
  party: string;
  dateFrom: string;
  dateTo: string;
  scope?: 'SELF' | 'ALL' | 'UNASSIGNED';
  onClose: () => void;
  onIssued: () => void;
}) {
  const lotsQuery = useQuery({
    queryKey: qk.phoiPhieu.partyLots(kind, party, dateFrom, dateTo, scope),
    queryFn: () => getPhoiPhieuPartyLots(kind, party, { dateFrom, dateTo, scope }),
  });
  const stkQuery = useQuery({ queryKey: qk.phoiPhieu.stk, queryFn: () => listPhoiPhieuStk() });
  const [selected, setSelected] = useState<Selection>(new Set<number>());
  const [treasuryAccountId, setTreasuryAccountId] = useState('');
  const [issuing, setIssuing] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const lots = useMemo(() => lotsQuery.data?.items ?? [], [lotsQuery.data]);
  const direction = kind === 'THU' ? 'IN' as const : 'OUT' as const;
  const verb = kind === 'THU' ? 'thu' : 'chi';
  const selectedLots = useMemo(() => selected === 'all'
    ? lots
    : lots.filter((lot) => selected.has(lot.tripId)), [lots, selected]);
  // The phiếu books each source's open remainder — the exact amount the
  // voucher engine will consume — not the lot's conLai remainder, which can
  // differ when a THU charge sits below the lot's cost.
  const voucherTotal = selectedLots.reduce((sum, lot) => sum + lot.entries.reduce((row, entry) => row + entry.amount, 0), 0);

  async function issue() {
    if (selectedLots.length === 0 || !treasuryAccountId || issuing) return;
    setIssuing(true);
    setMessage(null);
    try {
      const voucher = await createPhoiPhieuVoucher({
        tripIds: selectedLots.map((lot) => lot.tripId),
        direction,
        treasuryAccountId: Number(treasuryAccountId),
      });
      setMessage({ kind: 'ok', text: `Đã lập phiếu ${voucher.code}: ${voucher.entries} khoản, tổng ${formatCurrency(voucher.total)}.` });
      setSelected(new Set<number>());
      // The drawer STAYS OPEN on success: the message names the phiếu, the
      // query invalidation refreshes the remaining unpaid lots, and the
      // accountant can immediately issue the next batch.
      onIssued();
    } catch (error) {
      setMessage({ kind: 'err', text: error instanceof Error ? error.message : 'Không lập được phiếu.' });
    } finally {
      setIssuing(false);
    }
  }

  const disabledReason = selectedLots.length === 0
    ? 'Chọn ít nhất một lô'
    : !treasuryAccountId ? 'Chọn số tài khoản quỹ (STK)' : undefined;

  return (
    <Drawer
      isOpen
      onClose={onClose}
      title={`Lô chưa thanh toán — ${party}`}
      subtitle={`${kind === 'THU' ? 'Phải thu' : 'Phải trả'} · ${dateFrom || '…'} → ${dateTo || '…'}`}
      className="ppc-lots-drawer"
      footer={
        <div className="ppc-lots-bar" role="region" aria-label="Thanh hành động lập phiếu hàng loạt">
          <p className="ppc-lots-bar__count" role="status">
            {selectedLots.length === 0
              ? 'Chưa chọn lô nào'
              : `Đã chọn ${selectedLots.length} lô · Tổng lập phiếu: ${formatMoney(voucherTotal)} ₫`}
          </p>
          <UuiSelectField
            label="Số tài khoản quỹ (STK)"
            hideLabel
            ariaLabel="Số tài khoản quỹ (STK)"
            value={treasuryAccountId}
            onChange={(event) => setTreasuryAccountId(event.target.value)}
            options={[
              { value: '', label: '— Chọn STK —' },
              ...(stkQuery.data?.items ?? []).map((account) => ({ value: String(account.id), label: account.code + ' - ' + account.name })),
            ]}
            width="content"
          />
          <button
            type="button"
            className="btn btn--primary"
            disabled={issuing || selectedLots.length === 0 || !treasuryAccountId}
            title={disabledReason}
            onClick={() => void issue()}
          >
            {issuing ? 'Đang lập…' : `Lập phiếu ${verb} (${selectedLots.length})`}
          </button>
        </div>
      }
    >
      {message && <p role="status" style={{ color: message.kind === 'ok' ? 'var(--ok, #16a34a)' : 'var(--err, #dc2626)' }}>{message.text}</p>}
      {lotsQuery.isError && <p role="alert">Không tải được các lô của đối tượng này. Vui lòng thử lại.</p>}
      {lotsQuery.isSuccess && lots.length === 0 && (
        <p role="status">Không còn lô chưa thanh toán của {party} trong kỳ này.</p>
      )}
      {lots.length > 0 && (
        // react-aria's own selection strings (Select All / Select) localize
        // through the I18nProvider — the drawer speaks Vietnamese to AT.
        <I18nProvider locale="vi-VN">
        <Table
          aria-label={`Các lô chưa thanh toán của ${party}`}
          selectionMode="multiple"
          selectionBehavior="toggle"
          selectedKeys={selected}
          onSelectionChange={setSelected}
        >
          <Table.Header>
            <Table.Head isRowHeader>STT</Table.Head>
            <Table.Head id="bill">Số Bill / Booking</Table.Head>
            <Table.Head id="container">Container</Table.Head>
            <Table.Head id="date">Ngày</Table.Head>
            <Table.Head id="nang">Tiền nâng</Table.Head>
            <Table.Head id="ha">Tiền hạ</Table.Head>
            <Table.Head id="khac">PS khác</Table.Head>
            <Table.Head id="total">{kind === 'THU' ? 'Phải thu' : 'Phải trả'}</Table.Head>
            <Table.Head id="paid">{kind === 'THU' ? 'Đã thu' : 'Đã trả'}</Table.Head>
            <Table.Head id="remain">Còn lại</Table.Head>
          </Table.Header>
          <Table.Body items={lots}>
            {(lot: PhoiPhieuPartyLot) => (
              <Table.Row id={lot.tripId}>
                {/* isRowHeader lives on the STT column; the cell prints the
                    position so the mockup's numbered rows stay readable. */}
                <Table.Cell><span className="ppc-lots-ordinal">{lots.indexOf(lot) + 1}</span></Table.Cell>
                <Table.Cell>{billBookingReference(lot.billOrBooking)}</Table.Cell>
                <Table.Cell>{lot.containerNumber ?? '—'}</Table.Cell>
                <Table.Cell>{formatDate(lot.departureDate, { empty: '—' })}</Table.Cell>
                <Table.Cell>{formatMoney(lot.tienNang)}</Table.Cell>
                <Table.Cell>{formatMoney(lot.tienHa)}</Table.Cell>
                <Table.Cell>{formatMoney(lot.psKhac)}</Table.Cell>
                <Table.Cell><strong>{formatMoney(lot.total)}</strong></Table.Cell>
                <Table.Cell>{formatMoney(lot.daThuTra)}</Table.Cell>
                <Table.Cell>{formatMoney(lot.conLai)}</Table.Cell>
              </Table.Row>
            )}
          </Table.Body>
        </Table>
        </I18nProvider>
      )}
      <p className="ppc-lots-hint">Tổng lập phiếu cộng từng khoản còn mở của các lô đã chọn — đúng số phiếu sẽ ghi vào quỹ.</p>
    </Drawer>
  );
}
