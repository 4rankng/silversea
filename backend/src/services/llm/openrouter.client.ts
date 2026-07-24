// OpenRouter LLM client — OpenAI-compatible Chat Completions, used when the
// admin selects OpenRouter as the chatbot agent provider.
//
// Mirrors the MiniMax client structure: a factory that returns a concrete
// LlmProvider. OpenRouter does NOT support MiniMax's `reasoning_split` and
// does not leak `<think>` blocks for the models we route to, so no
// cleanContent hook is needed (the runner defaults to identity).
//
// OCR has its OWN OpenRouter usage (qwen/qwen3-vl-32b-instruct in
// ocr.service.ts) — this module is for the agent only.
import {
  OPENROUTER_MODEL,
  OPENROUTER_BASE_URL,
  OPENROUTER_TIMEOUT_MS,
} from './models';
import { runOpenAiCompletion, runOpenAiStreamingCompletion } from './openai-runner';
import { MiniMaxError } from './minimax.client';
import type { LlmProvider, LlmCompleteOptions } from './provider';

/** Build a concrete OpenRouter provider instance bound to a live key + model.
 *  Used by provider-registry.ts when OpenRouter is the active provider. */
export function createOpenRouterProvider(
  key: string,
  model: string = OPENROUTER_MODEL,
): LlmProvider {
  return {
    id: 'openrouter',
    model,
    async complete(opts: LlmCompleteOptions) {
      if (!key) {
        throw new MiniMaxError('OpenRouter chưa cấu hình (thiếu API key)', 'no_key');
      }
      return runOpenAiCompletion(
        {
          providerId: 'openrouter',
          baseUrl: OPENROUTER_BASE_URL,
          apiKey: key,
          model,
          timeoutMs: OPENROUTER_TIMEOUT_MS,
        },
        opts,
      );
    },
    async streamComplete(
      opts: LlmCompleteOptions,
      onText: (delta: string) => void,
    ) {
      if (!key) {
        throw new MiniMaxError('OpenRouter chưa cấu hình (thiếu API key)', 'no_key');
      }
      return runOpenAiStreamingCompletion(
        {
          providerId: 'openrouter',
          baseUrl: OPENROUTER_BASE_URL,
          apiKey: key,
          model,
          timeoutMs: OPENROUTER_TIMEOUT_MS,
        },
        opts,
        onText,
      );
    },
  };
}
