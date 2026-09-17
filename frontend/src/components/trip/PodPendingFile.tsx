interface PodPendingFileProps {
  name: string;
  busy: boolean;
  readOnly: boolean;
  onRetry: () => void;
  onDiscard: () => void;
}

export function PodPendingFile({ name, busy, readOnly, onRetry, onDiscard }: PodPendingFileProps) {
  return (
    <div className="trip-pod__pending" role="status">
      <span>Chưa gửi: <strong>{name}</strong></span>
      <div className="trip-pod__actions">
        <button type="button" className="trip-pod__action" disabled={busy || readOnly} onClick={onRetry}>Thử tải lại</button>
        <button type="button" className="trip-pod__action trip-pod__action--secondary" disabled={busy} onClick={onDiscard}>Bỏ tệp chưa gửi</button>
      </div>
    </div>
  );
}
