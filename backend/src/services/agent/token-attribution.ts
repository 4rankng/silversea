// Lightweight token attribution: estimate how many tokens each component of the
// prompt consumes (system prompt, tool-schema manifest, prior history, the
// within-turn transcript) so a ballooning manifest or transcript is visible in
// the logs — the lever for cutting `tokens_in` / response latency. Char-based
// estimate (~3.5 chars/token for mixed vi/en text) is rough but fine for
// RELATIVE before/after comparison. Logs COUNTS ONLY — never prompt text (no
// PII / financial data reaches the log).
import type { MiniMaxMessage, MiniMaxTool } from '../llm/minimax.client';

const CHARS_PER_TOKEN = 3.5;

export interface TokenAttribution {
  /** The static system prompt (instructions, date, few-shot). */
  system: number;
  /** The advertised tool-schema manifest — the dominant `tokens_in` driver and
   *  the thing the manifest-collapse cut. */
  toolSchema: number;
  /** Seed/prior turns before any ReAct activity this turn. */
  history: number;
  /** Within-turn assistant + tool messages (grows each iteration, re-billed). */
  transcript: number;
  total: number;
}

export function estimateTokensByComponent(
  messages: MiniMaxMessage[],
  tools?: MiniMaxTool[],
): TokenAttribution {
  let system = 0;
  let history = 0;
  let transcript = 0;
  // Transcript = the first assistant(tool_calls) / tool reply onward. Everything
  // before that (system + the user's question + prior session turns) is the seed.
  let inTranscript = false;
  for (const m of messages) {
    const size = messageChars(m) / CHARS_PER_TOKEN;
    if (m.role === 'system') {
      system += size;
    } else if (m.role === 'assistant' || m.role === 'tool' || inTranscript) {
      transcript += size;
      inTranscript = true;
    } else {
      history += size;
    }
  }
  const toolSchema = tools ? JSON.stringify(tools).length / CHARS_PER_TOKEN : 0;
  return {
    system: Math.round(system),
    toolSchema: Math.round(toolSchema),
    history: Math.round(history),
    transcript: Math.round(transcript),
    total: Math.round(system + toolSchema + history + transcript),
  };
}

function messageChars(m: MiniMaxMessage): number {
  let chars = (m.content ?? '').length;
  if (m.tool_calls) {
    for (const tc of m.tool_calls) chars += tc.function.arguments.length + tc.function.name.length;
  }
  return chars;
}

export function formatAttribution(a: TokenAttribution): string {
  return `system=${a.system} toolSchema=${a.toolSchema} history=${a.history} transcript=${a.transcript} total≈${a.total}`;
}
