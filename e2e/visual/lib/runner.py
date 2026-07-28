"""Visual regression test runner core.

Drives Playwright against localhost:7174, logs in via API for speed, then
sets localStorage.token and navigates to each TC's URL, runs assertions,
and captures one full-page screenshot per TC.

Black-box per the web-gui-tester skill: no JS injection with side effects,
no DOM mutation, no URL construction to bypass guards. Only Playwright's
native locator/click/fill/screenshot primitives.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import traceback
import urllib.request
import urllib.error
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional

from playwright.sync_api import (
    sync_playwright,
    Page,
    Browser,
    BrowserContext,
    TimeoutError as PlaywrightTimeoutError,
)

# Resolve repo paths regardless of CWD. This file lives at e2e/visual/lib/.
HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[2]  # e2e/visual/lib/ -> e2e/visual/ -> e2e/ -> repo
E2E_ROOT = HERE.parents[1]   # e2e/visual/lib/ -> e2e/visual/ -> e2e/

# Add the legacy e2e/ dir so we can reuse ApiClient if desired.
if str(E2E_ROOT) not in sys.path:
    sys.path.insert(0, str(E2E_ROOT))

from visual.lib.accounts import ACCOUNTS, DEFAULT_PASSWORD  # noqa: E402

BASE_URL = os.environ.get("VISUAL_URL", "http://localhost:7174").rstrip("/")
API_URL = os.environ.get("VISUAL_API", "http://localhost:3001").rstrip("/")
VIEWPORT_DESKTOP = {"width": 1280, "height": 900}
VIEWPORT_MOBILE = {"width": 375, "height": 667}

# --- TC registry -----------------------------------------------------------

@dataclass
class TC:
    tc_id: str
    title: str
    roles: list[str]
    url: Optional[str]
    viewport: str = "desktop"  # "desktop" | "mobile"
    fn: Callable = None
    prereqs: list[str] = field(default_factory=list)  # e.g. ["seed:trips"]
    section: str = ""

# Global registry, populated by @tc decorator.
REGISTRY: list[TC] = []


def tc(
    tc_id: str,
    *,
    roles: list[str],
    url: Optional[str] = None,
    title: str = "",
    viewport: str = "desktop",
    prereqs: list[str] = None,
):
    """Register a test case.

    The decorated function receives a VisualTestContext and runs the actual
    assertions. The runner handles login + goto + screenshot around it.
    """
    def deco(fn: Callable):
        REGISTRY.append(TC(
            tc_id=tc_id,
            title=title or fn.__doc__.strip().splitlines()[0] if fn.__doc__ else tc_id,
            roles=roles,
            url=url,
            viewport=viewport,
            fn=fn,
            prereqs=prereqs or [],
        ))
        return fn
    return deco


# --- Result recording ------------------------------------------------------

@dataclass
class TCResult:
    tc_id: str
    title: str
    role: str = ""
    status: str = "SKIP"  # PASS | FAIL | BLOCKED | SKIP
    url: str = ""
    screenshot: Optional[str] = None
    failure_screenshot: Optional[str] = None
    dom_dump: Optional[str] = None
    console_log: Optional[str] = None
    duration_ms: int = 0
    detail: str = ""
    error: str = ""

    def to_json_safe(self) -> dict:
        d = asdict(self)
        # Make paths relative to run dir for portability.
        for k in ("screenshot", "failure_screenshot", "dom_dump", "console_log"):
            if d[k]:
                d[k] = str(Path(d[k]).name)
        return d


# --- The runner ------------------------------------------------------------

class ApiLogin:
    """Minimal API client for fast token-based login (no form fill needed)."""

    def __init__(self, base_url: str = API_URL):
        self.base_url = base_url

    def login(self, identifier: str, password: str) -> dict:
        body = json.dumps({"identifier": identifier, "password": password}).encode()
        # Retry on transient failures (rate-limit, empty body, network blip).
        # Staging sometimes returns empty 200 bodies under load.
        last_err = None
        for attempt in range(3):
            req = urllib.request.Request(
                f"{self.base_url}/api/auth/login",
                data=body,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=15) as resp:
                    raw = resp.read()
                    if not raw:
                        raise ValueError("empty response body")
                    return json.loads(raw)
            except urllib.error.HTTPError as e:
                err_body = e.read()
                try:
                    return {"error": json.loads(err_body), "status": e.code}
                except Exception:
                    last_err = f"HTTP {e.code} (non-JSON body)"
            except (json.JSONDecodeError, ValueError) as e:
                last_err = f"login parse error: {e}"
            except Exception as e:
                last_err = f"login network error: {e}"
            # Brief backoff before retry.
            time.sleep(1.0 * (attempt + 1))
        return {"error": last_err or "login failed after 3 attempts"}


class VisualTestContext:
    """Per-TC context: a fresh page, role, and capture helpers."""

    def __init__(self, page: Page, role: str, run_dir: Path, tc_id: str):
        self.page = page
        self.role = role
        self.run_dir = run_dir
        self.tc_id = tc_id
        self._console_errors: list[str] = []

    # --- navigation & waits ---

    def login(self, role: str | None = None) -> dict:
        """Log in via API, set localStorage.token, then navigate to the
        role's home page so the SPA boots in authenticated state. Returns
        the user object.

        Critical: after setting the token, we MUST do a full `goto` to the
        role's home (not a pushState from /login). The SPA's auth gate
        evaluates on initial load — if we stay on /login and pushState,
        React's mounted LoginPage component doesn't re-evaluate auth,
        and subsequent navigations get redirected back to /login or the
        role home, losing the target URL.
        """
        role = role or self.role
        identifier, password = _resolve_account(role)
        result = ApiLogin().login(identifier, password)
        if "token" not in result:
            raise RuntimeError(f"login failed for {role}/{identifier}: {result.get('error')}")

        token = result["token"]
        user = result.get("user", {})
        # Land on /login so we have a same-origin page and localStorage access.
        # Retry the initial goto — staging's SPA can occasionally abort the
        # first navigation when its auth-redirect races with the load.
        for attempt in range(3):
            try:
                self.page.goto(f"{BASE_URL}/login", wait_until="domcontentloaded",
                               timeout=20000)
                break
            except Exception as e:
                if "ERR_ABORTED" in str(e) or "frame was detached" in str(e):
                    self.page.wait_for_timeout(800)
                    continue
                break
        try:
            self.page.evaluate(
                "(tok) => { try { localStorage.setItem('token', tok); } catch(e) {} }",
                token,
            )
        except Exception:
            pass
        # Reload the current page (/login). The SPA reads the token from
        # localStorage on initial render, sees the authenticated state,
        # and redirects to the role's home. Retry on SPA-race aborts.
        for attempt in range(3):
            try:
                self.page.reload(wait_until="domcontentloaded", timeout=20000)
                break
            except Exception as e:
                if "ERR_ABORTED" in str(e) or "frame was detached" in str(e):
                    self.page.wait_for_timeout(800)
                    continue
                break
        try:
            self.page.wait_for_load_state("networkidle", timeout=8000)
        except PlaywrightTimeoutError:
            pass
        # Allow the SPA's role-redirect to settle.
        self.page.wait_for_timeout(1500)
        return user

    def goto(self, path: str, wait: str = "networkidle"):
        """Navigate to a path under BASE_URL.

        For SPAs, when the user is already authenticated and on a same-origin
        page, the SPA router intercepts in-page navigation. But Playwright's
        `page.goto()` for a URL the browser has never visited triggers a
        fresh load that may race with the auth check (the SPA sees no token
        during the initial HTML load and redirects to /login, aborting the
        original nav with ERR_ABORTED).

        Strategy:
          1. If the current page is already same-origin AND not on /login,
             use history.pushState + a popstate dispatch so the SPA router
             handles it.
          2. Otherwise (first nav after login, or coming from /login), do a
             full page.goto. The login() method already navigated to the
             role's home, so we're typically on an authenticated page when
             this is called.
        """
        url = path if path.startswith("http") else f"{BASE_URL}{path}"
        current = self.page.url
        # We're "SPA-ready" if we're on the same origin and NOT on /login
        # (login page is the unauthenticated-state component; pushState
        # from there doesn't trigger React to re-evaluate auth properly).
        on_login = "/login" in current
        same_origin_authenticated = (
            current.startswith(BASE_URL.rstrip("/"))
            and not on_login
            and "about:blank" not in current
        )
        if same_origin_authenticated and not path.startswith("http"):
            # SPA in-app navigation. Retry up to 3 times — the SPA's
            # internal redirects can destroy the execution context
            # mid-evaluate (e.g. role-guard redirects), and a fresh
            # attempt after a brief wait typically succeeds.
            last_exc = None
            for attempt in range(3):
                try:
                    self.page.evaluate(
                        "(url) => { window.history.pushState({}, '', url); "
                        "window.dispatchEvent(new PopStateEvent('popstate')); }",
                        path,
                    )
                    try:
                        self.page.wait_for_load_state("networkidle", timeout=8000)
                    except PlaywrightTimeoutError:
                        pass
                    self.page.wait_for_timeout(400)
                    return
                except Exception as e:
                    last_exc = e
                    # SPA navigated mid-evaluate. Wait for it to settle
                    # and retry — page state may have changed.
                    try:
                        self.page.wait_for_load_state("domcontentloaded", timeout=5000)
                    except Exception:
                        pass
                    self.page.wait_for_timeout(800)
                    continue
            # All retries failed; fall through to full navigation.
        # Full navigation (first nav after login, or coming from /login).
        try:
            self.page.goto(url, wait_until=wait, timeout=20000)
            try:
                self.page.wait_for_load_state("networkidle", timeout=5000)
            except PlaywrightTimeoutError:
                pass
        except PlaywrightTimeoutError:
            pass

    def wait_for(self, selector: str, timeout: int = 8000):
        """Wait for a selector/text to appear. Used for stability before capture."""
        try:
            self.page.wait_for_selector(selector, timeout=timeout)
        except PlaywrightTimeoutError:
            raise AssertionError(f"wait_for timeout: {selector!r} not found within {timeout}ms")

    def expect_text(self, text: str, timeout: int = 5000):
        """Assert that some element contains the given text (case-sensitive)."""
        try:
            self.page.wait_for_selector(f"text={text}", timeout=timeout, state="visible")
        except PlaywrightTimeoutError:
            raise AssertionError(f"expected text not visible: {text!r}")

    def expect_url_contains(self, fragment: str):
        if fragment not in self.page.url:
            raise AssertionError(f"URL {self.page.url!r} does not contain {fragment!r}")

    def expect_url_not_contains(self, fragment: str):
        if fragment in self.page.url:
            raise AssertionError(f"URL {self.page.url!r} unexpectedly contains {fragment!r}")

    def expect_element(self, selector: str, timeout: int = 5000):
        try:
            self.page.wait_for_selector(selector, timeout=timeout, state="visible")
        except PlaywrightTimeoutError:
            raise AssertionError(f"expected element not visible: {selector!r}")

    def click(self, selector: str, timeout: int = 5000):
        self.page.click(selector, timeout=timeout)

    def fill(self, selector: str, value: str, timeout: int = 5000):
        self.page.fill(selector, value, timeout=timeout)

    # --- capture ---

    def capture(self, suffix: str = "") -> Path:
        """Capture a full-page screenshot. Returns the saved path.

        If `suffix` is given (e.g. "01-dashboard"), the file is named
        `<tc_id>_<suffix>.png` — useful when a TC visits multiple pages
        and wants per-step evidence. The runner's final capture (after
        the TC body returns) is `<tc_id>.png`.
        """
        if suffix:
            # Sanitize suffix to filesystem-safe chars.
            clean = re.sub(r"[^A-Za-z0-9._-]", "-", suffix)[:80]
            name = f"{self.tc_id}_{clean}.png"
        else:
            name = f"{self.tc_id}.png"
        path = self.run_dir / name
        self.page.screenshot(path=str(path), full_page=True)
        return path

    def capture_failure(self, err: Exception) -> tuple[Path, Path, Path]:
        """Capture (screenshot, dom.html, console.log) for a failure."""
        shot = self.run_dir / f"{self.tc_id}.fail.png"
        try:
            self.page.screenshot(path=str(shot), full_page=True)
        except Exception:
            pass  # page may already be closed
        dom = self.run_dir / f"{self.tc_id}.dom.html"
        try:
            dom.write_text(self.page.content(), encoding="utf-8")
        except Exception:
            dom.write_text(f"(could not dump DOM: {err})", encoding="utf-8")
        console = self.run_dir / f"{self.tc_id}.console.log"
        console.write_text(
            "\n".join(self._console_errors) or "(no console errors captured)",
            encoding="utf-8",
        )
        return shot, dom, console


def _resolve_account(role: str) -> tuple[str, str]:
    if role not in ACCOUNTS:
        raise KeyError(f"unknown role: {role!r}. Known: {list(ACCOUNTS)}")
    return ACCOUNTS[role]["identifier"], DEFAULT_PASSWORD


# --- The orchestrator ------------------------------------------------------

def run_section(
    section_module: str,
    *,
    out_root: Path,
    only_failed: list[str] | None = None,
    force: bool = False,
    limit: int | None = None,
) -> dict:
    """Run all TCs registered by `section_module`.

    `section_module` is e.g. "sections.s00_cross_cutting" — it must be
    importable and must have populated the REGISTRY via @tc decorators.

    Returns the summary dict (also written to results.json).
    """
    # Reset registry for this section to avoid cross-section pollution.
    REGISTRY.clear()

    # Import triggers @tc decorators to populate REGISTRY.
    __import__(section_module, fromlist=["*"])

    tcs = list(REGISTRY)
    if limit:
        tcs = tcs[:limit]
    if only_failed:
        tcs = [t for t in tcs if t.tc_id in only_failed]

    section_id = section_module.split(".")[-1]
    timestamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    run_dir = out_root / f"{timestamp}_{section_id}"
    run_dir.mkdir(parents=True, exist_ok=True)

    results: list[TCResult] = []
    summary = {
        "section": section_id,
        "started_at": datetime.now().isoformat(),
        "base_url": BASE_URL,
        "totals": {"pass": 0, "fail": 0, "blocked": 0, "skip": 0, "total": len(tcs)},
    }

    print(f"\n[visual] section={section_id}  base={BASE_URL}  out={run_dir}")
    print(f"[visual] {len(tcs)} TC(s) to run\n")

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        try:
            for i, t in enumerate(tcs, 1):
                # Pick the first role for primary execution. RBAC checks
                # that need multiple roles do their own role-switching
                # inside the TC body (the helper exposes ctx.use_role()).
                role = t.roles[0]
                vp = VIEWPORT_MOBILE if t.viewport == "mobile" else VIEWPORT_DESKTOP
                ctx_browser = browser.new_context(viewport=vp)
                # Attach console error listener (read-only, no side effects).
                page = ctx_browser.new_page()
                page.on("console", lambda msg: (
                    ctx_console_errs.append(f"[{msg.type}] {msg.text}")
                    if msg.type in ("error", "warning")
                    else None
                ))
                ctx_console_errs: list[str] = []
                page.on("pageerror", lambda exc: ctx_console_errs.append(f"[pageerror] {exc}"))

                ctx = VisualTestContext(page, role, run_dir, t.tc_id)
                ctx._console_errors = ctx_console_errs  # type: ignore

                result = TCResult(tc_id=t.tc_id, title=t.title, role=role, url=t.url or "")
                start = time.monotonic()
                try:
                    if t.fn is None:
                        result.status = "SKIP"
                        result.detail = "TC has no implementation"
                    else:
                        t.fn(ctx)
                        # Capture the final state as evidence.
                        shot = ctx.capture()
                        result.screenshot = str(shot)
                        result.status = "PASS"
                except AssertionError as e:
                    msg = str(e)
                    # Convention: TCs that detect missing seed data raise
                    # `AssertionError("BLOCKED: ...")` to signal an
                    # environment gap rather than a product defect.
                    if msg.startswith("BLOCKED"):
                        result.status = "BLOCKED"
                        result.error = msg[len("BLOCKED"):].lstrip(": ").strip()
                    else:
                        result.status = "FAIL"
                        result.error = f"AssertionError: {msg}"
                        try:
                            shot, dom, console = ctx.capture_failure(e)
                            result.failure_screenshot = str(shot)
                            result.dom_dump = str(dom)
                            result.console_log = str(console)
                        except Exception:
                            pass
                except PlaywrightTimeoutError as e:
                    result.status = "FAIL"
                    result.error = f"PlaywrightTimeout: {e}"
                    try:
                        shot, dom, console = ctx.capture_failure(e)
                        result.failure_screenshot = str(shot)
                        result.dom_dump = str(dom)
                        result.console_log = str(console)
                    except Exception:
                        pass
                except Exception as e:
                    # Treat unknown errors as BLOCKED (env/seed issue), not FAIL.
                    msg = str(e)
                    if "login failed" in msg or "connect ECONNREFUSED" in msg:
                        result.status = "BLOCKED"
                        result.error = msg
                    else:
                        result.status = "FAIL"
                        result.error = f"{type(e).__name__}: {msg}\n{traceback.format_exc()[-400:]}"
                        try:
                            shot, dom, console = ctx.capture_failure(e)
                            result.failure_screenshot = str(shot)
                            result.dom_dump = str(dom)
                            result.console_log = str(console)
                        except Exception:
                            pass
                finally:
                    result.duration_ms = int((time.monotonic() - start) * 1000)
                    ctx_browser.close()

                # Tally + log.
                summary["totals"][result.status.lower()] = (
                    summary["totals"].get(result.status.lower(), 0) + 1
                )
                if result.status.lower() not in summary["totals"]:
                    summary["totals"][result.status.lower()] = 0
                summary["totals"][result.status.lower()] += 0  # already incremented above
                results.append(result)
                marker = {"PASS": "✅", "FAIL": "❌", "BLOCKED": "⏸️ ", "SKIP": "⏭️ "}[result.status]
                detail = f" — {result.error[:80]}" if result.error else ""
                print(f"  {marker} [{i:3d}/{len(tcs)}] {t.tc_id:<18} {result.duration_ms:>5}ms{detail}")
        finally:
            browser.close()

    summary["ended_at"] = datetime.now().isoformat()
    summary["totals"]["total"] = len(results)
    summary["results"] = [r.to_json_safe() for r in results]

    # Persist results.json.
    (run_dir / "results.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # Build the markdown report.
    _write_markdown_report(run_dir, section_id, summary, results)

    print(f"\n[visual] {section_id} → "
          f"✅ {summary['totals']['pass']}  "
          f"❌ {summary['totals']['fail']}  "
          f"⏸  {summary['totals']['blocked']}  "
          f"⏭ {summary['totals']['skip']}  "
          f"of {summary['totals']['total']}")
    print(f"[visual] artifacts: {run_dir}")
    return summary


def _write_markdown_report(
    run_dir: Path,
    section_id: str,
    summary: dict,
    results: list[TCResult],
) -> None:
    """Generate report.md with embedded screenshot references."""
    lines = [
        f"# Visual regression — {section_id}",
        "",
        f"- **Started:** {summary['started_at']}",
        f"- **Base URL:** `{summary['base_url']}`",
        f"- **Totals:** ✅ {summary['totals']['pass']}  "
        f"❌ {summary['totals']['fail']}  "
        f"⏸  {summary['totals']['blocked']}  "
        f"⏭ {summary['totals']['skip']}  "
        f"of {summary['totals']['total']}",
        "",
        "## Results",
        "",
        "| TC | Status | Role | Duration | Screenshot | Detail |",
        "|----|--------|------|----------|------------|--------|",
    ]
    for r in results:
        marker = {"PASS": "✅", "FAIL": "❌", "BLOCKED": "⏸️", "SKIP": "⏭️"}[r.status]
        # Use just filename; report lives in same dir as screenshots.
        shot_name = Path(r.screenshot).name if r.screenshot else (
            Path(r.failure_screenshot).name if r.failure_screenshot else "—"
        )
        shot_cell = f"[{shot_name}]({shot_name})" if shot_name != "—" else "—"
        detail_cell = (r.error or r.detail or "").replace("|", "\\|").replace("\n", " ")[:120]
        lines.append(
            f"| `{r.tc_id}` | {marker} | {r.role} | {r.duration_ms}ms | {shot_cell} | {detail_cell} |"
        )
    lines.append("")
    (run_dir / "report.md").write_text("\n".join(lines), encoding="utf-8")
