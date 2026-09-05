import { Router } from 'express';
import type { Request } from 'express';
import { Role } from '@tingting/shared';
import {
  appSettingsSchema,
  emailSettingsUpdateSchema,
  type EmailSettingsResponse,
  type AppSettings,
} from '@tingting/shared';
import {
  financialReportingPolicyRequestSchema,
  truckFinancialProfileRequestSchema,
  type FinancialReportingPolicyState,
  type TruckFinancialProfileState,
} from '@tingting/shared';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireRoles } from '../middleware/casbin';
import {
  applySavedAppSettings,
  getAppSettingsFrom,
  getAppSettings,
  getGovernedFinancialPolicyState,
  getAppSettingsUpdatedAt,
  GOVERNED_APP_SETTINGS_RESOURCE,
  saveDirectAppSettingsInTx,
} from '../services/app-settings.service';
import { maskKey } from '../services/crypto';
import {
  getEmailSettings,
  getEmailSettingsUpdatedAt,
  saveEmailSettingsInTx,
} from '../services/email-settings.service';
import {
  governedConfigVersionFromUpdatedAt,
  requestOrApplyGovernedConfigAction,
} from '../services/price-config-governance.service';
import { ApiError } from '../errors';
import { resolveIdempotencyKey, runIdempotent } from '../services/idempotency.service';
import {
  getFinancialReportingPolicyState,
  getTruckFinancialProfileState,
  requestFinancialReportingPolicyVersion,
  requestTruckFinancialProfileVersion,
} from '../services/financial-reporting-policy.service';

export const appSettingsRouter = Router();
const APP_SETTINGS_COMMANDS = {
  GENERAL_UPDATE: 'admin.app-settings.update',
  EMAIL_UPDATE: 'admin.app-settings.email.update',
  FINANCIAL_POLICY_REQUEST: 'admin.financial-reporting-policy.request',
  TRUCK_PROFILE_REQUEST: 'admin.truck-financial-profile.request',
} as const;

function hasDirectAppSettingsChange(previous: AppSettings, next: AppSettings): boolean {
  return previous.botEnabled !== next.botEnabled
    || previous.gpsEnabled !== next.gpsEnabled;
}

function hasFinancialPolicyAppSettingsChange(previous: AppSettings, next: AppSettings): boolean {
  return previous.creditWarningThresholdDefault !== next.creditWarningThresholdDefault
    || previous.creditTierOneAmountCap !== next.creditTierOneAmountCap
    || previous.salaryPayrollBusinessUnitId !== next.salaryPayrollBusinessUnitId;
}

function directAppSettingsOnly(previous: AppSettings, next: AppSettings) {
  return {
    ...previous,
    botEnabled: next.botEnabled,
    gpsEnabled: next.gpsEnabled,
  };
}

function financialPolicyOnly(settings: AppSettings) {
  return {
    creditWarningThresholdDefault: settings.creditWarningThresholdDefault,
    creditTierOneAmountCap: settings.creditTierOneAmountCap,
    salaryPayrollBusinessUnitId: settings.salaryPayrollBusinessUnitId,
  };
}

function emailSettingsResponse(
  resendApiKey: string,
  updatedAt: string | null,
): EmailSettingsResponse & { updatedAt: string | null } {
  return {
    resendKeySet: !!resendApiKey,
    resendKeyMasked: maskKey(resendApiKey),
    updatedAt,
  };
}

function requireIdempotencyKey(message: string, req: Request): string {
  const key = resolveIdempotencyKey({
    headerValue: req.header('Idempotency-Key'),
    requestId: req.body?._requestId,
  });
  if (!key) throw new ApiError(400, message);
  return key;
}

function parseExpectedUpdatedAt(req: Request): Date | null {
  const raw = req.header('If-Unmodified-Since')?.trim();
  if (!raw) return null;
  const expected = new Date(raw);
  if (Number.isNaN(expected.getTime())) {
    throw new ApiError(400, 'Phiên bản dữ liệu không hợp lệ.');
  }
  return expected;
}

