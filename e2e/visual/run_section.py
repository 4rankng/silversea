#!/usr/bin/env python3
"""Entry point: run one section's visual regression tests.

Usage:
    python3 run_section.py s00_cross_cutting          # run a section
    python3 run_section.py s01_overview_dispatch --limit 5  # smoke a few
    python3 run_section.py --refresh-summary          # rebuild SUMMARY.md only
    python3 run_section.py --list                     # list available sections

Environment:
    VISUAL_URL=http://localhost:7174      frontend URL
    VISUAL_API=http://localhost:3001      backend URL
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

# Make `visual.lib.*` importable when run as a script.
HERE = Path(__file__).resolve().parent
if str(HERE.parent) not in sys.path:  # e2e/
    sys.path.insert(0, str(HERE.parent))

from visual.lib.runner import run_section  # noqa: E402
from visual.lib.reporter import build_summary  # noqa: E402

REPO_ROOT = HERE.parents[1]
QA_VISUAL = REPO_ROOT / "qa" / "visual"

SECTIONS = [
    "s00_cross_cutting",
    "s01_overview_dispatch",
    "s02_pricing_revenue",
    "s03_cus",
    "s04_disbursement",
    "s05_ar",
    "s05_ar_workflow",
    "s06_ap",
    "s07_payroll",
    "s07_payroll_workflow",
    "s08_driver_app",
    "s09_field_app",
    "s10_clerk_app",
    "s11_finance_pnl",
    "s12_fuel",
    "s98_export_workflow",
    "s99_business_rules_workflow",
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 2)[1])
    parser.add_argument("section", nargs="?", help="section module name (e.g. s00_cross_cutting)")
    parser.add_argument("--limit", type=int, help="only run the first N TCs (for smoke)")
    parser.add_argument("--force", action="store_true", help="re-run even if results exist")
    parser.add_argument("--only", help="comma-separated TC IDs to re-run")
    parser.add_argument("--list", action="store_true", help="list available sections")
    parser.add_argument("--refresh-summary", action="store_true", help="rebuild SUMMARY.md only")
    parser.add_argument("--out", default=str(QA_VISUAL), help="output root (default: qa/visual)")
    args = parser.parse_args()

    if args.list:
        print("Available sections:")
        for s in SECTIONS:
            print(f"  {s}")
        return 0

    if args.refresh_summary:
        path = build_summary(QA_VISUAL)
        print(f"[visual] summary refreshed → {path}")
        return 0

    if not args.section:
        parser.error("section is required (or use --list / --refresh-summary)")

    if args.section not in SECTIONS:
        # Fuzzy match.
        candidates = [s for s in SECTIONS if args.section.lower() in s.lower()]
        if len(candidates) == 1:
            args.section = candidates[0]
        else:
            parser.error(
                f"unknown section {args.section!r}. Known: {SECTIONS}"
            )

    only_failed = [s.strip() for s in args.only.split(",")] if args.only else None

    summary = run_section(
        section_module=f"visual.sections.{args.section}",
        out_root=Path(args.out),
        only_failed=only_failed,
        force=args.force,
        limit=args.limit,
    )

    # Refresh cross-section SUMMARY.md.
    try:
        build_summary(QA_VISUAL)
    except Exception as e:
        print(f"[visual] warn: SUMMARY.md build failed: {e}", file=sys.stderr)

    # Exit non-zero if any failures.
    return 1 if summary["totals"]["fail"] > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
