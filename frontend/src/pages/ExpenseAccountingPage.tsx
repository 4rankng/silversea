import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/UI';
import { ExpenseAccountingWorkspace } from '../features/expense-accounting/ExpenseAccountingWorkspace';

/**
 * `/accounting/expenses` — the accountant's expense workspace.
 *
 * The screen names itself with the page-header primitive and the app-wide term
 * for it (`Chi phí phát sinh` — the sidebar label and the search registry entry).
 * It used to print a private `<header>` with a second name for the same concept
 * (`Chi phí và đối chiếu`) and its own back link; law §8 keeps ONE term per
 * concept, and `docs/design-system/04-*` bans a bespoke title block per page.
 */
export default function ExpenseAccountingPage() {
  const navigate = useNavigate();
  return (
    <div className="expense-accounting">
      <PageHeader title="Chi phí phát sinh" onBack={() => navigate('/accounting')} />
      <ExpenseAccountingWorkspace />
    </div>
  );
}
