# OCR Provider Migration: Gemini → OpenRouter (Qwen3-VL) with Gemini Fallback

> **Status:** `APPROVED` — consensus reached (Planner ✓ · Architect **SOUND-WITH-CHANGES**, 7 findings incorporated · Critic **APPROVE**) + user-confirmed 2026-06-28: **32B model** (`qwen/qwen3-vl-32b-instruct`) and **no `provider` field** in the API response. Awaiting execution path (team / ralph). No code touched yet.
> **Scope decision (user-confirmed 2026-06-28):** OpenRouter (Qwen3-VL) = **primary**; Gemini = **automatic fallback**; **MiniMax is excluded** from OCR entirely.
> **Risk band:** Short mode. No auth/security, no DB migrations, no PII/compliance, no public-API contract break (only an *additive* optional `provider` field). Touches one service, one config file, one route, one env-example, one frontend type.

---

## RALPLAN-DR Summary

### Principles (4)
1. **Faithful port, not a re-imagining.** Mirror vantaiphucloc's proven `openrouter.py` + multi-provider `ocr.py` design rather than inventing a new OCR architecture. Proven > clever.
2. **Key-presence gating, no new feature-flags.** A provider is "enabled" iff its API key is set — mirroring how `geminiApiKey` already works. Honors the project's "no agent feature-flags" stance: no `OPENROUTER_ENABLE` boolean. *(Scope note — Architect finding #5: the `no-agent-feature-flags` memory was written about the chatbot/agent; this plan extends the same principle to OCR, diverging intentionally from vantaiphucloc's `OPENROUTER_ENABLE`/`GEMINI_ENABLE` booleans. Recorded here so a future reader doesn't "fix" the divergence by re-adding flags.)*
3. **Preserve nepocorp's SEAL path.** vantaiphucloc's OCR only handles containers; nepocorp's `extractContainerAndSeal` handles **both CONTAINER and SEAL**. The OpenRouter client is prompt-generic, so both types must keep working through the new provider.
4. **No contract break.** The `/api/ocr` response shape stays byte-compatible; the only addition is an optional `provider` string. The existing `parseResponse()` JSON+regex safety net is reused unchanged.

### Decision Drivers (top 3)
1. **The user said "instead of Gemini"** → OpenRouter must be the *primary* provider tried first, every time. Gemini becomes insurance, not the default.
2. **Driver-facing latency + accuracy** → a misread container/seal number is worse than a slightly slower call. Fallback on *any* OpenRouter failure (HTTP error, empty, no-valid-numbers) keeps OCR resilient.
3. **`no-agent-feature-flags` memory** → don't ship `OPENROUTER_ENABLE`/`GEMINI_ENABLE` booleans. Gate purely on whether each key is present. One env var (the key) does the work of two.

### Viable Options
- **Option A — Multi-provider orchestrator (OpenRouter primary → Gemini fallback), key-gated.** *(Chosen.)* Ports vantaiphucloc's `openrouter.py` to TS and refactors `extractContainerAndSeal` to iterate providers first-valid-wins. Pros: proven in vantaiphucloc prod; resilient; honors "no flags"; Gemini stays as zero-cost insurance. Cons: larger diff than a pure swap; two providers to keep configured.
- **Option B — Pure replacement (rip Gemini out, OpenRouter only).** Smaller diff, but loses the automatic fallback that vantaiphucloc relies on (a single OpenRouter 429/timeout → driver sees "Không nhận dạng được"). Rejected: user explicitly wants Gemini retained as fallback.
- **Option C — Add MiniMax as last-resort (full vantaiphucloc parity).** Rejected: user explicitly excluded MiniMax from OCR. (MiniMax remains in use only for the chatbot/agent, untouched.)

> Alternatives B and C are invalidated by explicit user instruction, not by analysis alone.

