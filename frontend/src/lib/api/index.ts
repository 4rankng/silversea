/**
 * Public surface of the `lib/api` module. All 46 existing imports
 * (`import { api } from '../lib/api'`) resolve here through the implicit
 * `index.ts` barrel.
 *
 * Sub-files own a single concern:
 *   - client.ts  — fetch transport, auth header, blob/upload helpers
 *   - errors.ts  — ApiError class + Vietnamese Zod field translation
 *   - photo.ts   — authenticated photo loading (Authorization-header blob)
 */
export { api, fileCommandFingerprint } from './client';
export { ApiError, formatErrorMessage } from './errors';
