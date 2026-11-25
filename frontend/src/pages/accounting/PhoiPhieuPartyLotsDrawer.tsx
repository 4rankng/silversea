import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  createPhoiPhieuVoucher, getPhoiPhieuPartyLots, listPhoiPhieuStk,
  type PhoiPhieuPartyLot,
} from '../../api/phoiPhieuClient';
import { qk } from '../../api/keys';
import { billBookingReference } from '../../lib/business-reference';
import { formatCurrency, formatDate, formatMoney, businessDateISO } from '../../lib/format';
import { Drawer } from '../../components/UI';
import { DateField, UuiSelectField } from '../../design-system';
import { Table } from '../../components/untitled-ui/application/table/table';
import { I18nProvider } from 'react-aria-components';
import type { Selection } from 'react-aria-components';

/** SIL-1030 — "Chi phí" line names of the phiếu form (mockup image9: "Nâng
 *  hàng AXEU…", "Hạ vỏ AXEU…"), keyed by the open-remainder bucket. */
const ENTRY_BUCKET_LABELS: Record<'nang' | 'ha' | 'khac', string> = {
  nang: 'Nâng hàng',
  ha: 'Hạ hàng',
  khac: 'Phát sinh khác',
};

/** Card 191026160000 — the report row's drill-down ("bảng các lô chưa thanh
 *  toán" of the clicked khách hàng / nhà xe). Selection issues ONE batch phiếu
 *  through the same consolidated endpoint the board toolbar uses, so the quỹ
 *  engine — not this drawer — owns the postings. Table = the vendored Untitled
 *  UI PRO table (its own select-all header checkbox + per-row checkboxes).
 *
 *  SIL-916 (KB §6.1/§6.2): `party = null` is the BATCH drill-down the report's
 *  "Lập phiếu thu" / "Lập phiếu chi" buttons open — every party's unpaid lots
 *  in the window, one phiếu at the accountant's choice. It carries a party
 *  column (whose money is this?) and opens full-canvas: the shared 2/3 drawer
 *  cannot hold twelve columns without the phantom horizontal scroll the
 *  SIL-872 doctrine bans. The per-party drawer keeps its 2/3 width and its
 *  exact rendering. */
