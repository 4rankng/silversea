/**
 * Forwarder expense-type labels for the catalog. Handler body moved
 * verbatim from routes/forwarder.ts.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler';
import { buildNoInvoicePolicySnapshot } from '../../services/no-invoice-disbursement.service';
import { listForwarderExpenseTypeRows } from '../../services/forwarder.service';

const router = Router();

router.get('/expense-types', asyncHandler(async (_req: Request, res: Response) => {
  const rows = await listForwarderExpenseTypeRows();
  res.json(rows.map((row) => ({
    code: row.code,
    name: row.name,
    noInvoicePolicySnapshot: row.requiresInvoice
      ? null
      : buildNoInvoicePolicySnapshot({
        code: row.code,
        name: row.name,
        requiresInvoice: row.requiresInvoice,
        substituteEvidenceAllowed: row.substituteEvidenceAllowed,
        noInvoiceEvidenceTypes: row.noInvoiceEvidenceTypes,
        noInvoicePerItemLimit: String(row.noInvoicePerItemLimit),
        noInvoicePerDayLimit: String(row.noInvoicePerDayLimit),
        noInvoiceFinanceLeadItemApprovalLimit: String(row.noInvoiceFinanceLeadItemApprovalLimit),
        noInvoiceDirectorDayApprovalLimit: String(row.noInvoiceDirectorDayApprovalLimit),
        noInvoiceFinanceLeadApprovalTitle: row.noInvoiceFinanceLeadApprovalTitle,
        noInvoiceDirectorApprovalTitle: row.noInvoiceDirectorApprovalTitle,
        noInvoicePolicyVersion: row.noInvoicePolicyVersion,
      }),
  })));
}));


export default router;
