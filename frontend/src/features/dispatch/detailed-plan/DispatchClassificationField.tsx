import type { DispatchClassification } from '@tingting/shared';
import { UuiSelectField } from '../../../design-system/forms/UuiSelectField';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';
import {
  classificationHint,
  classificationOptionsForRow,
  isLclPickup,
  withLclPickupShellTag,
} from './DispatchPlanCellValues';
import { useDispatchTaskTags } from './useDispatchTaskTags';

/**
 * The Phân loại control of the dispatch assignment dialog.
 *
 * Split out of `DispatchPlanEditorCell`, which sits on a frozen LOC ceiling.
 * It also owns the one behaviour here that is not a plain read/write of the
 * draft: choosing Lấy Lẻ pre-selects the shell tag in the driver task note.
 *
 * The option set keys on the row's CARGO MODE, never on the stored
 * classification — once a dispatcher saves LCL_PICKUP the stored value is no
 * longer LCL, and a classification-keyed list would offer that LCL lot the
 * cont models on the next reopen.
 */
export function DispatchClassificationField({
  row,
  classification,
  operationalNotes,
  onChange,
  disabled,
}: {
  row: DispatchDetailPlanRow;
  classification: DispatchClassification;
  operationalNotes: string | null;
  onChange: (next: DispatchClassification, nextNotes: string | null) => void;
  disabled: boolean;
}) {
  // Same cached query the task-tag editor runs, so seeding costs no extra
  // request. An unloaded pool simply skips the seed — the chip stays absent
  // and the classification plus the 40FT gate still stand on their own —
  // rather than writing a note segment that would parse back as free text.
  const { tags } = useDispatchTaskTags();

  return (
    <UuiSelectField
      label="Phân loại"
      width="content"
      wrapperClassName="dispatch-assignment-dialog__classification"
      value={classification}
      options={classificationOptionsForRow(row.cargoMode)}
      onChange={(event) => {
        const next = event.target.value as DispatchClassification;
        const labels = tags.map((tag) => tag.label);
        onChange(
          next,
          isLclPickup(next) && labels.length > 0
            ? withLclPickupShellTag(operationalNotes, labels)
            : operationalNotes,
        );
      }}
      disabled={disabled}
      hint={classificationHint(row.cargoMode, classification)}
    />
  );
}
