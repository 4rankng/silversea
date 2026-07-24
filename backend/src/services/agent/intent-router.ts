// Intent Router — "route before reasoning" (P1, Lane 0).
//
// Sits between the FAQ fast lane and the orchestrator in agentSocket.ts. When
// the FAQ lane abstains, routeIntent() classifies the message deterministically:
//
//   Lane 0 (navigation) → resolve via PAGE_CATALOG → emit a navigate directive.
//                         ZERO LLM calls. This is the #1 production intent
//                         (ui.navigate was the most-called tool at 21/41 turns).
//   Lane 2 (lookup)     → [reserved for P1 follow-up after P0.4 model-tier spike]
//   else                → Lane 4 (full ReAct via the orchestrator).
//
// DESIGN PRINCIPLES (from the HLD):
//   1. Deterministic rules first — cheap, auditable, microsecond-scale.
//   2. Fail-open to ReAct on low confidence — correctness preserved.
//   3. Every routing decision sets intent_bucket for the metrics row.
//   4. Behind a kill-switch (config.agentIntentRouter).
//
// The navigation matcher reuses the SAME Vietnamese diacritic-insensitive
// normalization + PAGE_CATALOG aliases as ui.search_pages (tools/ui.ts), so a
// query that matches there also matches here — no drift.

import {
  AGENT_ROUTE_KEYS,
  PAGE_CATALOG,
  type AgentRouteKey,
  type AgentDirective,
  type PageAgentMeta,
} from '@tingting/shared';
import { normalizeText } from './text.js';
import type { AgentContext } from './tool.types.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export type IntentLane = 'nav' | 'summary' | 'financial' | 'report' | 'lookup' | 'react';

export interface SimpleReportRequest {
  report: 'profit' | 'receivables' | 'payables';
  month?: number;
  year?: number;
}

export interface RouteDecision {
  /** Which lane the router chose. 'nav' = Lane 0 (0 LLM); 'summary' = Lane 3
   *  (0 LLM, dashboard aggregation); 'financial' = canonical company financial
   *  overview (3 parallel service reads, 0 LLM); 'lookup' = Lane 2 (1 tool
   *  call + synthesis); 'react' = Lane 4 (full ReAct). */
  lane: IntentLane;
  /** For lane='nav': the navigate directive to emit directly. */
  directive?: AgentDirective;
  /** For lane='lookup': the search query to pass to data.search. */
  lookupQuery?: string;
  /** For lane='report': canonical deterministic report to execute. */
  reportRequest?: SimpleReportRequest;
  /** Human-readable reason for observability/debugging. */
  reason: string;
}

// ─── Navigation matching (Lane 0) ───────────────────────────────────────────

// Vietnamese + English open-verb set. The message must START with (or be
// dominated by) one of these for Lane 0 to fire — this prevents hijacking a
// question that merely MENTIONS a page ("lợi nhuận ở trang báo cáo?" stays on
// the ReAct path because it's analytical, not navigational).
const NAV_VERBS = [
  // Vietnamese (normalized = diacritic-stripped + lowercase)
  'mo', 'mo trang', 'mo page', 'mo man hinh',
  'vao', 'vao trang', 'den trang', 'den man hinh',
  'di toi', 'den voi',
  'cho xem trang', 'cho toi xem trang',
  'huong dan toi',
  'tro loi toi trang',
  // English
  'open', 'open the', 'open page', 'go to', 'take me to', 'show me', 'navigate to', 'navigate',
];

// Per-key search data, derived from PAGE_CATALOG (single source of truth).
// Identical to the PAGE_SEARCH_ENTRIES in tools/ui.ts — kept duplicated (not
// shared) so the router stays a pure, dependency-light module testable without
// the tool layer. If PAGE_CATALOG changes, both update (compile-time guard).
const NAV_ENTRIES: ReadonlyArray<{
  routeKey: AgentRouteKey;
  title: string;
  description: string;
  aliases: readonly string[];
  pathBasename: string;
}> = (AGENT_ROUTE_KEYS as readonly AgentRouteKey[]).map((k) => {
  const meta: PageAgentMeta = PAGE_CATALOG[k].agent!;
  // Extract the path basename for matching (e.g. '/dashboard' → 'dashboard',
  // '/fleet' → 'fleet'). Users often say the path name, not the VN title.
  const rawPath = typeof PAGE_CATALOG[k].path === 'string' ? PAGE_CATALOG[k].path as string : '';
  const pathBasename = rawPath.split('/').filter(Boolean)[0] ?? '';
  return {
    routeKey: k,
    title: PAGE_CATALOG[k].title,
    description: meta.description,
    aliases: meta.aliases ?? [],
    pathBasename,
  };
});

