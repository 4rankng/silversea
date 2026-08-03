/** Typed API client for the admin-owned application feature switches. */
import { api } from '../lib/api';
import type { PendingGovernanceResponse } from '../lib/governance';
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
} from '@tingting/shared/src/schemas/financial-reporting-policy';
import { toQuery } from '../lib/http/query';

const APP_SETTINGS_PATH = '/admin/app-settings';
const FINANCIAL_REPORTING_POLICY_PATH = `${APP_SETTINGS_PATH}/financial-reporting/policy`;
const TRUCK_FINANCIAL_PROFILE_PATH = `${APP_SETTINGS_PATH}/financial-reporting/truck-profiles`;

export const appSettingsClient = {
  getSettings: () => api.get<AppSettings>(APP_SETTINGS_PATH),
  saveSettings: (settings: AppSettings) =>
    api.put<AppSettings | PendingGovernanceResponse>(APP_SETTINGS_PATH, settings),
  getEmailSettings: () => api.get<EmailSettingsResponse>(EMAIL_SETTINGS_PATHS.base),
  saveEmailSettings: (settings: EmailSettingsUpdate) =>
    api.put<EmailSettingsResponse>(EMAIL_SETTINGS_PATHS.base, settings),
  getFinancialReportingPolicy: () =>
    api.get<FinancialReportingPolicyState>(FINANCIAL_REPORTING_POLICY_PATH),
  requestFinancialReportingPolicy: (payload: FinancialReportingPolicyRequest) =>
    api.post<PendingGovernanceResponse>(`${FINANCIAL_REPORTING_POLICY_PATH}/requests`, payload),
  getTruckFinancialProfiles: (truckId: number | null) =>
    api.get<TruckFinancialProfileState>(
      `${TRUCK_FINANCIAL_PROFILE_PATH}${toQuery({ truckId: truckId ?? undefined })}`,
    ),
  requestTruckFinancialProfile: (payload: TruckFinancialProfileRequest) =>
    api.post<PendingGovernanceResponse>(`${TRUCK_FINANCIAL_PROFILE_PATH}/requests`, payload),
};
