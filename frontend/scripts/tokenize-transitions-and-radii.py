#!/usr/bin/env python3
"""Two mechanical drift cleanups the ratchet sanctions ("cleaning up is free").

1. untokenizedTransition -> the `--t-*` duration tokens that already exist in
   src/styles/tokens.css (--t-fast 120ms, --t-normal 180ms, --t-slow 240ms,
   --t-spring 300ms, all carrying var(--ease)/var(--ease-spring)). A duration is
   mapped to the nearest token when the declared easing is a plain keyword
   (`ease`, `ease-in`, `ease-out`, `ease-in-out`); `linear` is preserved after
   the token. A transition that already uses `var(--t-` is left alone, and any
   duration outside the table is left alone.

2. radiusOffLadder -> the nearest value on the sanctioned ladder in
   docs/design-system/01-tokens.md (0,2,4,6,8,10,12,14,16,18,20,24,999), ties
   rounded up. Values already on the ladder and percentage/full forms are
   untouched.

Usage: python3 scripts/tokenize-transitions-and-radii.py [--apply]
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

APPLY = "--apply" in sys.argv
SRC = Path("src")
EXCLUDED = re.compile(r"^(styles/|design-system/|components/untitled-ui/)")

LADDER = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 999]
DURATIONS = {
    120: "--t-fast", 0.12: "--t-fast", 0.15: "--t-fast",
    160: "--t-normal", 180: "--t-normal", 0.18: "--t-normal", 200: "--t-normal", 0.2: "--t-normal",
    240: "--t-slow", 0.24: "--t-slow", 250: "--t-slow", 300: "--t-slow", 0.3: "--t-slow",
}
EASINGS = {"ease", "ease-in", "ease-out", "ease-in-out"}

TRANSITION_PART = re.compile(
    r"(?P<prop>[a-z-]+)\s+(?P<dur>\d+(?:\.\d+)?)(?P<unit>ms|s)\s+(?P<ease>[a-z-]+)(?![a-z(])",
    re.I,
)
RADIUS_DECL = re.compile(r"(border(?:-[a-z]+)*-radius\s*:\s*)([^;{}]+)(;)", re.I)
PX = re.compile(r"(\d+(?:\.\d+)?)px")


def nearest_radius(value: float) -> int:
    best = min(LADDER, key=lambda c: (abs(c - value), -c))
    return best


transitions = radii = 0
transition_report: list[str] = []
radius_report: list[str] = []


def fix_transitions(value: str, path: str) -> str:
    global transitions

    def sub(m: re.Match[str]) -> str:
        global transitions
        dur = float(m.group("dur")) if m.group("unit").lower() == "ms" else float(m.group("dur")) * 1000
        token = DURATIONS.get(dur)
        ease = m.group("ease").lower()
        if token is None or ease not in EASINGS:
            return m.group(0)
        transitions += 1
        transition_report.append(f"{m.group('prop')} {m.group('dur')}{m.group('unit')} {ease} -> {token}  ({path})")
        return f"{m.group('prop')} var({token})"

    return TRANSITION_PART.sub(sub, value)


def fix_radius(value: str, path: str) -> str:
    global radii

    def sub(m: re.Match[str]) -> str:
        global radii
        n = float(m.group(1))
        if n in LADDER:
            return m.group(0)
        snapped = nearest_radius(n)
        radii += 1
        radius_report.append(f"{n}px -> {snapped}px  ({path})")
        return f"{snapped}px"

    return PX.sub(sub, value)


files = [p for p in SRC.rglob("*.css") if not EXCLUDED.match(str(p.relative_to(SRC))) and ".test." not in str(p)]
for path in files:
    original = path.read_text()
    rel = str(path)
    out_lines = []
    for line in original.splitlines(keepends=True):
        line = fix_transitions(line, rel)
        # `rel` is bound as a default argument rather than closed over: a Python
        # closure captures the VARIABLE, so a lambda built in a loop reads the
        # LAST iteration's value if it is ever called after the loop (B023).
        line = RADIUS_DECL.sub(lambda m, r=rel: m.group(1) + fix_radius(m.group(2), r) + m.group(3), line)
        out_lines.append(line)
    updated = "".join(out_lines)
    if updated != original and APPLY:
        path.write_text(updated)

print(f"{'APPLIED' if APPLY else 'DRY RUN'} — transitions tokenized: {transitions}; radii snapped: {radii}")
print("\ntransitions (first 10):")
for row in transition_report[:10]:
    print("  " + row)
print("\nradii (first 10):")
for row in radius_report[:10]:
    print("  " + row)
