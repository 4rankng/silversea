#!/usr/bin/env bash
# qawave-driver.sh — VisualQA capture driver for the 2026-09-22 kanban visual waves.
#
# One-session recipe (worksheet plans/reports/qa-wave-worksheet-2026-09-22.md):
#   1. login <user>          fetch JWT via API, stage the init script (token injection
#                            BEFORE first navigation — evaluateOnNewDocument pattern)
#   2. launch <path>         fresh agent-browser session "qawave", headed, init-script
#   3. width <1280|1440|1920|2560>   viewport switch (re-hit-test after every switch)
#   4. quiet                 close stray [role=dialog] before ANY tap sequence
#   5. tapref <sel>          real pointer tap: hit-test -> mouse move -> down -> up
#   6. shot <NN> full|crop|page [sel]
#                            full  = crop of the app shell (main.app-body) — the
#                                    subject-correct default. A genuine full-page capture
#                                    of this fixed shell paints the app into one corner of
#                                    a mostly-void canvas (card 20260922_69 D1).
#                            crop  = element crop (`[role=dialog]` for overlays); viewport
#                                    crop when sel is omitted
#                            page  = genuine full-page capture (--full) escape hatch
#                            writes qa/2026-09-22_<card>_<screen>_<state>_ui-<NN>[-full].png
#   7. measure <sel>...      px geometry (getBoundingClientRect) for the _38 bar checks
#
# Every shot stamps a DOM marker (card/NN/screen/state + pathname + clock) inside the crop
# target and re-reads it after the capture; the driver log carries `[marker: <pathname> |
# <h1>]` for every shot. A shot whose surface is not a logged-in app screen is REFUSED —
# exit 1 and the artefact is written as *_refused.png, never under the citable name. Set
# QAWAVE_ALLOW_NONAPP=1 to capture a login/blank surface on purpose.
#
# Pitfall guards (all binding, from the worksheet's hard-won list):
#   - ONE session (`--session qawave`); dead input -> `relaunch` (fresh launch, never rebind)
#   - a live daemon keeps the options it was started with, so `launch` closes the session
#     first: a second `open` silently drops --init-script, the SPA bounces to /login and the
#     driver still exits 0 — the "shot of the wrong surface" trap (card 20260922_69 D1)
#   - every capture of agent-browser output goes through `ab` (stderr dropped): the CLI's
#     "⚠ --headed ignored: daemon already running" banner goes to stderr and destroys the
#     jq parse downstream once it lands in a captured string (card 20260922_69 D2)
#   - hit-test (document.elementFromPoint) before EVERY tap; box re-read at tap time
#   - real pointer taps only (mouse move -> down -> up); el.click() is INVALID evidence
#   - real-mouse rot check FIRST after navigation (`rotcheck`); zero events -> fresh session
#   - app shell scrolls main.app-body via `wheel` (mouse wheel), never `agent-browser scroll`
#   - settle >=1s idle before measuring any scroll-top delta (`wheel` sleeps 1.2s)
#   - Escape closes dialogs with >=400ms settle (`esc` sleeps 0.5s)
#   - screenshot path is POSITIONAL (never --path)
#
# Every command is appended to the per-card driver log with its exit status.

set -u

QA_DIR="$(cd "$(dirname "$0")/.." && pwd)/qa"
API="${QAWAVE_API:-http://localhost:3002/api}"
ORIGIN="${QAWAVE_ORIGIN:-http://localhost:7175}"
SESSION="qawave"
VIEWPORT_H=1080
DATE="$(date +%F)"
SHELL_SEL="main.app-body"

CARD="${QAWAVE_CARD:?set QAWAVE_CARD, e.g. 20260922_37}"
SCREEN="${QAWAVE_SCREEN:-page}"
STATE="${QAWAVE_STATE:-default}"
LOG="${QAWAVE_LOG:-$QA_DIR/${DATE}_${CARD}_ui-driver.log}"
TOKEN_JS="$QA_DIR/.qawave-token-${QAWAVE_USER:-anon}.js"
# Each command is its own process, so the path a session was launched at is kept on disk:
# `shot` cites it when the surface in front of the lens is a different (RBAC-redirected) page.
STATE_FILE="$QA_DIR/.qawave-session"
SETTLE_TRIES="${QAWAVE_SETTLE_TRIES:-20}"   # app-surface probes per wait (0.5s apart)
ALLOW_NONAPP="${QAWAVE_ALLOW_NONAPP:-}"     # non-empty => allow capturing a login/blank surface

