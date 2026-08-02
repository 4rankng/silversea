/**
 * OCR service for extracting container & seal numbers from photos.
 *
 * Providers are tried in order, each gated by its API key being set:
 *   1. OpenRouter (Qwen3-VL) — primary (callOpenRouterVision)
 *   2. Gemini                — fallback (callGeminiVision)
 * The first provider to return a type-valid result wins; on any error/empty/
 * type-miss the request transparently falls through. With only a Gemini key
 * configured this behaves exactly like the previous Gemini-only build.
 *
 * Ported (faithfully) from vantaiphucloc:
 *   - app/contexts/operations/infrastructure/openrouter.py → callOpenRouterVision
 *   - app/contexts/operations/infrastructure/ai.py         → callGeminiVision / preprocessImage
 *   - app/contexts/operations/infrastructure/ocr.py        → extractContainerAndSeal (multi-provider loop)
 *
 * Accuracy techniques:
 *   - Structured JSON output via Gemini responseSchema; prompt-only + regex net for OpenRouter (temperature 0.0)
 *   - Hard-coded 2-model Gemini fallback chain (mirrors vantaiphucloc ai.py)
 *   - <think> stripping for Qwen reasoning output
 *   - Image preprocessing: downscale + auto-contrast (.normalise())
 *   - ISO 6346 check-digit auto-correction for near-miss container numbers
 *
 * Design (matches phucloc + spec Decision 1): we validate FORMAT only and
 * intentionally do NOT reject numbers with a bad check digit — VLMs misread
 * 1–2 characters. The driver/user visually confirms; the frontend flags
 * check-digit mismatches as a warning. Numbers are never auto-committed here.
 */
import sharp from 'sharp';
import { validateCheckDigit, suggestCorrections } from '@tingting/shared';
import { getOcrSettings, ocrHasAvailableKey, type OcrSettings } from './ocr-settings.service';

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta';
export const OCR_DISABLED_ERROR = 'OCR đang tắt trong cấu hình hệ thống.';
const OCR_MISSING_KEY_ERROR = 'OCR chưa cấu hình (thiếu OPENROUTER_API_KEY / GEMINI_API_KEY)';

/**
 * Hard-coded model fallback chain — tries each in order until one succeeds.
 * Mirrors vantaiphucloc ai.py `_GEMINI_MODELS`. Using capable multimodal
 * models avoids a 2-pass fallback and survives single-model 503 overload.
 */
const GEMINI_MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest'] as const;

const VISION_TIMEOUT_MS = 60_000;
const MAX_IMAGE_DIMENSION = 2048;
const MAX_DETECT = 10;

// Format validator (anchored) and global extractor (for free-text fallback).
const CONTAINER_RE = /^[A-Z]{4}\d{7}$/;
const CONTAINER_RE_G = /[A-Z]{4}\d{7}/g;

// OpenRouter (Qwen3-VL) — endpoint + model are hardcoded constants, NOT env
// vars. The base URL is a fixed OpenAI-compatible endpoint and the model is a
// pinned slug that should not drift per environment; only the API key
// (resolved via OCR settings) is runtime-configurable. Mirrors the MiniMax LLM pattern
// (services/llm/models.ts: MODEL_FAST / MINIMAX_BASE_URL) — change in code.
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_MODEL = 'qwen/qwen3-vl-32b-instruct';

// OpenRouter (OpenAI-compatible) call budget. Qwen reasoning models can wrap
// chain-of-thought in <think>…</think>; strip both closed blocks and an
// unclosed trailing one (truncation mid-thought). Ported from vantaiphucloc
// openrouter.py.
const OPENROUTER_TIMEOUT_MS = 60_000;
const THINK_RE = /<think>.*?<\/think>/gis;
const THINK_TRAILING_RE = /<think>.*$/gis;

