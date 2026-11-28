import type { UsersListCounts } from './user.service';

export interface UsersKpiCountRow {
  role: string;
  status: string;
  count: number;
}

/**
 * SIL-1315 — dải KPI /users phải là PHÂN VÙNG cộng lại đúng bằng tổng:
 * trước đây chỉ ADMIN/MANAGER/ACCOUNTANT được đếm là 'Nhân sự văn phòng',
 * DRIVER đếm 'Lái xe' bất kể trạng thái, còn OPS/CUS/DISPATCHER/CUSTOMER
 * lọt khỏi mọi nhóm (72 = 10 + 43 + 1, thiếu 18) và tài khoản bị khoá bị
 * đếm hai lần (một lần theo vai trò, một lần theo 'Bị khoá / Ngưng').
 *
 * Phân vùng mới: ACTIVE chia theo vai trò (nhân sự / lái xe / khách hàng),
 * còn lại (mọi vai trò) vào 'Bị khoá / Ngưng' — bốn nhóm chặn trên kín,
 * không chồng lấn, cộng lại đúng `total` cho mọi tổ hợp vai trò/trạng thái.
 */
export function foldUsersKpiCounts(rows: UsersKpiCountRow[]): UsersListCounts {
  const counts: UsersListCounts = {
    total: 0,
    staffCount: 0,
    driverCount: 0,
    customerCount: 0,
    inactiveCount: 0,
    byRole: {},
  };
  for (const row of rows) {
    counts.total += row.count;
    counts.byRole[row.role] = (counts.byRole[row.role] ?? 0) + row.count;
    if (row.status !== 'ACTIVE') {
      counts.inactiveCount += row.count;
    } else if (row.role === 'DRIVER') {
      counts.driverCount += row.count;
    } else if (row.role === 'CUSTOMER') {
      counts.customerCount += row.count;
    } else {
      counts.staffCount += row.count;
    }
  }
  return counts;
}
