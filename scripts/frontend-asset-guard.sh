# Post-cutover stale-asset guard — runs INSIDE the frontend nginx container.
# Piped in by the Makefile deploy targets:
#   ssh root@<server> "... docker exec -i <frontend> sh" < scripts/frontend-asset-guard.sh
#
# Lesson from the 2026-09-12 04:43 incident: a browser holding a stale
# index.html used to be able to load old hashed CSS that the server still had
# on disk, so users silently ran the previous build after a staging/prod cut.
# Assets are now baked into the frontend image (nothing accumulates
# server-side between cuts) and index.html is served no-cache — this guard is
# the enforcement half: the cut FAILS if the running container's index.html
# references any asset file it does not actually have, so no stale-hashed CSS
# can ever be served again.
#
# Fail-closed: if index.html carries no asset refs at all (unexpected build
# shape), the guard fails rather than passing vacuously.

# HTML_ROOT lets this run outside the container (tests); the deploy targets pipe
# it in and get the real nginx root.
cd "${HTML_ROOT:-/usr/share/nginx/html}" || { echo "asset guard: html root missing" >&2; exit 1; }

refs=$(grep -oE 'assets/[A-Za-z0-9._/-]+\.(css|js|mjs|woff2?|png|jpe?g|svg|webp|avif)' index.html || true)
if [ -z "$refs" ]; then
  echo "asset guard: no hashed asset refs found in index.html — unexpected build shape, refusing to pass" >&2
  exit 1
fi

status=0
for ref in $(echo "$refs" | sort -u); do
  if [ ! -f "$ref" ]; then
    echo "STALE ASSET REF: $ref" >&2
    status=1
  fi
done

if [ "$status" -ne 0 ]; then
  echo "asset guard: index.html references assets missing from the running container — a stale build would be served" >&2
  exit 1
fi

# Empty-state illustrations are loaded at runtime, so index.html never mentions
# them — the guard above cannot see them. Lesson from the 2026-09-27 incident:
# four illustration webp files shipped mode 0600 (the rest 0644) and every
# request 403'd, so the driver fuel/cost empty states silently rendered
# text-only while the code was correct. This script runs as root inside the
# container, where a readability test would pass anyway, so assert the MODE:
# nginx runs as its own user and only needs the other-read bit.
# GNU stat first (the container), BSD `stat -f` second so the guard can be run
# off-container (tests) without lying about the mode.
file_mode() {
  stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1" 2>/dev/null
}

if [ -d assets/illustrations ]; then
  art=0
  art_bad=0
  for file in assets/illustrations/*; do
    [ -e "$file" ] || continue
    art=$((art + 1))
    mode=$(file_mode "$file") || { echo "ILLUSTRATION UNREADABLE (stat failed): $file" >&2; status=1; art_bad=$((art_bad + 1)); continue; }
    # The other-read bit is the last octal digit being 4-7; nginx is not the
    # owner, so only that bit makes the file servable.
    case "$mode" in
      *[4567]) ;;
      *) echo "ILLUSTRATION NOT WORLD-READABLE (mode $mode): $file — nginx will 403 it and the empty state will render text-only" >&2; status=1; art_bad=$((art_bad + 1)) ;;
    esac
  done
  if [ "$art" -eq 0 ]; then
    echo "illustration guard: assets/illustrations is empty — unexpected build shape, refusing to pass" >&2
    status=1
  elif [ "$art_bad" -eq 0 ]; then
    echo "illustration guard OK: $art illustration(s) world-readable"
  fi
else
  echo "illustration guard: assets/illustrations missing — unexpected build shape, refusing to pass" >&2
  status=1
fi

if [ "$status" -ne 0 ]; then
  echo "asset guard: the running container cannot serve every asset — the cut must not proceed" >&2
  exit 1
fi

echo "asset guard OK: every hashed asset referenced by index.html exists and every illustration is readable"