function assertOptionalVersion(current: string | null, expected: Date | null, message: string): void {
  if (!current) return;
  if (!expected) throw new ApiError(428, message);
  if (new Date(current).getTime() !== expected.getTime()) {
    throw new ApiError(409, 'Dữ liệu đã được người khác cập nhật. Vui lòng tải lại trước khi lưu.');
  }
}

appSettingsRouter.get(
  '/email',
  requireRoles(Role.ADMIN),
  asyncHandler(async (_req, res) => {
    const settings = await getEmailSettings();
    res.json(emailSettingsResponse(settings.resendApiKey, await getEmailSettingsUpdatedAt()));
  }),
);

appSettingsRouter.put(
  '/email',
  requireRoles(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const update = emailSettingsUpdateSchema.parse(req.body);
    const idempotencyKey = requireIdempotencyKey(
      'Idempotency-Key là bắt buộc khi cập nhật cấu hình email.',
      req,
    );
    const expectedUpdatedAt = parseExpectedUpdatedAt(req);
    const { result, replayed } = await runIdempotent({
      endpoint: APP_SETTINGS_COMMANDS.EMAIL_UPDATE,
      idempotencyKey,
      payload: { body: update, expectedUpdatedAt: expectedUpdatedAt?.toISOString() ?? null },
      createdBy: req.user?.userId ?? null,
      entityType: 'app-settings',
      create: async (tx) => {
        const currentUpdatedAt = await getEmailSettingsUpdatedAt(tx);
        assertOptionalVersion(
          currentUpdatedAt,
          expectedUpdatedAt,
          'Thiếu phiên bản cấu hình email. Vui lòng tải lại trước khi cập nhật.',
        );
        const settings = await saveEmailSettingsInTx(tx, update);
        return emailSettingsResponse(settings.resendApiKey, await getEmailSettingsUpdatedAt(tx));
      },
    });
    res.json({ ...result, replayed });
  }),
);

appSettingsRouter.get(
  '/',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT),
  asyncHandler(async (_req, res) => res.json({
    ...(await getAppSettings()),
    updatedAt: await getAppSettingsUpdatedAt(),
  })),
);
appSettingsRouter.put(
  '/',
  requireRoles(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const next = appSettingsSchema.parse(req.body);
    const idempotencyKey = requireIdempotencyKey(
      'Idempotency-Key là bắt buộc khi cập nhật cài đặt ứng dụng.',
      req,
    );
    const expectedUpdatedAt = parseExpectedUpdatedAt(req);
    const previous = await getAppSettings();
    const directChange = hasDirectAppSettingsChange(previous, next);
    const materialChange = hasFinancialPolicyAppSettingsChange(previous, next);
    const { result, replayed } = await runIdempotent({
      endpoint: APP_SETTINGS_COMMANDS.GENERAL_UPDATE,
      idempotencyKey,
      payload: { body: next, expectedUpdatedAt: expectedUpdatedAt?.toISOString() ?? null },
      createdBy: req.user?.userId ?? null,
      entityType: 'app-settings',
      responseStatusCode: materialChange ? 201 : 200,
      create: async (tx) => {
        const currentUpdatedAt = await getAppSettingsUpdatedAt(tx);
        assertOptionalVersion(
          currentUpdatedAt,
          expectedUpdatedAt,
          'Thiếu phiên bản cài đặt ứng dụng. Vui lòng tải lại trước khi cập nhật.',
        );
        const current = await getAppSettingsFrom(tx);
        let directSaved = null as Awaited<ReturnType<typeof saveDirectAppSettingsInTx>> | null;
        if (directChange) {
          directSaved = await saveDirectAppSettingsInTx(tx, current, next);
        }
        if (materialChange) {
          const governedState = await getGovernedFinancialPolicyState(tx);
          const outcome = await requestOrApplyGovernedConfigAction({
            resource: GOVERNED_APP_SETTINGS_RESOURCE,
            operation: governedState.updatedAt ? 'UPDATE' : 'CREATE',
            subjectId: null,
            subjectKey: GOVERNED_APP_SETTINGS_RESOURCE,
            originalVersion: governedState.updatedAt
              ? governedConfigVersionFromUpdatedAt(governedState.updatedAt)
              : 0,
            beforeRow: governedState,
            afterData: financialPolicyOnly(next),
            makerId: req.user?.userId ?? 0,
            makerRole: req.user?.role ?? Role.ADMIN,
            transaction: tx,
          });
          return outcome.appliedRow ?? outcome.action;
        }
        if (directSaved) {
          return { ...directSaved.settings, updatedAt: directSaved.updatedAt };
        }
        return { ...current, updatedAt: currentUpdatedAt };
      },
    });
    if (!replayed && directChange) {
      await applySavedAppSettings(previous, directAppSettingsOnly(previous, next));
    }
    const status = materialChange ? (replayed ? 200 : 201) : 200;
    res.status(status).json({ ...result, replayed });
  }),
);