AB=(agent-browser --session "$SESSION" --headed)
REQ_PATH=""   # path asked for at `launch` (the marker flags a mismatch)
SURFACE=""    # freshest DOM probe, as a JSON object

log() { printf '[%s] %s -> exit %s\n' "$(date +%T)" "$1" "${2:-0}" >>"$LOG"; }

run_logged() {
  local desc="$1"; shift
  "$@"
  local rc=$?
  log "$desc" "$rc"
  return $rc
}

# agent-browser prints "⚠ --headed ignored: daemon already running" on stderr. Any capture
# that lets it through puts a banner line in front of the payload, and the jq call
# downstream dies on it (card 20260922_69 D2), so every consuming call goes through `ab`.
ab() { "${AB[@]}" "$@" 2>/dev/null; }

js() { printf '%s' "$1" | ab eval --stdin; }

is_int() { case "$1" in ''|*[!0-9]*) return 1 ;; *) return 0 ;; esac; }

# Single DOM probe: the app surface + the fields a shot must be able to assert.
# Returns a JSON OBJECT so jq reads it straight (no stringified-JSON round trip).
probe() {
  js "({ pathname: location.pathname,
        loginForm: !!document.querySelector('input[type=password]'),
        appBody: !!document.querySelector('$SHELL_SEL'),
        dialogs: document.querySelectorAll('[role=dialog]').length,
        h1: (document.querySelector('h1')?.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 120),
        headerText: (document.querySelector('header, nav, .app-nav, aside')?.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 160) })"
}

pf() { printf '%s' "$SURFACE" | jq -r "$1" 2>/dev/null; }

# Bounded wait for a settled, logged-in app surface; caches it in $SURFACE.
cmd_await() {
  local i=0 st
  while :; do
    st=$(probe) || { log "await: DOM probe failed" 1; return 1; }
    SURFACE="$st"
    if [ "$(printf '%s' "$st" | jq -r '.appBody' 2>/dev/null)" = "true" ] &&
       [ "$(printf '%s' "$st" | jq -r '.loginForm' 2>/dev/null)" = "false" ]; then
      return 0
    fi
    i=$((i + 1))
    if [ "$i" -ge "$SETTLE_TRIES" ]; then
      log "await: still no logged-in app surface after ${i} probes ($(printf '%s' "$st" | jq -rc . 2>/dev/null))" 1
      return 1
    fi
    sleep 0.5
  done
}

cmd_login() {
  local user="$1" pass="${2:-Abc123}"
  local resp token
  resp=$(curl -sf -X POST "$API/auth/login" -H 'Content-Type: application/json' \
    -d "{\"identifier\":\"$user\",\"password\":\"$pass\"}") || { log "login $user (API)" 1; return 1; }
  token=$(printf '%s' "$resp" | jq -r '.token // empty')
  [ -n "$token" ] || { log "login $user (no token in: $(printf '%s' "$resp" | head -c 200))" 1; return 1; }
  # evaluateOnNewDocument equivalent: agent-browser --init-script registers this
  # BEFORE the first page load, so the SPA auth guard sees the token on mount.
  printf "localStorage.setItem('token', '%s');\n" "$token" >"$TOKEN_JS"
  log "login $user -> token staged at $TOKEN_JS (${#token} chars)" 0
}

