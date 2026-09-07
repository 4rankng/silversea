// Config routes aggregator (T3c split).
//
// routes/config.ts was a 2475-line monolith; the surface now lives in
// domain modules under routes/config/, following the established extraction
// pattern (debit-note-templates, master-data-import, driver-user-binding):
//
//   - ./config/config-helpers            shared predicates, governed-resource
//                                        registrations, catalog guards
//   - ./config/catalog-crud.routes       27 crud mounts + bootstrap/pricing
//   - ./config/tire-lifecycle.routes     tire install/remove/dispose/transfer
//   - ./config/operational-config.routes road/fuel/company-info/fuel-history
//   - ./config/salary-periods-config.routes  both salary-period routers
//   - ./config/audit-logs.routes         audit-log query
//
// This file keeps the exact public surface index.ts imports: default router
// + catalogBootstrapRouter, tireLifecycleRouter, salaryPeriodsRouter,
// salaryPeriodsAdminRouter, auditLogRouter. The helpers module is imported
// for its side-effect governed-resource registrations.

import { Router } from 'express';
import './config/config-helpers';
import catalogCrudRouter from './config/catalog-crud.routes';
import { tireLifecycleRouter } from './config/tire-lifecycle.routes';
import operationalConfigRouter from './config/operational-config.routes';
import {
  salaryPeriodsRouter,
  salaryPeriodsAdminRouter,
} from './config/salary-periods-config.routes';
import { auditLogRouter } from './config/audit-logs.routes';
import { pairSalarySettingsRouter } from './config/pair-salary-settings.routes';

export { tireLifecycleRouter, salaryPeriodsRouter, salaryPeriodsAdminRouter, auditLogRouter };
export { catalogBootstrapRouter } from './config/catalog-crud.routes';

const router = Router();
router.use(catalogCrudRouter);
router.use(operationalConfigRouter);
router.use(pairSalarySettingsRouter);

export default router;
