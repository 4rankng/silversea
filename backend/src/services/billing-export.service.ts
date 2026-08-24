// Debit-note / payment-statement XLSX rendering barrel. The renderers live in
// leaf modules (shared / identity / legacy-xlsx / debit-note-xlsx /
// templated-xlsx); this file keeps the public dispatch entry point
// (buildBillingXlsx) and named re-exports so every importer resolves
// unchanged. Dependency direction: billing-export -> billing-document, one-way.
import type { BillingDocument, DebitNoteTemplate } from '@tingting/shared';
import { templateToSnapshot } from './billing-document.service';
import { buildLegacyXlsx } from './billing-export-legacy-xlsx.service';
import { renderTemplatedXlsx } from './billing-export-templated-xlsx.service';

/**
 * Public entry point. `null`/`undefined` template or a mismatched document type
 * delegates to the verbatim legacy renderer. A live template is snapshotted,
 * then rendered by renderTemplatedXlsx.
 */
export async function buildBillingXlsx(
  doc: BillingDocument,
  template?: DebitNoteTemplate | null,
): Promise<Buffer> {
  if (!template) return buildLegacyXlsx(doc);
  if (template.documentType !== doc.type) return buildLegacyXlsx(doc);
  return renderTemplatedXlsx(doc, templateToSnapshot(template));
}

// ── Compatibility re-exports (leaf surface, named only — `export *` is banned
// by the material-write registry scanner) ────────────────────────────────────
export { renderColumnValue } from './billing-export-shared.service';
export {
  captureIssuedOfficialIdentitySnapshot,
  resolveBillingDocumentIdentity,
} from './billing-export-identity.service';
export { buildLegacyXlsx } from './billing-export-legacy-xlsx.service';
export { renderTemplatedXlsx } from './billing-export-templated-xlsx.service';
