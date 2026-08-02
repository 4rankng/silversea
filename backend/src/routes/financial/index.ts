import { Router } from 'express';
import { registerAuditEvent } from '../../services/audit-registry';
import { AuditEvent } from '../../services/audit-types';

import ledgerRoutes from './ledger.routes';
import paymentsRoutes from './payments.routes';
import penaltiesRoutes from './penalties.routes';
import reportsRoutes from './reports.routes';
import advancesRoutes from './advances.routes';
import debtOffsetsRoutes from './debt-offsets.routes';
import billingDocumentsRoutes from './billing-documents.routes';
import governanceActionsRoutes from './governance-actions.routes';
import creditOverridesRoutes from './credit-overrides.routes';
import fuelInvoicesRoutes from './fuel-invoices.routes';
import snapshotRoutes from './snapshot.routes';

// Audit event registrations
registerAuditEvent('POST', '/api/payments/receive', AuditEvent.PAYMENT_RECEIVED);
registerAuditEvent('POST', '/api/adjustments', AuditEvent.ADJUSTMENT_CREATED);
registerAuditEvent('POST', '/api/governance-actions/', '/check', AuditEvent.ENTITY_UPDATED);
registerAuditEvent('POST', '/api/governance-actions/', '/approve', AuditEvent.ENTITY_UPDATED);
registerAuditEvent('POST', '/api/governance-actions/', '/reject', AuditEvent.ENTITY_UPDATED);
registerAuditEvent('POST', '/api/governance-actions/', '/return-for-evidence', AuditEvent.ENTITY_UPDATED);
registerAuditEvent('POST', '/api/governance-actions/', '/cancel', AuditEvent.ENTITY_UPDATED);
registerAuditEvent('POST', '/api/penalties', AuditEvent.PENALTY_CREATED);
registerAuditEvent('POST', '/api/penalties/', '/cancel', AuditEvent.PENALTY_CANCELED);
registerAuditEvent('POST', '/api/payments/vendor', AuditEvent.PAYMENT_RECEIVED);
registerAuditEvent('POST', '/api/payments/carrier', AuditEvent.PAYMENT_RECEIVED);
registerAuditEvent('POST', '/api/reports/distribute-profit', AuditEvent.PROFIT_DISTRIBUTION_REQUESTED);
registerAuditEvent('POST', '/api/advance-requests/', '/approve', AuditEvent.ENTITY_UPDATED);
registerAuditEvent('POST', '/api/advance-requests/', '/reject', AuditEvent.ENTITY_UPDATED);
registerAuditEvent('POST', '/api/advance-settlements/', '/check', AuditEvent.ENTITY_UPDATED);
registerAuditEvent('POST', '/api/advance-settlements/', '/approve', AuditEvent.ENTITY_UPDATED);
registerAuditEvent('POST', '/api/advance-settlements/', '/reject', AuditEvent.ENTITY_UPDATED);
registerAuditEvent('POST', '/api/advance-settlements/', '/reversal', AuditEvent.ENTITY_UPDATED);
registerAuditEvent('POST', '/api/finance/debt-offsets/', '/approve', AuditEvent.ENTITY_UPDATED);
registerAuditEvent('POST', '/api/finance/debt-offsets', AuditEvent.ENTITY_CREATED);
registerAuditEvent('POST', '/api/finance/credit-overrides', AuditEvent.ENTITY_CREATED);
registerAuditEvent('POST', '/api/finance/credit-overrides/', '/check', AuditEvent.ENTITY_UPDATED);
registerAuditEvent('POST', '/api/finance/credit-overrides/', '/approve', AuditEvent.ENTITY_UPDATED);
registerAuditEvent('POST', '/api/finance/credit-overrides/', '/reject', AuditEvent.ENTITY_UPDATED);
registerAuditEvent('POST', '/api/finance/fuel-invoices', AuditEvent.ENTITY_CREATED);
registerAuditEvent('PUT', '/api/finance/fuel-invoices/', AuditEvent.ENTITY_UPDATED);
registerAuditEvent('POST', '/api/finance/fuel-invoices/', '/approve', AuditEvent.ENTITY_UPDATED);
registerAuditEvent('POST', '/api/finance/snapshots/ar/', '/recapture', AuditEvent.ENTITY_UPDATED);
registerAuditEvent('POST', '/api/finance/snapshots/ap/', '/recapture', AuditEvent.ENTITY_UPDATED);

const router = Router();

router.use(governanceActionsRoutes);
router.use(creditOverridesRoutes);
router.use(fuelInvoicesRoutes);
router.use(snapshotRoutes);
router.use(ledgerRoutes);
router.use(paymentsRoutes);
router.use(penaltiesRoutes);
router.use(reportsRoutes);
router.use(advancesRoutes);
router.use(debtOffsetsRoutes);
router.use(billingDocumentsRoutes);

// Audit: saving a billing document (debit note / payment statement snapshot)
registerAuditEvent('POST', '/api/finance/billing-documents', AuditEvent.ENTITY_CREATED);

export default router;
