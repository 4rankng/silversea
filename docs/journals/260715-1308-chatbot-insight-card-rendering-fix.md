---
date: 2026-07-15
type: fix
status: verified
area: chatbot-insight-cards
---

# Chatbot insight-card rendering fix

## Context

A July 2026 business-analysis response displayed only its short summary instead of the KPI grid, charts, tables, and Vietnamese analysis. Chart and table headings were also absent even when the model supplied widget titles.

## What happened

The model mixed a structured `insight_card` JSON object with prose after the closing brace and formatted KPI values such as `"25,7%"`. Percent strings violated the numeric schema, the parser discarded trailing prose, and validation fallback reduced the response to `summary`. Separately, the frontend rendered widget bodies without their optional titles.

The orchestrator now normalizes currency, percent, and chart-label variants before shared-schema validation and preserves trailing prose as optional Markdown `details`. The shared response contract persists that field, and the frontend renders it after titled widgets. Regression coverage also confirms that later responses append to chat state instead of replacing an earlier card.

A P2 review found one merge edge: when a card already contains `details` and the provider also appends analysis, preserving only one source would still lose content. The parser now keeps both, avoids exact duplication, and continues rejecting leaked internal contract text.

## Verification

- Backend: 690 tests discovered; 689 passed, 0 failed, 1 todo.
- Frontend: 146 tests passed, including card rendering and message-preservation coverage.
- Shared, backend, and frontend production builds passed; the existing frontend large-chunk warning remains unchanged.
- JSON serialization and shared-schema rehydration preserve `details`, covering the persistence/history boundary.

## Decisions

Future responses retain structured widgets and narrative analysis both live and after conversation history reload. Existing historical rows that were already reduced to a summary remain valid but cannot have discarded text reconstructed because that content was never persisted.
