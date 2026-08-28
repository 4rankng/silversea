# Knowledge Base (Understand-Anything)

This project ships a code knowledge graph generated with
[Understand-Anything](https://github.com/Egonex-AI/Understand-Anything) so the
backend, shared package, and deployment infrastructure can be explored as an
interactive graph: files/functions/classes as nodes, import and call
relationships as edges, plus architecture layers, a guided onboarding tour, and
a business-domain map.

## Where it lives

| File | What it is |
| --- | --- |
| `.ua/knowledge-graph.json` | **Structural graph** — 1403 nodes / 2464 edges across 301 source files, 11 architecture layers, and a 12-step onboarding tour. |
| `.ua/domain-graph.json` | **Domain graph** — 6 business domains → 9 flows → 33 ordered steps (Trip Operations, Finance & Billing, Advances & Governance, Salary & Payroll, Forwarder & Customer Portal, Fleet & Master Data). |
| `.ua/meta.json` | Generation metadata: commit hash, scope, stats, validation status. |
| `.ua/.understandignore` | Scoping config (allowlist of backend/src + shared/src + infra). |
| `.ua/tmp/`, `.ua/intermediate/` | Pipeline scratch + scripts — git-ignored, regenerated each run. |

## Scope

The graph covers the **highest domain-logic density**: backend services/routes/db,
the shared `@tingting/shared` contracts and financial calculations, and the
deployment infrastructure. Frontend UI, tests, plans, and docs are intentionally
excluded to keep the graph focused. Broaden the scope by editing
`.ua/.understandignore` and regenerating.

## How it was generated

The graph uses Understand-Anything's real pipeline (not a hand-rolled imitation):
the bundled `scan-project.mjs` (file inventory + language/category) and
`extract-structure.mjs` (tree-sitter function/class/call-graph extraction), plus
UA's official `KnowledgeGraphSchema` validation. One customization was required:

- **Custom import resolver** (`.ua/tmp/resolve-silversea-imports.mjs`) replaces
  the bundled `extract-import-map.mjs`, which returns 0 edges here because it
  cannot resolve the `@tingting/shared` workspace alias or the Drizzle barrel
  imports (`../db` → `../db/index.ts`). The custom resolver handles the alias,
  relative paths, and extensionless/directory imports.

Both graphs validate **green** (`success=true, issues=0`) against
`@understand-anything/core`'s Zod schema.

## Viewing the graph

If you have the Understand-Anything plugin installed (Claude Code, Cursor, or
GitHub Copilot), open this repo and run:

- `/understand-dashboard` — launches the interactive browser UI (pan/zoom/click
  nodes; toggle between Structural and Domain views).
- `/understand-chat` — ask questions about the codebase in natural language.
- `/understand-onboard` — generate a new-hire onboarding guide from the tour.
- `/understand-diff` — check the graph impact of pending code changes.

Without the plugin, the JSON files are self-describing and can be queried with
`jq`, e.g.:

```sh
# Everything in the Business Services layer
jq '.layers[] | select(.id=="layer:business-services") | .nodeIds' .ua/knowledge-graph.json

# What does the trip-lifecycle flow consist of?
jq '.nodes[] | select(.id|startswith("step:trip-lifecycle:"))' .ua/domain-graph.json

# Top imported files (most depended upon)
jq '[.edges[] | select(.type=="imports") | .target] | group_by(.) | map({file:.[0], count:length}) | sort_by(-.count) | .[:10]' .ua/knowledge-graph.json
```

## Regenerating

The pipeline is fully reproducible from the scripts under `.ua/tmp/`. To
regenerate after significant code changes:

```sh
PLUGIN="/path/to/Understand-Anything/understand-anything-plugin"  # or re-clone
UA_DIR="$(pwd)/.ua"
PR="$(pwd)"

# 1. Scan (respects .ua/.understandignore)
node "$PLUGIN/skills/understand/scan-project.mjs" "$PR" "$UA_DIR/tmp/ua-scan-files.json"
# 2. Resolve imports (custom resolver)
node "$UA_DIR/tmp/resolve-silversea-imports.mjs" "$PR" "$UA_DIR/tmp/ua-scan-files.json" "$UA_DIR/tmp/ua-import-map-output.json"
# 3. Extract structure in batches
node "$UA_DIR/tmp/run-structure-batches.mjs" "$PR" "$PLUGIN"
# 4. Build graph fragment (nodes + edges)
node "$UA_DIR/tmp/build-graph.mjs" "$PR"
# 5. Assemble + validate (writes knowledge-graph.json)
node "$UA_DIR/tmp/assemble-graph.mjs" "$PR" "$PLUGIN"
# 6. Build domain graph (writes domain-graph.json)
node "$UA_DIR/tmp/build-domain-graph.mjs" "$PR" "$PLUGIN"
```

Commit the regenerated `.ua/knowledge-graph.json`, `.ua/domain-graph.json`, and
`.ua/meta.json`. Per UA's "commit it once, and teammates skip the pipeline"
model, teammates with the plugin read the committed JSONs directly.
