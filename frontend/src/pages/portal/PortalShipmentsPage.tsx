import { RoleWorkInbox } from '../../components/work-inbox/RoleWorkInbox';
import { useCustomerPortalScope } from './CustomerPortalScope';

export default function PortalShipmentsPage() {
  const { selectedCustomerId, ready } = useCustomerPortalScope();
  return (
    <RoleWorkInbox
      role="customer"
      title="Theo dõi lô hàng"
      description="Xác nhận khi đã nhận hàng hoặc báo sai lệch. Trạng thái giao luôn nêu rõ nguồn xác nhận."
      customerId={selectedCustomerId}
      scopeReady={ready}
    />
  );
}