export function PhoiPhieuPartyLotsDrawer({ kind, party, dateFrom, dateTo, scope, onClose, onIssued }: {
  kind: 'THU' | 'TRA';
  /** The party to drill into; null = the batch drill-down (every party). */
  party: string | null;
  dateFrom: string;
  dateTo: string;
  scope?: 'SELF' | 'ALL' | 'UNASSIGNED';
  onClose: () => void;
  onIssued: () => void;
}) {
  const batch = party == null;
  const lotsQuery = useQuery({
    queryKey: qk.phoiPhieu.partyLots(kind, party, dateFrom, dateTo, scope),
    queryFn: () => getPhoiPhieuPartyLots(kind, party, { dateFrom, dateTo, scope }),
  });
  const stkQuery = useQuery({ queryKey: qk.phoiPhieu.stk, queryFn: () => listPhoiPhieuStk() });
  const [selected, setSelected] = useState<Selection>(new Set<number>());
  const [treasuryAccountId, setTreasuryAccountId] = useState('');
  // SIL-1030 (K6.13 / mockup image9) — "Ngày chi" of the phiếu form; the
  // voucher books on this date, defaulting to today.
  const [valueDate, setValueDate] = useState(businessDateISO());
  const [issuing, setIssuing] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const lots = useMemo(() => lotsQuery.data?.items ?? [], [lotsQuery.data]);
  // SIL-729 — a trip lot is bookable through the trip-keyed voucher engine; a
  // shared shipment's fees (no single live trip) only DISPLAY here for the
  // clicked party's reconciliation — they never join the batch phiếu.
  const tripLots = useMemo(
    () => lots.filter((lot): lot is PhoiPhieuPartyLot & { tripId: number } => lot.tripId != null),
    [lots],
  );
  const sharedLots = useMemo(() => lots.filter((lot) => lot.tripId == null), [lots]);
  const direction = kind === 'THU' ? 'IN' as const : 'OUT' as const;
  const verb = kind === 'THU' ? 'thu' : 'chi';
  const selectedLots = useMemo(() => selected === 'all'
    ? tripLots
    : tripLots.filter((lot) => selected.has(lot.tripId)), [tripLots, selected]);
  // The phiếu books each source's open remainder — the exact amount the
  // voucher engine will consume — not the lot's conLai remainder, which can
  // differ when a THU charge sits below the lot's cost.
  const voucherTotal = selectedLots.reduce((sum, lot) => sum + lot.entries.reduce((row, entry) => row + entry.amount, 0), 0);

  // SIL-1030 (K6.13) — "bấm dòng bill phải chọn lô (đếm tăng)". The bill cell
  // is the explicit toggle (the row's own react-aria press path stays as the
  // checkbox fallback); stopPropagation keeps the two from double-toggling.
  function toggleLot(tripId: number) {
    setSelected((current) => {
      const next = new Set<number>(current === 'all' ? tripLots.map((lot) => lot.tripId) : [...(current as Set<number>)]);
      if (next.has(tripId)) next.delete(tripId); else next.add(tripId);
      return next;
    });
  }

  // SIL-1030 (K6.13 / mockup image9) — "Ô lập phiếu": one line per open fee
  // bucket of the selected lots, grouped per nhà xe with the group's own
  // subtotal (image10: "từng nhóm nhà xe có subtotal riêng").
  const phieuGroups = useMemo(() => {
    const groups = new Map<string, { party: string; lines: Array<{ key: string; chiPhi: string; container: string; amount: number; note: string }>; subtotal: number }>();
    for (const lot of selectedLots) {
      const party = lot.party ?? '—';
      const group = groups.get(party) ?? { party, lines: [], subtotal: 0 };
      for (const entry of lot.entries) {
        if (entry.amount <= 0) continue;
        group.lines.push({
          key: `${lot.tripId}:${entry.sourceId}`,
          chiPhi: ENTRY_BUCKET_LABELS[entry.bucket],
          container: lot.containerNumber ?? '—',
          amount: entry.amount,
          note: lot.ghiChu ?? '—',
        });
        group.subtotal += entry.amount;
      }
      groups.set(party, group);
    }
    return [...groups.values()];
  }, [selectedLots]);

  async function issue() {
    if (selectedLots.length === 0 || !treasuryAccountId || issuing) return;
    setIssuing(true);
    setMessage(null);
    try {
      const voucher = await createPhoiPhieuVoucher({
        tripIds: selectedLots.map((lot) => lot.tripId),
        direction,
        treasuryAccountId: Number(treasuryAccountId),
        valueDate,
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
      title={batch ? 'Lô chưa thanh toán — tất cả đối tác' : `Lô chưa thanh toán — ${party}`}
      subtitle={`${kind === 'THU' ? 'Phải thu' : 'Phải trả'} · ${dateFrom || '…'} → ${dateTo || '…'}`}
      className={batch ? 'ppc-lots-drawer ppc-lots-drawer--batch' : 'ppc-lots-drawer'}
      // The batch worklist carries a party column: it opens full-canvas so the
      // twelve columns fit the 1440 canvas without the phantom horizontal
      // scroll the SIL-872 doctrine bans.
      defaultExpanded={batch}
      footer={
        <div className="ppc-lots-bar" role="region" aria-label="Thanh hành động lập phiếu hàng loạt">
          <p className="ppc-lots-bar__count" role="status">
            {selectedLots.length === 0
              ? 'Chưa chọn lô nào'
              : `Đã chọn ${selectedLots.length} lô · Tổng lập phiếu: ${formatMoney(voucherTotal)} ₫`}
          </p>
          <UuiSelectField
            label="Tài khoản chi (STK)"
            hideLabel
            ariaLabel="Tài khoản chi (STK)"
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
            {issuing ? 'Đang lập…' : `Xác nhận lập phiếu ${verb} (${selectedLots.length})`}
          </button>
        </div>
      }
    >
      {message && <p role="status" style={{ color: message.kind === 'ok' ? 'var(--ok, #16a34a)' : 'var(--err, #dc2626)' }}>{message.text}</p>}
      {lotsQuery.isError && <p role="alert">Không tải được các lô của đối tượng này. Vui lòng thử lại.</p>}
      {lotsQuery.isSuccess && lots.length === 0 && (
        <p role="status">{batch ? 'Không có lô chưa thanh toán trong kỳ này.' : `Không còn lô chưa thanh toán của ${party} trong kỳ này.`}</p>
      )}
      {/* SIL-1030 (K6.13 / KB §6.2, mockup image9) — "bấm dòng bill phải chọn
          lô (đếm tăng) và hiện các ô lập phiếu": ngày chi · tài khoản chi ở
          thanh dưới, bảng STT · Nhà xe · Chi phí · Số container · Số tiền ·
          Tổng tiền · Ghi chú (mỗi nhóm nhà xe một subtotal), dòng Tổng thanh
          toán, và nút Xác nhận. */}
      {selectedLots.length > 0 && (
        <section className="ppc-lots-phieu" aria-label="Ô lập phiếu">
          <h3 className="ppc-lots-phieu__title">Phiếu {verb} — {selectedLots.length} lô</h3>
          <div className="ppc-lots-phieu__fields">
            <DateField controlSize="sm" label="Ngày chi" value={valueDate} required onChange={setValueDate} />
          </div>
          <div className="record-table-wrap">
            <table className="record-table ops-table">
              <thead>
                <tr>
                  <th scope="col">STT</th>
                  <th scope="col">Nhà xe</th>
                  <th scope="col">Chi phí</th>
                  <th scope="col">Số container</th>
                  <th scope="col">Số tiền</th>
                  <th scope="col">Tổng tiền</th>
                  <th scope="col">Ghi chú</th>
                </tr>
              </thead>
              <tbody>
                {phieuGroups.flatMap((group, groupIndex) => [
                  ...group.lines.map((line, lineIndex) => (
                    <tr key={line.key}>
                      <td data-label="STT">{groupIndex + lineIndex + 1}</td>
                      <td data-label="Nhà xe">{group.party}</td>
                      <td data-label="Chi phí">{line.chiPhi}</td>
                      <td data-label="Số container">{line.container}</td>
                      <td data-label="Số tiền">{formatMoney(line.amount)}</td>
                      <td data-label="Tổng tiền">—</td>
                      <td data-label="Ghi chú">{line.note}</td>
                    </tr>
                  )),
                  <tr key={`subtotal-${group.party}`} className="ppc-lots-phieu__subtotal">
                    <td data-label="STT">—</td>
                    <td data-label="Nhà xe"><strong>{group.party}</strong></td>
                    <td data-label="Chi phí">Tổng</td>
                    <td data-label="Số container">—</td>
                    <td data-label="Số tiền">—</td>
                    <td data-label="Tổng tiền"><strong>{formatMoney(group.subtotal)}</strong></td>
                    <td data-label="Ghi chú">—</td>
                  </tr>,
                ])}
              </tbody>
            </table>
          </div>
          <p className="ppc-lots-phieu__total"><strong>Tổng thanh toán</strong>: {formatCurrency(voucherTotal)}</p>
        </section>
      )}
      {tripLots.length > 0 && (
        // react-aria's own selection strings (Select All / Select) localize
        // through the I18nProvider — the drawer speaks Vietnamese to AT.
        <I18nProvider locale="vi-VN">
        <Table
          aria-label={batch ? 'Các lô chưa thanh toán của mọi đối tác' : `Các lô chưa thanh toán của ${party}`}
          selectionMode="multiple"
          selectionBehavior="toggle"
          selectedKeys={selected}
          onSelectionChange={setSelected}
        >
          <Table.Header>
            {/* SIL-874 — each head carries its chốt-ladder class; the page CSS
                pins the % share + px floor on it (table-layout: fixed sizes
                every column from this header row). */}
            <Table.Head isRowHeader className="ppc-lots-col--stt">STT</Table.Head>
            {/* SIL-916 — the batch worklist crosses parties, so the row must
                name whose money it is. The per-party drawer knows its party
                from its title and does not repeat it. */}
            {batch && <Table.Head id="party" className="ppc-lots-col--party">Đối tác</Table.Head>}
            <Table.Head id="bill" className="ppc-lots-col--bill">Số Bill / Booking</Table.Head>
            <Table.Head id="container" className="ppc-lots-col--container">Container</Table.Head>
            {kind === 'TRA' && <Table.Head id="plate" className="ppc-lots-col--plate">Biển kiểm soát</Table.Head>}
            <Table.Head id="date" className="ppc-lots-col--date">Ngày</Table.Head>
            <Table.Head id="nang" className="ppc-lots-col--nang">Tiền nâng</Table.Head>
            <Table.Head id="ha" className="ppc-lots-col--ha">Tiền hạ</Table.Head>
            <Table.Head id="khac" className="ppc-lots-col--khac">PS khác</Table.Head>
            <Table.Head id="total" className="ppc-lots-col--total">{kind === 'THU' ? 'Phải thu' : 'Phải trả'}</Table.Head>
            <Table.Head id="paid" className="ppc-lots-col--paid">{kind === 'THU' ? 'Đã thu' : 'Đã trả'}</Table.Head>
            <Table.Head id="remain" className="ppc-lots-col--remain">Còn lại</Table.Head>
            {/* Ticket 18/11 Task 3.2 — the main board's composed Ghi chú carried
                down to each lot (CUS trước, điều vận sau — server-composed). */}
            <Table.Head id="ghichu" className="ppc-lots-col--ghichu">Ghi chú</Table.Head>
          </Table.Header>
          <Table.Body items={tripLots}>
            {(lot) => (
              <Table.Row id={lot.tripId}>
                {/* isRowHeader lives on the STT column; the cell prints the
                    position so the mockup's numbered rows stay readable. */}
                <Table.Cell><span className="ppc-lots-ordinal">{lots.indexOf(lot) + 1}</span></Table.Cell>
                {batch && <Table.Cell className="ppc-lots-party">{lot.party ?? '—'}</Table.Cell>}
                <Table.Cell>
                  {/* SIL-1030 — "bấm dòng bill phải chọn lô": the bill cell is
                      the explicit toggle button (works for mouse, keyboard and
                      script clicks); stopPropagation keeps the row's own
                      selection press from double-toggling. */}
                  <button
                    type="button"
                    className="ppc-lots-bill-toggle"
                    aria-label={`Chọn lô ${billBookingReference(lot.billOrBooking)}`}
                    aria-pressed={selected === 'all' || selected.has(lot.tripId)}
                    onClick={(event) => { event.stopPropagation(); toggleLot(lot.tripId); }}
                  >
                    {billBookingReference(lot.billOrBooking)}
                  </button>
                </Table.Cell>
                <Table.Cell>
                  {/* SIL-1015 (SIL-467 no-cut): container and date tokens never
                      break mid-string — same nowrap span the plate cell carries. */}
                  <span style={{ whiteSpace: 'nowrap' }}>{lot.containerNumber ?? '—'}</span>
                </Table.Cell>
                {kind === 'TRA' && <Table.Cell><span style={{ whiteSpace: 'nowrap' }}>{lot.plateNumber ?? '—'}</span></Table.Cell>}
                <Table.Cell><span style={{ whiteSpace: 'nowrap' }}>{formatDate(lot.departureDate, { empty: '—' })}</span></Table.Cell>
                <Table.Cell>{formatMoney(lot.tienNang)}</Table.Cell>
                <Table.Cell>{formatMoney(lot.tienHa)}</Table.Cell>
                <Table.Cell>{formatMoney(lot.psKhac)}</Table.Cell>
                <Table.Cell><strong>{formatMoney(lot.total)}</strong></Table.Cell>
                <Table.Cell>{formatMoney(lot.daThuTra)}</Table.Cell>
                <Table.Cell>{formatMoney(lot.conLai)}</Table.Cell>
                <Table.Cell className="ppc-lots-note">{lot.ghiChu ?? '—'}</Table.Cell>
              </Table.Row>
            )}
          </Table.Body>
        </Table>
        </I18nProvider>
      )}
      {sharedLots.length > 0 && (
        <div className="ppc-lots-shared" role="note">
          <p className="ppc-lots-shared__title">Phí chung lô (chưa gắn chuyến) — đối chiếu, chưa lập phiếu được:</p>
          {/* SIL-1027 (K6.6) — the shared fees read as the SAME money table as
              the trip lots above (bill, fee split, phải thu/trả, còn lại, Ghi
              chú as columns), never a bare 'bill · total · còn lại' list —
              reconciliation compares columns. Display only: the non-toggle
              selection behavior keeps the vendored select column and its
              checkboxes out entirely, so these rows can never join the batch
              phiếu. Column classes are the trip ladder's, untouched. */}
          <Table
            aria-label="Phí chung lô chưa gắn chuyến"
            selectionMode="none"
            selectionBehavior="replace"
          >
            <Table.Header>
              <Table.Head isRowHeader className="ppc-lots-col--stt">STT</Table.Head>
              {batch && <Table.Head id="party" className="ppc-lots-col--party">Đối tác</Table.Head>}
              <Table.Head id="bill" className="ppc-lots-col--bill">Số Bill / Booking</Table.Head>
              <Table.Head id="container" className="ppc-lots-col--container">Container</Table.Head>
              <Table.Head id="nang" className="ppc-lots-col--nang">Tiền nâng</Table.Head>
              <Table.Head id="ha" className="ppc-lots-col--ha">Tiền hạ</Table.Head>
              <Table.Head id="khac" className="ppc-lots-col--khac">PS khác</Table.Head>
              <Table.Head id="total" className="ppc-lots-col--total">{kind === 'THU' ? 'Phải thu' : 'Phải trả'}</Table.Head>
              <Table.Head id="paid" className="ppc-lots-col--paid">{kind === 'THU' ? 'Đã thu' : 'Đã trả'}</Table.Head>
              <Table.Head id="remain" className="ppc-lots-col--remain">Còn lại</Table.Head>
              <Table.Head id="ghichu" className="ppc-lots-col--ghichu">Ghi chú</Table.Head>
            </Table.Header>
            <Table.Body items={sharedLots}>
              {(lot) => (
                <Table.Row id={`s-${lot.shipmentId}`}>
                  <Table.Cell><span className="ppc-lots-ordinal">{lots.indexOf(lot) + 1}</span></Table.Cell>
                  {batch && <Table.Cell className="ppc-lots-party">{lot.party ?? '—'}</Table.Cell>}
                  <Table.Cell>{billBookingReference(lot.billOrBooking)}</Table.Cell>
                  <Table.Cell>{lot.containerNumber ?? '—'}</Table.Cell>
                  <Table.Cell>{formatMoney(lot.tienNang)}</Table.Cell>
                  <Table.Cell>{formatMoney(lot.tienHa)}</Table.Cell>
                  <Table.Cell>{formatMoney(lot.psKhac)}</Table.Cell>
                  <Table.Cell><strong>{formatMoney(lot.total)}</strong></Table.Cell>
                  <Table.Cell>{formatMoney(lot.daThuTra)}</Table.Cell>
                  <Table.Cell>{formatMoney(lot.conLai)}</Table.Cell>
                  <Table.Cell className="ppc-lots-note">{lot.ghiChu ?? '—'}</Table.Cell>
                </Table.Row>
              )}
            </Table.Body>
          </Table>
        </div>
      )}
      <p className="ppc-lots-hint">Tổng lập phiếu cộng từng khoản còn mở của các lô đã chọn — đúng số phiếu sẽ ghi vào quỹ.</p>
    </Drawer>
  );
}
