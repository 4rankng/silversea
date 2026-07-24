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
  geminiApiKey: z.string().default(''),
  // OpenRouter (OpenAI-compatible) — primary OCR provider (Qwen3-VL). Optional;
  // when the key is set, container/seal OCR tries OpenRouter first and falls
  // back to Gemini on any error. Gated by key presence — no enable flag, per
  // the project's no-feature-flags stance (see ocr-openrouter-qwen-migration.md).
  // ONLY the key is env-driven. The base URL (https://openrouter.ai/api/v1) and
  // model (qwen/qwen3-vl-32b-instruct) are hardcoded constants in
  // services/ocr.service.ts (OPENROUTER_BASE_URL / OPENROUTER_MODEL) — change
  // them in code, not here.
  openrouterApiKey: z.string().default(''),
  // Bách Khoa GPS provider (dvbk.vn) — live vehicle positions. Optional; the
  // live-fleet endpoint degrades to an empty result when these are unset.
  // HTTPS base avoids sending credentials over plaintext (host redirects HTTP→HTTPS).
  bachKhoaApiUrl: z.string().url().default('https://dvbk.vn/BachKhoaAPI/'),
  bachKhoaUsername: z.string().default(''),
  bachKhoaPassword: z.string().default(''),
  bachKhoaTimeoutMs: z.coerce.number().int().positive().default(8000),
  // Which source to read live positions from:
  //  - 'auto'   : try the public API; on empty/access-denied, fall back to the portal (default)
  //  - 'api'    : documented /BachKhoaAPI/GetInfoCar only (needs vendor API-gateway access)
  //  - 'portal' : web-portal /Home/get_AllTIBase only (session-cookie login)
  bachKhoaProvider: z.enum(['auto', 'api', 'portal']).default('auto'),
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
  // Command-and-insight assistant (bot). Optional — the agent endpoints
  // return 503 while `botEnabled` is off, and the frontend launcher hides.
  // MiniMax key is empty until the owner signs off on data exposure (R2) and
  // the tool-calling + JSON-mode spike is verified (R1).
  //
  // ONLY `botEnabled` + `minimaxApiKey` are env-driven. Everything else the
  // bot needs — model, base URL, call timeout, ReAct loop cap — is a hardcoded
  // constant in services/llm/models.ts (MODEL_FAST / MINIMAX_BASE_URL /
  // MINIMAX_TIMEOUT_MS / AGENT_MAX_ITERATIONS). See that file for the rationale.
  botEnabled: z.boolean().default(false),
  minimaxApiKey: z.string().default(''),
  // Master key for at-rest encryption of DB-stored secrets (LLM API keys set
  // via the admin settings page). Optional; when empty, services/crypto.ts
  // derives a key from JWT_SECRET so existing deployments keep working. Set an
  // explicit 32-byte (base64/hex) key in prod for clean rotation. See crypto.ts.
  settingsEncryptionKey: z.string().default(''),
  // Chatbot SLA bands for the performance dashboard's user-perceived latency
  // gauge. p95 <= green = healthy; green < p95 <= amber = degraded; p95 > amber
  // = unhealthy. Tunable via env so ops can adjust without a redeploy.
  agentSlaP95GreenMs: z.coerce.number().int().positive().default(5000),
  agentSlaP95AmberMs: z.coerce.number().int().positive().default(12000),
  // A3 guardrail: when the model writes a destination path in prose instead of
  // calling ui.navigate, convert the turn into a real navigate directive so the
  // user is still taken to the page. Kill-switch — disable via env without a
  // redeploy if the matcher ever false-positives in production.
  agentNavigateGuardrail: z.boolean().default(true),
  // Tour net: validate an emitted {type:'start_tour} (role + existence) and
  // conservatively launch a curated tour when the model rambled a freeform
  // tutorial that matches one. Kill-switch — disable via env if it ever
  // false-positives (e.g. hijacks a narrow how-to question).
  agentTourGuardrail: z.boolean().default(true),
  // P1 Intent Router: deterministic route-before-reasoning. When ON, the agent
  // socket runs routeIntent() after the FAQ lane abstains and before the
  // orchestrator. Navigation intents (Lane 0) resolve to a directive with 0
  // LLM calls; single-entity lookups (Lane 2) get one tool call. Kill-switch —
  // disable via env to force every turn through the full ReAct loop.
  agentIntentRouter: z.boolean().default(true),
  // Live token streaming kill-switch. RUN_STARTED/tool progress remain active
  // when disabled; only model text falls back to terminal delivery. DISABLED
  // by default: streaming the prose prefix can race the final RUN_FINISHED
  // frame (a streamed bubble flashes then gets replaced by the authoritative
  // message). Answers now arrive whole in RUN_FINISHED.
  agentStreamingEnabled: z.boolean().default(false),
  // P5 Governance: LLM provider failover. When ON, a failed primary provider
  // call (timeout/http/429) retries on the alternate provider. Kill-switch.
  agentFailover: z.boolean().default(true),
  // P5 Governance: per-user chat rate limit (messages per minute). Prevents
  // abuse/cost runaway. 0 = disabled.
  agentRateLimitPerMin: z.number().int().nonnegative().default(20),
  // P5 Governance: agent_messages retention in days. 0 = keep forever.
  agentMessageRetentionDays: z.number().int().nonnegative().default(180),
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
  geminiApiKey: process.env.GEMINI_API_KEY,
  openrouterApiKey: process.env.OPENROUTER_API_KEY,
  bachKhoaApiUrl: process.env.BACH_KHOA_API_URL,
  bachKhoaUsername: process.env.BACH_KHOA_USERNAME,
  bachKhoaPassword: process.env.BACH_KHOA_PASSWORD,
  bachKhoaTimeoutMs: process.env.BACH_KHOA_TIMEOUT_MS,
  bachKhoaProvider: process.env.BACH_KHOA_PROVIDER,
  map4dApiKey: process.env.MAP4D_API_KEY,
  map4dApiUrl: process.env.MAP4D_API_URL,
  corsOrigin: process.env.CORS_ORIGIN,
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY,
  vapidSubject: process.env.VAPID_SUBJECT,
  botEnabled: parseFlag(process.env.BOT_ENABLE),
  minimaxApiKey: process.env.MINIMAX_API_KEY,
  settingsEncryptionKey: process.env.SETTINGS_ENCRYPTION_KEY,
  agentSlaP95GreenMs: process.env.AGENT_SLA_P95_GREEN_MS,
  agentSlaP95AmberMs: process.env.AGENT_SLA_P95_AMBER_MS,
  agentNavigateGuardrail: parseFlag(process.env.AGENT_NAVIGATE_GUARDRAIL, true),
  agentTourGuardrail: parseFlag(process.env.AGENT_TOUR_GUARDRAIL, true),
  agentIntentRouter: parseFlag(process.env.AGENT_INTENT_ROUTER, true),
  agentStreamingEnabled: parseFlag(process.env.AGENT_STREAMING_ENABLED, false),
  agentFailover: parseFlag(process.env.AGENT_FAILOVER, true),
  agentRateLimitPerMin: Number(process.env.AGENT_RATE_LIMIT_PER_MIN) || 20,
  agentMessageRetentionDays: Number(process.env.AGENT_MESSAGE_RETENTION_DAYS) || 180,
};

