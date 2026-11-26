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
import { DateField, NumberField, UuiSelectField } from '../../design-system';
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
  // SIL-1099 (K2.113) — per-line Số tiền edits (partial collection). Keyed by
  // the OPS source id; '' = invalid/untouched-invalid, absent = engine default
  // (the source's full open remainder).
  const [amountEdits, setAmountEdits] = useState<Record<string, number | ''>>({});

  const lots = useMemo(() => lotsQuery.data?.items ?? [], [lotsQuery.data]);
  // SIL-729 — the two bookable shapes of one worklist: a trip lot books
  // through its trip; a shared shipment's fees (no single live trip) book
  // through their shipment (SIL-1030). Same phiếu engine either way.
  const tripLots = useMemo(
    () => lots.filter((lot): lot is PhoiPhieuPartyLot & { tripId: number } => lot.tripId != null),
    [lots],
  );
  const sharedLots = useMemo(() => lots.filter((lot) => lot.tripId == null), [lots]);
  const direction = kind === 'THU' ? 'IN' as const : 'OUT' as const;
  const verb = kind === 'THU' ? 'thu' : 'chi';
  // SIL-1030 — the selection key mirrors the service's lotKey: a trip lot is
  // its tripId; the shared lot (no single live trip) is the NEGATED
  // shipmentId, so one number set carries both tables' picks, never colliding.
  function lotSelectionKey(lot: PhoiPhieuPartyLot): number {
    return lot.tripId ?? -lot.shipmentId;
  }
  const selectedLots = useMemo(() => selected === 'all'
    ? lots
    : lots.filter((lot) => selected.has(lotSelectionKey(lot))), [lots, selected]);
  // The phiếu books each source's open remainder — the exact amount the
  // voucher engine will consume — not the lot's conLai remainder, which can
  // differ when a THU charge sits below the lot's cost. A multi-trip
  // shipment's money lists under its trip lots AND its shared lot; one open
  // fee books once, so the preview dedupes by source id (the engine does the
  // same server-side).
  const selectedEntries = useMemo(() => {
    const bySourceId = new Map<number, { lot: PhoiPhieuPartyLot; sourceId: number; amount: number; bucket: 'nang' | 'ha' | 'khac' }>();
    for (const lot of selectedLots) {
      for (const entry of lot.entries) {
        if (entry.amount > 0 && !bySourceId.has(entry.sourceId)) {
          bySourceId.set(entry.sourceId, { lot, sourceId: entry.sourceId, amount: entry.amount, bucket: entry.bucket });
        }
      }
    }
    return [...bySourceId.values()];
  }, [selectedLots]);
  const effectiveAmount = (row: { sourceId: number; amount: number }): number => {
    const edit = amountEdits[String(row.sourceId)];
    return typeof edit === 'number' ? edit : row.amount;
  };
  const amountInvalid = (row: { sourceId: number; amount: number }): boolean => {
    const edit = amountEdits[String(row.sourceId)];
    return edit === '' || (typeof edit === 'number' && (edit < 1 || edit > row.amount));
  };
  const voucherTotal = selectedEntries.reduce((sum, row) => sum + effectiveAmount(row), 0);

  // SIL-1030 (K6.13) — "bấm dòng bill phải chọn lô (đếm tăng)". The bill cell
  // is the explicit toggle (the row's own react-aria press path stays as the
  // checkbox fallback); stopPropagation keeps the two from double-toggling.
  function toggleLot(key: number) {
    setSelected((current) => {
      const next = new Set<number>(current === 'all' ? lots.map((lot) => lotSelectionKey(lot)) : [...(current as Set<number>)]);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  // SIL-1030 (K6.13 / mockup image9) — "Ô lập phiếu": one line per open fee
  // bucket of the selected lots, grouped per nhà xe with the group's own
  // subtotal (image10: "từng nhóm nhà xe có subtotal riêng"). Lines come from
  // the deduped selectedEntries, so a shipment picked through both a trip lot
  // and its shared lot prints once.
  const phieuGroups = useMemo(() => {
    const groups = new Map<string, { party: string; lines: Array<{ key: string; chiPhi: string; container: string; amount: number; note: string }>; subtotal: number }>();
    for (const row of selectedEntries) {
      const party = row.lot.party ?? '—';
      const group = groups.get(party) ?? { party, lines: [], subtotal: 0 };
      group.lines.push({
        key: String(row.sourceId),
        chiPhi: ENTRY_BUCKET_LABELS[row.bucket],
        container: row.lot.containerNumber ?? '—',
        amount: effectiveAmount(row),
        note: row.lot.ghiChu ?? '—',
      });
      group.subtotal += effectiveAmount(row);
      groups.set(party, group);
    }
    return [...groups.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- effectiveAmount closes over amountEdits
  }, [selectedEntries, amountEdits]);

  async function issue() {
    if (selectedLots.length === 0 || !treasuryAccountId || issuing) return;
    const invalid = selectedEntries.find((row) => amountInvalid(row));
    if (invalid) {
      setMessage({ kind: 'err', text: 'Số tiền từng khoản phải lớn hơn 0 và không vượt phần còn lại.' });
      return;
    }
    setIssuing(true);
    setMessage(null);
    try {
      // SIL-1030 — trip lots ride tripIds; the shared lot rides its negated
      // selection key's shipment id. Both-empty can't happen (issue is gated
      // on selectedLots.length).
      const tripIds = selectedLots.filter((lot): lot is PhoiPhieuPartyLot & { tripId: number } => lot.tripId != null).map((lot) => lot.tripId);
      const shipmentIds = selectedLots.filter((lot) => lot.tripId == null).map((lot) => lot.shipmentId);
      // SIL-1099 (K2.113) — edited per-line amounts ride along; untouched lines
      // keep the engine's full-remaining default.
      const amountBySourceId = Object.fromEntries(selectedEntries
        .filter((row) => amountEdits[String(row.sourceId)] !== undefined)
        .map((row) => [String(row.sourceId), effectiveAmount(row)]));
      const voucher = await createPhoiPhieuVoucher({
        tripIds,
        ...(shipmentIds.length > 0 ? { shipmentIds } : {}),
        direction,
        treasuryAccountId: Number(treasuryAccountId),
        valueDate,
        ...(Object.keys(amountBySourceId).length > 0 ? { amountBySourceId } : {}),
      });
      setMessage({ kind: 'ok', text: `Đã lập phiếu ${voucher.code}: ${voucher.entries} khoản, tổng ${formatCurrency(voucher.total)}.` });
      setSelected(new Set<number>());
      setAmountEdits({});
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

  // SIL-1030 reopen — the STT column is ONE counter running across every
  // party group's lines in render order; `groupIndex + lineIndex + 1`
  // restarted per group, so group 1's first line reprinted an earlier STT
  // (live THU repro: 1,2,3,4,5,2).
  let stt = 0;

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
                {phieuGroups.flatMap((group) => [
                  ...group.lines.map((line) => {
                    stt += 1;
                    return (
                      <tr key={line.key}>
                        <td data-label="STT">{stt}</td>
                        <td data-label="Nhà xe">{group.party}</td>
                        <td data-label="Chi phí">{line.chiPhi}</td>
                        <td data-label="Số container">{line.container}</td>
                        <td data-label="Số tiền">
                          {/* SIL-1099 (K2.113) — the accountant collects PART of a
                              khoản here: default = the full open remainder, capped
                              at it, so "luôn lấy trọn số còn mở" becomes a choice
                              instead of the only behavior. */}
                          <NumberField
                            controlSize="sm"
                            aria-label={`Số tiền · ${line.chiPhi}`}
                            value={amountEdits[line.key] ?? line.amount}
                            min={1}
                            max={line.amount}
                            step={1}
                            required
                            onChange={(amount) => setAmountEdits((current) => ({ ...current, [line.key]: amount }))}
                          />
                        </td>
                        <td data-label="Tổng tiền">—</td>
                        <td data-label="Ghi chú">{line.note}</td>
                      </tr>
                    );
                  }),
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
          <p className="ppc-lots-shared__title">Phí chung lô (chưa gắn chuyến) — bấm dòng bill để chọn lập phiếu:</p>
          {/* SIL-1027 (K6.6) — the shared fees read as the SAME money table as
              the trip lots above (bill, fee split, phải thu/trả, còn lại, Ghi
              chú as columns), never a bare 'bill · total · còn lại' list —
              reconciliation compares columns. SIL-1030 (K6.13): they are also
              the SAME selectable table — the shared lot books through its
              shipment (negated selection key), so its rows carry the same
              checkboxes and bill toggle as the trip ladder. Column classes are
              the trip ladder's, untouched. */}
          <I18nProvider locale="vi-VN">
          <Table
            aria-label="Phí chung lô chưa gắn chuyến"
            selectionMode="multiple"
            selectionBehavior="toggle"
            selectedKeys={selected}
            onSelectionChange={setSelected}
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
                <Table.Row id={-lot.shipmentId}>
                  <Table.Cell><span className="ppc-lots-ordinal">{lots.indexOf(lot) + 1}</span></Table.Cell>
                  {batch && <Table.Cell className="ppc-lots-party">{lot.party ?? '—'}</Table.Cell>}
                  <Table.Cell>
                    {/* SIL-1030 — "bấm dòng bill phải chọn lô": the shared lot's
                        bill cell is the same explicit toggle button as the trip
                        ladder's; stopPropagation keeps the row's own selection
                        press from double-toggling. */}
                    <button
                      type="button"
                      className="ppc-lots-bill-toggle"
                      aria-label={`Chọn lô ${billBookingReference(lot.billOrBooking)}`}
                      aria-pressed={selected === 'all' || selected.has(-lot.shipmentId)}
                      onClick={(event) => { event.stopPropagation(); toggleLot(-lot.shipmentId); }}
                    >
                      {billBookingReference(lot.billOrBooking)}
                    </button>
                  </Table.Cell>
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
          </I18nProvider>
        </div>
      )}
      <p className="ppc-lots-hint">Tổng lập phiếu cộng từng khoản còn mở của các lô đã chọn — đúng số phiếu sẽ ghi vào quỹ.</p>
    </Drawer>
  );
}
