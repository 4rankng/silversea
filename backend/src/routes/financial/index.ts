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

// Audit event registrations
registerAuditEvent('POST', '/api/payments/receive', AuditEvent.PAYMENT_RECEIVED);
registerAuditEvent('POST', '/api/adjustments', AuditEvent.ADJUSTMENT_CREATED);
registerAuditEvent('POST', '/api/governance-actions/', '/check', AuditEvent.ENTITY_UPDATED);
registerAuditEvent('POST', '/api/governance-actions/', '/approve', AuditEvent.ENTITY_UPDATED);
registerAuditEvent('POST', '/api/penalties', AuditEvent.PENALTY_CREATED);
registerAuditEvent('POST', '/api/penalties/', '/cancel', AuditEvent.PENALTY_CANCELED);
registerAuditEvent('POST', '/api/payments/vendor', AuditEvent.PAYMENT_RECEIVED);
registerAuditEvent('POST', '/api/payments/carrier', AuditEvent.PAYMENT_RECEIVED);
registerAuditEvent('POST', '/api/reports/distribute-profit', AuditEvent.PROFIT_DISTRIBUTED);
registerAuditEvent('POST', '/api/advance-requests/', '/approve', AuditEvent.ENTITY_UPDATED);
registerAuditEvent('POST', '/api/advance-requests/', '/reject', AuditEvent.ENTITY_UPDATED);
registerAuditEvent('POST', '/api/advance-settlements/', '/check', AuditEvent.ENTITY_UPDATED);
registerAuditEvent('POST', '/api/advance-settlements/', '/approve', AuditEvent.ENTITY_UPDATED);
registerAuditEvent('POST', '/api/advance-settlements/', '/reject', AuditEvent.ENTITY_UPDATED);
registerAuditEvent('POST', '/api/finance/debt-offsets/', '/approve', AuditEvent.ENTITY_UPDATED);
registerAuditEvent('POST', '/api/finance/debt-offsets', AuditEvent.ENTITY_CREATED);

const router = Router();

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
