import dotenv from 'dotenv';
import { z } from 'zod';

// Values supplied by the process (test runners, containers, and production
// deploys) must take precedence over the developer's local .env file.
dotenv.config();

const isProd = process.env.NODE_ENV === 'production';

// Default VAPID subject (RFC 8030 "from" contact). Single source — referenced
// by the schema default, the dev fallback, and the parse-failure recovery below.
const VAPID_SUBJECT_DEFAULT = 'mailto:admin@tingting.vip';

// Express `trust proxy` setting — controls how `req.ip` reads X-Forwarded-For.
// Number = hop count (typical: 1 when a single reverse proxy like nginx sits
// in front), boolean = trust all / trust none. Default 1 in production, false
// in dev. WITHOUT THIS, `req.ip` returns the Docker bridge address (e.g.
// 172.18.0.1) instead of the real client IP, which breaks audit logging.
const trustProxySchema = z.union([z.boolean(), z.number().int().nonnegative()]);

function parseTrustProxy(raw: string | undefined): boolean | number {
  if (raw === undefined || raw === '') return isProd ? 1 : false;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 0) return n;
  // Fall back to safe default if the env value is bogus.
  return isProd ? 1 : false;
}

// Strict boolean parse for feature flags. `z.coerce.boolean()` treats any
// non-empty string (including "false") as true, so flags must be parsed
// explicitly: only "true"/"1"/"yes" enable. Everything else stays off.
function parseFlag(raw: string | undefined, fallback = false): boolean {
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes';
}

const configSchema = z.object({
  port: z.coerce.number().int().positive().default(3001),
  databaseUrl: z.string().url().min(1),
  redisUrl: z.string().min(1),
  jwtSecret: z.string().min(isProd ? 32 : 1),
  jwtExpiresIn: z.string().default('7d'),
  uploadDir: z.string().default('./uploads'),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  googleMapsApiKey: z.string().default(''),
  // OpenRouter (OpenAI-compatible) — sole OCR provider (Qwen 2-tier chain,
  // matching vantaiphucloc). Gated by key presence — no enable flag, per the
  // project's no-feature-flags stance. ONLY the key is env-driven. The base
  // URL (https://openrouter.ai/api/v1) and the model chain
  // (qwen3-vl-32b-instruct → qwen3.7-plus) are hardcoded constants in
  // services/ocr.service.ts — change them in code, not here.
  openrouterApiKey: z.string().default(''),
  // Map4D place search (api.map4d.vn) — the map/search provider the Bách Khoa
  // portal embeds. Replaces OpenStreetMap/Nominatim for place autocomplete +
  // geocoding. The key alone authenticates (passed as ?key=, no portal login).
  // Search + geocoding degrade to empty when the key is unset.
  map4dApiKey: z.string().default(''),
  map4dApiUrl: z.string().url().default('https://api.map4d.vn'),
  corsOrigin: z.string().default(''),
  trustProxy: trustProxySchema.default(isProd ? 1 : false),
  // Web Push (VAPID). Optional — push silently no-ops when these are empty.
  vapidPublicKey: z.string().default(''),
  vapidPrivateKey: z.string().default(''),
  vapidSubject: z.string().default(VAPID_SUBJECT_DEFAULT),
  // Wave 0: shipment-first trip creation. When ON, `/api/trips` POST requires
  // a `shipmentId` at the HTTP boundary and the new trip is linked +
  // container-snapshotted from that shipment. When OFF (default),
  // `shipmentId` is optional — legacy trip creation keeps working unchanged,
  // but callers MAY pass a `shipmentId` to link + snapshot. The check is
  // enforced in `routes/trips.ts`, not the service, so other callers (seeds,
  // CLIs, internal services) can still create unlinked trips even with the
  // flag ON. Default OFF for backward compatibility; flip to ON
  // per-environment once the shipment-first migration is complete.
  shipmentFirstCreate: z.boolean().default(false),
  // Driver-app spec (260827): the Ops field-operations module (physical
  // paper-order handoff confirmation) isn't built yet, so the driver's first
  // milestone ("Đã nhận lệnh gốc" / accept order) is temporarily allowed to
  // fire without Ops having confirmed `paperOrderCollectedAt/By` first.
  // Default OFF (gate bypassed) per that spec's explicit instruction. Flip to
  // ON once the Ops module ships to restore the strict handoff gate.
  driverOpsPaperOrderGateEnabled: z.boolean().default(false),
  // Master key for at-rest encryption of DB-stored secrets (provider API keys
  // set via the admin settings pages). Optional; when empty, services/crypto.ts
  // derives a key from JWT_SECRET so existing deployments keep working. Set an
  // explicit 32-byte (base64/hex) key in prod for clean rotation. See crypto.ts.
  settingsEncryptionKey: z.string().default(''),
  // Wave 2 M3.3: Email service. The Resend API key is managed by ADMIN in
  // app_settings; sender identity remains deployment configuration.
  emailFromAddress: z.string().default('noreply@tingting.vn'),
  emailFromName: z.string().default('TingTing Logistics'),
  // Shared postgres client pool bounds (src/db/index.ts). All values are
  // per-connection timing/limits, not total-runtime limits — long seed and
  // import scripts stay unaffected. statement_timeout is deliberately NOT a
  // code option (postgres.js has none); deployments opt in via a DATABASE_URL
  // startup parameter at the compose level.
  dbPoolMax: z.coerce.number().int().positive().default(20),
  dbIdleTimeoutSeconds: z.coerce.number().int().nonnegative().default(30),
  dbConnectTimeoutSeconds: z.coerce.number().int().positive().default(10),
  dbMaxLifetimeSeconds: z.coerce.number().int().positive().default(1800),
});