const MULTI_CONTAINER_PROMPT = `Role: You are an expert logistics OCR assistant specializing in shipping containers. Examine the provided image and extract all standard ISO shipping container numbers.

Extraction Rules:

Format: A valid container number ALWAYS consists of exactly 4 uppercase letters followed by exactly 7 digits (e.g., MSKU1234567 or ALLU5216535).

Layout: The letters and digits may be separated by spaces, dashes, or printed across multiple lines. Concatenate them into a single, continuous 11-character alphanumeric string without spaces.

Exclusions: Strictly ignore ISO size/type codes (e.g., 22G1, 45G1, 42G1), company names, and weight/capacity specifications (e.g., MAX GW, TARE, NET, CU CAP, KG, LB). Also ignore any seal number — focus on container numbers only.

Common Errors: Pay close attention to characters that look similar (e.g., distinguish the letter O from the number 0, the letter Q from O, and the letter S from the number 5). Remember: the first 4 characters are always letters, and the last 7 are numbers.

Output: Return ONLY a clean JSON object containing the recognized container numbers. Do not include any conversational text. Example: {"container_numbers": ["ALLU5216535", "LSQU1077376"]}`;

const SEAL_PROMPT = `Role: You are an expert logistics OCR assistant specializing in shipping container seals. Examine the provided image and extract the seal number printed on the container seal.

Extraction Rules:

Format: A seal number is alphanumeric, UPPERCASE, no spaces (e.g., "VN123456", "SL1234567", "ABC12345"). It often appears on a bolt seal, cable seal, or a sticker near the container door handles.

Layout: The characters may be separated by spaces or dashes. Concatenate them into a single continuous string without spaces.

Exclusions: Strictly ignore ISO container numbers (4 letters + 7 digits such as MSKU1234567), ISO size/type codes (e.g., 22G1, 45G1), company names, and weight/capacity specifications (e.g., MAX GW, TARE, NET, CU CAP, KG, LB). Focus on the seal number only.

Common Errors: Pay close attention to characters that look similar (e.g., distinguish the letter O from the number 0, the letter I from the number 1). Seal numbers have no fixed length — return the full value exactly as printed.

Output: Return ONLY a clean JSON object containing the recognized seal number. Do not include any conversational text. Example: {"seal_number": "VN123456"}`;

// JSON schema enforced at the Gemini engine level (Gemini v1beta schema format).
const CONTAINER_SCHEMA = {
  type: 'OBJECT',
  properties: {
    container_numbers: {
      type: 'ARRAY',
      description: 'List of all valid ISO 6346 container numbers found in the image.',
      items: { type: 'STRING', pattern: '^[A-Z]{4}\\d{7}$' },
    },
  },
  required: ['container_numbers'],
};

const SEAL_SCHEMA = {
  type: 'OBJECT',
  properties: {
    seal_number: {
      type: 'STRING',
      nullable: true,
      description: 'Alphanumeric seal number printed on the seal (uppercase, no spaces), or null if none.',
    },
  },
  required: ['seal_number'],
};

/** Which vision provider produced (or failed to produce) a result. */
export type VisionProvider = 'openrouter' | 'gemini';

/** Provider-agnostic result of a single vision call. */
export interface VisionResult {
  success: boolean;
  text: string | null;
  error: string | null;
  provider: VisionProvider;
  model: string | null;
}

/**
 * Gemini-specific result — {@link VisionResult} plus `fallbackUsed` (true when
 * the secondary model in the hard-coded chain had to answer). Kept exported as
 * an alias for backward compatibility; nothing external imports it today.
 */
export type GeminiVisionResult = VisionResult & { fallbackUsed: boolean };

interface GeminiPart { text?: string }
interface GeminiContent { parts?: GeminiPart[] }
interface GeminiCandidate { content?: GeminiContent }
interface GeminiResponse { candidates?: GeminiCandidate[] }

// OpenAI-compatible (OpenRouter) response shapes. `message.content` may be a
// plain string OR an array of typed parts — extractContentText normalizes both.
interface OpenRouterTextPart { type: 'text'; text: string }
interface OpenRouterMessage { content?: unknown }
interface OpenRouterChoice { message?: OpenRouterMessage }
interface OpenRouterResponse { choices?: OpenRouterChoice[]; model?: string }

async function resolveRuntimeSettings(settings?: OcrSettings): Promise<OcrSettings> {
  return settings ?? getOcrSettings();
}

