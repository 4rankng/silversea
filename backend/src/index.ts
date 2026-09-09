import './lib/telemetry.js';
import express from 'express';
import cors from 'cors';
import { config } from './config';
import { client as dbClient } from './db';
import { disconnectRedis } from './lib/redis';
import { initEnforcer } from './casbin/enforcer';
import { authMiddleware, assetAuthMiddleware } from './middleware/auth';
import { casbinAuthz, tripRouteAuthz } from './middleware/casbin';
import { requireRoles } from './middleware/casbin';
import { Role } from '@tingting/shared';
import { auditLogMiddleware } from './middleware/audit';
import { globalErrorHandler } from './middleware/errorHandler';
import { initAuditService } from './services/audit.service';
import { initNotificationService } from './services/notification.service';
import { initPushService } from './services/push.service';
import { registerJob, startScheduler, stopScheduler } from './scheduler';
import {
  REMINDER_CRON,
  REMINDER_RETRY_CRON,
  runReceivableReminderRetries,
  runReceivableReminders,
} from './services/receivable-reminder.service';
import {
  logDurableEffectRunSummary,
  processDueDurableEffectJobs,
} from './services/durable-effect.service';
import { runRetentionSweeps } from './services/retention.service';
import authRoutes from './routes/auth';
import configRoutes, { auditLogRouter, catalogBootstrapRouter, salaryPeriodsRouter, salaryPeriodsAdminRouter, tireLifecycleRouter } from './routes/config';
import tripRoutes from './routes/trips';
import shipmentRoutes from './routes/shipments';
import portalRoutes from './routes/portal';
import financialRoutes from './routes/financial';
import { freightRatePreviewRoutes } from './routes/financial/freight-rate.routes';
import expenseRoutes from './routes/expense';
import driverRoutes from './routes/driver';
import forwarderRoutes from './routes/forwarder';
import forwarderAdminRoutes from './routes/forwarder-admin';
import ocrSettingsRoutes from './routes/ocr-settings';
import { appSettingsRouter } from './routes/app-settings';
import { uploadRouter, photosRouter } from './routes/upload';
import ocrRoutes from './routes/ocr';
import mapsRoutes from './routes/maps';
import notificationRoutes from './routes/notifications';
import opsRoutes from './routes/ops';
import salaryRoutes from './routes/salary';
import geotagRoutes from './routes/geotag';
import recoverableCostRoutes from './routes/recoverable-costs';
import { dashboardWorkInboxRouter, driverWorkInboxRouter, financialWorkInboxRouter, forwarderWorkInboxRouter, portalWorkInboxRouter, systemWorkInboxRouter } from './routes/work-inbox';

await initAuditService();
await initNotificationService();
await initPushService();
await initEnforcer();

// ─── Scheduler (Wave 0) ─────────────────────────────────────────────────────
// Self-test heartbeat: 1-min cadence, disabled in test (NODE_ENV=test) and in
// CI when SCHEDULER_DISABLE is set. Wave 2/3 register real jobs (email
// retry, receivable reminders, salary-period close) next to this one.
//
// Env knobs:
//   NODE_ENV=test                 — auto-disables (avoids firing during `npm test`)
//   SCHEDULER_DISABLE=1           — manually disable (one-off scripts, migrations)
const schedulerEnabled =
  config.nodeEnv !== 'test' && process.env.SCHEDULER_DISABLE !== '1';
