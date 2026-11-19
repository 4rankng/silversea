// Ticket 18/11 Task 1.2 — the [Hiện thông tin lô hàng team] switch for the
// two CUS workboards (Tổng quan lô hàng / Chi tiết lô hàng). Default OFF:
// each account only sees its own lots; ON threads `team=true` into the
// workspace list calls so same-ACTIVE-group creators' lots appear, with the
// per-row NV phụ trách line. The pages render it ONLY for role CUS, and the
// OFF default is per-mount state (no URL) — reopening a page always starts
// scoped to the account's own lots again.
import './CusTeamVisibilityToggle.css';

export interface CusTeamVisibilityToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
}

export function CusTeamVisibilityToggle({ checked, onChange }: CusTeamVisibilityToggleProps) {
  return (
    <label className="cus-team-visibility-toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>Hiện thông tin lô hàng team</span>
    </label>
  );
}
