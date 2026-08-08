"""Parse a regression-testing .md file into structured TC specs.

Used as a reference catalog so section authors can cross-check they've
covered every TC. The runner itself does NOT consume this — section files
register TCs explicitly via the @tc decorator.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


@dataclass
class TCSpec:
    tc_id: str
    section: str  # filename, e.g. "01-module-01-overview-dispatch"
    role_line: str = ""
    roles: list[str] = field(default_factory=list)
    prd_ref: str = ""
    rule: str = ""
    preconditions: str = ""
    steps: list[str] = field(default_factory=list)
    expected: list[str] = field(default_factory=list)
    depends_on: str = ""  # e.g. "Q01"
    evidence: str = ""
    url_hints: list[str] = field(default_factory=list)  # URLs extracted from steps


_TC_HEADER = re.compile(r"^###\s+(TC-[A-Za-z0-9\-]+)\s+(.*)$")
_URL_RE = re.compile(r"`(\/[a-zA-Z0-9_\-/\.:]*)`")
_Q_DEP_RE = re.compile(r"\bQ(\d{1,2})\b")
_PRD_RE = re.compile(r"Mã PRD:\s*([A-Za-z0-9\-]+)")


def parse_file(path: Path) -> list[TCSpec]:
    text = path.read_text(encoding="utf-8")
    section = path.stem
    specs: list[TCSpec] = []
    current: Optional[TCSpec] = None

    def _flush():
        nonlocal current
        if current:
            specs.append(current)
        current = None

    in_expected = False
    in_steps = False
    for line in text.splitlines():
        m = _TC_HEADER.match(line)
        if m:
            _flush()
            current = TCSpec(tc_id=m.group(1), section=section)
            in_expected = False
            in_steps = False
            continue
        if current is None:
            continue

        stripped = line.strip()
        # Field markers.
        if stripped.startswith("- **Vai trò"):
            current.role_line = stripped
            # Extract role names inside backticks.
            current.roles = re.findall(r"`(ADMIN|MANAGER|ACCOUNTANT|DISPATCHER|DRIVER|OPS|FORWARDER|CUS|CUSTOMER|CLERK)`", stripped)
        elif stripped.startswith("- **Mã PRD"):
            mm = _PRD_RE.search(stripped)
            if mm:
                current.prd_ref = mm.group(1)
        elif stripped.startswith("- **Phụ thuộc"):
            current.depends_on = stripped
        elif stripped.startswith("- **Tiền điều kiện"):
            current.preconditions = stripped
        elif stripped.startswith("- **Bằng chứng"):
            current.evidence = stripped
        elif stripped.startswith("- **Kết quả mong đợi"):
            in_expected = True
            in_steps = False
            continue
        elif stripped.startswith("- **Các bước"):
            in_steps = True
            in_expected = False
            continue
        elif stripped.startswith("- **Quy tắc nghiệp vụ"):
            current.rule = stripped
            continue

        # Body of expected / steps.
        if in_expected and stripped.startswith("-"):
            current.expected.append(stripped.lstrip("- ").strip())
        elif in_steps and re.match(r"^\d+\.", stripped):
            step_text = re.sub(r"^\d+\.\s*", "", stripped)
            current.steps.append(step_text)
            # Extract URLs.
            for url in _URL_RE.findall(step_text):
                current.url_hints.append(url)

        # Section boundary.
        if line.startswith("## ") and not line.startswith("### "):
            _flush()

    _flush()
    return specs


def parse_all(regression_dir: Path) -> dict[str, list[TCSpec]]:
    """Parse every regression .md file. Returns {section_stem: [TCSpec, ...]}."""
    out: dict[str, list[TCSpec]] = {}
    for md in sorted(regression_dir.glob("*.md")):
        if md.name == "README.md":
            continue
        out[md.stem] = parse_file(md)
    return out


def coverage_report(regression_dir: Path, implemented_ids: set[str]) -> str:
    """Build a markdown table comparing PRD TCs vs implemented TCs."""
    all_specs = parse_all(regression_dir)
    lines = [
        "# Regression coverage",
        "",
        "| File | Total TCs | Implemented | Missing |",
        "|------|-----------|------------|---------|",
    ]
    total = 0
    implemented = 0
    for stem, specs in all_specs.items():
        ids = {s.tc_id for s in specs}
        n_total = len(ids)
        n_impl = len(ids & implemented_ids)
        n_miss = n_total - n_impl
        total += n_total
        implemented += n_impl
        miss_pct = f"{n_miss}" if n_miss else "0"
        lines.append(f"| `{stem}` | {n_total} | {n_impl} | {miss_pct} |")
    lines.append(f"| **TOTAL** | **{total}** | **{implemented}** | **{total - implemented}** |")
    return "\n".join(lines)
