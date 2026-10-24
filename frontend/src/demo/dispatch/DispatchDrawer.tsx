/**
 * Slide-over Drawer chi tiết chuyến (spec §1.4, SIL-158): trượt từ phải,
 * 40% chiều rộng desktop (full-width mobile), 3 khối — phân bổ phương tiện,
 * thông số cont & chứng từ hiện trường, cấu hình phí nâng/hạ.
 *
 * Overlay MECHANICS dùng đúng stack house (review độc lập 24/10, AGENTS §3
 * "one pattern, one shared implementation"): usePortalTarget +
 * useAnimatedOverlay (scrim, animation, focus return, overlay stacking) +
 * useFocusTrap + useScrollLock + useConfirmShortcuts (Escape nhường cho
 * picker lồng nhau). Chrome bề mặt giữ nguyên geometry consult Gemini 24/10:
 * header h-16 (64px) px-6; body p-6 space-y-6 cuộn; footer sticky h-[72px]
 * shadow 0 -4px 12px; actions gap-3 justify-end (Hủy secondary, Lưu primary).
 */
import { useEffect, useRef, useState } from 'react';
import { animate, utils } from 'animejs';
import { Camera01, Copy01, FileAttachment01, Image01, Truck01, XClose } from '@untitledui/icons';
import { Button } from '@/components/untitled-ui/base/buttons/button';
import { Checkbox } from '@/components/untitled-ui/base/checkbox/checkbox';
import { Input } from '@/components/untitled-ui/base/input/input';
import { RadioGroup, RadioButton } from '@/components/untitled-ui/base/radio-buttons/radio-buttons';
import { useToastOptional } from '@/components/shared/Toast';
import { useConfirmShortcuts } from '@/design-system/Modal';
import { usePortalTarget } from '@/design-system/hooks/usePortalTarget';
import { useScrollLock } from '@/design-system/hooks/useScrollLock';
import { useAnimatedOverlay } from '@/hooks/useAnimatedOverlay';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { formatMoney } from '@/lib/format';
import { copyVehicleText, dropFee, liftFee, portName, surchargeFees } from './dispatch-model';
import { demoDrivers, demoTrucks, demoVendors } from '../data/seed';
import type { DemoPortFee, DemoTrip } from '../data/types';
import { UuiSelectField } from '@/design-system/forms/UuiSelectField';

/** Bản nháp chỉnh sửa: clone sâu phần dữ liệu có thể sửa trong drawer. */
function draftOf(trip: DemoTrip): DemoTrip {
  return { ...trip, fees: trip.fees.map((f) => ({ ...f })) };
}

