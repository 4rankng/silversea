// Official-identity assembly for rendered billing exports: counterparty
// loading, live-render identity, and the issued-snapshot capture/resolve pair.
// Extracted from billing-export.service.ts verbatim (pure code movement);
// renderers import these one-way. The FrozenDebitNoteTemplateSnapshot type
// here is the LOCAL export-side copy — deliberately not merged with the
// billing-document one.
import { db } from '../db';
import * as s from '../db/schema';
import { eq } from 'drizzle-orm';
import type { BillingDocument, DebitNoteTemplateSnapshot } from '@tingting/shared';
import type { DbLike, OfficialBillingIdentitySnapshot } from './billing-document.service';
// Counterparty display info assembled for headers/footers of rendered exports.
type BillingPartyInfo = {
  name: string;
  address: string;
  taxCode: string;
  representative: string;
  representativeTitle: string;
  phone: string;
};

// Frozen template + optional persisted official identity (issued docs freeze
// issuer/counterparty so later company-data edits do not rewrite history).
type FrozenDebitNoteTemplateSnapshot = DebitNoteTemplateSnapshot & {
  officialIdentity?: OfficialBillingIdentitySnapshot | null;
};

import {
  cloneTemplateSnapshot,
  defaultSnapshotForType,
  loadCompanyInfoFromExecutor,
  extractOfficialIdentitySnapshot,
  trimIdentityValue,
  stripHonorifics,
} from './billing-document.service';

async function loadCounterpartyInfo(
  doc: BillingDocument,
  executor: DbLike = db,
  lockRows = false,
): Promise<BillingPartyInfo> {
  if (doc.entityType === 'CUSTOMER') {
    const query = executor.select({
      name: s.customers.name,
      taxCode: s.customers.taxCode,
      contactPerson: s.customers.contactPerson,
      contactInfo: s.customers.contactInfo,
      phone: s.customers.phone,
    }).from(s.customers).where(eq(s.customers.id, doc.entityId)).limit(1);
    const [customer] = await (lockRows ? query.for('share') : query);
    return {
      name: customer?.name ?? doc.entityName ?? '',
      address: customer?.contactInfo ?? '',
      taxCode: customer?.taxCode ?? '',
      representative: customer?.contactPerson ?? '',
      representativeTitle: 'Giám Đốc',
      phone: customer?.phone ?? '',
    };
  }

  const query = executor.select({
    name: s.suppliers.name,
    taxCode: s.suppliers.taxCode,
    contactPerson: s.suppliers.contactPerson,
    phone: s.suppliers.phone,
    note: s.suppliers.note,
  }).from(s.suppliers).where(eq(s.suppliers.id, doc.entityId)).limit(1);
  const [supplier] = await (lockRows ? query.for('share') : query);
  return {
    name: supplier?.name ?? doc.entityName ?? '',
    address: supplier?.note ?? '',
    taxCode: supplier?.taxCode ?? '',
    representative: supplier?.contactPerson ?? '',
    representativeTitle: 'Giám Đốc',
    phone: supplier?.phone ?? '',
  };
}

function applyOfficialIdentityToSnapshot(
  snapshot: DebitNoteTemplateSnapshot,
  officialIdentity: OfficialBillingIdentitySnapshot,
): FrozenDebitNoteTemplateSnapshot {
  return {
    ...cloneTemplateSnapshot(snapshot),
    officialIdentity: {
      issuer: { ...officialIdentity.issuer },
      counterparty: { ...officialIdentity.counterparty },
      signatures: { ...officialIdentity.signatures },
      captureMetadata: { ...officialIdentity.captureMetadata },
    },
  };
}

