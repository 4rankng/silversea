from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError

from visual.sections import s98_export_workflow as section


class _TimeoutDownload:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        raise PlaywrightTimeoutError("download timeout")


class _FakeDownload:
    def __init__(self, payload: bytes, failure: str | None = None):
        self.payload = payload
        self._failure = failure

    def failure(self) -> str | None:
        return self._failure

    def save_as(self, path: str) -> None:
        Path(path).write_bytes(self.payload)


class _MissingDownload(_FakeDownload):
    def save_as(self, path: str) -> None:
        return None


class _CompletedDownload:
    def __init__(self, download: _FakeDownload):
        self.value = download

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class _FakePage:
    def __init__(
        self,
        *,
        visible_selectors: set[str] | None = None,
        download: _FakeDownload | None = None,
        timeout_download: bool = False,
    ):
        self.visible_selectors = visible_selectors or set()
        self.download = download
        self.timeout_download = timeout_download

    def wait_for_selector(self, selector: str, **_kwargs) -> None:
        if selector not in self.visible_selectors:
            raise PlaywrightTimeoutError(f"missing: {selector}")

    def expect_download(self, **_kwargs):
        if self.timeout_download:
            return _TimeoutDownload()
        if self.download is None:
            raise AssertionError("test setup requires a download")
        return _CompletedDownload(self.download)

    def click(self, *_args, **_kwargs) -> None:
        return None


class _FakeContext:
    def __init__(
        self,
        page: _FakePage,
        run_dir: Path,
        tc_id: str = "TC-EXPORT",
        login_error: Exception | None = None,
    ):
        self.page = page
        self.run_dir = run_dir
        self.tc_id = tc_id
        self.detail = ""
        self.login_error = login_error

    def login(self, *_args) -> None:
        if self.login_error:
            raise self.login_error
        return None

    def goto(self, *_args) -> None:
        return None


class ExportWorkflowTruthfulnessTests(unittest.TestCase):
    def test_required_auth_failure_is_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            ctx = _FakeContext(
                _FakePage(),
                Path(tmp),
                login_error=RuntimeError("login failed for ADMIN"),
            )
            with self.assertRaisesRegex(
                AssertionError,
                "ADMIN export authentication failed",
            ):
                section._login_for_required_export(ctx, "ADMIN")

    def test_required_missing_control_is_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            ctx = _FakeContext(_FakePage(), Path(tmp))
            with self.assertRaisesRegex(
                AssertionError,
                "required export control not found",
            ):
                section._find_export_control(
                    ctx,
                    ['button:has-text("Xuất Excel")'],
                    surface="/finance P&L XLSX",
                )

    def test_optional_missing_control_is_non_acceptance(self):
        with tempfile.TemporaryDirectory() as tmp:
            ctx = _FakeContext(_FakePage(), Path(tmp))
            with self.assertRaisesRegex(
                AssertionError,
                "^BLOCKED: optional capability not exposed",
            ):
                section._find_export_control(
                    ctx,
                    ['button:has-text("PDF")'],
                    surface="/customers/:id debt-detail PDF",
                    optional=True,
                )

    def test_download_timeout_is_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            ctx = _FakeContext(
                _FakePage(timeout_download=True),
                Path(tmp),
            )
            with self.assertRaisesRegex(
                AssertionError,
                "did not trigger a download within 15 seconds",
            ):
                section._download_and_assert(
                    ctx,
                    'button:has-text("Xuất Excel")',
                    extension="xlsx",
                    magic=b"PK",
                    description="finance P&L XLSX",
                )

    def test_download_failure_is_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            ctx = _FakeContext(
                _FakePage(download=_FakeDownload(b"", "HTTP 401 Unauthorized")),
                Path(tmp),
            )
            with self.assertRaisesRegex(
                AssertionError,
                "HTTP 401 Unauthorized",
            ):
                section._download_and_assert(
                    ctx,
                    'button:has-text("Xuất Excel")',
                    extension="xlsx",
                    magic=b"PK",
                    description="finance P&L XLSX",
                )

    def test_invalid_download_is_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            ctx = _FakeContext(
                _FakePage(download=_FakeDownload(b"not-an-xlsx" * 100)),
                Path(tmp),
            )
            with self.assertRaisesRegex(
                AssertionError,
                "invalid file signature",
            ):
                section._download_and_assert(
                    ctx,
                    'button:has-text("Xuất Excel")',
                    extension="xlsx",
                    magic=b"PK",
                    description="finance P&L XLSX",
                )

    def test_missing_download_file_is_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            ctx = _FakeContext(
                _FakePage(download=_MissingDownload(b"PK" + (b"x" * 1000))),
                Path(tmp),
            )
            with self.assertRaisesRegex(
                AssertionError,
                "download file is missing",
            ):
                section._download_and_assert(
                    ctx,
                    'button:has-text("Xuất Excel")',
                    extension="xlsx",
                    magic=b"PK",
                    description="finance P&L XLSX",
                )

    def test_required_tc_propagates_download_timeout(self):
        with tempfile.TemporaryDirectory() as tmp:
            control = 'button:has-text("Xuất sao kê")'
            ctx = _FakeContext(
                _FakePage(
                    visible_selectors={control},
                    timeout_download=True,
                ),
                Path(tmp),
                "TC-EXPORT-XLSX-DEBT",
            )
            with (
                patch.object(section, "_get_first_customer_id", return_value=1),
                self.assertRaisesRegex(
                    AssertionError,
                    "did not trigger a download within 15 seconds",
                ),
            ):
                section.tc_export_xlsx_debt(ctx)

    def test_valid_xlsx_download_passes_validation(self):
        with tempfile.TemporaryDirectory() as tmp:
            payload = b"PK" + (b"x" * 1000)
            ctx = _FakeContext(
                _FakePage(download=_FakeDownload(payload)),
                Path(tmp),
            )
            size = section._download_and_assert(
                ctx,
                'button:has-text("Xuất Excel")',
                extension="xlsx",
                magic=b"PK",
                description="finance P&L XLSX",
            )
            self.assertEqual(size, len(payload))


if __name__ == "__main__":
    unittest.main()