/**
 * Call Gemini with an image + prompt. Iterates the hard-coded model chain,
 * returning on the first success. Empty key → friendly error (no 500).
 */
export async function callGeminiVision(
  prompt: string,
  imageBuffer: Buffer,
  mimeType: string,
  responseSchema?: Record<string, unknown>,
  settings?: OcrSettings,
): Promise<GeminiVisionResult> {
  const runtimeSettings = await resolveRuntimeSettings(settings);
  if (!runtimeSettings.enabled) {
    return {
      success: false,
      text: null,
      error: OCR_DISABLED_ERROR,
      provider: 'gemini',
      model: null,
      fallbackUsed: false,
    };
  }
  if (!runtimeSettings.geminiKey) {
    return {
      success: false,
      text: null,
      error: 'OCR chưa cấu hình (thiếu GEMINI_API_KEY)',
      provider: 'gemini',
      model: null,
      fallbackUsed: false,
    };
  }

  const encoded = imageBuffer.toString('base64');
  const generationConfig: Record<string, unknown> = {
    temperature: 0.0,
    maxOutputTokens: 4096,
  };
  if (responseSchema) {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseSchema = responseSchema;
  }

  const payload = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType, data: encoded } },
      ],
    }],
    generationConfig,
  };

  let lastError: string | null = null;

  for (const model of GEMINI_MODELS) {
    const url = `${GEMINI_ENDPOINT}/models/${model}:generateContent?key=${runtimeSettings.geminiKey}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        // Keep server-side observability for upstream failures (400/403/429/5xx)
        // without leaking the API key or spamming dev output — the user-facing
        // error stays the clean `HTTP <status>` string below.
        const errBody = await response.text().catch(() => '<no body>');
        console.error(`[ocr] Gemini ${model} → ${response.status}: ${errBody.slice(0, 500)}`);
        lastError = `HTTP ${response.status}`;
        continue;
      }

      const result = (await response.json()) as GeminiResponse;
      const candidates = result.candidates;
      if (!candidates || candidates.length === 0) {
        lastError = 'No response generated';
        continue;
      }

      // Join ALL parts' text — Gemini may split the answer across parts, and
      // reading only parts[0] would discard the real JSON when parts[0] is a
      // preamble/empty. Mirrors extractContentText on the OpenRouter path.
      const geminiParts = candidates[0]?.content?.parts ?? [];
      const text = geminiParts.map(p => p?.text ?? '').join('').trim();
      return {
        success: true,
        text,
        error: null,
        provider: 'gemini',
        model,
        fallbackUsed: model !== GEMINI_MODELS[0],
      };
    } catch (e) {
      lastError = e instanceof Error
        ? (e.name === 'AbortError' ? `Timeout after ${VISION_TIMEOUT_MS}ms` : `${e.name}: ${e.message}`)
        : 'Request failed';
      continue;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    success: false,
    text: null,
    error: lastError ?? 'All models failed',
    provider: 'gemini',
    model: null,
    fallbackUsed: false,
  };
}

// ── OpenRouter (Qwen3-VL) vision client ────────────────────────────────────
// Faithful port of vantaiphucloc openrouter.py: OpenAI-compatible Chat
// Completions, image as a base64 data URI, temperature 0, NO response_format
// (model support for json_object is uneven — a 400 would silently regress
// every request to Gemini; parseResponse()'s regex net is the safety net).

/** Remove <think> reasoning blocks (closed, and a trailing unclosed one). */
function stripThink(text: string): string {
  return text.replace(THINK_RE, '').replace(THINK_TRAILING_RE, '').trim();
}

/**
 * Normalize an OpenAI-style `message.content` to a string. Per the spec the
 * field may be a plain string OR an array of typed parts [{type:'text',text}].
 * Narrowing to `typeof === 'string'` only would silently drop parts-array
 * responses (spurious "empty" failover to Gemini). Ported from openrouter.py
 * `_extract_text`.
 */
function extractContentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b): b is OpenRouterTextPart =>
        typeof b === 'object' && b !== null && (b as { type?: string }).type === 'text')
      .map(b => b.text)
      .join('\n');
  }
  return '';
}

/**
 * Call an OpenRouter vision model. Empty key → friendly error (no throw). On a
 * non-2xx the status is returned as `HTTP <status>` (with a server-side log of
 * the upstream body) so a 429/401/404 is distinguishable. A 60s AbortController
 * guards against hangs; on abort the error names the timeout.
 */
export async function callOpenRouterVision(
  prompt: string,
  imageBuffer: Buffer,
  mimeType: string,
  settings?: OcrSettings,
): Promise<VisionResult> {
  const runtimeSettings = await resolveRuntimeSettings(settings);
  if (!runtimeSettings.enabled) {
    return {
      success: false,
      text: null,
      error: OCR_DISABLED_ERROR,
      provider: 'openrouter',
      model: null,
    };
  }
  if (!runtimeSettings.openrouterKey) {
    return {
      success: false,
      text: null,
      error: 'OCR chưa cấu hình (thiếu OPENROUTER_API_KEY)',
      provider: 'openrouter',
      model: null,
    };
  }

  const dataUri = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;
  const payload = {
    model: OPENROUTER_MODEL,
    temperature: 0,
    // Parity with Gemini (maxOutputTokens 4096). The completion budget INCLUDES
    // any <think> reasoning tokens; 2048 can truncate the answer mid-JSON when
    // the model reasons, which silently fails over to Gemini. 4096 leaves room.
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: dataUri } },
      ],
    }],
  };

  const url = `${OPENROUTER_BASE_URL.replace(/\/+$/, '')}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${runtimeSettings.openrouterKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '<no body>');
      console.error(`[ocr] OpenRouter → ${response.status}: ${errBody.slice(0, 500)}`);
      return {
        success: false,
        text: null,
        error: `HTTP ${response.status}`,
        provider: 'openrouter',
        model: OPENROUTER_MODEL,
      };
    }

    const result = (await response.json()) as OpenRouterResponse;
    const choice = result.choices?.[0];
    const text = stripThink(extractContentText(choice?.message?.content));
    if (!text) {
      return {
        success: false,
        text: null,
        error: 'Empty OpenRouter response',
        provider: 'openrouter',
        model: result.model ?? OPENROUTER_MODEL,
      };
    }
    return {
      success: true,
      text,
      error: null,
      provider: 'openrouter',
      model: result.model ?? OPENROUTER_MODEL,
    };
  } catch (e) {
    const msg = e instanceof Error
      ? (e.name === 'AbortError' ? `Timeout after ${OPENROUTER_TIMEOUT_MS}ms` : `${e.name}: ${e.message}`)
      : 'Request failed';
    return {
      success: false,
      text: null,
      error: msg,
      provider: 'openrouter',
      model: OPENROUTER_MODEL,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Lightweight preprocessing — downscale + auto-contrast. Equivalent to
 * vantaiphucloc `preprocess_image` (PIL autocontrast cutoff=1 + LANCZOS
 * downscale). Modern VLMs read faded/night/shadowed paint better when text
 * stands out. Returns JPEG bytes + mime.
 */
export async function preprocessImage(imageBuffer: Buffer): Promise<{ buffer: Buffer; mimeType: string }> {
  const processed = await sharp(imageBuffer)
    .rotate() // auto-orient from EXIF, then strip metadata
    .resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, { fit: 'inside', withoutEnlargement: true })
    .normalise() // auto-contrast (≈ PIL ImageOps.autocontrast cutoff=1)
    .jpeg({ quality: 95 })
    .toBuffer();
  return { buffer: processed, mimeType: 'image/jpeg' };
}

function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

interface ParsedResponse {
  containerNumbers: string[];
  sealNumber: string | null;
}

/** Extract container numbers + seal from the Gemini response (JSON, then regex fallback). */
function parseResponse(text: string | null): ParsedResponse {
  if (!text) return { containerNumbers: [], sealNumber: null };

  // 1. Structured JSON first
  try {
    const data = JSON.parse(text) as { container_numbers?: unknown; seal_number?: unknown };
    const nums = Array.isArray(data.container_numbers)
      ? data.container_numbers
          .map(n => String(n).toUpperCase().trim())
          .filter(n => CONTAINER_RE.test(n))
      : [];
    const seal = typeof data.seal_number === 'string' && data.seal_number.trim()
      ? data.seal_number.toUpperCase().trim()
      : null;
    // Only trust the JSON shape when it actually yielded a result. OpenRouter
    // (unlike schema-enforced Gemini) sends NO response_format, so the model can
    // return valid JSON under a different key (e.g. {"numbers":[...]} or a bare
    // array); returning an empty miss there would drop a valid number and make
    // every request fall through to Gemini. Fall through to the regex net so the
    // number is recovered. Mirrors vantaiphucloc ocr.py `_parse_numbers_from_response`.
    if (nums.length > 0 || seal) {
      return { containerNumbers: dedupe(nums), sealNumber: seal };
    }
  } catch {
    // fall through to regex
  }

  // 2. Fallback: regex extraction from free-text response (containers only)
  const cleaned = text.replace(/[`"'\n\r]/g, '').trim().toUpperCase();
  if (cleaned === 'NONE') return { containerNumbers: [], sealNumber: null };
  const matches = cleaned.match(CONTAINER_RE_G) ?? [];
  return { containerNumbers: dedupe(matches), sealNumber: null };
}

interface AutoCorrectResult {
  numbers: string[];
  warnings: string[];
}

/** Auto-correct numbers with bad check digits using ISO 6346 suggestions. */
function autoCorrectNumbers(numbers: string[]): AutoCorrectResult {
  const warnings: string[] = [];
  const corrected: string[] = [];
  for (const n of numbers) {
    if (validateCheckDigit(n)) {
      corrected.push(n);
    } else {
      const suggestions = suggestCorrections(n, 1);
      if (suggestions.length > 0) {
        warnings.push(`${n} → ${suggestions[0]}`);
        corrected.push(suggestions[0]);
      } else {
        corrected.push(n);
      }
    }
  }
  return { numbers: dedupe(corrected), warnings };
}

export interface ExtractResult {
  success: boolean;
  containerNumbers: string[];
  sealNumber: string | null;
  /** Near-miss corrections applied, formatted "ORIGINAL → CORRECTED". */
  checkDigitWarnings: string[];
  error: string | null;
  provider: VisionProvider | null;
  model: string | null;
}

/**
 * Ordered OCR providers, derived from the resolved OCR settings.
 * OpenRouter (Qwen3-VL) is tried first whenever its key is set; Gemini is the
 * fallback.
 */
function orderedProviders(settings: OcrSettings): VisionProvider[] {
  const list: VisionProvider[] = [];
  if (settings.openrouterKey) list.push('openrouter');
  if (settings.geminiKey) list.push('gemini');
  return list;
}

/**
 * Dispatch a vision call to the named provider. Gemini takes a responseSchema
 * (Gemini v1beta structured output); OpenRouter is prompt-only and relies on
 * parseResponse()'s JSON+regex net.
 */
async function callProvider(
  name: VisionProvider,
  prompt: string,
  responseSchema: Record<string, unknown> | undefined,
  imageBuffer: Buffer,
  mimeType: string,
  settings: OcrSettings,
): Promise<VisionResult> {
  if (name === 'openrouter') return callOpenRouterVision(prompt, imageBuffer, mimeType, settings);
  return callGeminiVision(prompt, imageBuffer, mimeType, responseSchema, settings);
}

/**
 * Extract container or seal numbers from an image based on the requested type.
 *
 * - `CONTAINER`: extracts ISO 6346 container numbers only.
 * - `SEAL`: extracts the seal number only.
 *
 * Type-specific prompts prevent cross-contamination (e.g. a seal photo being
 * misread as a container number). Container numbers with invalid ISO 6346 check
 * digits are auto-corrected when a near-miss valid number exists.
 */
export async function extractContainerAndSeal(
  imageBuffer: Buffer,
  type: 'CONTAINER' | 'SEAL' = 'CONTAINER',
  mimeType = 'image/jpeg',
  settingsArg?: OcrSettings,
): Promise<ExtractResult> {
  const settings = await resolveRuntimeSettings(settingsArg);
  let buffer = imageBuffer;
  let mime = mimeType;
  try {
    const pre = await preprocessImage(imageBuffer);
    buffer = pre.buffer;
    mime = pre.mimeType;
  } catch {
    // keep raw image if preprocessing fails
  }

  const prompt = type === 'SEAL' ? SEAL_PROMPT : MULTI_CONTAINER_PROMPT;
  const schema = type === 'SEAL' ? SEAL_SCHEMA : CONTAINER_SCHEMA;

  if (!settings.enabled) {
    return {
      success: false,
      containerNumbers: [],
      sealNumber: null,
      checkDigitWarnings: [],
      error: OCR_DISABLED_ERROR,
      provider: null,
      model: null,
    };
  }

  const providers = orderedProviders(settings);
  if (!ocrHasAvailableKey(settings) || providers.length === 0) {
    return {
      success: false,
      containerNumbers: [],
      sealNumber: null,
      checkDigitWarnings: [],
      error: OCR_MISSING_KEY_ERROR,
      provider: null,
      model: null,
    };
  }

  // Track the last attempted provider so the exhausted path reports which one
  // got furthest (and the error it gave) — every provider failure stays visible
  // rather than collapsing to a generic "failed".
  let lastProvider: VisionProvider | null = null;
  let lastModel: string | null = null;
  let lastError: string | null = null;

  for (const name of providers) {
    const result = await callProvider(name, prompt, schema, buffer, mime, settings);

    if (!result.success || !result.text) {
      lastProvider = name;
      lastModel = result.model;
      lastError = result.error ?? 'Request failed';
      continue;
    }

    const parsed = parseResponse(result.text);

    if (type === 'SEAL') {
      // SEAL succeeds only when a seal number was extracted; otherwise fall
      // through to the next provider (a container-style misread is not a seal).
      if (parsed.sealNumber) {
        return {
          success: true,
          containerNumbers: [],
          sealNumber: parsed.sealNumber,
          checkDigitWarnings: [],
          error: null,
          provider: name,
          model: result.model,
        };
      }
      lastProvider = name;
      lastModel = result.model;
      lastError = 'Không nhận dạng được số seal';
      continue;
    }

    // CONTAINER: validate FORMAT only (4 letters + 7 digits). We intentionally
    // skip ISO 6346 check-digit verification here — VLMs misread 1–2 chars.
    // The user visually confirms; checkDigitWarnings surface auto-corrections.
    const valid = parsed.containerNumbers.filter(n => CONTAINER_RE.test(n));

    if (valid.length === 0) {
      lastProvider = name;
      lastModel = result.model;
      lastError = 'Không nhận dạng được số cont';
      continue;
    }

    const { numbers, warnings } = autoCorrectNumbers(valid);
    return {
      success: true,
      containerNumbers: numbers.slice(0, MAX_DETECT),
      sealNumber: null,
      checkDigitWarnings: warnings,
      error: null,
      provider: name,
      model: result.model,
    };
  }

  // All providers exhausted.
  return {
    success: false,
    containerNumbers: [],
    sealNumber: null,
    checkDigitWarnings: [],
    error: lastError ?? (type === 'SEAL' ? 'Không nhận dạng được số seal' : 'Không nhận dạng được số cont'),
    provider: lastProvider,
    model: lastModel,
  };
}

// ─── M12.3: Pump-photo OCR ──────────────────────────────────────────────────
//
// Recognises litres × unit_price ≈ total from a fuel-pump display photo.
// The result is a SUGGESTION — the caller (expense entry) must let the user
// confirm/edit before committing. When litres × unitPrice deviates from total
// beyond a tolerance, the result is flagged `mismatch: true` so the UI warns
// the user and falls back to manual entry.

const PUMP_PROMPT = `Role: You are an expert OCR assistant specializing in fuel pump displays at Vietnamese petrol stations. Examine the image and extract the fuel pump reading.

Extract these values from the pump display:
- litres: the volume of fuel dispensed (in litres)
- unit_price: the price per litre (in VND)
- total: the total amount to pay (in VND)

Important notes:
- Vietnamese pump displays may show amounts with dots as thousand separators (e.g. "25.000" means 25000).
- Some pumps may not show all three values. Extract only what is visible.
- Numbers may be partially obscured or blurry — extract the best reading you can.

Output: Return ONLY a clean JSON object: {"litres": number, "unit_price": number, "total": number}. Use null for any value that cannot be read. Do not include any conversational text.`;

const PUMP_SCHEMA = {
  type: 'object',
  properties: {
    litres: { type: 'number' },
    unit_price: { type: 'number' },
    total: { type: 'number' },
  },
};

export interface PumpReading {
  success: boolean;
  litres: number | null;
  unitPrice: number | null;
  total: number | null;
  /** True when litres × unitPrice deviates from total by more than 5%. */
  mismatch: boolean;
  /** The computed expected total (litres × unitPrice) for the UI to display. */
  computedTotal: number | null;
  error: string | null;
  provider: VisionProvider | null;
  model: string | null;
}

/**
 * Cross-check: litres × unitPrice should approximately equal total.
 * Tolerance is 5% (Vietnamese pump displays round to the nearest VND; small
 * rounding differences are expected). Returns { mismatch, computedTotal }.
 */
export function crossCheckPumpReading(
  litres: number | null,
  unitPrice: number | null,
  total: number | null,
): { mismatch: boolean; computedTotal: number | null } {
  if (litres == null || unitPrice == null || total == null || total === 0) {
    return { mismatch: false, computedTotal: null };
  }
  const computed = Math.round(litres * unitPrice);
  const deviation = Math.abs(computed - total) / total;
  return { mismatch: deviation > 0.05, computedTotal: computed };
}

/**
 * Extract litres, unit_price, and total from a fuel-pump display photo.
 * Uses the same Gemini/OpenRouter vision pipeline as container/seal OCR.
 */
export async function extractPumpReading(
  imageBuffer: Buffer,
  mimeType = 'image/jpeg',
  settingsArg?: OcrSettings,
): Promise<PumpReading> {
  const settings = await resolveRuntimeSettings(settingsArg);
  let buffer = imageBuffer;
  let mime = mimeType;
  try {
    const pre = await preprocessImage(imageBuffer);
    buffer = pre.buffer;
    mime = pre.mimeType;
  } catch {
    // keep raw image if preprocessing fails
  }

  if (!settings.enabled) {
    return {
      success: false, litres: null, unitPrice: null, total: null,
      mismatch: false, computedTotal: null,
      error: OCR_DISABLED_ERROR,
      provider: null, model: null,
    };
  }

  const providers = orderedProviders(settings);
  if (!ocrHasAvailableKey(settings) || providers.length === 0) {
    return {
      success: false, litres: null, unitPrice: null, total: null,
      mismatch: false, computedTotal: null,
      error: OCR_MISSING_KEY_ERROR,
      provider: null, model: null,
    };
  }

  let lastProvider: VisionProvider | null = null;
  let lastModel: string | null = null;
  let lastError: string | null = null;

  for (const name of providers) {
    const result = await callProvider(name, PUMP_PROMPT, PUMP_SCHEMA, buffer, mime, settings);
    lastProvider = name;
    lastModel = result.model;

    if (!result.success || !result.text) {
      lastError = result.error ?? 'Provider returned empty';
      continue;
    }

    try {
      const parsed = JSON.parse(result.text);
      const litres = parsed.litres != null ? Number(parsed.litres) : null;
      const unitPrice = parsed.unit_price != null ? Number(parsed.unit_price) : null;
      const total = parsed.total != null ? Number(parsed.total) : null;

      if (litres == null && unitPrice == null && total == null) {
        lastError = 'Không đọc được giá trị nào từ ảnh';
        continue;
      }

      const { mismatch, computedTotal } = crossCheckPumpReading(litres, unitPrice, total);

      return {
        success: true, litres, unitPrice, total,
        mismatch, computedTotal,
        error: null, provider: name, model: result.model,
      };
    } catch {
      lastError = 'Không thể phân tích kết quả OCR';
      continue;
    }
  }

  return {
    success: false, litres: null, unitPrice: null, total: null,
    mismatch: false, computedTotal: null,
    error: lastError ?? 'Tất cả provider đều thất bại',
    provider: lastProvider, model: lastModel,
  };
}
