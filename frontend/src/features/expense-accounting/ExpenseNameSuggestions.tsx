import { OPS_EXPENSE_SUGGESTIONS, type ExpenseCostGroup } from '@tingting/shared';
import './ExpenseNameSuggestions.css';

export function ExpenseNameSuggestions({ group, disabled, onChoose }: { group: ExpenseCostGroup; disabled?: boolean; onChoose: (name: string) => void }) {
  const names = OPS_EXPENSE_SUGGESTIONS.find(item => item.group === group)?.names;
  if (!names?.length) return null;
  return <details className="expense-name-suggestions"><summary>Gợi ý khoản chi</summary><div>{names.map(name => <button key={name} type="button" className="btn btn--ghost btn--sm" disabled={disabled} onClick={() => onChoose(name)}>{name}</button>)}</div></details>;
}
