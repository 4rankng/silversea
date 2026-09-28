#!/usr/bin/env python3
"""Class-A dead-code cut (evidence: agent://DeadCodeReport, re-verified by grep).

Frontend:
  - hooks/animations/usePressAnimation.ts      (whole file, not in the barrel)
  - features/dispatch/components/ReassignDialog.tsx (whole file; live sibling is
    features/dispatch/detailed-plan/TripReassignDialog.tsx)
  - features/dispatch/components/FleetGrid.tsx (whole file, no importer)
  - pages/debt-detail-ledger.tsx               (groupLedgerRows + LedgerRouteCard
    and every helper that becomes orphaned once they go)
Backend:
  - commission.service.ts   recordCommissionIdempotent
  - financial.service.ts    recordDriverPayoutIdempotent
  - forwarder.service.ts    deleteTripExpense (the ...InTx / ...Guarded variants
    are the live ones)

Pins that name the deleted files are removed with them (they were text readers,
not consumers). Usage: python3 scripts/dead-code-cut.py [--apply]
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

APPLY = "--apply" in sys.argv
ROOT = Path("..").resolve()
FE = ROOT / "frontend"
BE = ROOT / "backend"

REMOVED_FILES = [
    FE / "src/hooks/animations/usePressAnimation.ts",
    FE / "src/features/dispatch/components/ReassignDialog.tsx",
    FE / "src/features/dispatch/components/FleetGrid.tsx",
]


def cut_span(text: str, start: int) -> tuple[int, int]:
    """Cut a top-level declaration from `start` to the line before the next one.

    Brace matching is not safe here: a return type like
    `): { debit: number; credit: number } {` makes the first `{` after the
    parameter list a *type*, not the body, and the cut then leaves an orphaned
    body behind. Every top-level statement in these files is a declaration, so
    "up to the next declaration" is exact — and any comment block immediately
    preceding the next declaration is preserved.
    """
    nxt = DECL.search(text, start + 1)
    end = nxt.start() if nxt else len(text)
    region = text[start:end]
    lines = region.splitlines(keepends=True)
    keep = 0
    for line in reversed(lines):
        stripped = line.strip()
        if stripped == '' or stripped.startswith('//') or stripped.startswith('*') or stripped.startswith('/*'):
            keep += 1
        else:
            break
    cut_end = end - sum(len(line) for line in lines[len(lines) - keep:]) if keep else end
    return start, cut_end


DECL = re.compile(r"^(?:export )?(?:function|const|type|interface) ([A-Za-z_$][\w$]*)", re.M)

EXTERNAL_USE: dict[str, set[str]] = {}


def external_users(name: str, own: Path) -> set[str]:
    """Files other than `own` that mention `name` — an exported symbol may only
    be deleted when this is empty."""
    if name not in EXTERNAL_USE:
        hits: set[str] = set()
        for p in list((FE / "src").rglob("*.ts")) + list((FE / "src").rglob("*.tsx")):
            if p == own:
                continue
            if re.search(rf"\b{re.escape(name)}\b", p.read_text(errors="ignore")):
                hits.add(str(p.relative_to(ROOT)))
        EXTERNAL_USE[name] = hits
    return EXTERNAL_USE[name]


def prune_dead_exports(path: Path, seeds: list[str], keep: set[str]) -> list[str]:
    """Remove `seeds` and every declaration they orphan, to a fixpoint."""
    text = path.read_text()
    removed: list[str] = []
    gone: set[str] = set()
    wanted = set(seeds)
    while True:
        targets: list[tuple[int, int, str, int]] = []
        for m in DECL.finditer(text):
            name = m.group(1)
            if name in keep or name in gone:
                continue
            uses = len(re.findall(rf"\b{re.escape(name)}\b", text))
            if name not in wanted and uses > 1:
                continue
            outside = external_users(name, path)
            if outside:
                print(f"  keep {name}: referenced by {', '.join(sorted(outside))}")
                gone.add(name)  # never reconsider
                continue
            if name in wanted or uses == 1:
                start, end = cut_span(text, m.start())
                targets.append((start, end, name, text[:start].count("\n") + 1))
        if not targets:
            break
        for start, end, name, line in sorted(targets, reverse=True):
            removed.append(f"{name} (line {line}, {end - start} chars)")
            gone.add(name)
        for start, end, _n, _l in sorted(targets, reverse=True):
            text = text[:start] + text[end:]
        wanted = set()
    if APPLY:
        path.write_text(text)
    return removed


def drop_lines(path: Path, patterns: list[str]) -> int:
    lines = path.read_text().splitlines(keepends=True)
    kept = [ln for ln in lines if not any(p in ln for p in patterns)]
    if APPLY and len(kept) != len(lines):
        path.write_text("".join(kept))
    return len(lines) - len(kept)


print(f"{'APPLIED' if APPLY else 'DRY RUN'} — class-A dead-code cut\n")

for f in REMOVED_FILES:
    exists = f.exists()
    print(f"  {'delete' if exists else 'gone  '} {f.relative_to(ROOT)} ({f.stat().st_size if exists else 0} bytes)")
    if APPLY and exists:
        f.unlink()

print("\npins naming the deleted files:")
for rel, pats in [
    ("frontend/src/styles/overlay-surface.styles.test.ts", ["ReassignDialog.tsx"]),
    ("frontend/src/styles/dialog-density-contract.styles.test.ts", ["ReassignDialog.tsx"]),
    ("frontend/src/styles/operational-color-contract.styles.test.ts", ["FleetGrid.tsx", "fleetGrid"]),
]:
    p = ROOT / rel
    n = drop_lines(p, pats)
    print(f"  {rel}: {n} line(s) dropped")

print("\ndebt-detail-ledger.tsx orphan prune:")
LIVE = {"money", "rowTypeLabel", "FILTER_OPTIONS", "LedgerFilter", "WorkspaceTab"}
for item in prune_dead_exports(FE / "src/pages/debt-detail-ledger.tsx", ["groupLedgerRows", "LedgerRouteCard"], LIVE):
    print(f"  - {item}")