// Provide dev-only defaults for values not marked as required in production
const withDefaults = {
  ...raw,
  port: raw.port || '3001',
  databaseUrl: raw.databaseUrl || (isProd ? undefined : 'postgres://postgres:postgres@localhost:5432/tingting'),
  redisUrl: raw.redisUrl || (isProd ? undefined : 'redis://localhost:6390'),
  jwtSecret: raw.jwtSecret || (isProd ? undefined : 'dev-secret-change-in-production'),
  jwtExpiresIn: raw.jwtExpiresIn || '7d',
  uploadDir: raw.uploadDir || './uploads',
  nodeEnv: raw.nodeEnv || 'development',
  googleMapsApiKey: raw.googleMapsApiKey || '',
  geminiApiKey: raw.geminiApiKey || '',
  openrouterApiKey: raw.openrouterApiKey || '',
  bachKhoaApiUrl: raw.bachKhoaApiUrl || 'https://dvbk.vn/BachKhoaAPI/',
  bachKhoaUsername: raw.bachKhoaUsername || '',
  bachKhoaPassword: raw.bachKhoaPassword || '',
  bachKhoaTimeoutMs: raw.bachKhoaTimeoutMs || 8000,
  bachKhoaProvider: raw.bachKhoaProvider || 'auto',
  map4dApiKey: raw.map4dApiKey || '',
  map4dApiUrl: raw.map4dApiUrl || 'https://api.map4d.vn',
  corsOrigin: raw.corsOrigin || '',
  trustProxy: raw.trustProxy,
  vapidPublicKey: raw.vapidPublicKey || '',
  vapidPrivateKey: raw.vapidPrivateKey || '',
  vapidSubject: raw.vapidSubject || VAPID_SUBJECT_DEFAULT,
  botEnabled: raw.botEnabled,
  minimaxApiKey: raw.minimaxApiKey || '',
  settingsEncryptionKey: raw.settingsEncryptionKey || '',
  agentSlaP95GreenMs: raw.agentSlaP95GreenMs || 5000,
  agentSlaP95AmberMs: raw.agentSlaP95AmberMs || 12000,
  agentNavigateGuardrail: raw.agentNavigateGuardrail,
  agentTourGuardrail: raw.agentTourGuardrail,
  agentIntentRouter: raw.agentIntentRouter,
  agentStreamingEnabled: raw.agentStreamingEnabled,
  agentFailover: raw.agentFailover,
  agentRateLimitPerMin: raw.agentRateLimitPerMin,
  agentMessageRetentionDays: raw.agentMessageRetentionDays,
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
  databaseUrl: 'postgres://postgres:postgres@localhost:5432/tingting',
  redisUrl: 'redis://localhost:6390',
  jwtSecret: 'dev-secret-change-in-production',
  jwtExpiresIn: '7d',
  uploadDir: './uploads',
  nodeEnv: 'development',
  googleMapsApiKey: '',
  geminiApiKey: '',
  openrouterApiKey: '',
  bachKhoaApiUrl: 'https://dvbk.vn/BachKhoaAPI/',
  bachKhoaUsername: '',
  bachKhoaPassword: '',
  bachKhoaTimeoutMs: 8000,
  bachKhoaProvider: 'auto',
  map4dApiKey: '',
  map4dApiUrl: 'https://api.map4d.vn',
  corsOrigin: '',
  trustProxy: false,
  vapidPublicKey: '',
  vapidPrivateKey: '',
  vapidSubject: VAPID_SUBJECT_DEFAULT,
  botEnabled: false,
  minimaxApiKey: '',
  settingsEncryptionKey: '',
  agentSlaP95GreenMs: 5000,
  agentSlaP95AmberMs: 12000,
  agentNavigateGuardrail: true,
  agentTourGuardrail: true,
  agentIntentRouter: true,
  agentFailover: true,
  agentRateLimitPerMin: 20,
  agentMessageRetentionDays: 180,
});
