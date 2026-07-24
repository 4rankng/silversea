---
phase: 3
title: "Component mapping & spike"
status: completed
priority: P2
effort: 4h
dependencies: [2]
---

# Phase 3: Component mapping & spike

## Overview

For each of the ≤6 signed-off targets, fetch the actual Tailkit code (`get_component_code`), port it into a **spike directory** outside the production tree, and prove the retokenization works against NEPO tokens. Output is a working spike + a per-target porting note. Still no production changes.

## Requirements

- **Functional:** a `spike/` directory under the plan folder with one retokenized demo per target, runnable in isolation (plain HTML or a scratch Vite page).
- **Non-functional:** each spike must visually match the Tailkit reference *and* use only NEPO `var(--*)` tokens — zero `bg-gray-*`, `text-slate-*`, `dark:` classes.

## Architecture

```
plans/260719-frontend-polish-tailkit/
├── spike/
│   ├── T1-empty-states/        # retokenized HTML demo
│   ├── T3-toast-variants/
│   └── ...
└── porting-notes.md            # per-target: what changed, what to watch
```

Spikes are HTML files that import NEPO `tokens.css` directly, so the retokenization is provable without touching the React app.

## Related Code Files

- Read: `frontend/src/styles/tokens.css` (token names — the retokenization source of truth).
- Read: each Tailkit snippet returned by `get_component_code`.
- Create: `plans/260719-frontend-polish-tailkit/spike/*.html`
- Create: `plans/260719-frontend-polish-tailkit/porting-notes.md`

## Implementation Steps

1. **Fetch source.** For each target, call `mcp__tailkit__get_component_code` with `tech: "html"` (easiest to retokenize without React boilerplate). Save raw output into `spike/<id>-raw.html` for diff reference.

2. **Build a token-translation table** in `porting-notes.md`:
   ```
   Tailkit class          → NEPO token
   -----------------------------------
   bg-white               → background: var(--surface)
   bg-gray-50             → background: var(--surface-2)
   bg-gray-100            → background: var(--surface-3)
   text-gray-900          → color: var(--ink)
   text-gray-500          → color: var(--ink-3)
   border-gray-200        → border-color: var(--line)
   shadow-sm              → box-shadow: var(--sh-sm)
   rounded-lg             → border-radius: var(--r)
   ...
   ```
   This table is reused in Phase 4 — write it once, refer forever.

3. **Retokenize each spike.** Produce `spike/<id>.html` using the translation table. Load `tokens.css` via `<link>` so the same `var(--*)` resolves.

4. **Screenshot-in-words check.** Open each spike in a browser (or have the user open it). Confirm: (a) it looks like the Tailkit reference, (b) it uses NEPO colors, (c) it is responsive across 420/640/1023/1100px.

5. **Record gotchas per target** in `porting-notes.md`:
   - Tailwind v3 classes that don't exist in v4 (e.g. some `ring-offset-*`, deprecated `space-y-reverse`).
   - daisyUI class collisions (`btn`, `input`, `badge` — must be renamed or scoped).
   - Any icon set mismatch (Tailkit often uses Heroicons; NEPO uses `lucide-react` — swap names).
   - Animation/transition tokens — map to `--t-fast`, `--ease`, etc.

6. **Decide go/no-go per target.** If a target turns out to be too expensive to retokenize cleanly (e.g. heavy `dark:` theming), drop it and document why. Update `targets.md`.

## Success Criteria

- [ ] `spike/` contains one retokenized HTML demo per surviving target.
- [ ] `porting-notes.md` has the shared token-translation table + per-target gotchas.
- [ ] Zero `bg-gray-*`, `text-slate-*`, `dark:` classes survive in any spike file (grep-verified).
- [ ] Surviving targets list finalized; dropped targets recorded with reason.

## Risk Assessment

- **Risk:** Tailkit HTML uses Tailwind utility classes that need the full Tailwind runtime, but spikes load only `tokens.css`. *Mitigation:* rewrite utilities as plain CSS using NEPO tokens in the spike — this is exactly what Phase 4 will do anyway, so the spike doubles as the porting template.
- **Risk:** icon library mismatch makes the spike look broken. *Mitigation:* swap Heroicons → lucide-react names in the porting note; spike uses inline SVG placeholders.
- **Risk:** a target that looked cheap in Phase 2 turns out to need a new dependency. *Mitigation:* drop it; the plan's default is zero new deps.
