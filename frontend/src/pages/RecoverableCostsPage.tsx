import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { RecoverableCostsWorkspace } from '../features/recoverable-costs/RecoverableCostsWorkspace';

export default function RecoverableCostsPage() {
  return (
    <div className="recoverable-costs-page">
      <Breadcrumbs
        className="recoverable-costs-page__breadcrumbs"
        items={[{ label: 'Lô hàng', to: '/shipments' }, { label: 'Chi phí cần kiểm tra' }]}
      />
      <RecoverableCostsWorkspace />
    </div>
  );
}
