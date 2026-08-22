import { RoleWorkInbox } from '../components/work-inbox/RoleWorkInbox';

export default function ForwarderTripsPage() {
  return (
    <RoleWorkInbox
      role="operations"
      title="Công việc vận hành"
      description="Ưu tiên bàn giao lệnh giấy, chứng từ và chi phí còn thiếu; hồ sơ chuyến vẫn là nơi xử lý chi tiết."
    />
  );
}