function SectionCard({
  step,
  title,
  children,
}: {
  step: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-secondary_alt bg-primary p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-primary">
        <span className="flex size-5 items-center justify-center rounded-full bg-brand-primary text-xs font-semibold text-brand-800">
          {step}
        </span>
        {title}
      </h3>
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

function FieldHint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-quaternary">{children}</p>;
}

function FeeEditor({
  label,
  fee,
  onChange,
}: {
  label: string;
  fee: DemoPortFee | undefined;
  onChange: (next: DemoPortFee | undefined) => void;
}) {
  if (!fee) {
    return (
      <div className="rounded-lg bg-secondary px-3 py-2.5">
        <p className="text-sm font-medium text-tertiary">{label}</p>
        <FieldHint>Chuyến trả vỏ tại bãi nâng — không phát sinh phí hạ.</FieldHint>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-secondary_alt p-4">
      <p className="text-sm font-semibold text-primary">{label}</p>
      <p className="mt-0.5 text-xs text-quaternary">
        Cảng {portName(fee.portId)} · HĐ: {fee.invoiceTo}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Input
          label="Đơn giá (VND)"
          size="sm"
          type="number"
          value={fee.amountVnd ? String(fee.amountVnd) : ''}
          onChange={(v) => onChange({ ...fee, amountVnd: Number(v) || 0 })}
        />
        <Input
          label="Mã đơn vị nhận hóa đơn"
          size="sm"
          value={fee.invoiceTo}
          onChange={(v) => onChange({ ...fee, invoiceTo: String(v) })}
        />
      </div>
      <div className="mt-3">
        <p className="text-sm font-medium text-secondary">Hình thức thanh toán</p>
        <RadioGroup
          value={fee.method}
          onChange={(method) =>
            onChange({
              ...fee,
              method: method as DemoPortFee['method'],
              ...(method === 'unc'
                ? { uncStatus: 'pending' as const, reimbursed: undefined }
                : { reimbursed: 'pending' as const, uncStatus: undefined }),
            })
          }
          className="mt-2 flex-row gap-6"
        >
          <RadioButton value="unc" label="Công ty chuyển khoản (UNC)" />
          <RadioButton value="driver-cash" label="Lái xe chi tiền mặt" />
        </RadioGroup>
        <FieldHint>Đề xuất từ biểu phí cảng: {formatMoney(fee.amountVnd)} đ</FieldHint>
      </div>
    </div>
  );
}

const EVIDENCE_TILES = [
  { icon: Camera01, label: 'Ảnh cánh cửa Cont' },
  { icon: FileAttachment01, label: 'Phiếu EIR nâng/hạ' },
  { icon: Image01, label: 'Biên lai thu phí cảng' },
] as const;

export function DispatchDrawer({
  isOpen,
  trip,
  onClose,
  onSave,
}: {
  isOpen: boolean;
  trip: DemoTrip | null;
  onClose: () => void;
  onSave: (next: DemoTrip) => void;
}) {
  const { toast } = useToastOptional() ?? {};
  const overlayRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const portalTarget = usePortalTarget();

  const { visible, handleClose, overlayToken } = useAnimatedOverlay({
    overlayRef,
    contentRef: asideRef,
    isOpen,
    onClose,
    entrance: (overlay, aside, prefersReduced) => {
      if (prefersReduced) {
        utils.set(overlay, { opacity: 1 });
        utils.set(aside, { translateX: '0%' });
        return;
      }
      utils.set(overlay, { opacity: 0 });
      animate(overlay, { opacity: [0, 1], duration: 180, ease: 'out(2)' });
      utils.set(aside, { translateX: '100%', willChange: 'transform' });
      animate(aside, {
        translateX: ['100%', '0%'],
        duration: 240,
        ease: 'out(3)',
      });
    },
    exit: (overlay, aside, onDone) => {
      animate(overlay, { opacity: 0, duration: 150, ease: 'in(2)' });
      animate(aside, {
        translateX: '100%',
        duration: 200,
        ease: 'in(2)',
        complete: onDone,
      });
    },
  });

  useFocusTrap(asideRef, visible);
  useScrollLock(visible);
  useConfirmShortcuts({ isOpen: visible, onCancel: handleClose, overlayToken });

  const [draft, setDraft] = useState<DemoTrip | null>(trip ? draftOf(trip) : null);
  /** Phụ phí bị bỏ tick: giữ nguyên để tick lại không mất số tiền gốc. */
  const removedSurchargeRef = useRef<DemoPortFee | null>(null);

  useEffect(() => {
    setDraft(trip ? draftOf(trip) : null);
    removedSurchargeRef.current = null;
  }, [trip]);

  if (!visible || !draft) return null;
  if (!portalTarget) return null;

  const truck = draft.truckId ? demoTrucks.find((t) => t.id === draft.truckId) : undefined;
  const driver = draft.driverId
    ? demoDrivers.find((d) => d.id === draft.driverId)
    : truck
      ? demoDrivers.find((d) => d.id === truck.defaultDriverId)
      : undefined;
  const vendor = draft.vendorId ? demoVendors.find((v) => v.id === draft.vendorId) : undefined;
  const surcharge = surchargeFees(draft)[0];
  const spec = draft.containerSpec;

  const setSource = (source: DemoTrip['source']) => {
    if (source === 'inhouse') {
      const first = demoTrucks[0];
      setDraft((d) =>
        d
          ? { ...d, source, vendorId: undefined, truckId: first.id, driverId: first.defaultDriverId }
          : d,
      );
    } else {
      setDraft((d) =>
        d
          ? { ...d, source, truckId: undefined, driverId: undefined, vendorId: demoVendors[0].id }
          : d,
      );
    }
  };

  const setTruck = (truckId: string) => {
    const next = demoTrucks.find((t) => t.id === truckId);
    setDraft((d) => (d ? { ...d, truckId, driverId: next?.defaultDriverId } : d));
  };

  const onCopyRegistration = async () => {
    const text = copyVehicleText({ truck, driver, vendor });
    try {
      await navigator.clipboard.writeText(text);
      toast?.({ kind: 'success', message: `Đã copy thông tin đăng ký xe: ${text}` });
    } catch {
      toast?.({ kind: 'error', message: 'Không copy được — trình duyệt chặn clipboard.' });
    }
  };

  const save = () => {
    onSave(draft);
    removedSurchargeRef.current = null;
    toast?.({ kind: 'success', message: `Đã lưu thay đổi chuyến ${draft.code}.` });
    handleClose();
  };

  const toggleSurcharge = (has: boolean) => {
    setDraft((d) => {
      if (!d) return d;
      const others = d.fees.filter((f) => f.kind !== 'surcharge');
      if (!has) {
        removedSurchargeRef.current = surchargeFees(d)[0] ?? null;
        return { ...d, fees: others };
      }
      const restored =
        removedSurchargeRef.current ??
        ({
          id: `${d.id}-sur`,
          kind: 'surcharge' as const,
          portId: d.liftPortId,
          amountVnd: 200_000,
          method: 'unc' as const,
          invoiceTo: d.fees[0]?.invoiceTo ?? '',
          uncStatus: 'pending' as const,
        } satisfies DemoPortFee);
      return { ...d, fees: [...others, restored] };
    });
  };

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 bg-overlay/50"
      data-testid="demo-dispatch-drawer"
      role="dialog"
      aria-modal="true"
      aria-label={trip ? `Chi tiết chuyến ${trip.code}` : 'Chi tiết chuyến'}
      onClick={(e) => {
        if (e.target === overlayRef.current) handleClose();
      }}
    >
      <aside
        ref={asideRef}
        className="absolute inset-y-0 right-0 flex w-full flex-col bg-primary shadow-xl sm:w-[40%] sm:min-w-[480px]"
      >
        {/* Header 64px */}
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-secondary_alt px-6">
          <Truck01 className="size-5 shrink-0 text-quaternary" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-md font-semibold text-primary">{draft.code}</p>
            <p className="truncate text-xs text-tertiary">
              {draft.contNo} · {draft.size}′ · {draft.routeText}
            </p>
          </div>
          <Button color="tertiary" iconLeading={XClose} aria-label="Đóng chi tiết chuyến" onPress={handleClose} />
        </header>

        {/* Body: 3 khối, cuộn */}
        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          <SectionCard step={1} title="Phân bổ phương tiện">
            <RadioGroup
              value={draft.source}
              onChange={(v) => setSource(v as DemoTrip['source'])}
              className="flex-row gap-6"
            >
              <RadioButton value="inhouse" label="Xe nhà" />
              <RadioButton value="vendor" label="Xe ngoài" />
            </RadioGroup>

            {draft.source === 'inhouse' ? (
              <>
                <UuiSelectField
                  label="Đầu kéo"
                  searchable={false}
                  options={demoTrucks.map((t) => ({ label: `${t.plate} — ${t.model}`, value: t.id }))}
                  value={draft.truckId ?? ''}
                  onChange={(e) => setTruck(e.target.value)}
                />
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-secondary px-3 py-2.5 text-sm">
                  <p className="font-medium text-primary">{driver?.fullName ?? '—'}</p>
                  <p className="text-right text-tertiary">Moóc {truck?.trailerPlate ?? '—'}</p>
                  <p className="text-xs text-tertiary">SĐT {driver?.phone ?? '—'}</p>
                  <p className="text-right text-xs text-tertiary">CCCD {driver?.idNumber ?? '—'}</p>
                </div>
              </>
            ) : (
              <UuiSelectField
                label="Nhà xe ngoài"
                searchable={false}
                options={demoVendors.map((v) => ({ label: v.name, value: v.id }))}
                value={draft.vendorId ?? ''}
                onChange={(e) => setDraft((d) => (d ? { ...d, vendorId: e.target.value } : d))}
              />
            )}

            <Button
              color="secondary"
              size="sm"
              iconLeading={Copy01}
              className="self-start"
              onPress={() => void onCopyRegistration()}
            >
              Copy thông tin đăng ký xe
            </Button>
          </SectionCard>

          <SectionCard step={2} title="Thông số cont & chứng từ hiện trường">
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Số Container"
                size="sm"
                value={draft.contNo}
                onChange={(v) => setDraft((d) => (d ? { ...d, contNo: String(v) } : d))}
              />
              <Input
                label="Số chì (Seal)"
                size="sm"
                value={spec?.sealNo ?? ''}
                onChange={(v) =>
                  setDraft((d) =>
                    d
                      ? {
                          ...d,
                          containerSpec: {
                            sealNo: String(v),
                            maxGrossKg: d.containerSpec?.maxGrossKg ?? 30480,
                            tareKg: d.containerSpec?.tareKg ?? 2200,
                          },
                        }
                      : d,
                  )
                }
              />
              <Input
                label="Max Gross (kg)"
                size="sm"
                type="number"
                value={spec?.maxGrossKg ? String(spec.maxGrossKg) : ''}
                onChange={(v) =>
                  setDraft((d) =>
                    d
                      ? {
                          ...d,
                          containerSpec: {
                            sealNo: d.containerSpec?.sealNo ?? '',
                            maxGrossKg: Number(v) || 0,
                            tareKg: d.containerSpec?.tareKg ?? 2200,
                          },
                        }
                      : d,
                  )
                }
              />
              <Input
                label="Tare (kg)"
                size="sm"
                type="number"
                value={spec?.tareKg ? String(spec.tareKg) : ''}
                onChange={(v) =>
                  setDraft((d) =>
                    d
                      ? {
                          ...d,
                          containerSpec: {
                            sealNo: d.containerSpec?.sealNo ?? '',
                            maxGrossKg: d.containerSpec?.maxGrossKg ?? 30480,
                            tareKg: Number(v) || 0,
                          },
                        }
                      : d,
                  )
                }
              />
            </div>
            <div>
              <p className="text-sm font-medium text-secondary">Ảnh hiện trường (lái xe tải từ app)</p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {EVIDENCE_TILES.map(({ icon: Icon, label }) => (
                  <figure
                    key={label}
                    className="flex aspect-[4/3] flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-secondary_alt bg-secondary text-center"
                  >
                    <Icon className="size-5 text-quaternary" aria-hidden="true" />
                    <figcaption className="px-1 text-xs leading-4 text-quaternary">{label}</figcaption>
                  </figure>
                ))}
              </div>
            </div>
          </SectionCard>

          <SectionCard step={3} title="Cấu hình chi phí nâng / hạ">
            <FeeEditor
              label="Phí nâng vỏ / hàng"
              fee={liftFee(draft)}
              onChange={(next) =>
                setDraft((d) =>
                  d ? { ...d, fees: d.fees.map((f) => (f.kind === 'lift' && next ? next : f)) } : d,
                )
              }
            />
            <FeeEditor
              label="Phí hạ bãi"
              fee={dropFee(draft)}
              onChange={(next) =>
                setDraft((d) =>
                  d ? { ...d, fees: d.fees.map((f) => (f.kind === 'drop' && next ? next : f)) } : d,
                )
              }
            />
            <div className="rounded-lg border border-secondary_alt p-4">
              <Checkbox
                label="Phụ phí cảng / vé bãi"
                isSelected={Boolean(surcharge)}
                onChange={toggleSurcharge}
              />
              {surcharge && (
                <div className="mt-3">
                  <Input
                    label="Số tiền phụ phí (VND)"
                    size="sm"
                    type="number"
                    value={surcharge.amountVnd ? String(surcharge.amountVnd) : ''}
                    onChange={(v) =>
                      setDraft((d) =>
                        d
                          ? {
                              ...d,
                              fees: d.fees.map((f) =>
                                f.kind === 'surcharge' ? { ...f, amountVnd: Number(v) || 0 } : f,
                              ),
                            }
                          : d,
                      )
                    }
                  />
                </div>
              )}
            </div>
          </SectionCard>
        </div>

        {/* Footer sticky 72px, actions gap-3 justify-end (consult) */}
        <footer className="flex h-[72px] shrink-0 items-center justify-end gap-3 border-t border-secondary_alt bg-primary px-6 shadow-[0_-4px_12px_var(--color-secondary_alt)]">
          <Button color="secondary" onPress={handleClose}>
            Hủy
          </Button>
          <Button color="primary" onPress={save} data-testid="demo-drawer-save">
            Lưu
          </Button>
        </footer>
      </aside>
    </div>
  );
}
