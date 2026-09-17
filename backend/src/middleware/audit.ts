import type { Request, Response, NextFunction } from 'express';
import {
  buildAuditMetadata,
  extractAuditEntityId,
  extractAuditEntityKey,
  extractAuditEntityType,
  finalizeDurableMaterialWriteAudit,
  persistAudit,
  sanitizeAuditBody,
  runWithAuditRequestContext,
} from '../services/audit.service';
import { AuditEvent } from '../services/audit-types';
import type { AuditEventType } from '../services/audit-types';
import { resolveAuditEvent } from '../services/audit-registry';
import { ApiError } from '../errors';
import { getMaterialWriteContext, matchDeclaredMaterialWrite } from './material-write';

const AUDIT_FAILURE_MESSAGE = 'Không thể ghi nhật ký thao tác. Vui lòng thử lại.';

export const sanitizeBody = sanitizeAuditBody;

export function auditLogMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    return next();
  }

  const fullPath = (req.originalUrl || req.url || '').split('?')[0];
  const isLoginPath = fullPath.includes('/login');
  const declaredMaterialWrite = matchDeclaredMaterialWrite(req.method, fullPath);
  if (declaredMaterialWrite) {
    try {
      const context = getMaterialWriteContext(req);
      res.locals.materialWriteEndpoint = context?.endpoint;
    } catch (error) {
      const body = error instanceof ApiError
        ? { error: error.message }
        : { error: 'Lỗi máy chủ' };
      const statusCode = error instanceof ApiError ? error.statusCode : 500;
      void (async () => {
        await persistAudit({
          event: AuditEvent.MUTATION_REJECTED,
          entityType: extractAuditEntityType(fullPath) || 'unknown',
          userId: req.user?.userId,
          actorRole: req.user?.role,
          actorEmail: req.user?.email ?? undefined,
          actorName: req.user?.fullName ?? req.user?.username ?? undefined,
          ipAddress: req.ip,
          metadata: buildAuditMetadata({
            req,
            fullPath,
            statusCode,
            outcome: 'REJECTED',
            body,
            materialWriteEndpoint: declaredMaterialWrite.endpoint,
            idempotencyKeyPresent: false,
          }),
        });
        res.locals.skipAuditPersistence = true;
        res.status(statusCode).json(body);
      })().catch((persistError) => {
        console.error('Audit log write failed:', persistError);
        res.locals.skipAuditPersistence = true;
        res.status(500).json({ error: AUDIT_FAILURE_MESSAGE });
      });
      return;
    }
  }

  // Capture the response body for entity key extraction by intercepting res.json.
  let capturedBody: Record<string, unknown> | null = null;
  const originalJson = res.json.bind(res);
  res.json = function (body: unknown) {
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      capturedBody = body as Record<string, unknown>;
    }
    return originalJson(body);
  };

  const originalEnd = res.end.bind(res);
  let auditPersisted = false;
  res.end = function (...args: Parameters<Response['end']>) {
    if (auditPersisted) {
      return originalEnd(...args);
    }
    auditPersisted = true;
    const idempotencyKeyPresent = Boolean(
      req.header('Idempotency-Key')
      || (req.body as Record<string, unknown> | undefined)?._requestId,
    );
    const event = typeof res.locals.auditEvent === 'string'
      ? res.locals.auditEvent as AuditEventType
      : resolveAuditEvent(req.method, fullPath);
    const entityType = extractAuditEntityType(fullPath);
    const localEntityId = res.locals.auditEntityId;
    const entityId = typeof localEntityId === 'number'
      ? localEntityId
      : extractAuditEntityId(fullPath, req.body as Record<string, unknown>);
    const entityKey = res.locals.auditEntityKey
      || extractAuditEntityKey(entityType, capturedBody, req.body as Record<string, unknown>);
    const materialWriteEndpoint = typeof res.locals.materialWriteEndpoint === 'string'
      ? res.locals.materialWriteEndpoint
      : declaredMaterialWrite?.endpoint;
    const failClosedAudit = Boolean(materialWriteEndpoint);

    const endWithAuditFailure = () => {
      res.statusCode = 500;
      const payload = JSON.stringify({ error: AUDIT_FAILURE_MESSAGE });
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Length', Buffer.byteLength(payload).toString());
      originalEnd(payload);
    };

    const persist = async () => {
      if (res.locals.skipAuditPersistence) {
        return;
      }
      if (res.statusCode < 400 && req.user) {
        const successPayload = {
          event,
          entityType: entityType || 'unknown',
          entityId: entityId ?? undefined,
          entityKey,
          userId: req.user.userId,
          actorRole: req.user.role,
          actorEmail: req.user.email ?? undefined,
          actorName: req.user.fullName ?? req.user.username ?? undefined,
          ipAddress: req.ip,
          metadata: buildAuditMetadata({
            req,
            fullPath,
            statusCode: res.statusCode,
            outcome: capturedBody?.replayed === true ? 'REPLAYED' : 'SUCCEEDED',
            body: capturedBody,
            materialWriteEndpoint,
            idempotencyKeyPresent,
          }),
        } as const;
        if (
          res.locals.durableMaterialWriteSuccessAudited === true
          && capturedBody?.replayed !== true
        ) {
          const durableAuditLogId = Number(res.locals.durableMaterialWriteAuditLogId);
          if (Number.isFinite(durableAuditLogId) && durableAuditLogId > 0) {
            await finalizeDurableMaterialWriteAudit({
              rowId: durableAuditLogId,
              payload: successPayload,
            });
          }
          return;
        }
        await persistAudit({
          ...successPayload,
        });
        return;
      }
      if (res.statusCode < 400 && !req.user && isLoginPath) {
        const respUser = capturedBody?.user as Record<string, unknown> | undefined;
        await persistAudit({
          event,
          entityType: entityType || 'auth',
          entityId: entityId ?? undefined,
          entityKey,
          userId: typeof respUser?.id === 'number' ? respUser.id : undefined,
          actorRole: typeof respUser?.role === 'string' ? respUser.role : undefined,
          actorEmail: typeof respUser?.email === 'string' ? respUser.email : undefined,
          actorName: typeof respUser?.fullName === 'string'
            ? respUser.fullName
            : (typeof respUser?.username === 'string' ? respUser.username : undefined),
          ipAddress: req.ip,
          metadata: buildAuditMetadata({
            req,
            fullPath,
            statusCode: res.statusCode,
            outcome: 'SUCCEEDED',
            body: capturedBody,
            materialWriteEndpoint,
            idempotencyKeyPresent,
          }),
        });
        return;
      }
      if (res.statusCode === 401 && isLoginPath) {
        await persistAudit({
          event: AuditEvent.LOGIN_FAILED,
          entityType: 'auth',
          entityKey: (req.body as Record<string, unknown> | undefined)?.identifier as string,
          ipAddress: req.ip,
          metadata: buildAuditMetadata({
            req,
            fullPath,
            statusCode: res.statusCode,
            outcome: 'FAILED_LOGIN',
            body: capturedBody,
            materialWriteEndpoint,
            idempotencyKeyPresent,
          }),
        });
        return;
      }
      if (res.statusCode === 403 && req.user) {
        await persistAudit({
          event: AuditEvent.ACCESS_DENIED,
          entityType: entityType || 'unknown',
          entityId: entityId ?? undefined,
          entityKey,
          userId: req.user.userId,
          actorRole: req.user.role,
          actorEmail: req.user.email ?? undefined,
          actorName: req.user.fullName ?? req.user.username ?? undefined,
          ipAddress: req.ip,
          metadata: buildAuditMetadata({
            req,
            fullPath,
            statusCode: res.statusCode,
            outcome: 'FORBIDDEN',
            body: capturedBody,
            materialWriteEndpoint,
            idempotencyKeyPresent,
          }),
        });
        return;
      }
      if (res.statusCode >= 400 && req.user) {
        await persistAudit({
          event: res.statusCode === 409
            ? AuditEvent.MUTATION_CONFLICT
            : AuditEvent.MUTATION_REJECTED,
          entityType: entityType || 'unknown',
          entityId: entityId ?? undefined,
          entityKey,
          userId: req.user.userId,
          actorRole: req.user.role,
          actorEmail: req.user.email ?? undefined,
          actorName: req.user.fullName ?? req.user.username ?? undefined,
          ipAddress: req.ip,
          metadata: buildAuditMetadata({
            req,
            fullPath,
            statusCode: res.statusCode,
            outcome: res.statusCode === 409 ? 'CONFLICT' : 'REJECTED',
            body: capturedBody,
            materialWriteEndpoint,
            idempotencyKeyPresent,
          }),
        });
      }
    };

    void persist()
      .then(() => {
        originalEnd(...args);
      })
      .catch((error) => {
        console.error('Audit log write failed:', error);
        if (failClosedAudit) {
          endWithAuditFailure();
          return;
        }
        originalEnd(...args);
      });
    return res;
  } as Response['end'];

  return runWithAuditRequestContext({
    req,
    res,
    fullPath,
    isLoginPath,
    declaredMaterialWriteEndpoint: declaredMaterialWrite?.endpoint,
    declaredCanonicalAliases: declaredMaterialWrite?.canonicalAliases,
  }, next);
}