/** Check if `haystack` contains `needle` at a word boundary (space-delimited).
 *  Prevents false matches like "congno" matching inside "sacongno" — only whole
 *  tokens or token-sequences count. Also handles the case where both are
 *  multi-word (the alias "cong no" in query "bao cao cong no phai thu"). */
function wordContains(haystack: string, needle: string): boolean {
  if (!needle || !haystack) return false;
  // Direct substring is fine for multi-word needles (they're already space-bound).
  if (needle.includes(' ')) {
    return haystack.includes(needle);
  }
  // Single-word needle: check as a whole token.
  const tokens = haystack.split(/\s+/);
  return tokens.includes(needle);
}

/**
 * Find the best page match for a normalized query string. Returns the routeKey
 * + match score (0 = no match). BIDIRECTIONAL substring matching: the query
 * may be longer OR shorter than the catalog entry (e.g. "trang cong no phai
 * thu" contains alias "cong no"; alias "lốp" is contained in query "trang
 * lốp"). Scoring takes the MAX across all entries.
 */
function findPageMatch(normalizedQuery: string): { routeKey: AgentRouteKey; score: number } | null {
  let best: { routeKey: AgentRouteKey; score: number } | null = null;
  // Strip common noise words from the query to improve matching. These are
  // generic page-navigation filler that shouldn't influence the page match.
  const cleanQuery = normalizedQuery
    .replace(/\b(trang|page|pages|man hinh|cho|xem|toi|the|edit|sua|chinh|bao cao|bao|cao|chi tiet|danh sach|danh|sach)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  for (const entry of NAV_ENTRIES) {
    const normTitle = normalizeText(entry.title);
    let score = 0;

    // ── Alias matching (strongest signal — aliases are curated for this) ──
    for (const alias of entry.aliases) {
      const normAlias = normalizeText(alias);
      if (normAlias.length < 2) continue;
      // Exact alias match.
      if (cleanQuery === normAlias || normalizedQuery === normAlias) {
        score = Math.max(score, 100);
        break;
      }
      // Alias appears as a word-boundary substring in the query (query is longer).
      if (normAlias.length >= 3 && wordContains(cleanQuery, normAlias)) {
        score = Math.max(score, 75);
        break;
      }
      // Query appears in the alias (alias is longer — e.g. query "lốp" in alias "lốp xe").
      if (cleanQuery.length >= 3 && normAlias.includes(cleanQuery)) {
        score = Math.max(score, 70);
        break;
      }
    }

    // ── Title matching (word-boundary aware) ──
    if (normTitle === cleanQuery || normTitle === normalizedQuery) {
      score = Math.max(score, 95);
    } else if (normTitle.length >= 3 && wordContains(cleanQuery, normTitle)) {
      score = Math.max(score, 85);
    } else if (cleanQuery.length >= 3 && normTitle.includes(cleanQuery)) {
      score = Math.max(score, 80);
    } else if (normTitle.length >= 3) {
      // Partial title token match: check if the first significant title token
      // (e.g. "cong" from "cong no phai thu") appears in the query. This catches
      // "bao cao cong no" → matches "cong no phai thu" via the "cong no" bigram.
      const titleTokens = normTitle.split(' ').filter((t) => t.length >= 3);
      const queryTokens = cleanQuery.split(' ').filter((t) => t.length >= 3);
      // Check for 2-gram overlap (e.g. "cong no" in both).
      for (let i = 0; i < titleTokens.length - 1; i++) {
        const bigram = `${titleTokens[i]} ${titleTokens[i + 1]}`;
        if (cleanQuery.includes(bigram)) {
          score = Math.max(score, 78);
          break;
        }
      }
      // Single significant token overlap (weaker — "no" alone is too common,
      // so require length >= 4 to avoid false positives on short words).
      if (score < 78) {
        for (const tt of titleTokens) {
          if (tt.length >= 4 && queryTokens.includes(tt)) {
            score = Math.max(score, 72);
            break;
          }
        }
      }
    }

    // ── Path basename matching (e.g. "dashboard", "fleet", "trips") ──
    if (entry.pathBasename.length >= 3) {
      const normPath = normalizeText(entry.pathBasename);
      if (cleanQuery === normPath || normalizedQuery === normPath) {
        score = Math.max(score, 90);
      } else if (cleanQuery.includes(normPath)) {
        score = Math.max(score, 75);
      }
    }

    if (score > 0 && (!best || score > best.score)) {
      best = { routeKey: entry.routeKey, score };
    }
  }

  return best;
}

/**
 * Strip the leading nav verb from a normalized message to extract the page
 * query. E.g. "mo trang cong no" → "trang cong no" → matched against catalog.
 * Returns the remaining query string, or null if no nav verb prefix found.
 */
function extractPageQuery(normalized: string): string | null {
  // Sort by length descending so "mo trang" is tried before "mo".
  const sortedVerbs = [...NAV_VERBS].sort((a, b) => b.length - a.length);
  for (const verb of sortedVerbs) {
    if (normalized === verb || normalized.startsWith(verb + ' ')) {
      const rest = normalized.slice(verb.length).trim();
      // The verb alone ("open") with no target → no query to match.
      if (rest.length === 0) return null;
      return rest;
    }
  }
  return null;
}

// Minimum score for a confident navigation match. Below this, abstain to ReAct.
// 70 = alias-include or title-include (a real page reference). Description-only
// matches (50) are too weak — "lợi nhuận ở trang báo cáo" shouldn't navigate.
const NAV_SCORE_THRESHOLD = 70;

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Classify a user message into an execution lane. Deterministic, synchronous,
 * fail-open. Returns {lane:'nav', directive} for navigation, or {lane:'react'}
 * for everything else.
 *
 * @param message The raw user message (Vietnamese or English).
 * @param _ctx The agent context (unused in v1 — reserved for role-gating Lane 2).
 */
export function routeIntent(message: string, _ctx?: AgentContext): RouteDecision {
  const normalized = normalizeText(message).trim();

  if (!normalized) {
    return { lane: 'react', reason: 'empty message' };
  }

  // ── Lane 0: Navigation ──────────────────────────────────────────────────
  const pageQuery = extractPageQuery(normalized);
  if (pageQuery) {
    const match = findPageMatch(pageQuery);
    if (match && match.score >= NAV_SCORE_THRESHOLD) {
      const directive: AgentDirective = {
        kind: 'navigate',
        routeKey: match.routeKey,
      };
      return {
        lane: 'nav',
        directive,
        reason: `nav verb + page match "${match.routeKey}" (score ${match.score})`,
      };
    }
    // Nav verb present but no confident page match → still might be navigation
    // that the LLM can resolve better (e.g. "mở trang báo cáo lương tháng trước"
    // needs context the LLM has). Fall through to ReAct.
  }

  // Also handle bare page references without a verb: "cong no" alone could be
  // a data query OR a navigation request. Too ambiguous for Lane 0 — the verb
  // requirement prevents hijacking data questions. Stay on ReAct.

  // ── Lane 3: Daily-work summary ──────────────────────────────────────────
  // Detect summary/daily-work intents: "tóm tắt việc hôm nay", "cần làm gì",
  // "tình hình", "có gì quan trọng không", "what's up today". These route to
  // the summary lane which calls getDashboardStats() (0 LLM calls).
  if (isSummaryIntent(normalized)) {
    return { lane: 'summary', reason: 'summary/daily-work intent detected' };
  }

  // ── Lane 3b: Company financial overview ────────────────────────────────
  // Broad health-check questions have a fixed data contract: current-period
  // P&L + AR + AP. Sending these through ReAct previously cost 3 model rounds,
  // ~33k tokens, and often a second final-schema call. Keep the matcher narrow:
  // explicit periods, vehicles/customers, comparisons, and causal questions
  // still need the analytical agent.
  if (isFinancialOverviewIntent(normalized)) {
    return { lane: 'financial', reason: 'broad company financial overview detected' };
  }
  const reportRequest = extractSimpleReportIntent(normalized);
  if (reportRequest) {
    return { lane: 'report', reportRequest, reason: `simple ${reportRequest.report} report detected` };
  }
  // A specific financial question must not fall through into the generic
  // entity lookup below merely because it contains a month number, plate, or
  // customer name. Preserve the full analytical path for those cases.
  if (isSpecificFinancialAnalysis(normalized)) {
    return { lane: 'react', reason: 'specific financial analysis requires ReAct' };
  }

  // ── Lane 2: Single-tool lookup ──────────────────────────────────────────
  // Detect single-entity lookup queries: "Số lốp 136.31", "khách hàng vietsun",
  // "chuyến X206". These route to ONE data.search call + one synthesis pass
  // (shorter than a full ReAct loop). The detection is conservative — only
  // short messages with a clear entity reference qualify.
  const lookupQuery = extractLookupQuery(normalized);
  if (lookupQuery) {
    return { lane: 'lookup', lookupQuery, reason: `single-entity lookup detected` };
  }

  // ── Lane 4: Full ReAct ──────────────────────────────────────────────────
  return { lane: 'react', reason: 'no deterministic route matched' };
}

// ─── Summary intent detection (Lane 3) ──────────────────────────────────────

// Phrases that indicate a daily-work summary request. Normalized (diacritic-
// stripped + lowercase). The message must CONTAIN one of these phrases.
// Kept conservative: "tình hình tài chính" is analytical (ReAct), not a summary.
const SUMMARY_PHRASES = [
  // Vietnamese
  'tom tat viec hom nay', 'tom tat hom nay',
  'can lam gi hom nay', 'can lam gi',
  'co gi quan trong khong', 'co gi quan trong',
  'viec hom nay', 'cong viec hom nay',
  'tinh hinh hom nay', 'xem tinh hinh',
  'tong quat hom nay', 'dien bien hom nay',
  // "hôm nay có gì" / "có gì hôm nay" patterns
  'hom nay co gi', 'co gi can lam',
  // English
  'what to do today', "what's on today", 'todays summary', 'daily summary',
  'what needs my attention', 'anything urgent',
];

/** Check if a normalized message matches a summary/daily-work intent. */
function isSummaryIntent(normalized: string): boolean {
  // Exact match or starts-with for short summary phrases.
  for (const phrase of SUMMARY_PHRASES) {
    if (normalized === phrase || normalized.includes(phrase)) {
      return true;
    }
  }
  // "tóm tắt" at the start with no specific entity → summary.
  if (normalized.startsWith('tom tat') && normalized.length <= 30) {
    return true;
  }
  return false;
}

const FINANCIAL_OVERVIEW_PHRASES = [
  'tinh hinh tai chinh',
  'suc khoe tai chinh',
  'tai chinh cong ty',
  'cong ty lam an',
  'lam an duoc khong',
  'lam an the nao',
  'business health',
  'financial health',
];

const FINANCIAL_OVERVIEW_SPECIFIC = /(tai sao|vi sao|so voi|tung xe|(?:^|\s)xe\s+[0-9]|khach hang|nha cung cap|thang\s+[0-9]|quy\s+[0-9]|nam\s+20\d{2}|\d{1,2}[\/-]20\d{2})/i;

/** Broad current-company health only; specific analysis fails open to ReAct. */
function isFinancialOverviewIntent(normalized: string): boolean {
  if (normalized.length > 120 || FINANCIAL_OVERVIEW_SPECIFIC.test(normalized)) return false;
  return FINANCIAL_OVERVIEW_PHRASES.some((phrase) => normalized.includes(phrase));
}

function isSpecificFinancialAnalysis(normalized: string): boolean {
  // Do not include "công nợ" here: a short customer receivable phrase is an
  // established Lane-2 entity lookup (for example "công nợ khách hàng Vietsun").
  return /(tai chinh|loi nhuan|doanh thu|chi phi)/i.test(normalized)
    && FINANCIAL_OVERVIEW_SPECIFIC.test(normalized);
}

function extractSimpleReportIntent(normalized: string): SimpleReportRequest | null {
  // Causal/comparative/entity-scoped questions need the analytical agent.
  if (/(tai sao|vi sao|so voi|tung xe|(?:^|\s)xe\s+[0-9]|khach hang\s+\S|nha cung cap\s+\S)/i.test(normalized)) return null;
  // The deterministic lane currently supports current totals and calendar
  // months only. Fail open for quarters and year-only requests so we never
  // answer a historical question with the current month's figures.
  if (/quy\s*[1-4]/i.test(normalized)) return null;
  const asksForValue = /(bao nhieu|tong|thang nay|ky nay|hien tai|tinh hinh)/i.test(normalized);
  if (!asksForValue) return null;

  const period = /thang\s*([1-9]|1[0-2])(?:\s*(?:[\/-]|nam\s+)\s*(20\d{2}))?/i.exec(normalized);
  const month = period?.[1] ? Number(period[1]) : undefined;
  const year = period?.[2] ? Number(period[2]) : undefined;
  if (/nam\s+20\d{2}/i.test(normalized) && !year) return null;

  // Aging services expose current balances only. Historical AR/AP must remain
  // in ReAct until an as-of-date query is available.
  if (/(cong no phai thu|tong phai thu)/i.test(normalized)) {
    return month || year ? null : { report: 'receivables' };
  }
  if (/(cong no phai tra|tong phai tra)/i.test(normalized)) {
    return month || year ? null : { report: 'payables' };
  }
  if (/(loi nhuan|doanh thu|lai lo)/i.test(normalized)) return { report: 'profit', month, year };
  return null;
}

// ─── Lookup intent detection (Lane 2) ───────────────────────────────────────

// Entity keyword patterns that indicate a single-entity lookup. When a message
// contains one of these patterns + a reference (name/number/plate), it's a
// lookup — not an analytical question. Conservative: analytical questions
// ("tại sao lợi nhuận giảm?") must NOT match.
//
// Patterns are checked against the NORMALIZED (diacritic-stripped, lowercase)
// message. Each pattern maps to a regex that extracts the reference.
const LOOKUP_PATTERNS: { regex: RegExp; desc: string }[] = [
  // Vietnamese truck plate formats: "136.31", "15C-136.31", "51C-123.45".
  // Pattern: optional prefix (letters+digits+dash) then digits.digits.
  // "Số lốp 136.31", "lốp xe 15C-136.31", "136.31"
  { regex: /(?:lop|lop xe|vo xe|so lop|xe)?\s*([\d]{2,4}[a-z]?-?[\d]{0,4}\.?[\d]{2,4})\b/i, desc: 'truck plate' },
  // Customer/supplier name references. Capture only the name part (last word(s)).
  // "khách hàng vietsun", "khach vietsun"
  { regex: /(?:khach hang|khach)\s+([a-z][a-z0-9]{2,20})/i, desc: 'customer name' },
  // "cong no khach hang vietsun" → the "hang" is part of "khach hang"
  { regex: /cong no khach hang\s+([a-z][a-z0-9]{2,20})/i, desc: 'customer receivable' },
  // Trip code references.
  { regex: /(?:chuyen|lenh)\s+([a-z0-9][a-z0-9-]{1,15})/i, desc: 'trip code' },
  // Driver name references.
  { regex: /(?:tai xe|lai xe|driver)\s+([a-z][a-z]{2,20})/i, desc: 'driver name' },
  // Bare plate number — must be the ENTIRE message (short).
  { regex: /^([\d]{2,4}[a-z]?-?[\d]{0,4}\.[\d]{2,4})$/i, desc: 'bare plate' },
];

/** Maximum message length for Lane 2. Long messages are likely analytical or
 *  multi-part — those need the full ReAct loop. */
const LOOKUP_MAX_LENGTH = 60;

/**
 * Detect a single-entity lookup query. Returns the search query string to pass
 * to data.search, or null if the message isn't a lookup. Conservative: only
 * short messages with a clear entity reference qualify.
 */
function extractLookupQuery(normalized: string): string | null {
  if (normalized.length > LOOKUP_MAX_LENGTH) return null;
  // Skip messages that contain analytical/question words anywhere (not just
  // at the start). "lợi nhuận xe 136.31 tháng 6 là bao nhiêu" is analytical,
  // not a lookup, despite containing a plate number.
  if (/(tai sao|vi sao|lam sao|the nao|huong dan|day toi|day minh|bao nhieu|la bao nhieu|thang na[oy])/i.test(normalized)) return null;

  for (const { regex } of LOOKUP_PATTERNS) {
    const match = regex.exec(normalized);
    if (match && match[1]) {
      const ref = match[1].trim();
      if (ref.length >= 2) {
        // Return the full original entity reference as the search query.
        // For "số lốp 136.31" the query is "136.31" (the plate).
        // For "khách hàng vietsun" the query is "vietsun".
        return ref;
      }
    }
  }
  return null;
}
