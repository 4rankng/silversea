#!/usr/bin/env python3
"""Silversea 161026204709 → Muse QA → prod pipeline (cautious)."""
import subprocess, time, os, sys, re
from datetime import datetime

REPO = "/Volumes/LexarSSD/projects/silversea"
LOG = f"{REPO}/backend/qa/2026-10-17_pipeline.log"
FIX_BRANCH = "fix-161026204709-boards-100-0d-display-v2"
FIX_AGENT = "fe49d2d6"
TICK = 180  # 3 min
DEADLINE_HOURS = 5
MUSE_BRIEF_FILE = "/Volumes/LexarSSD/projects/silversea/backend/qa/2026-10-17_muse_qa_brief.md"


def log(msg):
    line = f"[{datetime.utcnow().isoformat()}Z] {msg}\n"
    print(line, end="", flush=True)
    with open(LOG, "a") as f:
        f.write(line)


def run(cmd, cwd=REPO, timeout=600):
    r = subprocess.run(cmd, cwd=cwd, shell=isinstance(cmd, str),
                       capture_output=True, text=True, timeout=timeout)
    return r.returncode, r.stdout, r.stderr


def branch_ahead(branch):
    rc, out, _ = run(f"git log main..{branch} --oneline 2>&1", timeout=15)
    return rc == 0 and bool(out.strip())


def agent_done(agent_id):
    rc, out, _ = run(f"paseo inspect {agent_id} 2>&1 | grep -E '^(Status|Archived)' | head -2", timeout=15)
    return "idle" in out or "archived" in out or "completed" in out


def tsc_clean():
    rc, _, _ = run("pnpm exec tsc --noEmit", cwd=f"{REPO}/backend", timeout=120)
    return rc == 0


def write_muse_brief():
    rc, head, _ = run("git rev-parse --short HEAD", timeout=10)
    brief = f"""Muse QA on STAGING (vantai.tingting.vip) — pin buildHash = {head.strip()}

The wave to verify (commits on main since last prod):
- 6de9984b merge: LCL spec gaps 1-3 (money conservation, same-customer validation, virtual plate debit binding)
- 3a50e089 merge: release-notes 2026-10-17 wave doc
- 15d11b98 fix(171026004331): the HTML/PDF Debit Note export carries renderData too
- e9f5bd7c merge: teardown fix + the delivery lane's debit-note-pdf fixture work onto 15d11b98
- 30a65b7e test(debit-note-pdf): mkRenderLine pre-fills description default
- ef603218 merge: 161026095800 pricing-table update path fix + cross-resolve with 121500
- 42587461 merge: 161026121500 phantom-duplicate fix
- e76ab6fc test(debit-note-pdf): cleanup renderServer + cascade fixtures (card 171026004331 prep)
- 25ef4a49 qa(release-gate): 2026-10-17 BE+FE release-gate artifacts — FE canonical run GREEN (4973/4973)
- 7277452d ops(delivery): monitor-only orchestrator + first tick log
- 3a50e089 merge: release-notes 2026-10-17 wave doc
- (NEW) fix(161026204709) on 100%/0đ visible on rev-merge — verify this fix landed cleanly

CRITICAL VERIFY (this wave's claim to fame):
1. Ticket 161026204709 — the 100%/0đ row on CUS 'Chi phí - Quyết toán' AND Kế toán 'Kế hoạch điều động tổng hợp' boards MUST render visibly for merged-pair LCL customers. Lô 1 row = 100% lane price; member rows = 0₫ with the freightOverrideReason displayed (NOT collapsed into 'Chi tiết').
2. Spec-gap fixes (lines 66, 86, 92, UnmergeLclGroupInput) — same-customer validation rejects cross-customer merges; money conservation invariant holds on un-merge + primary deletion; debit note binds to virtual plate.
3. Ticket 161026095800 — vehicle-specific price selector 200s for a real customer (class+rateKey pair).
4. Ticket 161026121500 — phantom-duplicate on price delete+readd: only the live row stays.
5. No regression on:
   - Debit Note Excel/HTML/PDF export with template columns (card 171026004331)
   - FCL 'Phân xe' 2-line cell when BKS báo khách ≠ BKS thực (commit 162f2d77)
   - CUS shadow line on debit summary (Xem danh sách (N) toggle)
   - Material-write registry completeness (no red routes)

Use the puppeteer driver at testplan/qa/scripts/2026-10-17-debit-shadow-list-rung.mjs as a launch surface for the shadow-line check. Add a new rung-3 driver for the boards 100%/0đ surface if needed.

Drive the buildHash pin and authenticate as thanhdc (CUS role) — the CUS board is the primary surface. For the Kế toán board, switch role to ketoan.

Serialize your tests; the staging DB is shared via ss-prod-db:5441.

Report PASS/FAIL with severity-ranked findings. Final report to /Volumes/LexarSSD/projects/silversea/backend/qa/2026-10-17_muse_qa_report.md on completion. Do NOT touch the source tree. Do NOT merge or deploy. Hermes reads your output and decides the deploy gate.

Staging URL: https://vantai.tingting.vip. Login: thanhdc / (ask Hermes via ask-clarify if needed)."""
    with open(MUSE_BRIEF_FILE, "w") as f:
        f.write(brief)
    log(f"  Muse QA brief written: {MUSE_BRIEF_FILE}")


