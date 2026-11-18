import { api } from '../lib/api';

/** Thành viên một nhóm CUS (join users — projection tối thiểu cho UI). */
export interface CusGroupMember {
  userId: number;
  name: string | null;
  username: string | null;
  status: string;
}

export interface CusGroup {
  id: number;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
  members: CusGroupMember[];
}

const PATH = '/auth/cus-groups';

export const cusGroupsClient = {
  list: async () => {
    return api.get<{ items: CusGroup[] }>(PATH);
  },

  create: async (data: { name: string }) => {
    return api.post<CusGroup>(PATH, data);
  },

  update: async (id: number, data: { name?: string; status?: 'ACTIVE' | 'INACTIVE' }) => {
    return api.put<CusGroup>(`${PATH}/${id}`, data);
  },

  /** Replace-all member set — editor gửi luôn full danh sách userId đã chọn. */
  setMembers: async (id: number, userIds: number[]) => {
    return api.put<CusGroup>(`${PATH}/${id}/members`, { userIds });
  },
};
