import './ActionBar.css';
import { AlertTriangle, Check, ArrowRight, Loader2 } from 'lucide-react';
import { useTripFormContext } from '../../hooks/useTripFormContext';
import { isAnyUploading } from '../../hooks/useTripFormPhotos';
import { useFixedActionClearance } from '../../hooks/useFixedActionClearance';

interface ActionBarProps {
  loading?: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}

export function ActionBar({ loading, onCancel, onSubmit }: ActionBarProps) {
  const barRef = useFixedActionClearance<HTMLDivElement>('--trip-action-bar-height');
  const form = useTripFormContext();
  const allFilled = form.requiredFieldsFilled >= form.totalRequiredFields;
  // Leg validity gates the button with the SAME rule the submit path
  // enforces — the bar must never promise "ready" for a form that would
  // fail validation on submit.
  const legsReady = form.legsValid;
  const ready = allFilled && legsReady;
  const disabled = form.submitting || isAnyUploading(form.uploading) || loading;

  return (
    <>
      {form.error && <div className="form-alert form-alert--danger">{form.error}</div>}
      <div ref={barRef} className="tc-action-bar">
        <div className="tc-action-bar__status">
          <span className="tc-action-bar__status-icon">
            {allFilled
              ? <Check size={16} style={{ color: 'var(--accent)' }} />
              : <AlertTriangle size={16} style={{ color: 'var(--warning)' }} />}
          </span>
          <div>
            <div className="tc-action-bar__status-main">
              {allFilled && !legsReady
                ? 'Chặng chưa hợp lệ — cần đủ điểm đi, điểm đến và quãng đường không âm'
                : allFilled ? 'Sẵn sàng tạo lệnh' : `Còn ${form.totalRequiredFields - form.requiredFieldsFilled} trường bắt buộc chưa điền`}
            </div>
            <div className="tc-action-bar__status-sub">Điền đủ trường bắt buộc để bật nút "Tạo lệnh"</div>
          </div>
        </div>
        <div className="tc-action-bar__spacer" />
        <button className="btn btn--ghost" type="button" onClick={onCancel} disabled={form.submitting}>Hủy</button>
        <button className="btn btn--primary" id="trip-new-submit" type="button" disabled={disabled || !ready} onClick={onSubmit}>
          {form.submitting ? <Loader2 size={16} className="spin" /> : <ArrowRight size={16} />}
          Tạo lệnh
        </button>
      </div>
    </>
  );
}
