import './lib/telemetry.js';
import express from 'express';
import cors from 'cors';
import { config } from './config';
import { client as dbClient } from './db';
import { disconnectRedis } from './lib/redis';
import { initEnforcer } from './casbin/enforcer';
import { authMiddleware, assetAuthMiddleware } from './middleware/auth';
import { casbinAuthz } from './middleware/casbin';
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
import { processPendingTripGpsCaptureJobs } from './services/trip-gps-capture-job.service';
import authRoutes from './routes/auth';
import configRoutes, { auditLogRouter, catalogBootstrapRouter, salaryPeriodsRouter, salaryPeriodsAdminRouter, tireLifecycleRouter } from './routes/config';
import tripRoutes from './routes/trips';
import shipmentRoutes from './routes/shipments';
import portalRoutes from './routes/portal';
import { agentRoutes } from './routes/agent';
import { initAgentSocket } from './agentSocket';
import financialRoutes from './routes/financial';
import expenseRoutes from './routes/expense';
import driverRoutes from './routes/driver';
import forwarderRoutes from './routes/forwarder';
import forwarderAdminRoutes from './routes/forwarder-admin';
import adminGpsRoutes from './routes/admin-gps';
import gpsSettingsRoutes from './routes/gps-settings';
import adminChatbotMetricsRoutes from './routes/admin-chatbot-metrics';
import llmSettingsRoutes from './routes/llm-settings';
import { appSettingsRouter } from './routes/app-settings';
import faqAdminRoutes from './routes/faq-admin';
import { onboardingRouter } from './routes/onboarding';
import { onboardingSettingsRouter } from './routes/onboarding-settings';
import { uploadRouter, photosRouter } from './routes/upload';
import ocrRoutes from './routes/ocr';
import mapsRoutes from './routes/maps';
import notificationRoutes from './routes/notifications';
import salaryRoutes from './routes/salary';
import geotagRoutes from './routes/geotag';
import recoverableCostRoutes from './routes/recoverable-costs';
import { requireWorkflowActive } from './middleware/workflow-rollout';

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
    name: 'trip-gps-capture-retry',
    cron: '* * * * *',
    handler: async () => {
      const jobs = await processPendingTripGpsCaptureJobs();
      if (jobs.length > 0) {
        console.log(`[scheduler] trip-gps-capture-retry: ${jobs.length} job(s) processed`);
      }
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
app.use('/api/driver/me', authMiddleware, casbinAuthz('driver_portal'), driverRoutes);
app.use('/api/forwarder/me', authMiddleware, casbinAuthz('forwarder_portal'), forwarderRoutes);
app.use('/api/forwarder-expenses', authMiddleware, casbinAuthz('financial'), forwarderAdminRoutes);
// GPS route-DB admin (backfill + recapture) — MANAGER/ADMIN only (gps-admin action).
app.use('/api/admin/gps', authMiddleware, casbinAuthz('gps-admin'), adminGpsRoutes);
app.use('/api/admin/gps-settings', authMiddleware, requireRoles(Role.ADMIN), gpsSettingsRoutes);
// Chatbot (agent) performance monitoring — ADMIN-only aggregation API. The
// `chatbot-metrics` action needs no Casbin policy row: the ADMIN wildcard
// (`p, ADMIN, *, *`) grants ADMIN and every other role gets 403. MUST mount
// before the catch-all /api or it would be shadowed.
app.use('/api/admin/chatbot', authMiddleware, casbinAuthz('chatbot-metrics'), adminChatbotMetricsRoutes);
// Admin LLM provider settings (MiniMax / OpenRouter selection + API keys).
// ADMIN-only: the `llm-settings` Casbin resource has no policy row, so only the
// ADMIN wildcard (`p, ADMIN, *, *`) matches; requireRoles(Role.ADMIN) is the
// belt-and-suspenders gate. MUST mount before the catch-all /api.
app.use('/api/admin/llm-settings', authMiddleware, casbinAuthz('llm-settings'), requireRoles(Role.ADMIN), llmSettingsRoutes);
app.use('/api/admin/app-settings', authMiddleware, casbinAuthz('config'), appSettingsRouter);
// Admin onboarding master switch (turn the onboarding tutorial on/off app-wide).
// ADMIN-only: same gate pattern as llm-settings — the `onboarding-settings`
// Casbin resource has no policy row, so only the ADMIN wildcard matches.
app.use('/api/admin/onboarding-settings', authMiddleware, casbinAuthz('onboarding-settings'), requireRoles(Role.ADMIN), onboardingSettingsRouter);
// Admin FAQ knowledge base management (create/update/delete + auto-embed).
// ADMIN-only: same gate pattern as llm-settings — the `faq-admin` Casbin
// resource has no policy row, so only the ADMIN wildcard matches; requireRoles
// is belt-and-suspenders. MUST mount before the catch-all /api.
app.use('/api/admin/faq-entries', authMiddleware, casbinAuthz('faq-admin'), requireRoles(Role.ADMIN), faqAdminRoutes);
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
app.use('/api/trips', authMiddleware, casbinAuthz('trips'), tripRoutes);
// Shipments (Wave 0 — lô hàng): first-class shipment entity that every later
// wave (CUS portal, debit-note, dispatch handoff) builds on. RBAC matrix:
// ADMIN wildcard · MANAGER read+write+delete · ACCOUNTANT read · CLERK
// read+write. CUSTOMER/DRIVER/FORWARDER are denied at this mount; the customer
// portal ships its own row-scoped surface in Wave 2.
app.use('/api/shipments', authMiddleware, casbinAuthz('shipments'), shipmentRoutes);
app.use('/api/recoverable-costs', authMiddleware, requireWorkflowActive, casbinAuthz('recoverable_costs'), recoverableCostRoutes);
app.use('/api/portal', authMiddleware, casbinAuthz('customer_portal'), requireRoles(Role.CUSTOMER), portalRoutes);
// Command-and-insight assistant (bot). Acts as the caller; office roles only.
// 503 while BOT_ENABLE is off. Mounts before the catch-all /api.
app.use('/api/agent', authMiddleware, casbinAuthz('agent'), agentRoutes);
// Onboarding (Phase 4): tour progress + checklist tasks. Office roles only —
// mirrors the agent gate. The `onboarding` Casbin resource has explicit policy
// rows for MANAGER/ACCOUNTANT; ADMIN matches via its wildcard.
app.use('/api/onboarding', authMiddleware, casbinAuthz('onboarding'), requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT), onboardingRouter);
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

// Command-and-insight assistant real-time transport. Attached to the same
// http.Server Express uses; returns null when the bot is disabled.
const agentIo = initAgentSocket(server);

// ── Graceful shutdown (tsx watch sends SIGTERM on restart) ─────────────────
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received — shutting down…`);

  agentIo?.close();              // stop the assistant socket.io server
  stopScheduler();               // cancel all cron tasks (Wave 0)
  server.close();                // stop accepting new connections
  await dbClient.end();          // drain Postgres pool
  await disconnectRedis();       // close Redis connection
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

export default app;