if (schedulerEnabled) {
  registerJob({
    name: 'scheduler-heartbeat',
    cron: '* * * * *',
    handler: async () => {
      // No-op heartbeat; visible as a row in scheduler_run_logs every minute.
      console.log('[scheduler] heartbeat tick');
    },
  });

  // Wave 3 M5.7 — daily receivable-overdue reminder. Sends an email to
  // the customer + an in-app notification to financial roles. Skips
  // paid / disputed / suspended customers; dedupes per calendar day.
  registerJob({
    name: 'receivable-reminder',
    cron: REMINDER_CRON,
    handler: async () => {
      const stats = await runReceivableReminders();
      console.log(`[scheduler] receivable-reminder: ${stats.reminded} reminded, ${stats.skipped} skipped, ${stats.deduped} deduped, ${stats.failed} failed`);
    },
  });

  registerJob({
    name: 'receivable-reminder-retry',
    cron: REMINDER_RETRY_CRON,
    handler: async () => {
      const stats = await runReceivableReminderRetries();
      console.log(`[scheduler] receivable-reminder-retry: ${stats.retried} retried, ${stats.suppressed} suppressed, ${stats.escalated} escalated, ${stats.failed} failed`);
    },
  });

  registerJob({
    name: 'durable-effect-dispatch',
    cron: '* * * * *',
    handler: async () => {
      const jobs = await processDueDurableEffectJobs();
      logDurableEffectRunSummary(jobs);
    },
  });

  // Daily 03:15 — retention sweeps for high-churn tables (notifications,
  // scheduler logs, durable-effect outbox, import row diagnostics).
  registerJob({
    name: 'retention-daily',
    cron: '15 3 * * *',
    retries: 1,
    handler: async () => {
      const results = await runRetentionSweeps();
      console.log(`[scheduler] retention-daily: ${results.map(r => `${r.table}=${r.deleted}`).join(', ')}`);
    },
  });

  startScheduler();
}

// Enable unaccent extension
try {
  await dbClient`CREATE EXTENSION IF NOT EXISTS unaccent;`;
  console.log('PostgreSQL unaccent extension initialized successfully.');
} catch (e) {
  console.error('Failed to initialize unaccent extension:', e);
}

const app = express();

// Honour X-Forwarded-For from the reverse proxy in front of us (nginx in
// prod). Without this, `req.ip` returns the Docker bridge IP (e.g.
// 172.18.0.1) and audit logs capture that instead of the real client IP.
// Configurable via TRUST_PROXY env (number of hops, or true/false); defaults
// to 1 in production, false in dev. MUST be set before any middleware that
// reads `req.ip`.
app.set('trust proxy', config.trustProxy);

// ── Core middleware ────────────────────────────────────────────────────────
app.use(cors({
  origin: config.corsOrigin
    ? config.corsOrigin.split(',').map(s => s.trim())
    : config.nodeEnv === 'development'
      ? 'http://localhost:7174'
      : false,
}));
app.use(express.json());
app.use('/uploads', express.static(config.uploadDir));

// Inlined request logger (was middleware/logger.ts — too shallow for its own module)
const LOG_SKIP_PATHS = ['/api/health', '/uploads', '/favicon.ico'];
app.use((req, res, next) => {
  if (LOG_SKIP_PATHS.some(p => req.path.startsWith(p))) return next();
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});

app.use(auditLogMiddleware);

// ── Public routes ──────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Auth routes: login is public, /me and /users use their own authMiddleware
app.use('/api/auth', authRoutes);

