/**
 * OCR service for extracting container & seal numbers from photos.
 *
 * OpenRouter is the sole OCR provider. Two models are tried in sequence:
 *   1. Qwen3-VL-32B  (15s timeout) — fast, capable vision model
 *   2. Qwen3.7-Plus  (55s timeout) — fallback for harder images
 * The first model to return a type-valid result wins; on any error/empty/
 * type-miss the request transparently falls through to the next model.
 *
 * Gemini is not used at all — matches vantaiphucloc's 2-tier OpenRouter-only setup.
 *
 * Ported (faithfully) from vantaiphucloc:
 *   - app/contexts/operations/infrastructure/openrouter.py → callOpenRouterVision
 *   - app/contexts/operations/infrastructure/ai.py         → preprocessImage
 *   - app/contexts/operations/infrastructure/ocr.py        → extractContainerAndSeal (multi-provider loop)
 *
 * Accuracy techniques:
 *   - Prompt-only + regex net for OpenRouter (temperature 0.0)
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

export const OCR_DISABLED_ERROR = 'OCR đang tắt trong cấu hình hệ thống.';
const OCR_MISSING_KEY_ERROR = 'OCR chưa cấu hình (thiếu OPENROUTER_API_KEY)';

const MAX_IMAGE_DIMENSION = 2048;
const MAX_DETECT = 10;

// Format validator (anchored) and global extractor (for free-text fallback).
const CONTAINER_RE = /^[A-Z]{4}\d{7}$/;
const CONTAINER_RE_G = /[A-Z]{4}\d{7}/g;

// OpenRouter — endpoint + models are hardcoded constants, NOT env vars.
// Two-model chain matching vantaiphucloc: Qwen3-VL-32B (fast) → Qwen3.7-Plus (fallback).
// Each model has its own per-call timeout sized so the chain sums within the
// frontend's 60s axios timeout. Only the API key is runtime-configurable.
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

interface OpenRouterModelConfig {
  label: string;
  model: string;
  timeoutMs: number;
}

const OPENROUTER_MODELS: OpenRouterModelConfig[] = [
  { label: 'Qwen3-VL-32B', model: 'qwen/qwen3-vl-32b-instruct', timeoutMs: 15_000 },
  { label: 'Qwen3.7-Plus', model: 'qwen/qwen3.7-plus', timeoutMs: 55_000 },
];

// OpenRouter (OpenAI-compatible) call budget. Qwen reasoning models can wrap
// chain-of-thought in <think>…</think>; strip both closed blocks and an
// unclosed trailing one (truncation mid-thought). Ported from vantaiphucloc
// openrouter.py.
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

/** Which vision provider produced (or failed to produce) a result. */
export type VisionProvider = 'openrouter';

/** Provider-agnostic result of a single vision call. */
export interface VisionResult {
  success: boolean;
  text: string | null;
  error: string | null;
  provider: VisionProvider;
  model: string | null;
}

// OpenAI-compatible (OpenRouter) response shapes. `message.content` may be a
// plain string OR an array of typed parts — extractContentText normalizes both.
interface OpenRouterTextPart { type: 'text'; text: string }
interface OpenRouterMessage { content?: unknown }
interface OpenRouterChoice { message?: OpenRouterMessage }
interface OpenRouterResponse { choices?: OpenRouterChoice[]; model?: string }

async function resolveRuntimeSettings(settings?: OcrSettings): Promise<OcrSettings> {
  return settings ?? getOcrSettings();
}

// ── OpenRouter (Qwen3-VL) vision client ────────────────────────────────────
// Faithful port of vantaiphucloc openrouter.py: OpenAI-compatible Chat
// Completions, image as a base64 data URI, temperature 0, NO response_format
// (model support for json_object is uneven — a 400 would kill every request;
// parseResponse()'s regex net is the safety net).

/** Remove <think> reasoning blocks (closed, and a trailing unclosed one). */
function stripThink(text: string): string {
  return text.replace(THINK_RE, '').replace(THINK_TRAILING_RE, '').trim();
}

/**
 * Normalize an OpenAI-style `message.content` to a string. Per the spec the
 * field may be a plain string OR an array of typed parts [{type:'text',text}].
 * Narrowing to `typeof === 'string'` only would silently drop parts-array
 * responses (spurious "empty" failover to the fallback model). Ported from
 * vantaiphucloc openrouter.py `_extract_text`.
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
 * the upstream body) so a 429/401/404 is distinguishable. The per-model
 * AbortController timeout guards against hangs; on abort the error names the
 * timeout.
 */
