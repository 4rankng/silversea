import { CardSection } from './CardSection';

/**
 * Governance reason for completed-trip corrections (COMPLETED lots only).
 * Owner ruling 07/10 (card 394): the reason is OPTIONAL — it must never gate
 * the save, not even via the native `required` attribute (constraint
 * validation silently swallows the submit before React sees it). A reason the
 * user does supply is still recorded for the audit trail.
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
          Lý do
        </label>
        <textarea
          id="governanceReason"
          className="input"
          rows={3}
          value={reason}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Nêu căn cứ và nội dung cần thay đổi (tuỳ chọn)"
        />
      </div>
    </CardSection>
  );
}
