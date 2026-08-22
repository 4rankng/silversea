import { db } from '../db';
import * as s from '../db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import {
  defaultDebitNoteColumns,
  defaultPaymentStatementColumns,
} from '@tingting/shared';
import type {
  BillingDocumentType,
  DebitNoteTemplate,
  DebitNoteTemplateColumn,
  DebitNoteTemplateSnapshot,
} from '@tingting/shared';
import type {
  FrozenDebitNoteTemplateSnapshot,
  OfficialBillingIdentitySnapshot,
} from './billing-document.service';

/**
 * Debit-note / payment-statement template CRUD and resolution.
 *
 * Split out of billing-document.service.ts. Owns reading debit_note_templates,
 * the default template snapshots, column normalization, and the resolution
 * chain (explicit override → customer assignment → document-type default),
 * plus the frozen-snapshot helpers used when rendering saved documents.
 */
export function cloneTemplateSnapshot(snapshot: DebitNoteTemplateSnapshot): FrozenDebitNoteTemplateSnapshot {
  const typed = snapshot as FrozenDebitNoteTemplateSnapshot;
  return {
    ...typed,
    columns: cloneColumns(snapshot.columns),
    officialIdentity: typed.officialIdentity
      ? {
          issuer: { ...typed.officialIdentity.issuer },
          counterparty: { ...typed.officialIdentity.counterparty },
          signatures: { ...typed.officialIdentity.signatures },
          captureMetadata: { ...typed.officialIdentity.captureMetadata },
        }
      : null,
  };
}

// ─── Billing document templates ───────────────────────────────────────────────

const cloneColumns = (cols: readonly DebitNoteTemplateColumn[]): DebitNoteTemplateColumn[] =>
  cols.map((col) => ({ ...col }));

export const DEFAULT_DEBIT_NOTE_COLUMNS: DebitNoteTemplateColumn[] =
  cloneColumns(defaultDebitNoteColumns as DebitNoteTemplateColumn[]);
export const DEFAULT_PAYMENT_STATEMENT_COLUMNS: DebitNoteTemplateColumn[] =
  cloneColumns(defaultPaymentStatementColumns as DebitNoteTemplateColumn[]);


const DEFAULT_DEBIT_NOTE_SNAPSHOT: DebitNoteTemplateSnapshot = {
  id: null,
  name: 'Mặc định giấy báo nợ',
  titleText: 'GIẤY BÁO NỢ',
  issuerName: null,
  issuerAddress: null,
  issuerTaxCode: null,
  issuerRepresentative: null,
  accentColor: '#00A651',
  showContainerColumn: true,
  showUnitColumn: true,
  groupingMode: 'NONE',
  columns: cloneColumns(DEFAULT_DEBIT_NOTE_COLUMNS),
  orientation: 'portrait',
  termsText: 'Vui lòng ghi số tham chiếu giấy báo nợ này trong chứng từ thanh toán',
  signatureLeftLabel: 'Khách hàng',
  signatureLeftName: null,
  signatureRightLabel: 'Người lập',
  signatureRightName: 'Phan Kim Phụng',
};

const DEFAULT_PAYMENT_STATEMENT_SNAPSHOT: DebitNoteTemplateSnapshot = {
  ...DEFAULT_DEBIT_NOTE_SNAPSHOT,
  name: 'Mặc định bảng kê',
  titleText: 'BẢNG KÊ CƯỚC VẬN CHUYỂN',
  accentColor: '#1F4E79',
  groupingMode: 'NONE',
  columns: [
    ...DEFAULT_PAYMENT_STATEMENT_COLUMNS,
  ],
};

function looksLikePaymentStatementColumns(cols: DebitNoteTemplateColumn[]): boolean {
  if (cols.some((col) => col.headerGroup != null)) return false;
  const variables = new Set(cols.map((col) => col.variable));
  const ids = new Set(cols.map((col) => col.id));
  const horizontalSignals = [
    variables.has('rowIndex'),
    variables.has('truckPlate') && (variables.has('origin') || variables.has('actionType')),
    variables.has('actionType'),
    variables.has('origin') && variables.has('deliveryAddress'),
    ids.has('stt') && ids.has('bien_so'),
    ids.has('gia_vc') && ids.has('so_cont'),
    variables.has('container20Count') || variables.has('container40Count'),
  ];
  return horizontalSignals.filter(Boolean).length >= 3;
}

