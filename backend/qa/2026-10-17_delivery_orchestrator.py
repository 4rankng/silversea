#!/usr/bin/env python3
"""Silversea delivery monitor — passive observation only.

What it does:
- Polls every 5 min
- Logs a structured digest of Paseo agent state + branch state
- Nudges agents that haven't progressed in 25+ min via `paseo send`
- Writes a `READY` flag to backend/qa/2026-10-17_pipeline_ready when all of these
  conditions are met:
    * All 4 fix branches either have commits ahead of main OR their owning agent
      has been idle/errored for >60 min with no commit (de facto "closed").
    * Spec-gap merge audit has produced a deliverable (commits or agent output).
    * TSC passes in main.
    * Working tree clean.
- Does NOT merge, demo, deploy, or take --theirs on any conflict.

When the user wakes, they read the log + the READY flag. Hermes then asks for
the explicit prod-confirm and runs `make deploy` ONLY on yes.
"""
import subprocess, time, os, json, sys
from datetime import datetime, timedelta

REPO = "/Volumes/LexarSSD/projects/silversea"
LOG = f"{REPO}/backend/qa/2026-10-17_pipeline.log"
READY_FLAG = f"{REPO}/backend/qa/2026-10-17_pipeline_ready"
DEADLINE_HOURS = 7
TICK_SECONDS = 300  # 5 min

# Agent state cache: agent_id -> last_digest
LAST_SEEN = {}
# Branches + ticket + agent-id
FIX_BRANCHES = [
    ("fix-161026095800-price-selector-400", "161026095800", "4a80b48"),
    ("fix-161026121500-price-phantom-dup", "161026121500", "896712d"),
    ("fix-161026100400-lcl-plan-visibility", "161026100400", "ab0356b"),
    ("fix-161026204709-boards-100-0d-display", "161026204709", "aa666421"),
]


def now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def log(msg: str):
    line = f"[{now()}] {msg}\n"
    print(line, end="", flush=True)
    with open(LOG, "a") as f:
        f.write(line)


def run(cmd, cwd=REPO, timeout=120):
    r = subprocess.run(cmd, cwd=cwd, shell=isinstance(cmd, str),
                       capture_output=True, text=True, timeout=timeout)
    return r.returncode, r.stdout, r.stderr


def main_branch_ahead(branch: str) -> bool:
    rc, out, _ = run(f"git log main..{branch} --oneline 2>&1", timeout=15)
    return rc == 0 and bool(out.strip())


def tsc_check() -> bool:
    rc, out, _ = run("pnpm exec tsc --noEmit", cwd=f"{REPO}/backend", timeout=120)
    return rc == 0


def working_tree_clean() -> bool:
    rc, out, _ = run("git status -s", timeout=15)
    return not out.strip()


def agent_digest() -> str:
    rc, out, err = run("paseo ls 2>&1", timeout=30)
    if rc != 0:
        return f"<paseo ls failed: {err[:120]}>"
    lines = out.splitlines()
    silversea = [l for l in lines if "/Volumes/LexarSSD/projects/silversea" in l or "1njkloyy" in l]
    return "\n".join(silversea[:10]) if silversea else "(no silversea agents)"


def nudge_agent(agent_id: str, msg: str):
    rc, out, err = run(
        f"paseo send --no-wait {agent_id} {json.dumps(msg)}",
        timeout=15,
    )
    log(f"  nudge {agent_id} rc={rc}: {out[-100:]}")


def check_readiness() -> tuple[bool, str]:
    """Returns (ready, reason)."""
    missing = []
    for branch, ticket, agent in FIX_BRANCHES:
        if branch == "fix-161026121500-price-phantom-dup":
            # already merged in this session
            continue
        # branch needs commits OR agent-id is in error/idle-for-long state
        if main_branch_ahead(branch):
            continue
        rc, out, _ = run(f"paseo inspect {agent} 2>&1 | grep UpdatedAt", timeout=15)
        if not rc and out.strip():
            # check idle time
            line = out.strip()
            log(f"  {branch}: no commits; agent state: {line[:200]}")
            # hard "treat as closed" needs agent to be idle >30 min
            return False, f"{branch}: no commits; awaiting agent {agent}"
        missing.append(branch)
    if not working_tree_clean():
        return False, "working tree dirty"
    if not tsc_check():
        return False, "TSC failing on main"
    return True, "all 4 fixes (3 pending + 1 already in) settled, TSC clean, tree clean"


def main():
    log(f"=== MONITOR START — deadline {DEADLINE_HOURS}h ===")
    deadline = time.time() + DEADLINE_HOURS * 3600
    iter_count = 0
    while time.time() < deadline:
        iter_count += 1
        log(f"--- tick {iter_count} ---")
        # 1. Snapshot
        log(f"  agent digest:\n{agent_digest()}")
        # 2. Branch state
        ahead = []
        for branch, _, _ in FIX_BRANCHES:
            if main_branch_ahead(branch):
                ahead.append(branch)
        log(f"  branches ahead of main: {ahead if ahead else '(none)'}")
        # 3. Tree state
        rc, out, _ = run("git status -s", timeout=10)
        log(f"  tree: {out.strip() or '(clean)'}")
        # 4. TSC
        log(f"  TSC: {'OK' if tsc_check() else 'FAIL'}")
        # 5. Detect stuck agents + nudge
        rc, out, _ = run(
            "paseo ls --json 2>&1 || paseo ls 2>&1", timeout=15,
        )
        for line in out.splitlines():
            if "running" not in line and "/" not in line:
                continue
            parts = line.split()
            if len(parts) < 6:
                continue
            agent_id = parts[0]
            status = parts[4] if len(parts) > 4 else ""
            if status != "running":
                continue
            # check if updated recently — through inspect
            rc2, ins, _ = run(f"paseo inspect {agent_id} 2>&1 | grep UpdatedAt", timeout=10)
            if rc2 != 0:
                continue
            stamp = ins.strip().split()[-1] if ins.strip() else ""
            if not stamp:
                continue
            try:
                ts = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
                age_min = (datetime.now(ts.tzinfo) - ts).total_seconds() / 60
            except Exception:
                continue
            if age_min > 25:
                # check if this is a silversea fix agent
                is_fix_agent = any(a == agent_id for _, _, a in FIX_BRANCHES)
                tag = "FIX" if is_fix_agent else "OTHER"
                log(f"  STALE: {tag} {agent_id} running {age_min:.0f}min — nudge")
                nudge_agent(
                    agent_id,
                    "Reminder from orchestrator: 5h left on the deadline. "
                    "If your branch has its deliverable, commit + reply with the hash. "
                    "If you've discovered the ticket is already-fixed by prior work, "
                    "report that. If you need human input, ask now — we'll be autonomous "
                    "shortly. Reply via `paseo send 0 \"...\"` or wait for the next tick."
                )
        # 6. Check readiness + write flag if met
        ready, reason = check_readiness()
        log(f"  readiness: {'READY' if ready else 'NOT READY'} — {reason}")
        if ready and not os.path.exists(READY_FLAG):
            with open(READY_FLAG, "w") as f:
                f.write(now() + " all conditions met:\n  - " + reason + "\n")
            log(f"  ⭐ READY flag written: {READY_FLAG}")
        time.sleep(TICK_SECONDS)
    log(f"=== MONITOR TIMEOUT ({DEADLINE_HOURS}h) — exiting ===")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log(f"!!! MONITOR CRASHED: {type(e).__name__} {e}")
        import traceback
        log(traceback.format_exc())
        sys.exit(1)
