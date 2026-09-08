import { Loader2 } from 'lucide-react';

export interface CusDrawerFooterProps {
  isDirty: boolean;
  isSaving: boolean;
  onDiscard: () => void;
  onSave: () => void;
}

export function CusDrawerFooter({
  isDirty,
  isSaving,
  onDiscard,
  onSave,
}: CusDrawerFooterProps) {
  return (
    <div className="cus-drawer-footer">
      <div className="cus-drawer-footer__status">
        {isDirty ? (
          <span className="cus-drawer-footer__dirty-note">Có thay đổi container chưa lưu</span>
        ) : null}
      </div>
      <div className="cus-drawer-footer__actions">
        <button
          type="button"
          className="btn btn--ghost cus-drawer-footer__btn"
          onClick={onDiscard}
          disabled={!isDirty || isSaving}
        >
          Hủy
        </button>
        <button
          type="button"
          className="btn btn--primary cus-drawer-footer__btn cus-container-confirm"
          onClick={onSave}
          disabled={!isDirty || isSaving}
        >
          {isSaving ? <Loader2 className="spin" size={15} aria-hidden="true" /> : null}
          <span>{isSaving ? 'Đang lưu…' : 'Lưu'}</span>
        </button>
      </div>
    </div>
  );
}