export function normalizeTemplateColumns(cols: unknown, docType: BillingDocumentType = 'DEBIT_NOTE'): DebitNoteTemplateColumn[] {
  const fallback = docType === 'PAYMENT_STATEMENT'
    ? DEFAULT_PAYMENT_STATEMENT_COLUMNS
    : DEFAULT_DEBIT_NOTE_COLUMNS;
  if (!Array.isArray(cols) || cols.length === 0) return cloneColumns(fallback);

  const parsed = cloneColumns(cols as DebitNoteTemplateColumn[]);
  if (docType === 'DEBIT_NOTE' && looksLikePaymentStatementColumns(parsed)) {
    return cloneColumns(DEFAULT_DEBIT_NOTE_COLUMNS);
  }
  return parsed;
}

function rowToTemplate(row: typeof s.debitNoteTemplates.$inferSelect): DebitNoteTemplate {
  return {
    id: row.id, name: row.name, isDefault: row.isDefault,
    documentType: row.documentType as DebitNoteTemplate['documentType'],
    titleText: row.titleText,
    issuerName: row.issuerName, issuerAddress: row.issuerAddress, issuerTaxCode: row.issuerTaxCode,
    issuerRepresentative: row.issuerRepresentative,
    accentColor: row.accentColor,
    showContainerColumn: row.showContainerColumn, showUnitColumn: row.showUnitColumn,
    groupingMode: row.groupingMode as DebitNoteTemplate['groupingMode'],
    columns: normalizeTemplateColumns(row.columns, row.documentType as BillingDocumentType),
    amountInWords: row.amountInWords, orientation: row.orientation as DebitNoteTemplate['orientation'],
    termsText: row.termsText,
    signatureLeftLabel: row.signatureLeftLabel, signatureLeftName: row.signatureLeftName,
    signatureRightLabel: row.signatureRightLabel, signatureRightName: row.signatureRightName,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

export async function getDebitNoteTemplate(id: number): Promise<DebitNoteTemplate | null> {
  const [row] = await db.select().from(s.debitNoteTemplates)
    .where(and(eq(s.debitNoteTemplates.id, id), isNull(s.debitNoteTemplates.deletedAt))).limit(1);
  return row ? rowToTemplate(row) : null;
}

export function defaultSnapshotForType(type: string): DebitNoteTemplateSnapshot {
  return type === 'PAYMENT_STATEMENT'
    ? { ...DEFAULT_PAYMENT_STATEMENT_SNAPSHOT, columns: [...DEFAULT_PAYMENT_STATEMENT_SNAPSHOT.columns] }
    : { ...DEFAULT_DEBIT_NOTE_SNAPSHOT, columns: [...DEFAULT_DEBIT_NOTE_SNAPSHOT.columns] };
}

export async function getDefaultDebitNoteTemplate(docType: BillingDocumentType = 'DEBIT_NOTE'): Promise<DebitNoteTemplate | null> {
  const [row] = await db.select().from(s.debitNoteTemplates)
    .where(and(
      eq(s.debitNoteTemplates.isDefault, true),
      eq(s.debitNoteTemplates.documentType, docType),
      isNull(s.debitNoteTemplates.deletedAt),
    )).limit(1);
  return row ? rowToTemplate(row) : null;
}

/**
 * Resolve the template for a billing document export. Order:
 * explicit override → customer override → document-type default.
 * Soft-deleted templates are skipped (fall through to the next source).
 */
export async function resolveDebitNoteTemplate(opts: {
  templateIdOverride?: number | null;
  customerTemplateId?: number | null;
  docType?: string;
}): Promise<DebitNoteTemplate | null> {
  const docType = opts.docType === 'PAYMENT_STATEMENT' ? 'PAYMENT_STATEMENT' : 'DEBIT_NOTE';
  if (opts.templateIdOverride) {
    const t = await getDebitNoteTemplate(opts.templateIdOverride);
    if (t && t.documentType === docType) return t;
  }
  if (docType === 'DEBIT_NOTE' && opts.customerTemplateId) {
    const t = await getDebitNoteTemplate(opts.customerTemplateId);
    if (t && t.documentType === docType) return t;
  }
  return getDefaultDebitNoteTemplate(docType);
}

/** Frozen render-only copy written onto each saved billing document. */
export function templateToSnapshot(t: DebitNoteTemplate): DebitNoteTemplateSnapshot {
  return {
    id: t.id, name: t.name, titleText: t.titleText,
    issuerName: t.issuerName, issuerAddress: t.issuerAddress, issuerTaxCode: t.issuerTaxCode,
    issuerRepresentative: t.issuerRepresentative,
    accentColor: t.accentColor,
    showContainerColumn: t.showContainerColumn, showUnitColumn: t.showUnitColumn,
    groupingMode: t.groupingMode, columns: normalizeTemplateColumns(t.columns, t.documentType), orientation: t.orientation,
    termsText: t.termsText,
    signatureLeftLabel: t.signatureLeftLabel, signatureLeftName: t.signatureLeftName,
    signatureRightLabel: t.signatureRightLabel, signatureRightName: t.signatureRightName,
  };
}

/**
 * Resolve the snapshot to render a doc with. Issued documents always use their
 * frozen snapshot so an export can never rewrite official history. Drafts keep
 * the preview precedence: explicit `?templateId=` override → frozen snapshot →
 * customer assignment → document-type default → built-in standard snapshot.
 */
export async function resolveDebitNoteTemplateForDoc(
  doc: {
    type: string;
    entityType: string;
    entityId: number;
    debitNoteStatus?: string | null;
    debitNoteTemplateSnapshot?: DebitNoteTemplateSnapshot | null;
  },
  opts: { templateIdOverride?: number | null } = {},
): Promise<DebitNoteTemplateSnapshot | null> {
  const docType = doc.type === 'PAYMENT_STATEMENT' ? 'PAYMENT_STATEMENT' : 'DEBIT_NOTE';
  const isIssued = doc.debitNoteStatus != null && doc.debitNoteStatus !== 'DRAFT';
  if (isIssued && doc.debitNoteTemplateSnapshot) {
    return {
      ...cloneTemplateSnapshot(doc.debitNoteTemplateSnapshot),
      titleText: doc.type === 'PAYMENT_STATEMENT' && doc.debitNoteTemplateSnapshot.titleText === 'GIẤY BÁO NỢ'
        ? 'BẢNG KÊ CƯỚC VẬN CHUYỂN'
        : doc.debitNoteTemplateSnapshot.titleText,
    };
  }
  if (opts.templateIdOverride && opts.templateIdOverride > 0) {
    const t = await getDebitNoteTemplate(opts.templateIdOverride);
    if (t && t.documentType === docType) return templateToSnapshot(t);
  }
  if (doc.debitNoteTemplateSnapshot) return {
    ...cloneTemplateSnapshot(doc.debitNoteTemplateSnapshot),
    titleText: doc.type === 'PAYMENT_STATEMENT' && doc.debitNoteTemplateSnapshot.titleText === 'GIẤY BÁO NỢ'
      ? 'BẢNG KÊ CƯỚC VẬN CHUYỂN'
      : doc.debitNoteTemplateSnapshot.titleText,
  };
  let customerTemplateId: number | null = null;
  if (docType === 'DEBIT_NOTE' && doc.entityType === 'CUSTOMER') {
    const [cust] = await db.select({ tplId: s.customers.debitNoteTemplateId })
      .from(s.customers).where(eq(s.customers.id, doc.entityId)).limit(1);
    customerTemplateId = cust?.tplId ?? null;
  }
  const t = await resolveDebitNoteTemplate({ customerTemplateId, docType });
  return t ? templateToSnapshot(t) : defaultSnapshotForType(docType);
}

