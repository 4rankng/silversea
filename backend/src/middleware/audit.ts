import type { Request, Response, NextFunction } from 'express';
import { emitAudit } from '../services/audit.service';
import { AuditEvent } from '../services/audit-types';
import { resolveAuditEvent } from '../services/audit-registry';

function extractEntityType(path: string): string | null {
  const parts = path.replace('/api/', '').split('/');
  
  if (parts.length >= 2 && parts[0] === 'forwarder' && parts[1] === 'me') {
    if (parts.length > 2) {
      if (parts[2] === 'trips' && parts[4] === 'containers') return 'container-instances';
      if (parts[2] === 'expenses' && parts[4] === 'photos') return 'expense-photos';
      if (parts[2] === 'expenses') return 'trip-expenses';
      return parts[2];
    }
    return 'forwarder';
  }

  // Driver portal — mirror forwarder's container-instances mapping so driver
  // mutations on /api/driver/me/trips/:id/containers[/:cid[/seals]] audit
  // with the correct entity label ("thông tin container"), not the generic
  // "lái xe" label derived from the /driver prefix.
  if (parts.length >= 2 && parts[0] === 'driver' && parts[1] === 'me') {
    if (parts.length > 2) {
      if (parts[2] === 'trips' && parts[4] === 'containers') return 'container-instances';
      if (parts[2] === 'trips' && parts[4] === 'photos') return 'photos';
      return parts[2];
    }
    return 'driver';
  }

  // Handle accountant/admin trip expenses: /api/trips/:id/expenses/...
  if (parts.length >= 3 && parts[0] === 'trips' && parts[2] === 'expenses') {
    return 'trip-expenses';
  }

  if (parts.length >= 1) return parts[0];
  return null;
}

function extractEntityId(path: string, body: Record<string, unknown>): number | null {
  const parts = path.replace('/api/', '').split('/');
  const last = parts[parts.length - 1];
  const num = parseInt(last);
  if (!isNaN(num)) return num;

  // If the last segment is an action, the entity ID is the second-to-last segment
  if (['approve', 'reject', 'lock', 'unlock', 'cancel', 'dispatch', 'pre-departure', 'actuals', 'departure-date'].includes(last)) {
    const secondLast = parts[parts.length - 2];
    const idNum = parseInt(secondLast);
    if (!isNaN(idNum)) return idNum;
  }

  return body?.id ? parseInt(body.id as string) : null;
}

export function sanitizeBody(body: Record<string, unknown>): Record<string, unknown> {
  if (!body) return {};
  const rest: Record<string, unknown> = { ...body };
  // Auth credentials — never persisted to audit logs.
  delete rest.password;
  delete rest.passwordHash;
  delete rest.password_hash;
  // API keys / secrets — the LLM settings PUT carries provider keys; stripping
  // them here prevents plaintext keys from landing in audit_logs.payload.
  delete rest.apiKey;
  delete rest.openrouterApiKey;
  delete rest.openrouter_api_key;
  delete rest.minimaxApiKey;
  delete rest.minimax_api_key;
  delete rest.minimaxKey;
  delete rest.openrouterKey;
  delete rest.resendApiKey;
  delete rest.resend_api_key;
  delete rest.settingsEncryptionKey;
  return rest;
}