### ADR
- **Decision:** Migrate OCR to OpenRouter (Qwen3-VL) primary with Gemini key-presence-gated fallback; no MiniMax; no enable booleans.
- **Drivers:** user directive ("use openrouter qwen instead of gemini", then "fallback Gemini too, no minimax"); vantaiphucloc has the working reference; accuracy > raw speed for OCR.
- **Alternatives considered:** B (pure removal — loses resilience), C (add MiniMax — explicitly disallowed).
- **Why chosen:** Matches the exact provider chain the user named, reuses a proven design, and keeps the blast radius to one service + config.
- **Consequences:** Only `OPENROUTER_API_KEY` is env-driven (else OCR degrades to Gemini-only, or to "chưa cấu hình" if neither key is set). The base URL + model are **hardcoded constants** in `ocr.service.ts`, not env vars (per the user 2026-06-28; mirrors the MiniMax LLM pattern). tsx watch will not pick up new `.env` values — backend restart required (per `gemini-env-staleness` memory).
- **Follow-ups (out of scope):** (1) OpenRouter accuracy baseline harness (vantaiphucloc's `diag_minimax_ocr.py` only covers MiniMax — no OpenRouter baseline exists); (2) optional `provider` surfacing in any future OCR-analytics UI.

### Decisions resolved (user-confirmed 2026-06-28)
1. **Model slug — DECIDED (user):** `qwen/qwen3-vl-32b-instruct`. User chose 32B to match what vantaiphucloc actually runs in prod (`config.py` default, no `.env` override). This overrides the Architect's latency-first 8B recommendation (finding #4) in favor of accuracy parity with the reference deployment; the latency tradeoff is absorbed by the 60s timeout + automatic Gemini fallback. Now a code constant (`OPENROUTER_MODEL` in `ocr.service.ts`) — switch to the 8B variant in code if 32B proves too slow post-deploy.
2. **Surface `provider` in the API response — DECIDED (user): NO.** The `/api/ocr` response stays byte-identical to today. The service-internal `ExtractResult.provider` field is retained (server logs + unit-test assertions of which provider won), but it is **not** serialized to the client. → **No route change and no frontend change** (both dropped from the file list).

---

## Files

| File | Change | Type |
|------|--------|------|
| `backend/src/services/ocr.service.ts` | Add `callOpenRouterVision()`; generalize provider abstraction; multi-provider `extractContainerAndSeal` (OpenRouter→Gemini, first-valid-wins, preserve CONTAINER+SEAL); add `<think>` stripping; widen `provider` type. | Major |
| `backend/src/config/index.ts` | Add `openrouterApiKey` in the existing **4 places** (schema, raw, withDefaults, fallback). The base URL + model are NOT config — they're constants in `ocr.service.ts`. | Additive |
| `backend/.env.example` | Add `OPENROUTER_API_KEY=` only (placeholder — never real keys). Base URL + model are code constants, not env. | Additive |
| `backend/.env` | Add real `OPENROUTER_API_KEY` (**user action, gitignored, not committed**). | Config |
| OCR service tests | Add `callOpenRouterVision` unit tests (success, 429→failover, empty, `<think>` strip); assert OpenRouter-before-Gemini ordering **and** that `callGeminiVision` is NOT invoked when OpenRouter succeeds (strict mock `not.toHaveBeenCalled`) — locks "primary" semantics, not just "fallback works". | Tests |

**NOT modified:** `@tingting/shared` (ISO 6346 helpers reused as-is — so no shared rebuild needed), the `/api/ocr` route (path/auth/multipart contract **and response shape** — no `provider` field), `sharp` preprocessing, the frontend (camera/upload flow **and `OcrResponse` type** — untouched), agent/MiniMax code.

---

## Implementation detail (sketches for review)

### 1. Config (`backend/src/config/index.ts`) — only the key is env-driven
The base URL + model are **not** config fields; they're hardcoded constants in
`ocr.service.ts` (see §2), mirroring the MiniMax LLM pattern (`services/llm/models.ts`).
Only `openrouterApiKey` follows the existing `geminiApiKey` 4-place pattern:
```ts
// schema (near geminiApiKey)
geminiApiKey: z.string().default(''),
openrouterApiKey: z.string().default(''),

// raw
openrouterApiKey: process.env.OPENROUTER_API_KEY,

// withDefaults
openrouterApiKey: raw.openrouterApiKey || '',

// final safeParse fallback
openrouterApiKey: '',
```

### 2. New OpenRouter client (`ocr.service.ts`) — faithful port of `openrouter.py`
```ts
// Hardcoded constants — NOT env vars (per user 2026-06-28). Only the API key
// is env-driven (config.openrouterApiKey). Mirrors the MiniMax LLM pattern.
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_MODEL = 'qwen/qwen3-vl-32b-instruct';
const OPENROUTER_TIMEOUT_MS = 60_000;
const THINK_RE = /<think>.*?<\/think>/gis;
const THINK_TRAILING_RE = /<think>.*/gis;

/** Strip Qwen reasoning blocks (closed + trailing if truncated mid-thought). */
function stripThink(text: string): string {
  return text.replace(THINK_RE, '').replace(THINK_TRAILING_RE, '').trim();
}

/**
 * Normalize an OpenAI-style `message.content` to a clean string. Per the spec
 * the field may be a plain string OR an array of typed parts
 * `[{type:'text', text:'...'}]`. Faithful port of vantaiphucloc openrouter.py
 * `_extract_text` (lines 49-69) — narrowing to `typeof === 'string'` only would
 * silently drop parts-array responses and spuriously fail over to Gemini.
 * (Architect finding #2.)
 */
function extractContentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = content
      .filter((b): b is { type: 'text'; text: string } =>
        typeof b === 'object' && b !== null && (b as { type?: string }).type === 'text')
      .map(b => b.text);
    return parts.join('\n');
  }
  return '';
}

interface OpenRouterChoice { message?: { content?: unknown } }
interface OpenRouterResponse { choices?: OpenRouterChoice[]; model?: string }

/**
 * OpenAI-compatible vision call to OpenRouter. Image goes as a base64 data URI
 * in an `image_url` block (per vantaiphucloc openrouter.py). Uses
 * response_format json_object so Qwen3-VL emits clean JSON; the existing
 * parseResponse() regex fallback is the safety net if it doesn't.
 */
export async function callOpenRouterVision(
  prompt: string,
  imageBuffer: Buffer,
  mimeType: string,
): Promise<VisionResult> {
  if (!config.openrouterApiKey) {
    return { success:false, text:null, error:'OCR chưa cấu hình (thiếu OPENROUTER_API_KEY)', provider:'openrouter', model:null };
  }
  const dataUri = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;
  const payload = {
    model: OPENROUTER_MODEL,
    temperature: 0,
    max_tokens: 2048,
    // NOTE: intentionally NO response_format. OpenRouter/Qwen3-VL model
    // support for json_object mode is uneven — a 400 on a model-slug swap
    // would silently regress EVERY request to the Gemini fallback. The
    // prompt asks for JSON and the existing parseResponse() regex net
    // (ocr.service.ts:235) recovers both containers and seals. This matches
    // the proven vantaiphucloc openrouter.py, which also sends no
    // response_format. (Architect finding #1.)
    messages: [{ role:'user', content:[
      { type:'text', text: prompt },
      { type:'image_url', image_url:{ url: dataUri } },
    ]}],
  };
  const url = `${OPENROUTER_BASE_URL.replace(/\/+$/,'')}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method:'POST',
      headers:{ 'Authorization':`Bearer ${config.openrouterApiKey}`, 'Content-Type':'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      const errBody = await response.text().catch(() => '<no body>');
      console.error(`[ocr] OpenRouter → ${response.status}: ${errBody.slice(0,500)}`);
      return { success:false, text:null, error:`HTTP ${response.status}`, provider:'openrouter', model:OPENROUTER_MODEL };
    }
    const result = (await response.json()) as OpenRouterResponse;
    const choice = result.choices?.[0];
    // content may be a string OR an array of typed parts — extractContentText
    // normalizes both, then stripThink drops any <think> reasoning.
    const text = stripThink(extractContentText(choice?.message?.content));
    if (!text) return { success:false, text:null, error:'Empty OpenRouter response', provider:'openrouter', model:result.model ?? OPENROUTER_MODEL };
    return { success:true, text, error:null, provider:'openrouter', model:result.model ?? OPENROUTER_MODEL };
  } catch (e) {
    const msg = e instanceof Error ? (e.name==='AbortError'?`Timeout after ${OPENROUTER_TIMEOUT_MS}ms`:`${e.name}: ${e.message}`) : 'Request failed';
    return { success:false, text:null, error:msg, provider:'openrouter', model:OPENROUTER_MODEL };
  } finally { clearTimeout(timer); }
}
```

### 3. Provider abstraction + multi-provider `extractContainerAndSeal`
- Generalize the return type: rename `provider:'gemini'` literal → `provider:'openrouter'|'gemini'` (union). Introduce a private `VisionResult` interface shared by both `callOpenRouterVision` and `callGeminiVision`.
- Add a key-presence-gated ordered provider list:
```ts
function orderedProviders(): { name:'openrouter'|'gemini'; call: typeof callOpenRouterVision }[] {
  const list = [];
  if (config.openrouterApiKey) list.push({ name:'openrouter', call: callOpenRouterVision });   // primary
  if (config.geminiApiKey)     list.push({ name:'gemini',     call: callGeminiVision });        // fallback
  return list;
}
```
- `extractContainerAndSeal()` loops `orderedProviders()`, choosing the type-specific `prompt`/`schema` (CONTAINER vs SEAL) exactly as today, running `parseResponse()` + ISO-6346 auto-correct on the first success. The **per-type success predicate is explicit** (vantaiphucloc only had CONTAINER, so the executor must not guess the SEAL condition — Architect finding #3):
  - **CONTAINER** succeeds when `parsed.containerNumbers.filter(n => CONTAINER_RE.test(n)).length > 0`.
  - **SEAL** succeeds when `parsed.sealNumber !== null` (mirrors the current `ocr.service.ts:342` check).
  - On a type-specific miss (or any `success===false`/empty/HTTP error from the provider) → `continue` to the next provider. If the list is empty → existing "chưa cấu hình" error. Return shape `ExtractResult` gains a real `provider` field (no longer hardcoded `'gemini'`).
- `callGeminiVision` keeps its current 2-model internal fallback unchanged. Its return type stays exported as `GeminiVisionResult = VisionResult` (a type alias) for zero surface change — confirmed via grep that nothing external imports it (Architect finding #6).

---

## Acceptance criteria
- [ ] `OPENROUTER_API_KEY` unset + `GEMINI_API_KEY` set → OCR works via Gemini (no regression).
- [ ] Both keys set → OpenRouter is tried **first**; a forced OpenRouter failure (mock 429) transparently falls back to Gemini and still returns numbers.
- [ ] Both keys unset → `ok:false` with the "chưa cấu hình" message (no 500).
- [ ] CONTAINER **and** SEAL both work through OpenRouter (existing two-prompt dispatch preserved).
- [ ] `<think>…</think>` blocks in an OpenRouter response do not break JSON parsing.
- [ ] `/api/ocr` response is byte-identical to today (no `provider` field surfaced — the service-internal `ExtractResult.provider` is logged/tested only).
- [ ] No `any` types; explicit `OpenRouterResponse` interfaces (strict mode clean).
- [ ] Unit tests pass: `cd backend && npm test` (Vitest). Frontend `tsc -b` clean.

## Verification steps (agent-run, before claiming done)
1. `cd backend && npx tsc --noEmit` — strict-mode clean.
2. `cd backend && npm test` — OCR service tests green (incl. new OpenRouter + failover + `<think>` cases).
3. Restart backend (tsx won't re-read `.env`). The route is JWT-gated (`authMiddleware` + `casbinAuthz('ocr')`), so first obtain a token: `curl -s -X POST localhost:3090/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}'` → grab the JWT, then `curl -F file=@container.jpg -F type=CONTAINER -H "Authorization: Bearer <JWT>" http://localhost:3090/api/ocr` → valid `containerNumbers`; the backend log shows the OpenRouter path. (The response itself carries no `provider` field.)
4. Temporarily blank `OPENROUTER_API_KEY`, restart, re-curl → numbers still returned; the backend log now shows the Gemini path — failover proven.
5. `cd frontend && npx tsc -b` — clean (additive `provider?: string | null`).

