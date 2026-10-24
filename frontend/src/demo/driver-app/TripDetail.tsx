/**
 * Chi tiết lệnh chuyến — Layer 2 của ứng dụng lái xe demo (SIL-162, spec §5).
 *
 * Luồng OCR demo (consult SIL-162): bấm "Chụp Cửa Container (AI OCR)" →
 * thumbnail preview + badge "Đang đọc dữ liệu..." hiện ngay, sau 1,2s tự
 * điền 4 ô Số cont · Số chì · Max Gross · Tare (sửa tay được). Khu chứng
 * từ E-POD: EIR nâng / EIR hạ / biên lai. Nút "Hoàn thành chuyến" sticky
 * đáy màn hình.
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Camera01, CheckCircle, Image01, UploadCloud01 } from '@untitledui/icons';
import { Button } from '@/components/untitled-ui/base/buttons/button';
import { Input } from '@/components/untitled-ui/base/input/input';
import { cx } from '@/utils/cx';
import type { DemoTrip } from '../data';
import { OCR_READ_MS, attendanceTime, isTwinLiftTrip, ocrDemoValues, routeStops, type OcrFieldValues } from './derive';
import { TwinLiftBadge } from './TripCard';

type OcrState = 'idle' | 'reading' | 'done';

interface DocSlot {
  id: 'eir-lift' | 'eir-drop' | 'receipt';
  label: string;
  fileName: (trip: DemoTrip) => string;
}

const DOC_SLOTS: readonly DocSlot[] = [
  { id: 'eir-lift', label: 'EIR nâng', fileName: (t) => `eir-nang-${t.code}.jpg` },
  { id: 'eir-drop', label: 'EIR hạ', fileName: (t) => `eir-ha-${t.code}.jpg` },
  { id: 'receipt', label: 'Biên lai chi', fileName: (t) => `bien-lai-${t.code}.jpg` },
];

function OcrThumbnail({ reading }: { reading: boolean }) {
  return (
    <span
      className={cx(
        'relative flex size-20 shrink-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-lg bg-gradient-to-br from-utility-gray-100 to-utility-gray-200 ring-1 ring-inset ring-secondary_alt',
        reading && 'animate-pulse',
      )}
      aria-label="Ảnh cửa container"
    >
      <Camera01 className="size-6 text-fg-quaternary" aria-hidden="true" />
      <span className="px-1 text-center text-[10px] leading-tight text-fg-quaternary">Cửa container</span>
    </span>
  );
}

export interface TripDetailProps {
  trip: DemoTrip;
  completed: boolean;
  onBack: () => void;
  onComplete: (trip: DemoTrip) => void;
}

export function TripDetail({ trip, completed, onBack, onComplete }: TripDetailProps) {
  const [ocr, setOcr] = useState<OcrState>('idle');
  const [values, setValues] = useState<OcrFieldValues>({ contNo: '', sealNo: '', maxGrossKg: '', tareKg: '' });
  const [attached, setAttached] = useState<Record<string, boolean>>({});
  const timer = useRef<number | undefined>(undefined);

  // Hủy timer OCR khi rời màn hình — không setState sau unmount.
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const startOcr = () => {
    if (ocr !== 'idle') return;
    setOcr('reading');
    timer.current = window.setTimeout(() => {
      setValues(ocrDemoValues(trip));
      setOcr('done');
    }, OCR_READ_MS);
  };

  const stops = routeStops(trip);

  return (
    <div className="flex min-h-full flex-col" data-testid={`driver-trip-detail-${trip.id}`}>
      {/* Thanh quay lại + tiêu đề chuyến */}
      <div className="flex items-center gap-2">
        <Button color="secondary" size="sm" iconLeading={ArrowLeft} onPress={onBack}>
          Lệnh chuyến
        </Button>
        <span className="truncate text-sm font-semibold text-primary">{trip.code}</span>
        {isTwinLiftTrip(trip) && <TwinLiftBadge />}
      </div>

      {/* Tóm tắt lệnh */}
      <div className="mt-3 flex flex-col gap-1.5 rounded-xl border border-secondary_alt bg-primary p-3">
        <p className="text-sm font-semibold text-primary">
          {trip.contNo} · {trip.size}′ · {trip.flow === 'export' ? 'Hàng Xuất' : 'Hàng Nhập'}
        </p>
        <p className="text-xs text-tertiary">Booking {trip.bookingNo}{trip.billNo ? ` · Bill ${trip.billNo}` : ''}</p>
        <p className="text-xs text-secondary">
          Giờ có mặt <span className="font-semibold text-primary">{attendanceTime(trip)}</span> ·{' '}
          {stops.map((s) => s.label).join(' ➔ ')}
        </p>
        {trip.note && (
          <p className="mt-1 rounded-lg border border-error_subtle bg-error-primary px-2.5 py-2 text-xs leading-relaxed text-error-primary">
            {trip.note}
          </p>
        )}
      </div>

      {/* Chụp cửa container — AI OCR */}
      <section className="mt-3 flex flex-col gap-2.5" aria-label="Thông số vỏ container (AI OCR)">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-primary">Thông số vỏ container</h2>
          {ocr === 'reading' && (
            <span
              role="status"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-utility-blue-50 px-2 py-0.5 text-xs font-medium text-utility-blue-700 ring-1 ring-inset ring-utility-blue-200"
            >
              <span className="size-2 animate-pulse rounded-full bg-utility-blue-500" aria-hidden="true" />
              Đang đọc dữ liệu...
            </span>
          )}
        </div>

        <div className="flex items-start gap-3">
          {ocr !== 'idle' && <OcrThumbnail reading={ocr === 'reading'} />}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            {ocr === 'idle' ? (
              <Button color="primary" iconLeading={Camera01} onPress={startOcr} data-testid="ocr-capture-button">
                Chụp Cửa Container (AI OCR)
              </Button>
            ) : (
              <p className="flex items-center gap-1.5 text-xs font-medium text-utility-green-700">
                <CheckCircle className="size-4" aria-hidden="true" />
                {ocr === 'reading' ? 'Đang nhận diện ảnh…' : 'Đã điền từ ảnh — kiểm tra & sửa nếu cần'}
              </p>
            )}
            <p className="text-xs text-tertiary">Chụp ảnh cửa cont, AI tự đọc số cont, số chì, Max Gross, Tare.</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <Input label="Số cont" size="sm" value={values.contNo} onChange={(v) => setValues((s) => ({ ...s, contNo: v }))} />
          <Input label="Số chì" size="sm" value={values.sealNo} onChange={(v) => setValues((s) => ({ ...s, sealNo: v }))} />
          <Input
            label="Max Gross (kg)"
            size="sm"
            inputProps={{ inputMode: 'numeric' }}
            value={values.maxGrossKg}
            onChange={(v) => setValues((s) => ({ ...s, maxGrossKg: v }))}
          />
          <Input
            label="Tare (kg)"
            size="sm"
            inputProps={{ inputMode: 'numeric' }}
            value={values.tareKg}
            onChange={(v) => setValues((s) => ({ ...s, tareKg: v }))}
          />
        </div>
      </section>

      {/* Chứng từ E-POD */}
      <section className="mt-3 flex flex-col gap-2.5" aria-label="Chứng từ E-POD">
        <h2 className="text-sm font-semibold text-primary">Chứng từ E-POD (EIR &amp; biên lai)</h2>
        <div className="flex flex-col gap-2">
          {DOC_SLOTS.map((slot) => {
            const done = attached[slot.id];
            return (
              <div
                key={slot.id}
                className={cx(
                  'flex items-center gap-3 rounded-xl border border-dashed p-2.5',
                  done ? 'border-utility-green-300 bg-utility-green-50/40' : 'border-secondary_alt',
                )}
                data-testid={`doc-slot-${slot.id}`}
              >
                <span
                  className={cx(
                    'flex size-14 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset',
                    done ? 'bg-utility-green-50 ring-utility-green-200' : 'bg-secondary ring-secondary_alt',
                  )}
                >
                  {done ? (
                    <Image01 className="size-5 text-utility-green-700" aria-hidden="true" />
                  ) : (
                    <UploadCloud01 className="size-5 text-fg-quaternary" aria-hidden="true" />
                  )}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm font-medium text-primary">{slot.label}</span>
                  <span className="truncate text-xs text-tertiary">{done ? slot.fileName(trip) : 'Chưa tải lên'}</span>
                </span>
                {done ? (
                  <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-utility-green-700">
                    <CheckCircle className="size-4" aria-hidden="true" />
                    Đã tải lên
                  </span>
                ) : (
                  <Button
                    color="secondary"
                    size="sm"
                    iconLeading={Camera01}
                    onPress={() => setAttached((s) => ({ ...s, [slot.id]: true }))}
                  >
                    Tải lên
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Sticky đáy — hoàn thành chuyến */}
      <div className="sticky bottom-0 -mx-3 mt-3 border-t border-secondary_alt bg-primary px-3 py-3">
        {completed ? (
          <p className="flex items-center justify-center gap-1.5 rounded-lg bg-utility-green-50 py-2 text-sm font-semibold text-utility-green-700">
            <CheckCircle className="size-4" aria-hidden="true" />
            Chuyến đã hoàn thành
          </p>
        ) : (
          <Button
            color="primary"
            size="md"
            iconLeading={CheckCircle}
            className="w-full"
            onPress={() => onComplete(trip)}
            data-testid="complete-trip-button"
          >
            Hoàn thành chuyến
          </Button>
        )}
      </div>
    </div>
  );
}