cmd_launch() {
  local path="${1:-/}"
  REQ_PATH="$path"
  printf '%s\n' "$path" >"$STATE_FILE"
  # A live daemon keeps the options it was started with: a second `open` carrying
  # --init-script/--headed is silently ignored, the staged token never registers, and the
  # SPA's auth guard bounces to /login while this still exits 0 (card 20260922_69 D1).
  # Always start from a closed session so the token actually lands.
  "${AB[@]}" close >/dev/null 2>&1
  run_logged "launch $ORIGIN$path (init-script $TOKEN_JS)" \
    "${AB[@]}" --init-script "$TOKEN_JS" open "$ORIGIN$path" || return $?
  if cmd_await; then
    log "launch surface: $(pf '{pathname, appBody, loginForm, h1}' | jq -rc . 2>/dev/null) (requested $path)" 0
  else
    log "launch WARNING: requested $path, no logged-in app surface — `shot` will refuse" 0
  fi
}

cmd_relaunch() {
  "${AB[@]}" close >/dev/null 2>&1
  log "relaunch: closed session (daemon options are fixed at start; fresh launch required)" 0
  cmd_launch "${1:-/}"
}

cmd_width() {
  local w="$1"
  run_logged "set viewport ${w}x${VIEWPORT_H}" "${AB[@]}" set viewport "$w" "$VIEWPORT_H"
  sleep 0.4
  log "post-viewport settle 0.4s (re-hit-test required after any viewport change)" 0
}

cmd_quiet() {
  local n i=0
  n=$(ab get count '[role=dialog]' || echo 0)
  while [ "$n" != "0" ] && [ "$i" -lt 3 ]; do
    "${AB[@]}" press Escape >/dev/null 2>&1
    sleep 0.5   # Escape settle >=400ms
    n=$(ab get count '[role=dialog]' || echo 0)
    i=$((i + 1))
  done
  log "quiet: stray [role=dialog] count now $n (escapes issued: $i)" 0
  [ "$n" = "0" ]
}

cmd_hittest() {
  local x="$1" y="$2"
  js "(() => { const el = document.elementFromPoint($x, $y); return el
    ? JSON.stringify({ tag: el.tagName, id: el.id, cls: String(el.className).slice(0, 80), text: (el.textContent || '').trim().slice(0, 60) })
    : 'NULL (outside layout)'; })()"
  log "hittest ($x,$y)" 0
}

cmd_tap() {  # real pointer tap at hit-tested coords: move -> down -> up
  local x="$1" y="$2"
  if ! is_int "$x" || ! is_int "$y"; then
    log "tap: refusing non-numeric coords ('$x','$y')" 1
    return 1
  fi
  cmd_hittest "$x" "$y"
  run_logged "mouse move $x $y" "${AB[@]}" mouse move "$x" "$y"
  sleep 0.1
  run_logged "mouse down" "${AB[@]}" mouse down
  sleep 0.08
  run_logged "mouse up (tap $x,$y)" "${AB[@]}" mouse up
  sleep 0.3
}

cmd_tapref() {  # tap element center; box read fresh as JSON (post-scroll/viewport truth)
  local sel="$1" box x y
  # `get box` without --json prints plain text ("x: 48"), which jq cannot parse at all;
  # with --json the payload is wrapped in .data (card 20260922_69 D2).
  box=$(ab get box "$sel" --json) || { log "tapref $sel: element not found / no box" 1; return 1; }
  x=$(printf '%s' "$box" | jq -r '((.data.x // .x) + (.data.width // .width) / 2) | floor' 2>/dev/null)
  y=$(printf '%s' "$box" | jq -r '((.data.y // .y) + (.data.height // .height) / 2) | floor' 2>/dev/null)
  if ! is_int "$x" || ! is_int "$y"; then
    log "tapref $sel: unparsable box '$(printf '%s' "$box" | tr -d '\n')'" 1
    return 1
  fi
  log "tapref $sel box: x=$x y=$y (raw $(printf '%s' "$box" | tr -d '\n'))" 0
  cmd_tap "$x" "$y"
}

cmd_esc() {
  run_logged "press Escape" "${AB[@]}" press Escape
  sleep 0.5   # >=400ms settle before trusting the post-dialog surface
}

cmd_wheel() {  # scroll main.app-body with REAL mouse wheel; settle >=1s after
  local dy="${1:-600}"
  run_logged "mouse wheel $dy (main.app-body)" "${AB[@]}" mouse wheel "$dy"
  sleep 1.2   # edit-jump phantom trap: settle before any scroll-top measurement
}

