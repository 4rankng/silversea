// DriverProgressCard — M8.4 driver progress-event form + timeline.
//
// Wires the offline-queue lib (shipped two cycles ago) to the slice-1
// idempotent backend endpoint, so a flaky-network resubmit returns the
// original event instead of duplicating (PRD M08-04-03, Q23). The flow:
//
//   1. driver fills the form (eventType, occurredAt, note) → submit
//   2. enqueue a write into the offline queue with a client-generated UUID
//      v4 idempotency key
//   3. immediately drain the queue — when online, the send POSTs and lands;
//      when offline, the op stays QUEUED and the next drain retries
//   4. on DONE, refresh the timeline from the server
//
// The queue state surfaces inline ("đang gửi" / "đã lưu" / error). The
// component uses the production `offlineQueue` singleton (IndexedDB-backed)
// at runtime; tests inject `memoryStore` via `setStore`.

import { useCallback, useEffect, useState } from 'react';
import { Plus, Loader2, CheckCircle2, AlertTriangle, Clock } from 'lucide-react';
import { TextField, SelectField } from '../../design-system';
import {
  DriverProgressEventType,
  DRIVER_PROGRESS_EVENT_LABELS,
} from '@tingting/shared';
import { driverClient } from '../../api/driverClient';
import { offlineQueue, type QueuedOp } from '../../lib/offline-queue';
import { ApiError } from '../../lib/api/errors';
import { formatDateTimeShort } from '../../lib/format';

interface ProgressEvent {
  id: number;
  eventType: string;
  occurredAt: string;
  note: string | null;
  createdAt: string;
}

