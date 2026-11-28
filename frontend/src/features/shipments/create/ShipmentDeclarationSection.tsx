import { Plus, Trash2 } from 'lucide-react';
import { ShipmentCreateSection } from './ShipmentCreateSections';
import type {
  ShipmentContainerDraft,
  ShipmentCreateFormState,
} from './shipment-create-model';

type FormState = ShipmentCreateFormState;
type ContainerRow = ShipmentContainerDraft;

export interface ShipmentDeclarationSectionProps {
  form: FormState;
  containers: ReadonlyArray<ContainerRow>;
  saving: boolean;
  update: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  /** SIL-1144 (KB §3.4.1 "thao tác xóa là cục bộ từng dòng"): the per-row
   *  delete clears ONLY the named row's number — the workspace owns the
   *  local clear so the K2.13 typing fan-out never fires on a delete. */
  clearContainerDeclaration: (key: string) => void;
  /** FCL only: append one declaration slot (a new container row via the
   *  table's own row-add convention). LCL is single-declaration by law
   *  (§3.4.1 — the lot-level ô beside Số Bill/Booking), so no add button. */
  onAddDeclarationRow: () => void;
}

/** The §3.4.2 completeness voice: có tờ khai cấp container = ĐẦY ĐỦ; không
 *  có = VẪN THIẾU. The pill is a statement, never a validation gate — the
 *  declaration is optional on intake, so it never joins readiness. */
function CompletenessPill({ present }: { present: boolean }) {
  return (
    <span className={present ? 'csc-decl-pill csc-decl-pill--ok' : 'csc-decl-pill csc-decl-pill--missing'}>
      {present ? 'Đầy đủ' : 'Vẫn thiếu'}
    </span>
  );
}

/**
 * SIL-1144 (KB Chương 3 §3.4, QA-Retest4): the "Tờ khai hải quan" register —
 * the management band the create form was missing. Per §3.4.1 the EDITABLE
 * input stays where the law pins it (FCL: the container table's Số tờ khai
 * column; LCL: the ô beside Số Bill/Booking in Nhận diện lô); this band reads
 * those SAME values and carries the management affordances:
 *  - one row per declaration carrier (FCL: every container row; LCL: the
 *    lot-level number), each with the §3.4.2 ĐẦY ĐỦ / VẪN THIẾU pill;
 *  - a per-row delete that clears the number LOCALLY (siblings that share
 *    the number keep it — SIL-521 allows repeats);
 *  - FCL "Thêm tờ khai" appends a declaration slot row (the container
 *    table's row-add convention; KB §3.4.1's copy law re-fills a blank at
 *    save when the operator leaves it untouched).
 */
export function ShipmentDeclarationSection({
  form,
  containers,
  saving,
  update,
  clearContainerDeclaration,
  onAddDeclarationRow,
}: ShipmentDeclarationSectionProps) {
  const isFcl = form.cargoMode === 'FCL';
  return (
    <ShipmentCreateSection id="declaration" title="Tờ khai hải quan">
      {isFcl && (
        <div className="csc-decl-rows">
          {containers.map((row, index) => {
            const present = row.declarationNumber.trim() !== '';
            const context = row.containerNumber.trim() || `Container ${index + 1}`;
            return (
              <div key={row.key} className="csc-decl-row" data-field-id={`declaration-row-${index + 1}`}>
                <span className="csc-decl-row__context">{context}</span>
                <CompletenessPill present={present} />
                <span className={present ? 'csc-decl-row__value' : 'csc-decl-row__value csc-decl-row__value--empty'}>
                  {row.declarationNumber.trim() || 'Chưa có tờ khai'}
                </span>
                <button
                  type="button"
                  className="csc-icon-button csc-icon-button--danger"
                  aria-label={`Xóa tờ khai ${row.declarationNumber.trim() || `container ${index + 1}`}`}
                  title="Xóa tờ khai"
                  onClick={() => clearContainerDeclaration(row.key)}
                  disabled={saving || !present}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
            );
          })}
          <div data-field-id="declaration-add">
            <button
              type="button"
              className="csc-utility-button csc-utility-button--dashed"
              /* SIL-1144 (QA 28/11): the KB §10.6.7 names the button '+ Thêm
                 tờ khai' — the Plus icon paints the glyph, the accessible
                 name carries it verbatim. */
              aria-label="+ Thêm tờ khai"
              onClick={onAddDeclarationRow}
              disabled={saving}
            >
              <Plus size={15} aria-hidden="true" />Thêm tờ khai
            </button>
          </div>
        </div>
      )}
      {!isFcl && (() => {
        const present = form.declarationNumber.trim() !== '';
        return (
          <div className="csc-decl-row" data-field-id="declaration-row-lcl">
            <span className="csc-decl-row__context">Tờ khai cấp lô</span>
            <CompletenessPill present={present} />
            <span className={present ? 'csc-decl-row__value' : 'csc-decl-row__value csc-decl-row__value--empty'}>
              {form.declarationNumber.trim() || 'Chưa có tờ khai'}
            </span>
            <button
              type="button"
              className="csc-icon-button csc-icon-button--danger"
              aria-label={`Xóa tờ khai ${form.declarationNumber.trim() || 'cấp lô'}`}
              title="Xóa tờ khai"
              onClick={() => update('declarationNumber', '')}
              disabled={saving || !present}
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </div>
        );
      })()}
    </ShipmentCreateSection>
  );
}