export async function callOpenRouterVision(
  prompt: string,
  imageBuffer: Buffer,
  mimeType: string,
  settings?: OcrSettings,
  modelConfig?: OpenRouterModelConfig,
): Promise<VisionResult> {
  const runtimeSettings = await resolveRuntimeSettings(settings);
  const mc = modelConfig ?? OPENROUTER_MODELS[0];
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
    model: mc.model,
    temperature: 0,
    // The completion budget INCLUDES any <think> reasoning tokens; 2048 can
    // truncate the answer mid-JSON. 4096 leaves room.
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
  const timer = setTimeout(() => controller.abort(), mc.timeoutMs);

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
      console.error(`[ocr] OpenRouter ${mc.label} → ${response.status}: ${errBody.slice(0, 500)}`);
      return {
        success: false,
        text: null,
        error: `HTTP ${response.status}`,
        provider: 'openrouter',
        model: mc.model,
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
        model: result.model ?? mc.model,
      };
    }
    return {
      success: true,
      text,
      error: null,
      provider: 'openrouter',
      model: result.model ?? mc.model,
    };
  } catch (e) {
    const msg = e instanceof Error
      ? (e.name === 'AbortError' ? `Timeout after ${mc.timeoutMs}ms` : `${e.name}: ${e.message}`)
      : 'Request failed';
    return {
      success: false,
      text: null,
      error: msg,
      provider: 'openrouter',
      model: mc.model,
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

/** Extract container numbers + seal from the model response (JSON, then regex fallback). */
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
    // sends NO response_format, so the model can return valid JSON under a
    // different key (e.g. {"numbers":[...]} or a bare array); returning an
    // empty miss there would drop a valid number and force a wasteful failover
    // to the fallback model. Fall through to the regex net so the number is
    // recovered. Mirrors vantaiphucloc ocr.py `_parse_numbers_from_response`.
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
 * Ordered OCR model chain — OpenRouter only, matching vantaiphucloc.
 * Each entry is tried in sequence; the first to return a valid result wins.
 */
function orderedModels(settings: OcrSettings): OpenRouterModelConfig[] {
  if (!settings.openrouterKey) return [];
  return [...OPENROUTER_MODELS];
}

/**
 * Dispatch a vision call to a specific OpenRouter model. Prompt-only,
 * relies on parseResponse()'s JSON+regex net.
 */
async function callModel(
  modelConfig: OpenRouterModelConfig,
  prompt: string,
  imageBuffer: Buffer,
  mimeType: string,
  settings: OcrSettings,
): Promise<VisionResult> {
  return callOpenRouterVision(prompt, imageBuffer, mimeType, settings, modelConfig);
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

  const models = orderedModels(settings);
  if (!ocrHasAvailableKey(settings) || models.length === 0) {
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

  // Track the last attempted model so the exhausted path reports which one
  // got furthest (and the error it gave) — every model failure stays visible
  // rather than collapsing to a generic "failed".
  let lastProvider: VisionProvider | null = null;
  let lastModel: string | null = null;
  let lastError: string | null = null;

  for (const mc of models) {
    const result = await callModel(mc, prompt, buffer, mime, settings);

    if (!result.success || !result.text) {
      lastProvider = 'openrouter';
      lastModel = result.model;
      lastError = result.error ?? 'Request failed';
      continue;
    }

    const parsed = parseResponse(result.text);

    if (type === 'SEAL') {
      // SEAL succeeds only when a seal number was extracted; otherwise fall
      // through to the next model (a container-style misread is not a seal).
      if (parsed.sealNumber) {
        return {
          success: true,
          containerNumbers: [],
          sealNumber: parsed.sealNumber,
          checkDigitWarnings: [],
          error: null,
          provider: 'openrouter',
          model: result.model,
        };
      }
      lastProvider = 'openrouter';
      lastModel = result.model;
      lastError = 'Không nhận dạng được số seal';
      continue;
    }

    // CONTAINER: validate FORMAT only (4 letters + 7 digits). We intentionally
    // skip ISO 6346 check-digit verification here — VLMs misread 1–2 chars.
    // The user visually confirms; checkDigitWarnings surface auto-corrections.
    const valid = parsed.containerNumbers.filter(n => CONTAINER_RE.test(n));

    if (valid.length === 0) {
      lastProvider = 'openrouter';
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
      provider: 'openrouter',
      model: result.model,
    };
  }

  // All models exhausted.
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

First classify the image into exactly one outcome:
- ACCEPTED: a single fuel-pump display is visible and readable enough to extract a real reading.
- UNREADABLE: the image is too blurry, dark, cropped, or obstructed to read reliably.
- MULTI_SCREEN: more than one pump display / receipt-like numeric screen is visible, so the reading is ambiguous.
- NON_PUMP: the image is not a fuel-pump display.

Extract these values from the pump display:
- litres: the volume of fuel dispensed (in litres)
- unit_price: the price per litre (in VND)
- total: the total amount to pay (in VND)

Important notes:
- Vietnamese pump displays may show amounts with dots as thousand separators (e.g. "25.000" means 25000).
- Some pumps may not show all three values. Extract only what is visible.
- Numbers may be partially obscured or blurry — extract the best reading you can.
- For MULTI_SCREEN, NON_PUMP, or UNREADABLE return null for all numeric fields.

Output: Return ONLY a clean JSON object: {"outcome":"ACCEPTED|UNREADABLE|MULTI_SCREEN|NON_PUMP","litres":number|null,"unit_price":number|null,"total":number|null}. Do not include any conversational text.`;

export type PumpReadingOutcome = 'ACCEPTED' | 'UNREADABLE' | 'MULTI_SCREEN' | 'NON_PUMP' | 'ANOMALY';

export interface PumpReading {
  success: boolean;
  outcome: PumpReadingOutcome;
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

function parsePumpNumber(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function classifyPumpReadingValues(
  litres: number | null,
  unitPrice: number | null,
  total: number | null,
): {
  outcome: PumpReadingOutcome;
  success: boolean;
  litres: number | null;
  unitPrice: number | null;
  total: number | null;
  mismatch: boolean;
  computedTotal: number | null;
} {
  if (litres == null && unitPrice == null && total == null) {
    return {
      outcome: 'UNREADABLE',
      success: false,
      litres: null,
      unitPrice: null,
      total: null,
      mismatch: false,
      computedTotal: null,
    };
  }

  const hasNonPositiveValue = [litres, unitPrice, total].some((value) => value != null && value <= 0);
  const hasMissingValue = litres == null || unitPrice == null || total == null;
  const { mismatch, computedTotal } = crossCheckPumpReading(litres, unitPrice, total);

  if (hasNonPositiveValue || hasMissingValue) {
    return {
      outcome: 'ANOMALY',
      success: litres != null || unitPrice != null || total != null,
      litres,
      unitPrice,
      total,
      mismatch: false,
      computedTotal,
    };
  }

  return {
    outcome: mismatch ? 'ANOMALY' : 'ACCEPTED',
    success: true,
    litres,
    unitPrice,
    total,
    mismatch,
    computedTotal,
  };
}

function normalizePumpReadingOutcome(value: unknown): Exclude<PumpReadingOutcome, 'ANOMALY'> | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (
    normalized === 'ACCEPTED'
    || normalized === 'UNREADABLE'
    || normalized === 'MULTI_SCREEN'
    || normalized === 'NON_PUMP'
  ) {
    return normalized;
  }
  return null;
}

/**
 * Extract litres, unit_price, and total from a fuel-pump display photo.
 * Uses the same OpenRouter vision pipeline as container/seal OCR.
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
      outcome: 'UNREADABLE',
      success: false, litres: null, unitPrice: null, total: null,
      mismatch: false, computedTotal: null,
      error: OCR_DISABLED_ERROR,
      provider: null, model: null,
    };
  }

  const models = orderedModels(settings);
  if (!ocrHasAvailableKey(settings) || models.length === 0) {
    return {
      outcome: 'UNREADABLE',
      success: false, litres: null, unitPrice: null, total: null,
      mismatch: false, computedTotal: null,
      error: OCR_MISSING_KEY_ERROR,
      provider: null, model: null,
    };
  }

  let lastProvider: VisionProvider | null = null;
  let lastModel: string | null = null;
  let lastError: string | null = null;

  for (const mc of models) {
    const result = await callModel(mc, PUMP_PROMPT, buffer, mime, settings);
    lastProvider = 'openrouter';
    lastModel = result.model;

    if (!result.success || !result.text) {
      lastError = result.error ?? 'Provider returned empty';
      continue;
    }

    try {
      const parsed = JSON.parse(result.text);
      const rawOutcome = normalizePumpReadingOutcome(parsed.outcome);
      const litres = parsePumpNumber(parsed.litres);
      const unitPrice = parsePumpNumber(parsed.unit_price);
      const total = parsePumpNumber(parsed.total);
      const structuralOutcome = rawOutcome ?? (litres == null && unitPrice == null && total == null ? 'UNREADABLE' : 'ACCEPTED');

      if (structuralOutcome !== 'ACCEPTED') {
        return {
          success: false,
          outcome: structuralOutcome,
          litres: null,
          unitPrice: null,
          total: null,
          mismatch: false,
          computedTotal: null,
          error: null,
          provider: 'openrouter',
          model: result.model,
        };
      }

      if (litres == null && unitPrice == null && total == null) {
        lastError = 'Không đọc được giá trị nào từ ảnh';
        continue;
      }

      const classified = classifyPumpReadingValues(litres, unitPrice, total);

      return {
        outcome: classified.outcome,
        success: classified.success,
        litres: classified.litres,
        unitPrice: classified.unitPrice,
        total: classified.total,
        mismatch: classified.mismatch,
        computedTotal: classified.computedTotal,
        error: null, provider: 'openrouter', model: result.model,
      };
    } catch {
      lastError = 'Không thể phân tích kết quả OCR';
      continue;
    }
  }

  return {
    outcome: 'UNREADABLE',
    success: false, litres: null, unitPrice: null, total: null,
    mismatch: false, computedTotal: null,
    error: lastError ?? 'Tất cả provider đều thất bại',
    provider: lastProvider, model: lastModel,
  };
}