appSettingsRouter.get(
  '/financial-reporting/policy',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT),
  asyncHandler(async (_req, res) => {
    const state: FinancialReportingPolicyState = await getFinancialReportingPolicyState();
    res.json(state);
  }),
);

appSettingsRouter.post(
  '/financial-reporting/policy/requests',
  requireRoles(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const body = financialReportingPolicyRequestSchema.parse(req.body);
    const idempotencyKey = requireIdempotencyKey(
      'Idempotency-Key là bắt buộc khi gửi yêu cầu chính sách báo cáo.',
      req,
    );
    const { result, replayed } = await runIdempotent({
      endpoint: APP_SETTINGS_COMMANDS.FINANCIAL_POLICY_REQUEST,
      idempotencyKey,
      payload: { body },
      createdBy: req.user?.userId ?? null,
      entityType: 'financial-reporting-policy',
      responseStatusCode: 201,
      create: async (tx) => requestFinancialReportingPolicyVersion({
        body,
        actorId: req.user?.userId ?? 0,
        actorRole: req.user?.role ?? Role.ADMIN,
        transaction: tx,
      }),
    });
    res.status(replayed ? 200 : 201).json({ ...result, replayed });
  }),
);

appSettingsRouter.get(
  '/financial-reporting/truck-profiles',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT),
  asyncHandler(async (req, res) => {
    const rawTruckId = req.query.truckId;
    const truckId = typeof rawTruckId === 'string' && rawTruckId.trim() !== ''
      ? Number(rawTruckId)
      : null;
    if (truckId != null && (!Number.isInteger(truckId) || truckId <= 0)) {
      throw new ApiError(400, 'Xe đầu kéo không hợp lệ.');
    }
    const state: TruckFinancialProfileState = await getTruckFinancialProfileState(truckId);
    res.json(state);
  }),
);

appSettingsRouter.post(
  '/financial-reporting/truck-profiles/requests',
  requireRoles(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const body = truckFinancialProfileRequestSchema.parse(req.body);
    const idempotencyKey = requireIdempotencyKey(
      'Idempotency-Key là bắt buộc khi gửi hồ sơ tài chính xe.',
      req,
    );
    const { result, replayed } = await runIdempotent({
      endpoint: APP_SETTINGS_COMMANDS.TRUCK_PROFILE_REQUEST,
      idempotencyKey,
      payload: { body },
      createdBy: req.user?.userId ?? null,
      entityType: 'truck-financial-profile',
      responseStatusCode: 201,
      create: async (tx) => requestTruckFinancialProfileVersion({
        body,
        actorId: req.user?.userId ?? 0,
        actorRole: req.user?.role ?? Role.ADMIN,
        transaction: tx,
      }),
    });
    res.status(replayed ? 200 : 201).json({ ...result, replayed });
  }),
);
