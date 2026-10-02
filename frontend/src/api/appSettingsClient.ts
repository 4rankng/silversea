/** Typed API client for the admin-owned application feature switches. */
import { api } from '../lib/api';
import {
  EMAIL_SETTINGS_PATHS,
  type AppSettings,
  type EmailSettingsResponse,
  type EmailSettingsUpdate,
} from '@tingting/shared';
import type {
  FinancialReportingPolicyRequest,
  FinancialReportingPolicyState,
  TruckFinancialProfileRequest,
  TruckFinancialProfileState,
} from '@tingting/shared';
import { toQuery } from '../lib/http/query';

const APP_SETTINGS_PATH = '/admin/app-settings';
const FINANCIAL_REPORTING_POLICY_PATH = `${APP_SETTINGS_PATH}/financial-reporting/policy`;
const TRUCK_FINANCIAL_PROFILE_PATH = `${APP_SETTINGS_PATH}/financial-reporting/truck-profiles`;

export const appSettingsClient = {
  getSettings: () => api.get<AppSettings>(APP_SETTINGS_PATH),
  saveSettings: (settings: AppSettings) =>
    api.put<AppSettings>(APP_SETTINGS_PATH, settings),
  getEmailSettings: () => api.get<EmailSettingsResponse>(EMAIL_SETTINGS_PATHS.base),
  saveEmailSettings: (settings: EmailSettingsUpdate) =>
    api.put<EmailSettingsResponse>(EMAIL_SETTINGS_PATHS.base, settings),
  getFinancialReportingPolicy: () =>
    api.get<FinancialReportingPolicyState>(FINANCIAL_REPORTING_POLICY_PATH),
  // KP-147: the policy applies immediately — the retired /requests path
  // answers with the global 404 body ('Không tìm thấy API').
  requestFinancialReportingPolicy: (payload: FinancialReportingPolicyRequest) =>
    api.post(FINANCIAL_REPORTING_POLICY_PATH, payload),
  getTruckFinancialProfiles: (truckId: number | null) =>
    api.get<TruckFinancialProfileState>(
      `${TRUCK_FINANCIAL_PROFILE_PATH}${toQuery({ truckId: truckId ?? undefined })}`,
    ),
  requestTruckFinancialProfile: (payload: TruckFinancialProfileRequest) =>
    api.post(`${TRUCK_FINANCIAL_PROFILE_PATH}/requests`, payload),
};
