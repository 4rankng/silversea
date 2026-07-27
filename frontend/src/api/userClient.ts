import { api } from '../lib/api';
import { AUTH } from '@tingting/shared';
import type { BusinessUnit, UserRow } from '../features/users/utils';

export interface UsersResponse {
  items: UserRow[];
  total: number;
  businessUnits: BusinessUnit[];
}

const BUSINESS_UNITS_PATH = '/auth/business-units';

export const userClient = {
  getUsers: async () => {
    return api.get<UsersResponse>(AUTH.USERS);
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

  getBusinessUnits: async () => {
    return api.get<{ items: BusinessUnit[] }>(BUSINESS_UNITS_PATH);
  },

  createBusinessUnit: async (data: { code?: string | null; name: string; status?: 'ACTIVE' | 'INACTIVE' }) => {
    return api.post<BusinessUnit>(BUSINESS_UNITS_PATH, data);
  },

  updateBusinessUnit: async (id: number, data: { code?: string | null; name?: string; status?: 'ACTIVE' | 'INACTIVE' }) => {
    return api.patch<BusinessUnit>(`${BUSINESS_UNITS_PATH}/${id}`, data);
  },

  deactivateBusinessUnit: async (id: number) => {
    return api.delete<BusinessUnit>(`${BUSINESS_UNITS_PATH}/${id}`);
  },
};
