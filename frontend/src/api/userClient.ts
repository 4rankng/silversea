import { api } from '../lib/api';
import { toQuery } from '../lib/http/query';
import { AUTH } from '@tingting/shared';
import type { BusinessUnit, UserRow } from '../features/users/utils';

/** List params for GET /users. All optional; omitted fields keep server defaults. */
export type UsersListParams = {
  search?: string;
  role?: string;
  page?: number;
  limit?: number;
  sortBy?: 'name' | 'role' | 'status' | 'date';
  sortOrder?: 'asc' | 'desc';
};

/** Aggregates for the /users KPI cards and role-filter pills (full visible set). */
export interface UsersListCounts {
  total: number;
  staffCount: number;
  driverCount: number;
  inactiveCount: number;
  byRole: Record<string, number>;
}

export interface UsersResponse {
  items: UserRow[];
  /** Filtered count — matches the search/role params, drives pagination. */
  total: number;
  businessUnits: BusinessUnit[];
  counts?: UsersListCounts;
}

const BUSINESS_UNITS_PATH = '/auth/business-units';

export const userClient = {
  getUsers: async (params?: UsersListParams) => {
    return api.get<UsersResponse>(`${AUTH.USERS}${toQuery(params)}`);
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

  /** Optimistic-lock token from the loaded unit row — the backend rejects
   *  PATCH/DELETE without it (428), so it is required, never optional. */
  updateBusinessUnit: async (
    id: number,
    data: { code?: string | null; name?: string; status?: 'ACTIVE' | 'INACTIVE' },
    expectedUpdatedAt: string,
  ) => {
    return api.patch<BusinessUnit>(`${BUSINESS_UNITS_PATH}/${id}`, data, { expectedUpdatedAt });
  },

  deactivateBusinessUnit: async (id: number, expectedUpdatedAt: string) => {
    return api.delete<BusinessUnit>(`${BUSINESS_UNITS_PATH}/${id}`, { expectedUpdatedAt });
  },
};
