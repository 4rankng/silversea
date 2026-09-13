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

cd /usr/share/nginx/html || { echo "asset guard: html root missing" >&2; exit 1; }

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

echo "asset guard OK: every hashed asset referenced by index.html exists"
