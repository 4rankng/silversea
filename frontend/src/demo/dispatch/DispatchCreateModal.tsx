/**
 * Modal Tạo Chuyến Mới (spec §1.1, SIL-156): tạo nhanh 1 chuyến hoặc nhân
 * bản hàng loạt chuyến container từ cùng 1 mã Booking/Lệnh giao hàng.
 * Demo: chuyến mới chỉ tồn tại trong state trang (fixture-level), chưa phân
 * xe → trạng thái "Mới tạo".
 *
 * Overlay mechanics = house Modal `chrome="bare"` (portal, scrim, focus
 * trap, scroll lock, Escape nhường picker lồng nhau — review 24/10, AGENTS
 * §3); chrome bề mặt là của demo (header/body/footer per consult).
 */
import { useState } from 'react';
import { Plus, XClose } from '@untitledui/icons';
import { Button } from '@/components/untitled-ui/base/buttons/button';
import { Input } from '@/components/untitled-ui/base/input/input';
import { RadioGroup, RadioButton } from '@/components/untitled-ui/base/radio-buttons/radio-buttons';
import { Modal } from '@/design-system/Modal';
import { UuiSelectField } from '@/design-system/forms/UuiSelectField';
import { demoCustomers } from '../data/seed';
import type { DemoCargoFlow, DemoContainerSize, DemoTrip } from '../data/types';

export interface NewTripDraft {
  bookingNo: string;
  customerId: string;
  size: DemoContainerSize;
  flow: DemoCargoFlow;
  count: number;
}

/** Sinh các chuyến mới từ bản nháp — mã dựa trên đuôi mã booking. */
export function buildNewTrips(draft: NewTripDraft, date: string, startIndex: number): DemoTrip[] {
  const customer = demoCustomers.find((c) => c.id === draft.customerId);
  const suffix = draft.bookingNo.replace(/[^A-Z0-9]/gi, '').slice(-6).toUpperCase();
  return Array.from({ length: draft.count }, (_, i) => {
    const seq = startIndex + i + 1;
    return {
      id: `T-NEW-${suffix}-${seq}`,
      code: `CH-${date.slice(5, 7)}${date.slice(8, 10)}-N${String(seq).padStart(2, '0')}`,
      date,
      bookingNo: draft.bookingNo,
      contNo: `${suffix} ${String(1000000 + seq * 137)}`,
      size: draft.size,
      flow: draft.flow,
      source: 'inhouse',
      customerId: draft.customerId,
      liftPortId: 'CL',
      dropPortId: 'CL',
      routeText: `Cát Lái ➔ ${customer?.factory ?? 'Nhà máy'} ➔ Cát Lái`,
      freightVnd: 3_500_000,
      fees: [],
      timeline: [
        { start: '06:00', end: '07:00', label: 'Lấy lệnh & nâng vỏ @ Cát Lái' },
        { start: '07:00', end: '08:30', label: `Cát Lái ➔ ${customer?.factory ?? 'Nhà máy'}` },
        { start: '08:30', end: '09:30', label: 'Hạ hàng' },
      ],
    } satisfies DemoTrip;
  });
}

export function DispatchCreateModal({
  isOpen,
  onClose,
  onCreate,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (draft: NewTripDraft) => void;
}) {
  const [bookingNo, setBookingNo] = useState('');
  const [customerId, setCustomerId] = useState<string>(demoCustomers[0].id);
  const [size, setSize] = useState<DemoContainerSize>(40);
  const [flow, setFlow] = useState<DemoCargoFlow>('export');
  const [count, setCount] = useState(1);

  const valid = bookingNo.trim().length >= 4;

  const submit = () => {
    if (!valid) return;
    onCreate({ bookingNo: bookingNo.trim().toUpperCase(), customerId, size, flow, count });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Tạo Chuyến Mới"
      ariaLabel="Tạo chuyến mới"
      chrome="bare"
      backdropDismiss
    >
      <div className="w-full max-w-md" data-testid="demo-dispatch-create-modal">
        <div className="overflow-hidden rounded-2xl bg-primary shadow-xl">
          <header className="flex h-16 items-center gap-3 border-b border-secondary_alt px-6">
            <div className="min-w-0 flex-1">
              <h2 className="text-md font-semibold text-primary">Tạo Chuyến Mới</h2>
              <p className="text-xs text-tertiary">Nhân bản nhiều vỏ từ cùng 1 mã Booking</p>
            </div>
            <Button color="tertiary" iconLeading={XClose} aria-label="Đóng" onPress={onClose} />
          </header>

          <div className="flex flex-col gap-4 p-6">
            <Input
              label="Mã Booking / Lệnh giao hàng"
              size="sm"
              placeholder="Vd MSKU7648291"
              value={bookingNo}
              onChange={(v) => setBookingNo(String(v))}
              isInvalid={bookingNo.length > 0 && !valid}
            />
            <UuiSelectField
              label="Khách hàng / Chủ hàng"
              searchable={false}
              options={demoCustomers.map((c) => ({ label: `${c.code} — ${c.name}`, value: c.id }))}
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium text-secondary">Kích cỡ cont</p>
                <RadioGroup
                  value={String(size)}
                  onChange={(v) => setSize(Number(v) as DemoContainerSize)}
                  className="mt-2 flex-row gap-6"
                >
                  <RadioButton value="20" label="20′" />
                  <RadioButton value="40" label="40′" />
                </RadioGroup>
              </div>
              <div>
                <p className="text-sm font-medium text-secondary">Loại hình</p>
                <RadioGroup value={flow} onChange={(v) => setFlow(v as DemoCargoFlow)} className="mt-2 flex-row gap-6">
                  <RadioButton value="export" label="Xuất" />
                  <RadioButton value="import" label="Nhập" />
                </RadioGroup>
              </div>
            </div>
            <Input
              label="Số vỏ nhân bản"
              size="sm"
              type="number"
              value={String(count)}
              onChange={(v) => setCount(Math.max(1, Math.min(6, Number(v) || 1)))}
            />
          </div>

          <footer className="flex h-[72px] items-center justify-end gap-3 border-t border-secondary_alt px-6">
            <Button color="secondary" onPress={onClose}>
              Hủy
            </Button>
            <Button color="primary" iconLeading={Plus} isDisabled={!valid} onPress={submit} data-testid="demo-create-submit">
              Tạo {count > 1 ? `${count} chuyến` : 'chuyến'}
            </Button>
          </footer>
        </div>
      </div>
    </Modal>
  );
}