cmd_rotcheck() {
  # Real-mouse rot check: capture-phase listeners MUST see real hover events.
  # Zero events = dead input -> cmd_relaunch, NEVER a "dead button" conclusion.
  js 'window.__rot = 0; for (const t of ["mousemove", "mouseover", "pointermove"]) window.addEventListener(t, () => { window.__rot++; }, true); "rot-listeners-installed"'
  local mid_x=720 mid_y=540
  ab mouse move "$mid_x" "$mid_y" >/dev/null 2>&1
  ab mouse move $((mid_x + 40)) $((mid_y + 30)) >/dev/null 2>&1
  sleep 0.3
  local count
  # eval returns a JSON string literal ("5"); unquote it or every value — including "0",
  # the dead-input case this guard exists for — passes the != "0" test below.
  count=$(js 'String(window.__rot || 0)' | jq -r . 2>/dev/null)
  log "rotcheck: capture-phase listeners saw $count real mouse events (0 => DEAD INPUT => relaunch)" 0
  echo "rot events: $count"
  [ -n "$count" ] && [ "$count" != "0" ]
}

cmd_mark() {  # stamp the shot marker inside the crop target; echoes the marker text
  local nn="$1" target="${2:-body}"
  js "(() => {
    const el = document.querySelector('$target') || document.body;
    const r = el.getBoundingClientRect();
    let d = document.getElementById('qawave-marker');
    if (!d) { d = document.createElement('div'); d.id = 'qawave-marker'; document.body.appendChild(d); }
    d.textContent = 'QAWAVE $CARD #$nn  $SCREEN/$STATE  ' + location.pathname + '  ' + new Date().toTimeString().slice(0, 8);
    d.setAttribute('style', 'position:fixed;z-index:2147483647;pointer-events:none;opacity:.94;'
      + 'top:' + Math.max(2, Math.round(r.top) + 6) + 'px;left:' + Math.max(2, Math.round(r.left) + 6) + 'px;'
      + 'padding:3px 8px;border-radius:4px;background:#111;color:#0f0;'
      + 'font:600 12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap');
    return d.textContent;
  })()" | jq -r . 2>/dev/null
}

cmd_markread() {  # read the marker + pathname back after the capture: "<marker>|<pathname>"
  js "(() => { const d = document.getElementById('qawave-marker');
    return d ? d.textContent + '|' + location.pathname : '|'; })()" | jq -r . 2>/dev/null
}