// ── Protected routes (auth + Casbin) — specific paths first, catch-all /api last
// Resolve endpoint for salary periods (defaults, overrides) — accessible to all authenticated users
app.use('/api/salary-periods', authMiddleware, salaryPeriodsRouter);
// Admin CRUD for salary periods (defaults, overrides) — config authz
app.use('/api/salary-periods', authMiddleware, casbinAuthz('config'), salaryPeriodsAdminRouter);
app.use('/api/driver/me', authMiddleware, casbinAuthz('driver_portal'), driverWorkInboxRouter, driverRoutes);
app.use('/api/forwarder/me', authMiddleware, casbinAuthz('operations_portal'), forwarderWorkInboxRouter, forwarderRoutes);
// Ops field-operations portal (docs/prd/OpsVanHanh.md): role gates live inside
// the router (OPS portal routes / ADMIN·MANAGER·ACCOUNTANT approvals /
// ADMIN-only truck assignment), so no Casbin resource is introduced here.
app.use('/api/ops', authMiddleware, opsRoutes);
app.use('/api/forwarder-expenses', authMiddleware, casbinAuthz('financial'), forwarderAdminRoutes);
app.use('/api/admin/ocr-settings', authMiddleware, casbinAuthz('ocr-settings'), requireRoles(Role.ADMIN), ocrSettingsRoutes);
app.use('/api/admin/app-settings', authMiddleware, casbinAuthz('config'), appSettingsRouter);
app.use('/api/maps', authMiddleware, casbinAuthz('maps'), mapsRoutes);
app.use('/api/photos', assetAuthMiddleware, casbinAuthz('photos'), photosRouter);
app.use('/api/upload', authMiddleware, casbinAuthz('upload'), uploadRouter);
// OCR (container/seal recognition) — must mount before the catch-all /api
app.use('/api/ocr', authMiddleware, casbinAuthz('ocr'), ocrRoutes);
// Event-driven mobile GPS geotagging — phone fix captured on photo submission
// (container/seal, port receipt, fuel pump). Portal-facing; per-portal
// ownership resolved inside the service. MUST mount before the catch-all /api.
app.use('/api/geotag', authMiddleware, casbinAuthz('geotag'), geotagRoutes);
app.use('/api/notifications', authMiddleware, casbinAuthz('notifications'), notificationRoutes);
app.use('/api/trips', authMiddleware, tripRouteAuthz(), tripRoutes);
// Shipments (Wave 0 — lô hàng): first-class shipment entity that every later
// wave (CUS portal, debit-note, dispatch handoff) builds on. RBAC matrix:
// ADMIN wildcard · MANAGER read+write+delete · ACCOUNTANT read · CLERK
// read+write. CUSTOMER/DRIVER/FORWARDER are denied at this mount; the customer
// portal ships its own row-scoped surface in Wave 2.
app.use('/api/shipments', authMiddleware, casbinAuthz('shipments'), shipmentRoutes);
// Freight pricing preview (Phương án tính cước §2-D): shipments-authorized —
// the CUS create form (shipments read) consumes it without a financial grant.
// The snapshot/override financial surface mounts with the financial router.
app.use('/api/pricing', authMiddleware, casbinAuthz('shipments'), freightRatePreviewRoutes);
app.use('/api/recoverable-costs', authMiddleware, casbinAuthz('recoverable_costs'), recoverableCostRoutes);
app.use('/api/portal', authMiddleware, casbinAuthz('customer_portal'), requireRoles(Role.CUSTOMER), portalWorkInboxRouter, portalRoutes);
app.use('/api/financial', authMiddleware, casbinAuthz('financial'), financialWorkInboxRouter);
app.use('/api/dashboard', authMiddleware, dashboardWorkInboxRouter);
app.use('/api/system', authMiddleware, systemWorkInboxRouter);
// Catalog bootstrap is used by both office pages and portal forms. The router
// trims sensitive catalogs for DRIVER/FORWARDER before responding.
app.use('/api', authMiddleware, catalogBootstrapRouter);
// Config must mount before the generic /api financial catch-all,
// otherwise financial Casbin gate blocks FORWARDER from /catalogs/bootstrap etc.
app.use('/api', authMiddleware, casbinAuthz('config'), configRoutes);
app.use('/api', authMiddleware, casbinAuthz('financial'), financialRoutes);
app.use('/api/expenses', authMiddleware, casbinAuthz('financial'), expenseRoutes);
app.use('/api/audit-logs', authMiddleware, casbinAuthz('audit_logs'), auditLogRouter);
// N1 — tire lifecycle (install/remove). CRUD lives under the config catch-all
// at /api/fleet/tires; these dedicated endpoints need the same auth + config
// gating + MANAGER/ADMIN role (enforced inside the router).
app.use('/api/fleet/tires', authMiddleware, casbinAuthz('config'), tireLifecycleRouter);
app.use('/api/salary', authMiddleware, casbinAuthz('salary'), salaryRoutes);

// ── 404 catch-all (before error handler so unmatched API routes get 404, not 500) ──
app.use('/api', (_req, res) => res.status(404).json({ error: 'Không tìm thấy API' }));

// ── Global error handler (MUST be last) ────────────────────────────────────
app.use(globalErrorHandler);

const server = app.listen(config.port, () => {
  console.log(`NEPO API running on port ${config.port} [${config.nodeEnv}]`);
});

// ── Graceful shutdown (tsx watch sends SIGTERM on restart) ─────────────────
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received — shutting down…`);

  stopScheduler();               // cancel all cron tasks (Wave 0)
  server.close();                // stop accepting new connections
  await dbClient.end();          // drain Postgres pool
  await disconnectRedis();       // close Redis connection
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

export default app;
