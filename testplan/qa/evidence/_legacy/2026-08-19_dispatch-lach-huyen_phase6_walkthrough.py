#!/usr/bin/env python3
"""Phase 6 multi-viewport walkthrough: dieuvan (DISPATCHER) exercises the
changed dispatch surfaces at 1280/768/390/320. Writes a markdown evidence
report next to this script."""
import json
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = 'http://localhost:7174'
API = 'http://localhost:3001'
OUT = Path(__file__).with_name('2026-08-19_dispatch-lach-huyen_phase6_walkthrough.md')
VIEWPORTS = [(1280, 800), (768, 900), (390, 760), (320, 680)]
RESULTS: list[dict] = []


def check(page, label, ok, detail=''):
    RESULTS.append({'label': label, 'ok': bool(ok), 'detail': str(detail)[:300]})
    print(('PASS ' if ok else 'FAIL ') + label + (f' — {detail}' if detail and not ok else ''))


class ConsoleCapture:
    """Playwright <1.40-compatible console capture."""

    def __init__(self, page):
        self.errors: list[str] = []
        self.failed_requests: list[str] = []
        page.on('console', lambda msg: self.errors.append(msg.text) if msg.type == 'error' else None)
        page.on('requestfailed', lambda req: self.failed_requests.append(req.url) if '/api/' in req.url else None)

    def snapshot(self):
        return {'console': self.errors[:5], 'failed': self.failed_requests[:5]}


def run():
    report_lines = [
        '# Phase 6 — dieuvan multi-viewport walkthrough',
        '',
        f'- Date: 2026-08-19 · Backend {API} · Frontend {BASE}',
        '- Role: DISPATCHER (dieuvan) — the writer role for both workspaces.',
        '',
    ]
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context()
        # Login once via UI.
        page = ctx.new_page()
        capture = ConsoleCapture(page)
        page.goto(f'{BASE}/login', wait_until='networkidle')
        page.fill('#username-input', 'dieuvan', timeout=10_000)
        page.fill('#password-input', 'Abc123')
        page.click('button[type="submit"]')
        page.wait_for_url(lambda url: '/login' not in url, timeout=15_000)
        check(page, 'login as dieuvan succeeds', '/login' not in page.url, page.url)

        for width, height in VIEWPORTS:
            tag = f'{width}x{height}'
            page.set_viewport_size({'width': width, 'height': height})

            # ── Master plan (/dispatch) ────────────────────────────────
            page.goto(f'{BASE}/dispatch', wait_until='networkidle')
            time.sleep(1.0)
            body = page.locator('body')
            check(page, f'[{tag}] /dispatch loads', 'Kế hoạch' in page.content())
            check(page, f'[{tag}] no horizontal overflow on /dispatch',
                  page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'),
                  page.evaluate('document.documentElement.scrollWidth'))
            for label in ['Cảng Lạch Huyện', 'Nhà xe']:
                ctrl = page.get_by_text(label, exact=False).first
                check(page, f'[{tag}] facet control "{label}" visible', ctrl.is_visible())
            snap = capture.snapshot()
            check(page, f'[{tag}] no console errors on /dispatch',
                  not snap['console'], json.dumps(snap))

            # ── Detail plan (/dispatch-detail) ─────────────────────────
            page.goto(f'{BASE}/dispatch-detail', wait_until='networkidle')
            time.sleep(1.0)
            check(page, f'[{tag}] /dispatch-detail loads', 'Kế hoạch Chi tiết' in page.content() or 'dòng kế hoạch' in page.content())
            check(page, f'[{tag}] no horizontal overflow on /dispatch-detail',
                  page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'),
                  page.evaluate('document.documentElement.scrollWidth'))
            snap = capture.snapshot()
            check(page, f'[{tag}] no console errors on /dispatch-detail',
                  not snap['console'], json.dumps(snap))
            headers = page.locator('thead th').all_inner_texts() if page.locator('thead').count() else []
            check(page, f'[{tag}] detail columns include Phân loại',
                  any('phân loại' in h.lower() for h in headers), headers)
            check(page, f'[{tag}] detail column order Điều phối before Ghi chú',
                  next((i for i, h in enumerate(headers) if 'Điều phối' in h), -1)
                  < next((i for i, h in enumerate(headers) if 'Ghi chú' in h), 999), headers)

            # Editor dialog (first row only, desktop widths to keep it stable)
            if width >= 768 and page.locator('[aria-label*="Sửa ô điều phối"]').count() > 0:
                page.locator('[aria-label*="Sửa ô điều phối"]').first.click()
                page.wait_for_selector('[role="dialog"]', timeout=10_000)
                dialog = page.locator('[role="dialog"]')
                for field_label in ['Nhà xe', 'Phân loại', 'Cước thu dự kiến']:
                    check(page, f'[{tag}] editor has "{field_label}"',
                          dialog.get_by_text(field_label, exact=False).first.is_visible())
                # Escape closes and restores focus.
                page.keyboard.press('Escape')
                page.wait_for_timeout(400)
                check(page, f'[{tag}] Escape closes editor', page.locator('[role="dialog"]').count() == 0)

            # ── Ports config denied for DISPATCHER ─────────────────────
            # adminOnly guard redirects DISPATCHER away from the ports CRUD.
            page.goto(f'{BASE}/config/ports', wait_until='networkidle')
            time.sleep(0.6)
            redirected = '/config/ports' not in page.url
            check(page, f'[{tag}] DISPATCHER redirected away from /config/ports', redirected, page.url)

        # ADMIN parity spot-check at 1280 (login as admin from seed docs).
        admin_page = ctx.new_page()
        admin_capture = ConsoleCapture(admin_page)
        admin_page.set_viewport_size({'width': 1280, 'height': 800})
        admin_page.goto(f'{BASE}/login', wait_until='networkidle')
        # Log out via localStorage clear then log in as admin.
        admin_page.evaluate('localStorage.clear()')
        admin_page.goto(f'{BASE}/login', wait_until='networkidle')
        admin_page.fill('#username-input', 'admin', timeout=10_000)
        admin_page.fill('#password-input', 'Abc123')
        admin_page.click('button[type="submit"]')
        admin_page.wait_for_url(lambda url: '/login' not in url, timeout=15_000)
        admin_page.goto(f'{BASE}/config/ports', wait_until='networkidle')
        time.sleep(1.0)
        rows = admin_page.locator('.cfg-row, table tbody tr').count()
        check(admin_page, '[1280x800] ADMIN /config/ports lists ports', rows > 0, f'rows={rows}')
        check(admin_page, '[1280x800] ADMIN port page mentions Lạch Huyện',
              'Lạch Huyện' in admin_page.content())
        snap = admin_capture.snapshot()
        check(admin_page, '[admin] no console errors on /config/ports',
              not snap['console'], json.dumps(snap))
        browser.close()

    passed = sum(1 for r in RESULTS if r['ok'])
    report_lines.append(f'**Result: {passed}/{len(RESULTS)} checks passed.**')
    report_lines.append('')
    report_lines.append('| # | Check | Result | Detail |')
    report_lines.append('|---|-------|--------|--------|')
    for i, r in enumerate(RESULTS, 1):
        report_lines.append(f"| {i} | {r['label']} | {'✅' if r['ok'] else '❌'} | {r['detail'] or ''} |")
    OUT.write_text('\n'.join(report_lines), encoding='utf-8')
    print(f'\n{passed}/{len(RESULTS)} passed → {OUT}')
    return 0 if passed == len(RESULTS) else 1


if __name__ == '__main__':
    raise SystemExit(run())
