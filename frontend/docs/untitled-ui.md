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
  `uui:search` fails (429 or an HTML-error-page JSON parse failure), use the
  public website as the discovery fallback — see
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
- `@/*` resolves to `src/*` through both TypeScript and Vite.
- Installed source and the repository's current React Aria/TypeScript versions
  are authoritative. Adapt a retrieved component when upstream types have
  moved, and verify the adapted public behavior with focused tests.
- Prefer composition in feature code. Edit a shared Untitled primitive only
  when the behavior should change for every consumer.
