#!/usr/bin/env python3
"""Board hygiene: does each card's status line agree with its folder?

A card parked in the wrong column, or whose line still says "chờ deploy staging
+ QA" after it moved to QA_PASSED, is the same defect the card-197 driver had:
an announcement that does not match what happened. The board is the shared
source of truth, so this is worth a repeatable gate rather than a sweep someone
remembers to do by hand.

    python3 scripts/kanban-board-hygiene.py            # summary
    python3 scripts/kanban-board-hygiene.py --verbose  # every card, not just a sample

Deliberately conservative about what counts as a status line. An earlier pass
matched any line beginning "Trạng thái" and reported 208 mismatches, but that
count included prose ("Trạng thái column is off-screen to the right...") and
vocabulary the matcher did not know ("ĐANG LÀM" vs "ĐANG XỬ LÝ"). A count you
cannot trust is worse than no count, so this only accepts a `Trạng thái:` line
whose next token is a state, and compares that state alone.

Exit code 0 when the board is clean, 1 when it is not — so it can gate a step.
"""
import argparse
import os
import re
import subprocess
import sys

POINTER = ".kanban-dir"
COLUMNS = ("TODO", "IN_PROGRESS", "DEV_COMPLETED", "QA_PASSED")

# A status line is "Trạng thái:" followed by one of these. The FIRST group that
# matches wins, so the more specific states must come first.
STATE = [
    (re.compile(r"^QA\s*PASSED\b", re.I), "QA_PASSED"),
    (re.compile(r"^DEV\s*COMPLETED\b", re.I), "DEV_COMPLETED"),
    (re.compile(r"^ĐANG\s*(?:XỬ\s*LÝ|LÀM)\b", re.I), "IN_PROGRESS"),
    (re.compile(r"^MỞ\b", re.I), "TODO"),
]
LINE = re.compile(r"^trạng\s*thái\s*[:：]\s*(.*)$", re.I)


def board_root() -> str:
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    pointer = os.path.join(here, POINTER)
    if not os.path.isfile(pointer):
        sys.exit(f"no {POINTER} pointer next to the repo")
    with open(pointer) as fh:
        return fh.read().strip()


def states_in(path: str) -> list:
    """Every state a card claims, in document order."""
    try:
        out = subprocess.run(["textutil", "-convert", "txt", "-stdout", path],
                             capture_output=True, text=True, timeout=60).stdout
    except Exception:
        return []
    found = []
    for raw in out.splitlines():
        m = LINE.match(raw.strip())
        if not m:
            continue
        rest = m.group(1).strip()
        for rx, state in STATE:
            if rx.match(rest):
                found.append(state)
                break
    return found


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--verbose", action="store_true", help="list every finding, not a sample")
    ap.add_argument("--sample", type=int, default=25, help="how many findings to print")
    args = ap.parse_args()

    root = board_root()
    if not os.path.isdir(root):
        sys.exit(f"board path does not exist: {root}")

    agree, mismatch, no_line, contradictory, total = [], [], [], [], 0
    for col in COLUMNS:
        directory = os.path.join(root, col)
        if not os.path.isdir(directory):
            sys.exit(f"missing column: {directory}")
        for name in sorted(os.listdir(directory)):
            if not name.endswith(".docx"):
                continue
            total += 1
            found = states_in(os.path.join(directory, name))
            rel = f"{col}/{name}"
            if not found:
                no_line.append(rel)
            elif len(set(found)) > 1:
                # Several states in one card: usually a dated log entry that
                # re-states the status. The FIRST line is the current one.
                contradictory.append((rel, found[0], sorted(set(found))))
            elif found[0] == col:
                agree.append(rel)
            else:
                mismatch.append((rel, found[0]))

    print(f"board: {root}")
    print(f"scanned {total} cards across {len(COLUMNS)} columns")
    print(f"  status line agrees with folder : {len(agree)}")
    print(f"  MISMATCH (line != folder)     : {len(mismatch)}")
    print(f"  no parseable status line      : {len(no_line)}")
    print(f"  several states in one card    : {len(contradictory)}")

    def show(title, rows, fmt):
        if not rows:
            return
        print(f"\n{title}")
        listed = rows if args.verbose else rows[: args.sample]
        for r in listed:
            print("   ", fmt(r))
        if len(listed) < len(rows):
            print(f"    … and {len(rows) - len(listed)} more (use --verbose)")

    show("mismatched — the folder and the line disagree", mismatch,
         lambda r: f"{r[0]}  line says {r[1]}")
    show("several states in one card — first line is the current one", contradictory,
         lambda r: f"{r[0]}  says {r[1]}, also {r[2]}")

    return 1 if mismatch else 0


if __name__ == "__main__":
    sys.exit(main())
