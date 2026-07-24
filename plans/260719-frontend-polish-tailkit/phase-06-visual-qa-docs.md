---
phase: 6
title: "Visual QA & docs"
status: completed
priority: P2
effort: 3h
dependencies: [5]
---

# Phase 6: Visual QA & docs

## Overview

Final gates: whole-frontend visual sweep, full build, and the two docs that survive this plan — an ADR locking in the "Tailkit is reference-only" rule, and a short "how to reach for Tailkit" guide so the team self-serves next time.

## Requirements

- **Functional:** ADR merged; Tailkit usage guide published; build + tests + size-check all green; visual diff captured for migrated pages.
- **Non-functional:** future devs can answer "should I grab a Tailkit component?" without asking.

## Architecture

No code architecture changes. Docs land in `docs/adr/` and `docs/frontend/`.

## Related Code Files

- Read: every file touched in Phases 4-5 (final consistency sweep).
- Create: `docs/adr/ADR-XXXX-tailkit-as-reference-catalog.md` (find next free ADR number).
- Create: `docs/frontend/tailkit-usage-guide.md`.
- Update: `docs/high-level-design.md` if it has a frontend section that should mention the new primitives (check first; don't invent).
- Update: `AGENTS.md` "Frontend" section with a one-line note about Tailkit-as-reference.
- Remove (before merge): `frontend/src/pages/_designSystemPreview.tsx` route if not retained as a permanent storybook-substitute — or move it behind an auth-gated dev route.

## Implementation Steps

1. **Whole-plan consistency sweep.** Re-read `plan.md` and all `phase-*.md`. Check for stale references, contradictions, or scope creep introduced mid-flight. Fix.

2. **Visual diff capture.** For each migrated page, capture (or describe) before/after at 420 / 768 / 1280 px. If screenshot tooling is unavailable, write a structured description in `audit-after.md`.

3. **Run full build.**
   ```bash
   cd frontend && pnpm build
   ```
   Must succeed. Any TS error or Vite warning blocks close.

4. **Run full test suite.**
   ```bash
   cd frontend && pnpm test
   cd backend && pnpm test   # sanity, even though we didn't touch backend
   ```

5. **Run size check.**
   ```bash
   cd frontend && pnpm size-check
   ```
   Confirm we stayed under the project's size budget (`scripts/check_size.mjs`).

6. **Write the ADR.** Cover:
   - **Context:** Tailkit MCP is available; frontend already has daisyUI + custom design system.
   - **Decision:** Tailkit is a *reference catalog*, not a dependency. Adopted snippets are copy-in source, retokenized to NEPO tokens, never introduced as an npm package.
   - **Consequences:** no `components.json`, no `cn()` helper, no Tailwind v3 palette classes in `frontend/src`. daisyUI `d-` prefix stays.
   - **When to revisit:** only if the team decides to consolidate on shadcn CLI wholesale — that's a separate ADR.

7. **Write the usage guide.** Short and concrete:
   - When to search Tailkit (looking for inspiration, missing a primitive, comparing a pattern).
   - How to call the MCP tools (the 5 commands, with examples).
   - The retokenization rule + the translation table from `porting-notes.md`.
   - The grep guardrails.
   - Link to the ADR.

8. **Update `AGENTS.md`.** Under "Frontend" key patterns, add: *"Tailkit MCP is a reference catalog, not a dependency. See `docs/frontend/tailkit-usage-guide.md`."*

9. **Memory hygiene.** Run `/ck:journal` to capture a concise journal entry. Optionally update project memory with the "Tailkit is reference-only" decision so future sessions don't re-litigate it.

## Success Criteria

- [ ] `cd frontend && pnpm build` succeeds.
- [ ] `cd frontend && pnpm test` succeeds.
- [ ] `cd frontend && pnpm size-check` succeeds.
- [ ] ADR exists at `docs/adr/ADR-XXXX-tailkit-as-reference-catalog.md` and references this plan.
- [ ] Usage guide exists at `docs/frontend/tailkit-usage-guide.md` and includes the retokenization table.
- [ ] `AGENTS.md` mentions Tailkit-as-reference with a link.
- [ ] Visual sweep complete; no unresolved regression on migrated pages.
- [ ] Sibling-plan exclusion verified: `DebtDetailPage.tsx` / `PayableDetailPage.tsx` untouched.

## Risk Assessment

- **Risk:** ADR is written but ignored next time someone reaches for Tailkit. *Mitigation:* the `AGENTS.md` note + the grep guardrail make the rule machine-checkable, not just documentation.
- **Risk:** `_designSystemPreview.tsx` lingers and rots. *Mitigation:* explicit decide-and-document step — either it becomes a permanent dev-only route, or it's deleted before merge.
- **Risk:** docs/adr numbering convention unknown. *Mitigation:* `ls docs/adr/` first; pick next free number; if no ADR dir exists, follow whatever convention `docs/` already uses.
