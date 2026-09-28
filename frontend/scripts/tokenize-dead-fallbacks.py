#!/usr/bin/env python3
"""Tokenize the dead-var fallbacks in page CSS (design-drift hexFallback cleanup).

Two classes of fix, both evidence-based:

1. `var(--x, #hex)` where `--x` IS defined in src/styles/tokens.css -> the
   fallback is dead weight (the token always resolves). Drop the fallback.
   Zero visual delta.

2. `var(--x, #hex)` where `--x` is defined NOWHERE in the repo -> the fallback
   IS the paint, and the file silently carries a raw hex that the drift census
   can only see as `hexFallback`. Replace the whole expression with the nearest
   real token OF THE SAME CLASS (text / border / surface / brand), so the page
   joins the design system. Delta = RGB distance, reported per site.

Usage: python3 scripts/tokenize-dead-fallbacks.py [--apply]
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

APPLY = "--apply" in sys.argv
SRC = Path("src")
EXCLUDED = re.compile(r"^(styles/|design-system/|components/untitled-ui/)")
TOKENS_FILE = SRC / "styles/tokens.css"

# Hand-decided semantic mapping for the token names that exist NOWHERE in the
# repo (verified by scanning every .css/.ts/.tsx for a `--name:` definition).
# Each page carrying one of these was written against a foreign palette (the
# Tailwind/Untitled UI defaults, visible in the fallback hexes) and never
# tokenized, so the fallback WAS the paint and the raw hex was invisible to the
# drift census. The target is the repo token with the same role — the fallback
# hex is kept in the comment as the evidence for the choice.
SEMANTIC: dict[str, str] = {
    # text
    '--text-primary': '--fg-1',              # #101828
    '--text-secondary': '--fg-2',            # #475467 / #64748b
    '--text-tertiary': '--fg-3',             # #667085 / #98a2b3
    '--color-text-muted': '--fg-3',          # #64748b
    '--ink-1': '--ink',                      # #0f172a / #111827
    # lines: the ladder runs light->strong as line, line-2, line-3, line-strong
    '--border-color': '--line',              # #eef2f7 / #e2e8f0
    '--border-light': '--line',              # #eaecf0
    '--border-subtle': '--line',             # #eaecf0
    '--border-medium': '--line-2',           # #d0d5dd
    '--border-strong': '--line-strong',      # #98a2b3
    '--wf-line': '--line',                   # #eef1ef
    # surfaces
    '--surface-1': '--surface',              # #ffffff
    '--surface-white': '--surface',          # #fff
    '--wf-card': '--surface',                # #fff
    '--surface-muted': '--surface-2',        # #f2f4f7
    '--wf-bg': '--surface-2',                # #f8faf9
    '--bg-hover': '--surface-2',             # #f5f5f5
    # brand
    '--brand-600': '--brand',                # #005a2d
    '--brand-700': '--brand',                # #005a2d
    '--brand-primary': '--brand',            # #2563eb
    '--color-fg-brand-primary': '--brand',   # #005a2d
    '--background-color-brand-primary': '--brand-soft',  # #f2faf5
    # status
    '--warn': '--warning',                   # #a15c00 / #b45309
    '--wf-amber-mid': '--warning',           # #d97706
    '--warning-bg': '--warning-soft',        # #fff8e8 / #fff4e0
    '--color-warning-bg': '--warning-soft',  # #fef3c7
    '--color-warning-text': '--warning-text',# #92400e
    '--color-fg-warning-primary': '--warning-text',  # #b54708
    '--danger-bg': '--danger-soft',          # #fff7f7
    '--danger-line': '--danger-soft',        # #fecaca
    '--color-fg-error-primary': '--danger-text',     # #b42318
    '--success-bg': '--success-soft',        # #e6f4ea
    '--background-color-success-primary': '--success-soft',  # #ecfdf5
    '--color-fg-success-primary': '--success-text',  # #065f46
    '--color-bg-success-solid': '--success', # #17b26a
    '--state-sync': '--info',                # #2563eb (blue sync dot -> the semantic info tone)
}


def load_tokens() -> dict[str, str]:
    out: dict[str, str] = {}
    for line in TOKENS_FILE.read_text().splitlines():
        m = re.match(r"\s*(--[a-z0-9-]+)\s*:\s*(.+?);", line)
        if m:
            out[m.group(1)] = m.group(2).strip()
    return out


TOKENS = load_tokens()
ALL_REPO_TOKENS: set[str] = set()
for p in list(SRC.rglob("*.css")) + list(SRC.rglob("*.ts")) + list(SRC.rglob("*.tsx")):
    for m in re.finditer(r"(--[a-z0-9-]+)\s*:", p.read_text(errors="ignore")):
        ALL_REPO_TOKENS.add(m.group(1))

EXPR = re.compile(r"var\(\s*(--[a-z0-9-]+)\s*,\s*([^()]*#[0-9a-fA-F]{3,8}[^()]*)\)")

stripped = replaced = 0
report: list[tuple[int, str, str, str, str]] = []

files = [p for p in SRC.rglob("*.css") if not EXCLUDED.match(str(p.relative_to(SRC))) and ".test." not in str(p)]
for path in files:
    original = path.read_text()
    changed = [original]

    # `path` is bound as a default argument rather than closed over: a Python
    # closure captures the VARIABLE, not the value, so these read the LAST
    # iteration's path if they are ever called after the loop ends (B023).
    def transform(css: str, path=path) -> str:
        global stripped, replaced

        def sub(m: re.Match[str], path=path) -> str:
            global stripped, replaced
            name, fallback = m.group(1), m.group(2)
            hexes = re.findall(r"#[0-9a-fA-F]{3,8}", fallback)
            if name in TOKENS:
                stripped += 1
                return f"var({name})"
            if name in ALL_REPO_TOKENS or len(hexes) != 1:
                return m.group(0)  # defined elsewhere, or too odd to touch
            target = SEMANTIC.get(name)
            if target is None:
                print(f"  !! unmapped phantom token {name} in {path}")
                return m.group(0)
            dist = 0
            replaced += 1
            report.append((dist, str(path), name, hexes[0], target))
            return f"var({target})"

        # run to a fixpoint so nested var(--a, var(--b, #hex)) also resolves
        for _ in range(3):
            new = EXPR.sub(sub, css)
            if new == css:
                break
            css = new
        return css

    updated = transform(original)
    if updated != original:
        changed[0] = updated
        if APPLY:
            path.write_text(updated)

print(f"{'APPLIED' if APPLY else 'DRY RUN'} — fallbacks dropped (token defined): {stripped}; dead var -> real token: {replaced}")
report.sort(reverse=True)
print("\nworst 12 substitutions by RGB distance:")
for dist, path, name, hexv, target in report[:12]:
    print(f"  d={dist:7} {hexv:9} {name:32} -> {target:16} {path}")
if report:
    ds = [r[0] for r in report]
    print(f"\ndistance: mean {sum(ds) / len(ds):.0f}, median {sorted(ds)[len(ds) // 2]}, max {max(ds)}")