cmd_shot() {  # shot <NN> full|crop|page [selector] — worksheet naming, positional path
  local nn="$1" kind="${2:-full}" sel="${3:-}" path suffix="" target="" how=""
  case "$kind" in
    full) target="$SHELL_SEL"; suffix="-full"; how="shell[$SHELL_SEL]" ;;
    crop) target="$sel"; how="${sel:+crop[$sel]}"; how="${how:-crop(viewport)}" ;;
    page) suffix="-full"; how="page(--full)" ;;
    *) log "shot: unknown kind '$kind' (full|crop|page)" 1; return 1 ;;
  esac
  path="$QA_DIR/${DATE}_${CARD}_${SCREEN}_${STATE}_ui-${nn}${suffix}.png"

  cmd_await || true   # settle first: never shoot a loading screen
  REQ_PATH=$(cat "$STATE_FILE" 2>/dev/null || true)
  local app_body login_form dialogs mv_path mv_h1 marker refused=""
  app_body=$(pf '.appBody')
  login_form=$(pf '.loginForm')
  dialogs=$(pf '.dialogs // 0')
  mv_path=$(pf '.pathname // "?"')
  mv_h1=$(pf 'if (.h1 // "") != "" then .h1 else (.headerText // "") end')
  [ -n "$mv_h1" ] || mv_h1="(no h1 text)"
  [ -z "$REQ_PATH" ] || [ "$mv_path" = "$REQ_PATH" ] || mv_h1="$mv_h1 (launched $REQ_PATH)"

  # A shot is citable only when the page in front of the lens is the logged-in app
  # surface it claims to be. Otherwise the artefact is parked under *_refused.png and
  # the driver exits non-zero: a wrong-surface capture can never reach a report again.
  if [ "$app_body" != "true" ] || [ "$login_form" = "true" ]; then
    if [ -n "$ALLOW_NONAPP" ]; then
      log "shot $nn WARNING: non-app surface (appBody=$app_body loginForm=$login_form) allowed by QAWAVE_ALLOW_NONAPP" 0
    else
      refused="${path%.png}_refused.png"
      log "shot $nn REFUSED: not a logged-in app surface (pathname=$mv_path appBody=$app_body loginForm=$login_form) — writing ${refused##*/} instead of ${path##*/}; set QAWAVE_ALLOW_NONAPP=1 to capture on purpose" 1
    fi
  fi
  [ "$kind" = "full" ] && [ "$app_body" != "true" ] && { target=""; how="page(--full, no $SHELL_SEL)"; }
  [ "$dialogs" = "0" ] || log "shot $nn note: $dialogs [role=dialog] open — an overlay outside $SHELL_SEL is not in the crop (use 'crop [role=dialog]')" 0

  local out="${refused:-$path}"
  local -a cap=(screenshot)
  [ "$kind" = "page" ] && cap+=(--full)
  [ -n "$target" ] && cap+=("$target")
  cap+=("$out")

  marker=$(cmd_mark "$nn" "${target:-body}") || true
  if [ -z "$marker" ]; then
    log "shot $nn REFUSED: could not stamp the DOM marker (no page to attribute the shot to)" 1
    return 1
  fi
  run_logged "screenshot $how $out [marker: $mv_path | $mv_h1]" ab "${cap[@]}" || return $?
  local back; back=$(cmd_markread)
  if [ "${back%%|*}" != "$marker" ]; then
    if [ -z "$refused" ]; then mv "$out" "${out%.png}_refused.png"; out="${out%.png}_refused.png"; fi
    log "shot $nn REFUSED: marker changed during the capture (stamped '$marker', read back '${back%%|*}') — artefact ${out##*/}" 1
    return 1
  fi
  [ -z "$refused" ] || return 1
  echo "$out"
}

cmd_measure() {  # measure <sel>... — px geometry for the _38 bar contracts
  local sel sels_json="[]"
  for sel in "$@"; do
    sels_json=$(printf '%s' "$sels_json" | jq --arg s "$sel" '. + [$s]')
  done
  js "(() => { const sels = $sels_json; return JSON.stringify(sels.map((s) => {
    const el = document.querySelector(s);
    if (!el) return { sel: s, missing: true };
    const r = el.getBoundingClientRect();
    return { sel: s, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
             right: Math.round(r.right), offsetWidth: el.offsetWidth };
  }), null, 1); })()"
  log "measure $*" 0
}

cmd_authcheck() {  # DOM assertion: logged-in chrome present (never "by hope")
  local st; st=$(probe) || { log "authcheck: DOM probe failed" 1; return 1; }
  SURFACE="$st"
  printf '%s\n' "$st"
  log "authcheck (DOM assertion): $(printf '%s' "$st" | jq -rc . 2>/dev/null)" 0
}

case "${1:-help}" in
  login)     shift; cmd_login "$@" ;;
  launch)    shift; cmd_launch "$@" ;;
  relaunch)  shift; cmd_relaunch "$@" ;;
  width)     shift; cmd_width "$@" ;;
  quiet)     cmd_quiet ;;
  hittest)   shift; cmd_hittest "$@" ;;
  tap)       shift; cmd_tap "$@" ;;
  tapref)    shift; cmd_tapref "$@" ;;
  esc)       cmd_esc ;;
  wheel)     shift; cmd_wheel "$@" ;;
  rotcheck)  cmd_rotcheck ;;
  shot)      shift; cmd_shot "$@" ;;
  measure)   shift; cmd_measure "$@" ;;
  authcheck) cmd_authcheck ;;
  *)
    awk 'NR > 1 { if (!/^#/) exit; sub(/^# ?/, ""); print }' "$0"
    ;;
esac