function extractEntityKey(
  entityType: string | null,
  responseBody: Record<string, unknown> | null,
  requestBody: Record<string, unknown> | null,
): string | undefined {
  const pick = (obj: Record<string, unknown> | null, ...keys: string[]): string | undefined => {
    if (!obj) return undefined;
    for (const k of keys) {
      const v = obj[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (typeof v === 'number') return String(v);
    }
    return undefined;
  };

  switch (entityType) {
    case 'trips':
      return pick(responseBody, 'tripCode') || pick(requestBody, 'tripCode');
    case 'trucks':
      return pick(responseBody, 'licensePlate') || pick(requestBody, 'licensePlate');
    case 'customers':
    case 'routes':
    case 'cargo-types':
    case 'drivers':
    case 'penalty-reasons':
    case 'suppliers':
    case 'expense-categories':
      return pick(responseBody, 'name') || pick(requestBody, 'name');
    case 'cap-table':
      return pick(responseBody, 'partnerName') || pick(requestBody, 'partnerName');
    case 'reports': {
      const quarter = pick(responseBody, 'quarter') || pick(requestBody, 'quarter');
      const year = pick(responseBody, 'year') || pick(requestBody, 'year');
      if (quarter && year) return `Quý ${quarter}/${year}`;
      return undefined;
    }
    case 'payments':
    case 'adjustments':
    case 'penalties': {
      const tripRef = pick(responseBody, 'tripCode') || pick(requestBody, 'tripCode');
      if (tripRef) return `cho chuyến ${tripRef}`;
      return undefined;
    }
    default:
      return pick(responseBody, 'name', 'code') || pick(requestBody, 'name', 'code');
  }
}

export function auditLogMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    return next();
  }

  const fullPath = (req.originalUrl || req.url || '').split('?')[0];
  const isLoginPath = fullPath.includes('/login');

  // Capture the response body for entity key extraction by intercepting res.json.
  // This is a lighter touch than the previous approach of monkey-patching both
  // res.json AND res.end — we only intercept res.json and use res.on('finish')
  // for the actual audit write trigger.
  let capturedBody: Record<string, unknown> | null = null;
  const originalJson = res.json.bind(res);
  res.json = function (body: unknown) {
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      capturedBody = body as Record<string, unknown>;
    }
    return originalJson(body);
  };

  // Use res.on('finish') instead of monkey-patching res.end.
  // The 'finish' event fires after the response is sent to the client,
  // so the audit write never delays the response.
  res.on('finish', () => {
    const event = resolveAuditEvent(req.method, fullPath);
    const entityType = extractEntityType(fullPath);
    const localEntityId = res.locals.auditEntityId;
    const entityId = typeof localEntityId === 'number'
      ? localEntityId
      : extractEntityId(fullPath, req.body as Record<string, unknown>);
    const entityKey = res.locals.auditEntityKey || extractEntityKey(entityType, capturedBody, req.body as Record<string, unknown>);
    const idempotencyKeyPresent = Boolean(
      req.header('Idempotency-Key')
      || (req.body as Record<string, unknown> | undefined)?._requestId,
    );

    if (res.statusCode < 400 && req.user) {
      emitAudit({
        event,
        entityType: entityType || 'unknown',
        entityId: entityId ?? undefined,
        entityKey,
        userId: req.user.userId,
        actorRole: req.user.role,
        actorEmail: req.user.email ?? undefined,
        actorName: req.user.fullName ?? req.user.username ?? undefined,
        ipAddress: req.ip,
        metadata: {
          method: req.method,
          path: fullPath,
          statusCode: res.statusCode,
          outcome: capturedBody?.replayed === true ? 'REPLAYED' : 'SUCCEEDED',
          idempotencyKeyPresent,
          body: sanitizeBody(req.body as Record<string, unknown>),
        },
      });
    } else if (res.statusCode < 400 && !req.user && isLoginPath) {
      const respUser = capturedBody?.user as Record<string, unknown> | undefined;
      emitAudit({
        event,
        entityType: entityType || 'auth',
        entityId: entityId ?? undefined,
        entityKey,
        userId: respUser?.id as number,
        actorRole: respUser?.role as string,
        actorEmail: respUser?.email as string,
        actorName: (respUser?.fullName as string) ?? (respUser?.username as string),
        ipAddress: req.ip,
        metadata: {
          method: req.method,
          path: fullPath,
          body: sanitizeBody(req.body as Record<string, unknown>),
        },
      });
    } else if (res.statusCode === 401 && isLoginPath) {
      emitAudit({
        event: AuditEvent.LOGIN_FAILED,
        entityType: 'auth',
        entityKey: (req.body as Record<string, unknown> | undefined)?.identifier as string,
        ipAddress: req.ip,
        metadata: {
          method: req.method,
          path: fullPath,
          statusCode: res.statusCode,
          failed: true,
        },
      });
    } else if (res.statusCode === 403 && req.user) {
      emitAudit({
        event: AuditEvent.ACCESS_DENIED,
        entityType: extractEntityType(fullPath) || 'unknown',
        entityKey: undefined,
        userId: req.user.userId,
        actorRole: req.user.role,
        actorEmail: req.user.email ?? undefined,
        actorName: req.user.fullName ?? req.user.username ?? undefined,
        ipAddress: req.ip,
        metadata: {
          method: req.method,
          path: fullPath,
          statusCode: res.statusCode,
          failed: true,
        },
      });
    } else if (res.statusCode >= 400 && req.user) {
      emitAudit({
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
        metadata: {
          method: req.method,
          path: fullPath,
          statusCode: res.statusCode,
          failed: true,
          idempotencyKeyPresent,
          error: typeof capturedBody?.error === 'string' ? capturedBody.error : undefined,
          body: sanitizeBody(req.body as Record<string, unknown>),
        },
      });
    }
  });

  next();
}
