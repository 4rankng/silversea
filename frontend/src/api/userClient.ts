import { api } from '../lib/api';
import { AUTH } from '@tingting/shared';
import type { UserRow } from '../features/users/utils';

export const userClient = {
  getUsers: async () => {
    return api.get<{ items: UserRow[] }>(AUTH.USERS);
  },

  getUser: async (id: number) => {
    return api.get<UserRow>(AUTH.USER(id));
  },

  createUser: async (data: unknown) => {
    return api.post<UserRow>(AUTH.USERS, data);
  },

  updateUser: async (id: number, data: unknown) => {
    return api.patch<UserRow>(AUTH.USER(id), data);
  },

  deleteUser: async (id: number) => {
    return api.delete<UserRow>(AUTH.USER(id));
  },
};
