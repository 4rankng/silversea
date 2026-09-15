export const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function fileCommandFingerprint(file: File): string {
  return [
    file.name,
    file.size,
    file.type,
    file.lastModified,
  ].join(':');
}

/**
 * Every client mutation carries a transaction identifier. Domain clients that
 * need retry/replay semantics may supply their own stable Idempotency-Key; the
 * transport only generates one when the caller did not provide it.
 */
export function hasIdempotencyKey(headers: Record<string, string>): boolean {
  return Object.keys(headers).some(
    (name) => name.toLowerCase() === 'idempotency-key',
  );
}

export function ensureMutationTransactionKey(
  method: string | undefined,
  headers: Record<string, string>,
  generatedKey?: string,
): void {
  if (!method || !MUTATION_METHODS.has(method.toUpperCase())) return;
  if (!hasIdempotencyKey(headers)) {
    headers['Idempotency-Key'] = generatedKey ?? crypto.randomUUID();
  }
}
