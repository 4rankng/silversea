interface PodPendingFileProps {
  name: string;
  busy: boolean;
  readOnly: boolean;
  /** SIL-1073 (K3.104, Layer 1) — the server refused the file CONTENT (400):
   *  the file is unreadable, not merely undelivered, so the lane carries the
   *  KB state label "Chưa đọc được" instead of "Chưa gửi". Retry/discard
   *  stay (the discard is the real way out; a fixed re-pick uploads anew). */
  unreadable?: boolean;
  onRetry: () => void;
  onDiscard: () => void;
}

export function PodPendingFile({ name, busy, readOnly, unreadable = false, onRetry, onDiscard }: PodPendingFileProps) {
  return (
    <div className={`trip-pod__pending${unreadable ? ' trip-pod__pending--unreadable' : ''}`} role="status">
      <span>{unreadable ? 'Chưa đọc được' : 'Chưa gửi'}: <strong>{name}</strong></span>
      <div className="trip-pod__actions">
        <button type="button" className="trip-pod__action" disabled={busy || readOnly} onClick={onRetry}>Thử tải lại</button>
        <button type="button" className="trip-pod__action trip-pod__action--secondary" disabled={busy} onClick={onDiscard}>Bỏ tệp chưa gửi</button>
      </div>
    </div>
  );
}
