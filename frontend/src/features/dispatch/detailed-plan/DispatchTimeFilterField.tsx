import { useEffect, useState } from 'react';
import { TimeInput, isValidTime } from '../../../design-system/forms/TimeInput';

/** Keep partial time-bound edits local until the filter can apply a valid value. */
export function DispatchTimeFilterField({ label, value, onChange }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);

  return <TimeInput
    label={label}
    value={draft}
    className="detailed-plan-filters__hour-control"
    validateOnBlur
    onChange={(next) => {
      setDraft(next);
      if (next === '' || isValidTime(next)) onChange(next);
    }}
    onKeyDown={(event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.currentTarget.reportValidity();
      }
    }}
  />;
}
