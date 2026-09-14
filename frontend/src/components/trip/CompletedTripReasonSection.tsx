import { CardSection } from './CardSection';
import { TripStatus } from '@tingting/shared';

/**
 * Governance reason for completed-trip corrections (COMPLETED lots only).
 * Copy states the immediate-apply contract honestly instead of promising a
 * review flow that does not exist; the save button additionally confirms the
 * financial delta before commitment.
 */
export function CompletedTripReasonSection({ reason, onChange }: { reason: string; onChange: (value: string) => void }) {
  return (
    <CardSection
      number={0}
      span={2}
      title="Lý do điều chỉnh"
      subtitle="Cập nhật sẽ được áp dụng ngay cho chuyến đã hoàn thành"
    >
      <div className="tc-field">
        <label className="tc-field-label" htmlFor="governanceReason">
          Lý do <span style={{ color: 'var(--danger)', marginLeft: 3 }}>*</span>
        </label>
        <textarea
          id="governanceReason"
          className="input"
          rows={3}
          value={reason}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Nêu căn cứ và nội dung cần thay đổi"
          required
        />
      </div>
    </CardSection>
  );
}
