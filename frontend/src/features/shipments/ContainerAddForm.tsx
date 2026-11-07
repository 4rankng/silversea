// SIL-717 (id 837) — the shared "Thêm container" form.
//
// ONE implementation of the affordance (AGENTS.md §3): the CUS Tổng quan drawer
// mounts it; the dispatch container drawer (SIL-550) keeps its own form until
// its lane adopts this one — see the ownership note in `containerCopyLaw.ts`.
//
// The form shows the two per-container identifiers EMPTY (the operator's own
// entry), prefills the weight the row above carries, and STATES the fields
// that ride along silently — the operator reads what the new row will carry
// before saving it, never guesses.

import { useEffect, useId, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { TextField, UuiSelectField } from '../../design-system';
import { Button as UUIButton } from '../../components/untitled-ui/base/buttons/button';
import type { ContainerAddCopy } from './containerCopyLaw';
import './ContainerAddForm.css';

/** What the operator types into the add form. */
export interface ContainerAddEntry {
  /** The operator's own entry — never copied. */
  containerNumber: string;
  /** The operator's own pick — empty means "no type yet", NOT "inherit". */
  containerTypeId: string;
  /** Copied from the row above, still adjustable before the save. */
  cargoWeightKg: string;
}

export interface ContainerAddFormProps {
  /** The row above's values — the copy seed. */
  copy: ContainerAddCopy;
  /** The container-type catalog (empty = the operator picks later). */
  containerTypes: { id: number; code: string }[];
  /** What the new row will carry besides the two identifiers. */
  copySummary: string;
  saving: boolean;
  error: string | null;
  onSubmit: (entry: ContainerAddEntry) => void;
  onCancel: () => void;
}

export function ContainerAddForm({
  copy,
  containerTypes,
  copySummary,
  saving,
  error,
  onSubmit,
  onCancel,
}: ContainerAddFormProps) {
  const id = useId();
  const numberId = `${id}-container-number`;
  const typeId = `${id}-container-type`;
  const weightId = `${id}-container-weight`;
  const [containerNumber, setContainerNumber] = useState('');
  const [containerTypeId, setContainerTypeId] = useState('');
  // The weight follows the SOURCE row until the operator types their own
  // value — a poll that refreshes the detail must not leave a stale seed.
  const [weightOverride, setWeightOverride] = useState<string | null>(null);
  const cargoWeightKg = weightOverride ?? copy.cargoWeightKg ?? '';
  const [numberError, setNumberError] = useState<string | null>(null);
  const numberRef = useRef<HTMLInputElement | null>(null);

  // The form takes focus when it opens: the trigger unmounts with it, so a
  // keyboard user would otherwise have to Tab from the document start. The
  // effect runs ONCE after the commit (a render-phase focus() would never
  // land — the ref is still null — and would steal the caret on a later
  // render instead).
  useEffect(() => {
    numberRef.current?.focus();
  }, []);

  // The submit stays ENABLED and the form validates on submit (a disabled
  // submit hides the reason from the operator — the accessibility rule).
  const submit = () => {
    if (saving) return;
    if (containerNumber.trim() === '') {
      setNumberError('Nhập số container.');
      numberRef.current?.focus();
      return;
    }
    setNumberError(null);
    onSubmit({ containerNumber, containerTypeId, cargoWeightKg });
  };

  const escapeCancels = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); }
  };

  return (
    <form
      className="container-add-form"
      // Enter inside a field submits the form (implicit submission); the
      // BUTTON rides its own onPress — the vendored button swallows the
      // native submit of a `type=submit` click, so a submit-typed button
      // would never reach this handler.
      onSubmit={(event) => { event.preventDefault(); submit(); }}
      aria-label="Thêm container mới"
    >
      <p className="container-add-form__caption">{copySummary}</p>
      <div className="container-add-form__row">
        <TextField
          id={numberId}
          label="Số container"
          required
          controlSize="sm"
          value={containerNumber}
          onChange={(event) => { setContainerNumber(event.target.value); if (numberError) setNumberError(null); }}
          placeholder="Nhập số cont"
          autoComplete="off"
          maxLength={50}
          disabled={saving}
          error={numberError ?? undefined}
          ref={numberRef}
          // Escape cancels the ADD SESSION, never the drawer around it (the
          // house pattern of every inline editor in the CUS drawer).
          onKeyDown={escapeCancels}
        />
        <UuiSelectField
          id={typeId}
          label="Loại container mới"
          size="sm"
          width="stretch"
          searchable={false}
          value={containerTypeId}
          placeholder="Chọn loại"
          disabled={saving}
          onChange={(event) => setContainerTypeId(event.target.value)}
          options={containerTypes.map((option) => ({ value: String(option.id), label: option.code }))}
        />
        <TextField
          id={weightId}
          label="Trọng lượng (kg)"
          controlSize="sm"
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          value={cargoWeightKg}
          onChange={(event) => setWeightOverride(event.target.value)}
          disabled={saving}
          onKeyDown={escapeCancels}
        />
        <div className="container-add-form__actions">
          <UUIButton size="sm" color="secondary" onPress={onCancel} isDisabled={saving}>
            Hủy
          </UUIButton>
          <UUIButton
            size="sm"
            color="primary"
            iconLeading={<Plus size={16} aria-hidden="true" />}
            onPress={submit}
            isDisabled={saving}
          >
            {saving ? 'Đang lưu…' : 'Thêm container'}
          </UUIButton>
        </div>
      </div>
      {error && <p className="container-add-form__error" role="alert">{error}</p>}
    </form>
  );
}
