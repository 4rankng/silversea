// MiniMax LLM connection constants — hardcoded (NO env vars).
//
// All MiniMax + agent-orchestration constants live here as a single source of
// truth. We deliberately do NOT read these from the environment (per project
// decision): the values had drifted across `backend/.env`, `backend/.env.example`,
// and the config zod defaults. Only TWO values remain env-driven —
// `BOT_ENABLE` (on/off) and `MINIMAX_API_KEY` (secret); everything else is a
// constant imported from here.
//
// A MODEL_STRONG tier is reserved for future task-complexity routing (P2) and is
// intentionally unused today. Keep the default on MiniMax's high-speed line:
// the agent makes several sequential calls on analytical turns, so per-call
// output latency compounds quickly.

/** Model used for every MiniMax call (ReAct loop + final structured answer). */
export const MODEL_FAST = 'MiniMax-M2.7-highspeed';

/** OpenAI-compatible Chat Completions endpoint (international host). */
export const MINIMAX_BASE_URL = 'https://api.minimax.io/v1';

/** Per-call HTTP timeout (ms). AbortController fires at this boundary; an abort
 *  surfaces as a `timeout` MiniMaxError code. Applies to every call path. */
export const MINIMAX_TIMEOUT_MS = 60_000;

/** Hard cap on the ReAct tool-calling loop (runaway guard). Prod metrics show
 *  the 6-iteration tail is where latency explodes (a 6-iter turn hit 78 s /
 *  145 k prompt tokens): each extra iteration re-bills the whole growing
 *  context to a slow reasoning model. Normal analytical turns converge in ≤3,
 *  so 4 keeps a safety margin while killing the catastrophic tail. */
export const AGENT_MAX_ITERATIONS = 4;

// ─── OpenRouter (optional alternate agent provider) ─────────────────────────
// The admin can switch the chatbot agent to OpenRouter from the settings page
// (provider abstraction in services/llm/provider-registry.ts). OpenRouter is
// OpenAI-compatible, so the agent call shape is identical to MiniMax; the only
// differences are the base URL, the absence of MiniMax's `reasoning_split`, and
// the model id. Like the MiniMax constants above, these are code constants —
// not env-driven — to keep a single source of truth and prevent drift.
//
// `deepseek/deepseek-v4-flash` (DeepSeek V4 Flash) is the default: an efficiency-
// optimized MoE (284B total / 13B active, 1M context, ~$0.077/$0.154 per M tokens)
// explicitly built for chat systems + agent workflows with reasoning + tool use.
// Change here (one line) to route to a different OpenRouter model. NOTE: OCR has
// its OWN OpenRouter usage (qwen/qwen3-vl-32b-instruct in ocr.service.ts) — these
// constants are for the agent only and do not overlap.
export const OPENROUTER_MODEL = 'deepseek/deepseek-v4-flash';
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
/** Per-call HTTP timeout — matches MiniMax so agent latency budgets are
 *  provider-agnostic. */
export const OPENROUTER_TIMEOUT_MS = 60_000;