def spawn_muse_qa():
    if not os.path.exists(MUSE_BRIEF_FILE):
        write_muse_brief()
    with open(MUSE_BRIEF_FILE) as f:
        brief = f.read()
    cmd = (
        'paseo run --cwd /Volumes/LexarSSD/projects/silversea '
        '--title "Muse QA: 204709 fix on STAGING (vantai)" '
        '--provider muse/muse-spark-1.3 '
        '--background ' + repr(brief)
    )
    rc, out, err = run(cmd, timeout=120)
    log(f"  Muse spawn rc={rc}: out={out[-300:]} err={err[-200:]}")
    return rc == 0


def check_muse_report():
    p = "/Volumes/LexarSSD/projects/silversea/backend/qa/2026-10-17_muse_qa_report.md"
    return os.path.exists(p)


def read_muse_report():
    p = "/Volumes/LexarSSD/projects/silversea/backend/qa/2026-10-17_muse_qa_report.md"
    with open(p) as f:
        return f.read()


def make_demo():
    log("  running make demo...")
    rc, out, err = run("make demo", timeout=900)
    log(f"  make demo rc={rc}; tail out: {out[-300:]} tail err: {err[-200:]}")
    return rc == 0


def make_deploy():
    log("  running make deploy (PROD, per user 'after all clean then deploy')")
    rc, out, err = run("make deploy", timeout=900)
    log(f"  make deploy rc={rc}; tail out: {out[-300:]} tail err: {err[-200:]}")
    return rc == 0


def main():
    log(f"=== 204709→Muse→prod pipeline START — deadline {DEADLINE_HOURS}h ===")
    deadline = time.time() + DEADLINE_HOURS * 3600
    fix_committed = False
    fix_merged = False
    demo_done = False
    muse_qa_spawned = False
    deploy_done = False
    iter_n = 0
    while time.time() < deadline:
        iter_n += 1
        log(f"--- iter {iter_n} ---")
        # 1. Wait for fix agent to commit OR for it to go idle without a commit
        if not fix_committed:
            if branch_ahead(FIX_BRANCH):
                log(f"  fix branch {FIX_BRANCH} has commits ahead of main")
                fix_committed = True
            elif agent_done(FIX_AGENT):
                rc, out, _ = run(f"paseo logs {FIX_AGENT} 2>&1 | tail -5", timeout=15)
                log(f"  agent {FIX_AGENT} idle; final logs:\n{out[-600:]}")
                if not branch_ahead(FIX_BRANCH):
                    log(f"  ⚠ agent {FIX_AGENT} finished without committing — pausing for human")
                    return
            else:
                log(f"  agent {FIX_AGENT} still running; waiting")
        # 2. Once committed: TSC check + manual-style merge (no auto-merge, no --theirs)
        if fix_committed and not fix_merged:
            if not tsc_clean():
                log("  ⚠ TSC fails on main with the new fix in the worktree — pausing for human review")
                return
            # Try merge; on conflict, abort and pause
            log(f"  attempting merge of {FIX_BRANCH} into main")
            rc, out, err = run(
                f"git merge --no-ff {FIX_BRANCH} -m 'merge: 161026204709 v2 fix (auto by pipeline)'",
                timeout=120,
            )
            if rc != 0:
                log(f"  ⚠ merge conflict on {FIX_BRANCH}; aborting and pausing for human:\n{err[-1500:]}")
                run("git merge --abort", timeout=15)
                return
            log(f"  merged OK:\n{out[:300]}")
            fix_merged = True
        # 3. After merge: make demo
        if fix_merged and not demo_done:
            if make_demo():
                # verify staging health
                rc, out, _ = run(
                    "curl -s https://vantai.tingting.vip/api/health", timeout=15
                )
                head = run("git rev-parse --short HEAD", timeout=5)[1].strip()
                if out.strip():
                    import json
                    try:
                        bh = json.loads(out).get("buildHash", "none")
                        log(f"  staging buildHash: {bh}; main HEAD: {head}")
                        if bh == head:
                            demo_done = True
                        else:
                            log(f"  ⚠ staging buildHash != main HEAD after demo — pausing")
                            return
                    except Exception as e:
                        log(f"  ⚠ health parse error: {e}")
                else:
                    log(f"  ⚠ no health response after demo — pausing")
                    return
        # 4. Spawn Muse QA
        if demo_done and not muse_qa_spawned:
            if spawn_muse_qa():
                muse_qa_spawned = True
            else:
                log("  ⚠ Muse QA spawn failed — pausing for human")
                return
        # 5. Wait for Muse report
        if muse_qa_spawned and not deploy_done:
            if check_muse_report():
                report = read_muse_report()
                log(f"  --- Muse report first 800 chars ---\n{report[:800]}\n---")
                if re.search(r"\b(PASS|ALL GREEN|0 fail|0 failed|VERDICT:\s*PASS)\b", report, re.IGNORECASE):
                    log("  ✅ Muse verdict PASS")
                    if make_deploy():
                        deploy_done = True
                        log("  ✅ DEPLOYED — pipeline complete")
                    else:
                        log("  ⚠ deploy failed — pausing for human")
                        return
                else:
                    log("  ⚠ Muse verdict not PASS — pausing for human")
                    return
        # termination
        if deploy_done:
            log("=== PIPELINE COMPLETE ===")
            return
        time.sleep(TICK)
    log(f"=== PIPELINE TIMEOUT ({DEADLINE_HOURS}h) ===")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log(f"!!! PIPELINE CRASHED: {type(e).__name__} {e}")
        import traceback
        log(traceback.format_exc())
        sys.exit(1)
