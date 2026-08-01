#!/usr/bin/env bash
# ZCode `Stop` hook — keep the Understand-Anything knowledge base current.
#
# Fires at the end of every turn. Silently no-ops unless the KB is stale
# (the recorded gitCommitHash in meta.json differs from HEAD). When stale,
# injects an instruction telling the agent to run the plugin's incremental
# update flow (auto-update-prompt.md). On a current KB or missing KB, exits 0
# and injects nothing.
#
# Design notes:
# - ZCode config-file hooks must opt in via hooks.enabled:true; that is set in
#   ../config.json. This script itself is registered there under hooks.events.Stop.
# - Strict JSON output (per ZCode hook schema). Any malformed JSON is discarded
#   and logged, never blocks the session — so this is fail-safe.
# - Resolves the plugin root via the canonical symlink ~/.understand-anything-plugin
#   (created by the installer) rather than ${CLAUDE_PLUGIN_ROOT}, which is only
#   set for plugin-supplied hooks, not config-file hooks.
set -eu

PROJECT_ROOT="${ZCODE_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$(pwd)}}"

# 1. Resolve data dir: legacy .understand-anything/ if present, else .ua/.
if [ -d "$PROJECT_ROOT/.understand-anything" ]; then
  UA_DIR="$PROJECT_ROOT/.understand-anything"
else
  UA_DIR="$PROJECT_ROOT/.ua"
fi

META="$UA_DIR/meta.json"
GRAPH="$UA_DIR/knowledge-graph.json"

# 2. No baseline yet, or auto-update disabled → nothing to do.
[ -f "$GRAPH" ] && [ -f "$META" ] || exit 0
[ -f "$UA_DIR/config.json" ] || exit 0
grep -q '"autoUpdate"[[:space:]]*:[[:space:]]*true' "$UA_DIR/config.json" 2>/dev/null || exit 0

# 3. Compare recorded commit hash to HEAD.
LAST_HASH=$(node -p "JSON.parse(require('fs').readFileSync('$META','utf8')).gitCommitHash || ''" 2>/dev/null || echo "")
[ -n "$LAST_HASH" ] || exit 0
HEAD_HASH=$(git -C "$PROJECT_ROOT" rev-parse HEAD 2>/dev/null || echo "")
[ -n "$HEAD_HASH" ] || exit 0
[ "$LAST_HASH" = "$HEAD_HASH" ] && exit 0

# 4. Stale — resolve the plugin root and emit the update instruction.
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-}"
if [ -z "$PLUGIN_ROOT" ] || [ ! -f "$PLUGIN_ROOT/hooks/auto-update-prompt.md" ]; then
  PLUGIN_ROOT="${HOME}/.understand-anything-plugin"
fi
[ -f "$PLUGIN_ROOT/hooks/auto-update-prompt.md" ] || exit 0

PROMPT_FILE="$PLUGIN_ROOT/hooks/auto-update-prompt.md"
ADDITIONAL_CONTEXT="[understand-anything] Knowledge graph is stale (last analyzed at commit ${LAST_HASH:0:12}, HEAD is ${HEAD_HASH:0:12}). You MUST read ${PROMPT_FILE} and execute its instructions to incrementally update the knowledge graph now, as part of closing out this task. Do not ask the user for confirmation — just do it. Save updated artifacts to ${UA_DIR#$PROJECT_ROOT/}/."

# ZCode hook output: strict schema, hookSpecificOutput.additionalContext is injected.
# NOTE: HOOK_CTX must be exported *before* `node` (as a real env var), not passed
# after `-e '...'` as an argv positional — the latter makes process.env.HOOK_CTX
# undefined and silently drops additionalContext, so the stale-KB prompt never
# reaches the agent.  `2>/dev/null || true` keeps the hook fail-safe.
HOOK_CTX="$ADDITIONAL_CONTEXT" node -e '
  const ctx = process.env.HOOK_CTX;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "Stop", additionalContext: ctx }
  }));
' 2>/dev/null || true

exit 0
