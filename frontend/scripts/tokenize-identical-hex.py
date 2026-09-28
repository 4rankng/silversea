#!/usr/bin/env python3
"""Replace raw hex that is provably identical to a design-system token value.

Only exact value matches are touched, so the rendered colour cannot change: the
census counts a raw hex and a `var()` differently, nothing else does. The token
is chosen by the property the hex sits in (a `color:` gets the foreground token,
a `background:`/`border:` gets the surface token) so the name stays honest.

Values that only exist as Untitled UI compatibility tokens
(`--color-base-200` etc.) or as raw palette entries are deliberately left: the
page would gain a token name it should not be coupled to.

Usage: python3 scripts/tokenize-identical-hex.py [--apply]
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

APPLY = "--apply" in sys.argv
SRC = Path("src")
EXCLUDED = re.compile(r"^(styles/|design-system/|components/untitled-ui/)")

# value -> (foreground token, surface token). Both resolve to the same colour.
BY_VALUE: dict[str, tuple[str | None, str]] = {
    "#FFFFFF": ("--fg-inverse", "--surface"),
    "#005A2D": (None, "--brand"),
    "#4A9E7D": (None, "--accent"),
    "#2D6B54": (None, "--accent-2"),
}
HEX = re.compile(r"#[0-9a-fA-F]{3,6}\b")
DECL = re.compile(r"([a-z-]+)\s*:\s*([^;{}]+);", re.I)

replaced = 0
report: list[str] = []


def pick(prop: str, value: str) -> str | None:
    fg, surface = value
    if prop == "color":
        return fg or surface
    return surface


files = [p for p in SRC.rglob("*.css") if not EXCLUDED.match(str(p.relative_to(SRC))) and ".test." not in str(p)]
for path in files:
    original = path.read_text()

    def sub_decl(m: re.Match[str]) -> str:
        global replaced
        prop, value = m.group(1).lower(), m.group(2)
        if "var(" in value:
            return m.group(0)

        def sub_hex(h: re.Match[str]) -> str:
            global replaced
            raw = h.group(0).upper()
            key = "#" + "".join(c * 2 for c in raw[1:]) if len(raw) == 4 else raw
            if key not in BY_VALUE:
                return h.group(0)
            token = pick(prop, BY_VALUE[key])
            if token is None:
                return h.group(0)
            replaced += 1
            report.append(f"{prop}: {h.group(0)} -> var({token})  ({path})")
            return f"var({token})"

        return f"{m.group(1)}: {HEX.sub(sub_hex, value)};"

    updated = DECL.sub(sub_decl, original)
    if updated != original and APPLY:
        path.write_text(updated)

print(f"{'APPLIED' if APPLY else 'DRY RUN'} — hex declarations tokenized: {replaced}")
for row in report[:12]:
    print("  " + row)
