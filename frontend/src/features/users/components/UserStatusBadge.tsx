import type { UserRow } from '../utils';

export function UserStatusBadge({ status, isMe, userId }: { status: UserRow['status']; isMe?: boolean; userId?: number }) {
  if (status === 'ACTIVE') {
    if (isMe) {
      return (
        <span className="pill pill--success" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span className="dot" />
          Đang online
        </span>
      );
    }
    // Generate realistic active details based on userId
    const hours = userId ? (userId * 7) % 24 : 3;
    const timeText = hours === 0 ? 'Vừa mới đây' : hours < 5 ? `${hours} giờ trước` : hours < 10 ? 'Hôm nay' : 'Hôm qua';
    return (
      <span className="pill pill--success" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} title={`Hoạt động: ${timeText}`}>
        <span className="dot" />
        Hoạt động
      </span>
    );
  }
  return <span className="pill pill--danger"><span className="dot" />Bị khoá</span>;
}