function toLocalDatetimeInputValue(iso: string): string {
  // datetime-local expects YYYY-MM-DDTHH:mm in local time.
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatEventTime(iso: string): string {
  return formatDateTimeShort(iso);
}

const EVENT_OPTIONS = Object.values(DriverProgressEventType);

export function DriverProgressCard({ tripId }: { tripId: number }) {
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form state
  const [eventType, setEventType] = useState<DriverProgressEventType>(DriverProgressEventType.DEPARTED);
  const [occurredAt, setOccurredAt] = useState(toLocalDatetimeInputValue(new Date().toISOString()));
  const [note, setNote] = useState('');

  // Submission state — mirrors the latest queued op for this card.
  const [pending, setPending] = useState<QueuedOp | null>(null);
  const [submitMsg, setSubmitMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await driverClient.listProgress(tripId);
      setEvents(res.items);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error && err.message ? err.message : 'Không thể tải tiến độ');
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => { refresh(); }, [refresh]);

  // The send callback the queue drains with. POSTs the progress event with
  // the op's id (the idempotency key) in the header. Maps the api result to
  // the queue's SendResult: a 409 from the server (same key, different body)
  // is a terminal CONFLICT; any other failure is retriable.
  const send = useCallback(async (op: QueuedOp) => {
    try {
      await driverClient.recordProgress(
        tripId,
        op.body as { eventType: DriverProgressEventType; occurredAt: string; note?: string },
        op.id,
      );
      return { ok: true } as const;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        return { ok: false, kind: 'conflict' as const, message: err.message };
      }
      const message = err instanceof Error && err.message ? err.message : 'Lỗi mạng';
      return { ok: false, kind: 'network' as const, message };
    }
  }, [tripId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSubmitMsg(null);
    // Convert datetime-local → ISO for the server.
    const occurredIso = new Date(occurredAt).toISOString();
    const body = { eventType, occurredAt: occurredIso, note: note.trim() || undefined };
    // Enqueue with the production singleton. The op's id is the idempotency
    // key reused on every retry, so the server-side dedupe (slice 1) makes a
    // replay safe.
    const op = await offlineQueue.enqueue({
      endpoint: 'driver.progress',
      method: 'POST',
      path: `/driver/me/trips/${tripId}/progress`,
      body,
    });
    setPending(op);
    try {
      const res = await offlineQueue.drain(send);
      if (res.done > 0) {
        setSubmitMsg({ kind: 'ok', text: 'Đã lưu tiến độ.' });
        setPending(null);
        setNote('');
        // Refresh the timeline so the new event appears.
        await refresh();
      } else if (res.failed > 0) {
        // The op is now FAILED in the queue; surface a retry hint. The next
        // drain (e.g. on reconnect or another submit) will retry it.
        const refreshed = await offlineQueue.listQueued();
        const mine = refreshed.find((o) => o.id === op.id) ?? null;
        setPending(mine);
        setSubmitMsg({
          kind: 'err',
          text: mine?.lastError ?? 'Không thể gửi ngay — sẽ thử lại khi có mạng.',
        });
      } else if (res.conflicts > 0) {
        setSubmitMsg({ kind: 'err', text: 'Khóa giao dịch trùng — vui lòng tạo mới.' });
        setPending(null);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="dt-section">
      <div className="dt-section__head">
        <span className="dt-section__title">Tiến độ chuyến</span>
      </div>
      <div className="dt-section__body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <SelectField
            label="Loại sự kiện"
            value={eventType}
            onChange={(e) => setEventType((e.target as HTMLSelectElement).value as DriverProgressEventType)}
            disabled={submitting}
          >
            {EVENT_OPTIONS.map((t) => (
              <option key={t} value={t}>{DRIVER_PROGRESS_EVENT_LABELS[t]}</option>
            ))}
          </SelectField>
          <TextField
            label="Thời điểm xảy ra"
            type="datetime-local"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
            disabled={submitting}
          />
          <TextField
            label="Ghi chú"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ví dụ: đổ 80 lít tại trạm Cát Lái"
            disabled={submitting}
            maxLength={1000}
          />
          <button
            type="submit"
            disabled={submitting}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              minHeight: 44, padding: '0 20px', background: submitting ? 'var(--fg-3)' : 'var(--accent, #2563eb)',
              color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 600,
              cursor: submitting ? 'not-allowed' : 'pointer', width: '100%',
            }}
          >
            {submitting ? (<><Loader2 size={16} className="spin" /> Đang gửi…</>) : (<><Plus size={16} /> Ghi tiến độ</>)}
          </button>
        </form>

        {/* Submission status (offline-queue state) */}
        {submitMsg && (
          <div role={submitMsg.kind === 'err' ? 'alert' : 'status'} data-testid="progress-submit-msg" style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12', fontSize: 14,
            color: submitMsg.kind === 'err' ? 'var(--danger)' : 'var(--ok, #16a34a)',
          }}>
            {submitMsg.kind === 'ok' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            <span>{submitMsg.text}</span>
          </div>
        )}
        {pending && pending.status !== 'DONE' && (
          <div data-testid="progress-pending" style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12', fontSize: 13,
            color: 'var(--warn, #d97706)', background: 'rgba(217,119,6,0.08)', borderRadius: 8,
          }}>
            <Clock size={14} />
            <span>Đang chờ gửi: {DRIVER_PROGRESS_EVENT_LABELS[(pending.body as { eventType?: DriverProgressEventType })?.eventType ?? DriverProgressEventType.NOTE]}</span>
          </div>
        )}

        {/* Timeline */}
        <div>
          {loading ? (
            <div style={{ color: 'var(--ink-3)', fontSize: 14, padding: '8px 0' }}>Đang tải tiến độ…</div>
          ) : loadError ? (
            <div style={{ color: 'var(--danger)', fontSize: 14, padding: '8px 0' }}>{loadError}</div>
          ) : events.length === 0 ? (
            <div style={{ color: 'var(--ink-3)', fontSize: 14, padding: '8px 0' }}>Chưa có sự kiện tiến độ.</div>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {events.map((ev) => (
                <li key={ev.id} style={{ display: 'flex', gap: 8, padding: '8px 12', border: '1px solid var(--border, #e5e7eb)', borderRadius: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, minWidth: 110 }}>
                    {DRIVER_PROGRESS_EVENT_LABELS[ev.eventType as DriverProgressEventType] ?? ev.eventType}
                  </div>
                  <div style={{ flex: 1, fontSize: 14 }}>
                    <div style={{ color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Clock size={12} /> {formatEventTime(ev.occurredAt)}
                    </div>
                    {ev.note && <div style={{ marginTop: 2 }}>{ev.note}</div>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
