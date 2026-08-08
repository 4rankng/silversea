"""Aggregate per-section results into qa/visual/SUMMARY.md.

Reads every `<date>_<section>/results.json` under qa/visual/ and produces
a top-level dashboard suitable for customer handover.
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path


# Map section_id -> human-friendly title from regression docs.
SECTION_TITLES = {
    "s00_cross_cutting":     "00 — Cross-cutting (HT-01..HT-12 + Q01..Q23)",
    "s01_overview_dispatch": "01 — Tổng quan & Điều vận (M01)",
    "s02_pricing_revenue":   "02 — Báo giá cước & Doanh thu phi VT (M02)",
    "s03_cus":               "03 — Chăm sóc khách hàng / CUS (M03)",
    "s04_disbursement":      "04 — Chi hộ & Thu hộ (M04)",
    "s05_ar":                "05 — Công nợ phải thu (M05)",
    "s06_ap":                "06 — Công nợ phải trả (M06)",
    "s07_payroll":           "07 — Lương, chấm công, kỷ luật (M07)",
    "s08_driver_app":        "08 — App lái xe (M08, mobile)",
    "s09_field_app":         "09 — App nhân viên hiện trường (M09, mobile)",
    "s10_clerk_app":         "10 — App nhân viên chứng từ (CUS, M10, mobile)",
    "s11_finance_pnl":       "11 — Báo cáo tài chính & lãi lỗ (M11)",
    "s12_fuel":              "12 — Nhiên liệu & số hóa (M12)",
}


def _load_all_runs(visual_root: Path) -> dict[str, dict]:
    """For each section_id, return the latest run's results.json contents."""
    latest_per_section: dict[str, tuple[str, dict]] = {}  # section_id -> (timestamp, data)
    for run_dir in sorted(visual_root.iterdir()):
        if not run_dir.is_dir():
            continue
        # dir format: <YYYY-MM-DD_HHMMSS>_<section_id>
        parts = run_dir.name.split("_", 2)
        if len(parts) < 3:
            continue
        section_id = parts[2]
        results_file = run_dir / "results.json"
        if not results_file.exists():
            continue
        try:
            data = json.loads(results_file.read_text(encoding="utf-8"))
        except Exception:
            continue
        ts = parts[0] + "_" + parts[1]
        prev = latest_per_section.get(section_id)
        if prev is None or ts > prev[0]:
            latest_per_section[section_id] = (ts, {**data, "_run_dir": run_dir.name})

    return {sid: d for sid, (ts, d) in latest_per_section.items()}


def build_summary(visual_root: Path) -> Path:
    """Build (or rebuild) qa/visual/SUMMARY.md from all run results."""
    runs = _load_all_runs(visual_root)
    summary_path = visual_root / "SUMMARY.md"

    grand_totals = {"pass": 0, "fail": 0, "blocked": 0, "skip": 0, "total": 0}
    section_rows = []
    for sid in sorted(SECTION_TITLES.keys()):
        title = SECTION_TITLES[sid]
        if sid not in runs:
            section_rows.append((sid, title, None, None))
            continue
        data = runs[sid]
        t = data.get("totals", {})
        for k in grand_totals:
            grand_totals[k] += t.get(k, 0)
        run_dir = data.get("_run_dir", "")
        section_rows.append((sid, title, t, run_dir))

    lines = [
        "# Silversea — Visual Regression Summary",
        "",
        f"_Last refresh:_ {datetime.now().isoformat(timespec='seconds')}",
        f"_Target:_ `{runs.get('s00_cross_cutting', {}).get('base_url', 'http://localhost:7174')}`",
        "",
        "## Headline",
        "",
        f"**{grand_totals['pass']}/{grand_totals['total']} TCs pass** "
        f"(❌ {grand_totals['fail']} fail · ⏸ {grand_totals['blocked']} blocked · "
        f"⏭ {grand_totals['skip']} skip) across {len([r for r in section_rows if r[2]])} "
        f"of {len(SECTION_TITLES)} sections.",
        "",
        "## Per-section results",
        "",
        "| # | Section | Pass | Fail | Blocked | Skip | Total | Latest run |",
        "|---|---------|-----:|-----:|--------:|-----:|------:|------------|",
    ]
    for i, (sid, title, t, run_dir) in enumerate(section_rows, 1):
        if t is None:
            lines.append(f"| {i} | {title} | — | — | — | — | — | _(not run)_ |")
        else:
            link = f"[{run_dir}]({run_dir}/report.md)" if run_dir else "—"
            lines.append(
                f"| {i} | {title} | ✅ {t.get('pass', 0)} | ❌ {t.get('fail', 0)} | "
                f"⏸ {t.get('blocked', 0)} | ⏭ {t.get('skip', 0)} | {t.get('total', 0)} | {link} |"
            )
    lines.append("")

    # Per-section breakdown for any that have been run.
    lines.append("## Failures & blockers (action required)")
    ""
    any_fail = False
    for sid, title, t, run_dir in section_rows:
        if not t or (t.get("fail", 0) == 0 and t.get("blocked", 0) == 0):
            continue
        any_fail = True
        data = runs[sid]
        results = data.get("results", [])
        lines.append(f"### {title}")
        lines.append("")
        for r in results:
            if r["status"] in ("FAIL", "BLOCKED"):
                err = (r.get("error") or r.get("detail") or "").replace("\n", " ")[:200]
                shot = r.get("failure_screenshot") or r.get("screenshot") or ""
                shot_cell = f"[📷]({run_dir}/{shot})" if shot else ""
                lines.append(f"- `{r['tc_id']}` ({r['role']}) {r['status']} — {err} {shot_cell}")
        lines.append("")
    if not any_fail:
        lines.append("_(none — all run sections pass cleanly)_")
        lines.append("")

    # List of unrun sections.
    unrun = [title for sid, title, t, _ in section_rows if t is None]
    if unrun:
        lines.append("## Sections not yet run")
        ""
        for t in unrun:
            lines.append(f"- {t}")
        lines.append("")

    summary_path.write_text("\n".join(lines), encoding="utf-8")
    return summary_path
