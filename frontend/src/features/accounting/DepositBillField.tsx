// Card 20261005 — ô "Cược" Bill/Book trên phơi phiếu.
//
// Kế toán gõ 1–4 chữ số; hệ thống dò trong chính các lô hàng còn sống và gợi ý
// tối đa 5 dòng `reference · Hãng tàu · Tên khách hàng`. Bấm một dòng để chọn
// (KHÔNG tự chọn kết quả đầu tiên — máy không được quyết định cược thay người).
// Nút "Lưu" cạnh ô ghi cược xuống chuyến; khi đã lưu, dòng tóm tắt
// `Cược: {reference} · {customerName}` hiển thị cả khi ô nhập đang đóng.

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getPhoiPhieuDeposit,
  searchBillBook,
  setPhoiPhieuDeposit,
  type BillBookMatch,
} from '../../api/phoiPhieuClient';
import { qk } from '../../api/keys';
import { useDebouncedValue } from '../../design-system/hooks/useDebouncedValue';
import { TextField } from '../../design-system';
import { Btn } from '../../components/UI';

interface Props {
  tripId: number;
  onSaved?: () => void;
}

/** Ephemeral suggestion list — deliberately NOT in `qk`: it is a keystroke
 *  keystroke-scoped lookup, not a cached resource. */
const searchKey = (digits: string) => ['bill-book-search', digits] as const;

export function DepositBillField({ tripId, onSaved }: Props) {
  const queryClient = useQueryClient();
  const state = useQuery({
    queryKey: qk.phoiPhieu.deposit(tripId),
    queryFn: () => getPhoiPhieuDeposit(tripId),
  });

  const [digits, setDigits] = useState('');
  const [selected, setSelected] = useState<BillBookMatch | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');

  const debounced = useDebouncedValue(digits, 300);
  const numeric = /^[0-9]+$/.test(debounced);
  const matches = useQuery({
    queryKey: searchKey(debounced),
    queryFn: () => searchBillBook(debounced),
    enabled: numeric && debounced.length > 0,
  });

  const save = useMutation({
    mutationFn: async () => {
      const current = state.data;
      const expectedVersion = current?.tripVersion;
      if (expectedVersion == null) throw new Error('Chưa tải được số phiên chuyến.');
      return setPhoiPhieuDeposit(tripId, {
        depositShipmentId: selected?.shipmentId ?? current?.depositShipmentId ?? null,
        depositBillNumber: selected?.reference ?? current?.depositBillNumber ?? null,
        expectedVersion,
      });
    },
    onSuccess: () => {
      setError('');
      setSelected(null);
      setDigits('');
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: qk.phoiPhieu.deposit(tripId) });
      onSaved?.();
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Chưa lưu được cược.'),
  });

  // The summary line: the just-picked match when one exists, else the stored
  // deposit. `customerName` is only appended when actually known — never
  // invent one for a pre-existing deposit we cannot resolve.
  const reference = selected?.reference ?? state.data?.depositBillNumber ?? null;
  const customerName = selected?.customerName ?? state.data?.depositCustomerName ?? null;

  return (
    <div className="deposit-bill-field" data-testid="deposit-bill-field">
      {reference && (
        <p className="deposit-bill-field__summary" data-testid="deposit-bill-summary">
          Cược: {reference}
          {customerName ? ` · ${customerName}` : ''}
        </p>
      )}
      <div className="deposit-bill-field__row">
        <TextField
          controlSize="sm"
          label="Cược Bill/Book"
          value={digits}
          maxLength={4}
          inputMode="numeric"
          autoComplete="off"
          placeholder="Nhập 1–4 số"
          disabled={save.isPending}
          onChange={(event) => {
            const next = event.target.value.replace(/[^0-9]/g, '').slice(0, 4);
            setDigits(next);
            setSelected(null);
            setOpen(next.length > 0);
          }}
        />
        <Btn
          type="button"
          variant="secondary"
          size="sm"
          disabled={save.isPending || selected == null}
          onClick={() => save.mutate()}
        >
          {save.isPending ? 'Đang lưu…' : 'Lưu cược'}
        </Btn>
      </div>
      {error && <p role="alert" className="deposit-bill-field__error">{error}</p>}
      {open && numeric && matches.data && matches.data.items.length > 0 && (
        <ul className="deposit-bill-field__suggest" role="listbox" aria-label="Gợi ý Bill/Book">
          {matches.data.items.slice(0, 5).map((item) => (
            <li key={item.shipmentId}>
              <button
                type="button"
                className="deposit-bill-field__option"
                onClick={() => {
                  setSelected(item);
                  setOpen(false);
                }}
              >
                {item.reference}
                {item.shippingLineName ? ` · ${item.shippingLineName}` : ''}
                {item.customerName ? ` · ${item.customerName}` : ''}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default DepositBillField;
