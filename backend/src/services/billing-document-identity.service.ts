// Billing-document identity helpers: container text codecs, official-identity
// snapshot types + extraction, honorific/trim utilities, and the
// executor-scoped company-info loader. Extracted from billing-document.service.ts
// verbatim (pure code movement); the core re-exports them for existing
// importers (billing-export leaves resolve through the barrel).
import { db } from '../db';
import * as s from '../db/schema';
import { like } from 'drizzle-orm';
import { companyInfoFromSettings } from './company-info.service';
import type { Tx } from './trip-shared';
import type {
  BillingDocumentOfficialIdentitySnapshot,
  DebitNoteTemplateSnapshot,
} from '@tingting/shared';

export type DbLike = typeof db | Tx;

/** DB stores containers as comma-joined text (this schema avoids PG arrays). */
export function splitContainers(raw: string | null): string[] | null {
  if (!raw) return null;
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  return parts.length > 0 ? parts : null;
}
export function joinContainers(list: string[] | null | undefined): string | null {
  if (!list || list.length === 0) return null;
  return list.filter(Boolean).join(', ');
}
export type OfficialBillingIdentitySnapshot = BillingDocumentOfficialIdentitySnapshot;

export type FrozenDebitNoteTemplateSnapshot = DebitNoteTemplateSnapshot & {
  officialIdentity?: OfficialBillingIdentitySnapshot | null;
};

export function trimIdentityValue(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function stripHonorifics(value: string): string {
  return value.replace(/^Ông\s+|^Bà\s+/i, '').trim();
}


export function extractOfficialIdentitySnapshot(
  snapshot: DebitNoteTemplateSnapshot | null | undefined,
): OfficialBillingIdentitySnapshot | null {
  const raw = (snapshot as FrozenDebitNoteTemplateSnapshot | null | undefined)?.officialIdentity;
  if (!raw) return null;
  return {
    issuer: { ...raw.issuer },
    counterparty: { ...raw.counterparty },
    signatures: { ...raw.signatures },
    captureMetadata: { ...raw.captureMetadata },
  };
}

export async function loadCompanyInfoFromExecutor(executor: DbLike = db, lockRows = false) {
  const query = executor.select({
    key: s.appSettings.key,
    value: s.appSettings.value,
    updatedAt: s.appSettings.updatedAt,
  })
    .from(s.appSettings)
    .where(like(s.appSettings.key, 'company.%'));
  const rows = await (lockRows ? query.for('share') : query);
  return companyInfoFromSettings(rows);
}
