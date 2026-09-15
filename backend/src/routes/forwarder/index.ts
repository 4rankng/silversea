/**
 * Forwarder portal routes — HTTP surface under the forwarder mount.
 *
 * Split into family leaves mounted on one router; the single mount in
 * src/index.ts keeps resolving './routes/forwarder' to this index. Leaves
 * were cut in the old file's registration order; `router.use(resolveForwarder)`
 * stays here so every leaf sees the resolved forwarder profile exactly as the
 * old single-file router did.
 */
import { Router } from 'express';
import { resolveForwarder } from '../../middleware/forwarder';
import tripsRoutes from './trips';
import orderExchangeRoutes from './order-exchange';
import containersRoutes from './containers';
import expensesRoutes from './expenses';
import advancesRoutes from './advances';
import advanceDraftRoutes from '../financial/advance-drafts.routes';
import photosRoutes from './photos';
import typesRoutes from './types';

const router = Router();

// Resolve forwarder profile once for all routes — handlers access req.forwarder
router.use(resolveForwarder);
router.use('/', tripsRoutes);
router.use('/', orderExchangeRoutes);
router.use('/', containersRoutes);
router.use('/', expensesRoutes);
router.use('/', advancesRoutes);
router.use('/', advanceDraftRoutes);
router.use('/', photosRoutes);
router.use('/', typesRoutes);

// Named exports preserved from the old single-file router for test imports.
export {
  FORWARDER_IDEMPOTENCY_ENDPOINTS, forwarderTripContainerSchema,
  setForwarderExpensePhotoAfterUploadHookForTest,
} from './forwarder-shared';

export default router;