const raw = {
  port: process.env.PORT,
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN,
  uploadDir: process.env.UPLOAD_DIR,
  nodeEnv: process.env.NODE_ENV,
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
  openrouterApiKey: process.env.OPENROUTER_API_KEY,
  map4dApiKey: process.env.MAP4D_API_KEY,
  map4dApiUrl: process.env.MAP4D_API_URL,
  corsOrigin: process.env.CORS_ORIGIN,
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY,
  vapidSubject: process.env.VAPID_SUBJECT,
  shipmentFirstCreate: parseFlag(process.env.SHIPMENT_FIRST_CREATE),
  driverOpsPaperOrderGateEnabled: parseFlag(process.env.DRIVER_OPS_PAPER_ORDER_GATE_ENABLED, false),
  settingsEncryptionKey: process.env.SETTINGS_ENCRYPTION_KEY,
  dbPoolMax: process.env.DB_POOL_MAX,
  dbIdleTimeoutSeconds: process.env.DB_IDLE_TIMEOUT_SECONDS,
  dbConnectTimeoutSeconds: process.env.DB_CONNECT_TIMEOUT_SECONDS,
  dbMaxLifetimeSeconds: process.env.DB_MAX_LIFETIME_SECONDS,
};

// Provide dev-only defaults for values not marked as required in production
const withDefaults = {
  ...raw,
  port: raw.port || '3001',
  databaseUrl: raw.databaseUrl || (isProd ? undefined : 'postgres://postgres:postgres@localhost:5441/silversea'),
  // 6391 = this checkout's ss-prod-redis (the ss-main checkout's redis is 6392).
  // REDIS_URL in backend/.env must win at runtime; the default only has to
  // name the right container for THIS tree.
  redisUrl: raw.redisUrl || (isProd ? undefined : 'redis://localhost:6391'),
  jwtSecret: raw.jwtSecret || (isProd ? undefined : 'dev-secret-change-in-production'),
  jwtExpiresIn: raw.jwtExpiresIn || '7d',
  uploadDir: raw.uploadDir || './uploads',
  nodeEnv: raw.nodeEnv || 'development',
  googleMapsApiKey: raw.googleMapsApiKey || '',
  openrouterApiKey: raw.openrouterApiKey || '',
  map4dApiKey: raw.map4dApiKey || '',
  map4dApiUrl: raw.map4dApiUrl || 'https://api.map4d.vn',
  corsOrigin: raw.corsOrigin || '',
  trustProxy: raw.trustProxy,
  vapidPublicKey: raw.vapidPublicKey || '',
  vapidPrivateKey: raw.vapidPrivateKey || '',
  vapidSubject: raw.vapidSubject || VAPID_SUBJECT_DEFAULT,
  driverOpsPaperOrderGateEnabled: raw.driverOpsPaperOrderGateEnabled,
  settingsEncryptionKey: raw.settingsEncryptionKey || '',
  emailFromAddress: process.env.EMAIL_FROM_ADDRESS || 'noreply@tingting.vn',
  emailFromName: process.env.EMAIL_FROM_NAME || 'TingTing Logistics',
};

const result = configSchema.safeParse(withDefaults);

if (!result.success) {
  console.error('❌ Invalid configuration:');
  for (const issue of result.error.issues) {
    console.error(`   ${issue.path.join('.')}: ${issue.message}`);
  }
  if (isProd) {
    console.error('\nMissing or invalid environment variables. Exiting.');
    process.exit(1);
  }
  // In development, log warnings but continue with defaults
  console.warn('⚠️  Running with defaults — fix before deploying!');
}

export const config = result.success ? result.data : configSchema.parse({
  port: 3001,
  databaseUrl: 'postgres://postgres:postgres@localhost:5441/silversea',
  redisUrl: 'redis://localhost:6392',
  jwtSecret: 'dev-secret-change-in-production',
  jwtExpiresIn: '7d',
  uploadDir: './uploads',
  nodeEnv: 'development',
  googleMapsApiKey: '',
  openrouterApiKey: '',
  map4dApiKey: '',
  map4dApiUrl: 'https://api.map4d.vn',
  corsOrigin: '',
  trustProxy: false,
  vapidPublicKey: '',
  vapidPrivateKey: '',
  vapidSubject: VAPID_SUBJECT_DEFAULT,
  settingsEncryptionKey: '',
});
