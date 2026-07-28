import type { Request } from 'express';
import { resolveIdempotencyKey } from '../../services/idempotency.service';

export function getRequestIdempotencyKey(req: Request): string | undefined {
  const requestBody = req.body as Record<string, unknown> | undefined;
  return resolveIdempotencyKey({
    headerValue: req.header('Idempotency-Key'),
    requestId: requestBody?._requestId,
  });
}