## Risks & gotchas
- **OpenRouter latency vs Gemini Flash** — Qwen3-VL-32B is slower than Flash. Mitigated by 60s timeout + automatic Gemini fallback. Worth measuring post-deploy; if p95 is unacceptable, switch to the 8B variant by editing the `OPENROUTER_MODEL` constant in `ocr.service.ts` (not an env line).
- **Serial timeout ceiling (Architect finding #7)** — worst case before a driver sees failure is OpenRouter 60s hang → Gemini 60s (model 1) → Gemini 60s (model 2) ≈ **180s**. In practice HTTP errors fail fast (both providers `return`/`continue` on `!response.ok`), so only a true network *hang* hits the full ceiling. Accepted; documented honestly. If this proves intolerable, add a global `AbortController` budget shared across the provider chain (out of scope for v1).
- **`response_format: json_object` — RESOLVED by design.** We ship **prompt-only** by default (no `response_format`), exactly like the proven reference (`openrouter.py` sends none). The existing `parseResponse()` regex net recovers both container and seal from free-text. No model-support risk remains unless a future Qwen variant is added that refuses prompt-only JSON — at which point it's a one-line addition, not a default change.
- **`<think>` truncation** — Qwen "Thinking" variants can emit huge reasoning that truncates before the answer. We default to the **Instruct** (non-Thinking) variant and strip any `<think>` defensively. Do not switch to a `-thinking` slug.
- **Env staleness** — after editing `.env`, restart the backend (per `gemini-env-staleness`).
- **Key hygiene** — never commit a real `OPENROUTER_API_KEY`; `.env.example` gets placeholders only.
- **Deploy** — CI is billing-blocked (per `ci-billing-blocked-manual-deploy`); ships via normal manual backend deploy. vantai is a separate deployment and is NOT touched (this is nepocorp-only; vantaiphucloc is the reference, not a target).
