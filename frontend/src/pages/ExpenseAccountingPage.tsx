import { Link } from 'react-router-dom';
import { ExpenseAccountingWorkspace } from '../features/expense-accounting/ExpenseAccountingWorkspace';

export default function ExpenseAccountingPage() {
  return <div className="expense-accounting"><header className="expense-accounting-page-heading"><h1>Chi phí và đối chiếu</h1><Link to="/accounting" aria-label="Về không gian kế toán">← Kế toán</Link></header><ExpenseAccountingWorkspace /></div>;
}