async function buildLiveRenderIdentity(
  doc: BillingDocument,
  snapshot: DebitNoteTemplateSnapshot,
  executor: DbLike = db,
  lockSourceRows = false,
): Promise<OfficialBillingIdentitySnapshot> {
  const [company, counterparty] = await Promise.all([
    loadCompanyInfoFromExecutor(executor, lockSourceRows),
    loadCounterpartyInfo(doc, executor, lockSourceRows),
  ]);
  const fallbackCompanyRepresentative = trimIdentityValue(company.representative);
  const snapshotRightName = trimIdentityValue(snapshot.signatureRightName);
  return {
    issuer: {
      name: trimIdentityValue(snapshot.issuerName) || trimIdentityValue(company.name),
      address: trimIdentityValue(snapshot.issuerAddress) || trimIdentityValue(company.address),
      taxCode: trimIdentityValue(snapshot.issuerTaxCode) || trimIdentityValue(company.taxCode),
      representative: trimIdentityValue(snapshot.issuerRepresentative) || fallbackCompanyRepresentative,
      representativeTitle: trimIdentityValue(company.representativeTitle),
      phone: trimIdentityValue(company.phone),
      bankAccount: trimIdentityValue(company.bankAccount),
      bankName: trimIdentityValue(company.bankName),
      email: trimIdentityValue(company.email),
      logoStorageKey: company.logoStorageKey ?? null,
    },
    counterparty: {
      entityType: doc.entityType,
      name: trimIdentityValue(counterparty.name) || trimIdentityValue(doc.entityName),
      address: trimIdentityValue(counterparty.address),
      taxCode: trimIdentityValue(counterparty.taxCode),
      representative: trimIdentityValue(counterparty.representative),
      representativeTitle: trimIdentityValue(counterparty.representativeTitle),
      phone: trimIdentityValue(counterparty.phone),
      contactInfo: trimIdentityValue(counterparty.address),
    },
    signatures: {
      leftLabel: trimIdentityValue(snapshot.signatureLeftLabel) || 'Khách hàng',
      leftName: trimIdentityValue(snapshot.signatureLeftName),
      rightLabel: trimIdentityValue(snapshot.signatureRightLabel) || 'Người lập',
      rightName: snapshotRightName || stripHonorifics(fallbackCompanyRepresentative),
    },
    captureMetadata: {
      mode: 'ISSUED_AT_TRANSITION',
      capturedAt: new Date().toISOString(),
    },
  };
}

export async function captureIssuedOfficialIdentitySnapshot(
  doc: BillingDocument,
  executor: DbLike = db,
): Promise<FrozenDebitNoteTemplateSnapshot> {
  const baseSnapshot = cloneTemplateSnapshot(
    doc.debitNoteTemplateSnapshot ?? defaultSnapshotForType(doc.type),
  );
  const officialIdentity = await buildLiveRenderIdentity(doc, baseSnapshot, executor, true);
  return applyOfficialIdentityToSnapshot(baseSnapshot, officialIdentity);
}

export async function resolveBillingDocumentIdentity(
  doc: BillingDocument,
  snapshot: DebitNoteTemplateSnapshot | null | undefined,
  executor: DbLike = db,
): Promise<OfficialBillingIdentitySnapshot | null> {
  if (doc.officialIdentitySnapshot) {
    return {
      issuer: { ...doc.officialIdentitySnapshot.issuer },
      counterparty: { ...doc.officialIdentitySnapshot.counterparty },
      signatures: { ...doc.officialIdentitySnapshot.signatures },
      captureMetadata: { ...doc.officialIdentitySnapshot.captureMetadata },
    };
  }
  const effectiveSnapshot = snapshot ?? doc.debitNoteTemplateSnapshot ?? defaultSnapshotForType(doc.type);
  const captured = extractOfficialIdentitySnapshot(effectiveSnapshot);
  if (captured) return captured;
  return buildLiveRenderIdentity(doc, effectiveSnapshot, executor);
}

export function customerCode(name: string, fallback: number): string {
  const normalized = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd');
  const words = normalized
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !['CONG', 'TY', 'TNHH', 'MTV', 'CP', 'CO', 'LTD'].includes(word.toUpperCase()));
  const code = words.slice(0, 3).map((word) => word[0]?.toUpperCase()).join('');
  return code || String(fallback);
}
