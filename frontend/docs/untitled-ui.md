# Untitled UI React

This frontend keeps retrieved Untitled UI source under
`src/components/untitled-ui/`. The checked-in `components.json` pins the
component library to version 8, while the package scripts pin the CLI version
used to retrieve it.

## PRO authentication

Authenticate once from the frontend directory:

```sh
pnpm uui:login
```

The browser login is stored in the developer's local Untitled UI CLI
configuration. Never pass a license key on the command line, put one in an
environment file, or commit authentication material to this repository.

The MCP takes the key as a `key` argument instead. Both are valid; the same
rule applies — authentication material must not land in this repository.

## Discovery via the Untitled UI MCP (preferred)

**The MCP is the discovery path. The pinned CLI is the install path.** They
compose: `get_component` and `get_component_bundle` return the *exact CLI install
command* as their payload, so the MCP answers "what exists and how do I get it"
and the already-pinned scripts perform the write.

Use this first. The CLI's own `uui:search` is rate-limited (HTTP 429) and the
browser fallback below is slower still — neither is the normal route.

1. **Check what is already vendored** — read `src/components/untitled-ui/installed.json`.
   It lists every vendored file. A path listed there is **locally adapted**: edit it,
   do **not** re-run `add` over it (see the overwrite-prompt failure mode below).
2. **Search the catalog** — `mcp__untitledui__search_components` with a natural-language
   description, `version: 8`, and optionally `category_filter` (`base`, `application`,
   `marketing`, `foundations`, `shared-assets`, `examples`). It ranks semantically, so
   describe the need ("compact table with inline edit actions"), not the slug.
3. **For a whole page shape** — `mcp__untitledui__get_page_templates` (`page_type`:
   `dashboard` | `marketing` | `application` | `all`; `category` such as `dashboards`,
   `settings`, `login`, `pricing-pages`), then `get_page_template_files` for the command.
4. **Get the install command** — `mcp__untitledui__get_component` for one, or
   `mcp__untitledui__get_component_bundle` for several at once. Run the returned
   `pnpm uui:add:*` command from `frontend/`.
5. **Icons** — `mcp__untitledui__search_icons` returns exact `@untitledui/icons`
   PascalCase names. Use it rather than guessing an import name. Prefer
   `@untitledui/icons` over `lucide-react` in new Untitled-UI-family code so the
   vendored components stay internally consistent; `lucide-react` remains correct
   for the existing files that already use it.

Without an API key only free components are returned. A PRO component requested
without access returns `agent_instructions` — follow them, do not rebuild the
component from scratch.

## Search and add components

Search the version-8 catalog before adding source:

```sh
pnpm uui:search "compact table edit action" --type components --limit 5
```

Add a selected component through the script matching its official category:

```sh
pnpm uui:add:base button-utility
pnpm uui:add:application table
pnpm uui:add:foundations dot-icon
```

The scripts keep the library version and destination root stable. The CLI
creates the official category folders below `src/components/untitled-ui/`.
Inspect `git status`, the returned dependency list, and every generated file
before importing it.

Do not run `init` in this established application. Do not add `--overwrite`
until the existing local component and all of its consumers have been
reviewed. Avoid `example --yes`: for examples, that flag can include every
component and overwrite existing source.

## Known CLI failure modes (verified 2026-08-15)

- **`--path` is relative to the project's `src/`.** The CLI prepends `src/`
  itself, so `--path src/components/untitled-ui` silently produces
  `src/src/components/untitled-ui`. Always pass
  `--path components/untitled-ui`.
- **The dependency step shells out to `npm install`** and fails in this pnpm
  workspace with `EUNSUPPORTEDPROTOCOL workspace:*`. The component files land
  before this failure, so treat it as benign: after any `add`, install the
  reported dependencies with `pnpm add` in `frontend/` if any are missing.
- **When a dependency component already exists locally, the CLI prompts
  "Do you want to overwrite the existing files?" even with `--yes`.** Answer
  `n` (piped as `printf 'n\n' |`) to preserve local modifications; the install
  then completes normally. In non-interactive agent runs, pipe the answer
  explicitly.
- **Running `add` from the repo root without `--dir frontend`** writes to the
  root `package.json`/`package-lock.json` and `components/` instead of
  `frontend/`. Always run from `frontend/` or pass `--dir`.
- **Search is rate-limited (HTTP 429)** on the shared anonymous index. When
  `uui:search` fails (429 or an HTML-error-page JSON parse failure), go back to
  `mcp__untitledui__search_components` — that is the preferred discovery path and
  it is not subject to this limit. Only if the MCP is unavailable, use the public
  website as the last-resort fallback — see
  [Website discovery fallback](#website-discovery-fallback) below.

## Website discovery fallback (verified 2026-08-15)

When the CLI search is rate-limited, discover components from the public docs
site (no sign-in, no rate limit) and install with the reliable `add` command.

```sh
agent-browser open https://www.untitledui.com/react/components
agent-browser snapshot -i -u -c          # sidebar lists every component + URL
```

- The left sidebar enumerates **Base components**, **Application UI
  components**, and more, each as `link "Name" [url=.../components/<slug>]`.
- The **Search** button in the docs header opens a command menu that filters
  by name (fill the textbox, pick an option) — closest replacement for
  `uui:search`.
- Derive the CLI slug from the page URL's last segment (e.g.
  `/react/components/alerts` → `alerts`). Docs use plural page names; the CLI
  accepts plural slugs (`alerts` ✔, singular `alert` → "No components found").
- Confirm the category from the sidebar grouping (base vs application) and
  install with the matching script:
  `printf 'n\n' | pnpm uui:add:application alerts`.
- Close the browser when done: `agent-browser close`.

Verified end to end: website search "modal" → Modals page; sidebar slug
`alerts` → `uui:add:application alerts` installed `application/alerts/alerts.tsx`
with `tsc -b` clean.

## Local integration

- `src/styles/theme.css` and `src/styles/globals.css` are the canonical
  Untitled-compatible theme and Tailwind integration.
- `src/styles/theme.css` is upstream-derived **and hand-edited** — the brand
  re-colouring (`--color-brand-600: #005A2D`, `--color-brand-500: #4A9E7D`) is
  ours, not Untitled's. Never regenerate it wholesale: re-fetch the upstream
  theme and re-apply the brand diff. `pnpm check:brand` fails if the re-colouring
  or the `components.json` library version is lost, so a silent revert to the
  stock palette cannot land.
- `src/components/untitled-ui/installed.json` lists every vendored file.
  It is derived from the filesystem and enforced by
  `src/tests/structure.guard.test.ts` — add or remove a vendored file and the
  suite fails until the manifest is regenerated in the same commit.
- `@/*` resolves to `src/*` through both TypeScript and Vite.
- Installed source and the repository's current React Aria/TypeScript versions
  are authoritative. Adapt a retrieved component when upstream types have
  moved, and verify the adapted public behavior with focused tests.
- Prefer composition in feature code. Edit a shared Untitled primitive only
  when the behavior should change for every consumer.
