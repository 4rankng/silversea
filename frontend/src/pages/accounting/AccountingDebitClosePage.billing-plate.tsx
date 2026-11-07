// FB-093 (card 191026100833) — the BKS báo khách (xe ảo) quick-edit panel for
// /accounting/chot-debit. Split out of AccountingDebitClosePage.tsx alongside
// columns.tsx / rounds.tsx: it is pure presentation over page-owned state
// (the ledger's `ShipmentContainerLedger.billingPlateEditor` is the law it
// copies — same field pair, same footer, same error role).
import { USearchableField } from '../../features/shipments/create/uui-searchable-field';
import { EditActions } from '../../features/shipments/detail/ShipmentContainerEditActions';

export interface BillingPlateEditorProps {
  /** The lot under edit, named in the panel header so the accountant knows
   *  WHICH row the save will touch (the trigger is a cell inside a wide
   *  scrolling matrix). */
  lotLabel: string;
  draft: string;
  onDraftChange: (next: string) => void;
  saving: boolean;
  error: string | null;
  plateOptions: Array<{ value: string; label: string; searchText?: string }>;
  onSave: () => void;
  onCancel: () => void;
}

export function BillingPlateEditor({
  lotLabel,
  draft,
  onDraftChange,
  saving,
  error,
  plateOptions,
  onSave,
  onCancel,
}: BillingPlateEditorProps) {
  return (
    <section className="debit-billing-editor" aria-label={`Sửa BKS ảo — ${lotLabel}`}>
      <div className="debit-billing-editor__grid">
        <USearchableField
          label="BKS ảo"
          value={draft}
          onChange={onDraftChange}
          onCustomValue={onDraftChange}
          options={plateOptions}
          placeholder="Chọn hoặc nhập BKS"
          allowsCustomValue
          searchable
          disabled={saving}
        />
      </div>
      <div className="debit-billing-editor__footer">
        {error
          ? <span className="debit-billing-editor__error" role="alert">{error}</span>
          : <small>BKS ảo là biển số in cho khách.</small>}
        <EditActions
          saving={saving}
          // KB 3.6.6 / spec 23/10 §4.1: "BKS báo khách" is the CUS's OWN
          // output and MAY be blank — a blank draft is a CLEAR (the wire
          // carries `billingTruckNo: null`), so the Save button must stay
          // LIVE on an empty field. `EditActions` still disables it while the
          // save is in flight (`saving`).
          saveDisabled={false}
          label="BKS ảo"
          onCancel={onCancel}
          onSave={onSave}
        />
      </div>
    </section>
  );
}
