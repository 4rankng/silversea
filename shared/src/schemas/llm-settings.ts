/**
 * Admin LLM provider settings — shared contract for the settings API
 * (backend/src/routes/llm-settings.ts) and the admin settings page
 * (frontend pages/config/LlmSettingsConfigPage.tsx).
 *
 * The admin chooses which provider the chatbot agent uses (MiniMax or
 * OpenRouter) and stores that provider's API key. Keys are encrypted at rest
 * and NEVER returned in plaintext — the response only carries a masked preview
 * + a `*KeySet` boolean. The PUT request omits a key field to leave the stored
 * value untouched (so the admin can switch provider without re-entering), and
 * uses an explicit `clear*Key` boolean to clear one.
 */
import { z } from 'zod';

/** Which LLM provider the chatbot agent routes to. */
export const LLM_PROVIDERS = ['minimax', 'openrouter'] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

/** Hardcoded model name per provider (mirrors backend services/llm/models.ts).
 *  Shown read-only in the settings UI; not admin-configurable. */
export const LLM_PROVIDER_MODELS: Record<LlmProvider, string> = {
  minimax: 'MiniMax-M2.7-highspeed',
  openrouter: 'deepseek/deepseek-v4-flash',
};

/** Vietnamese display labels. */
export const LLM_PROVIDER_LABELS: Record<LlmProvider, string> = {
  minimax: 'MiniMax',
  openrouter: 'OpenRouter',
};

/** GET /api/admin/llm-settings — keys are never sent to the client. */
export interface LlmSettingsResponse {
  provider: LlmProvider;
  minimaxKeySet: boolean;
  openrouterKeySet: boolean;
  /** Masked preview (last 4 chars) or '' when unset. */
  minimaxKeyMasked: string;
  openrouterKeyMasked: string;
  /** Read-only model name per provider, for display. */
  models: Record<LlmProvider, string>;
}

/** PUT /api/admin/llm-settings request body.
 *  - `provider` is always required.
 *  - A key field is optional: omit/leave empty to keep the stored key.
 *  - `clearMinimaxKey`/`clearOpenRouterKey` explicitly wipe a stored key. */
export const llmSettingsUpdateSchema = z.object({
  provider: z.enum(LLM_PROVIDERS),
  minimaxApiKey: z.string().optional(),
  openrouterApiKey: z.string().optional(),
  clearMinimaxKey: z.boolean().optional(),
  clearOpenRouterKey: z.boolean().optional(),
});
export type LlmSettingsUpdate = z.infer<typeof llmSettingsUpdateSchema>;

/** API path constants for the admin LLM settings endpoints. */
export const LLM_SETTINGS_PATHS = {
  base: '/admin/llm-settings',
} as const;
