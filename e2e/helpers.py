"""
Shared E2E test helpers for NEPO logistics system.
Provides login, API client, screenshot capture, and result tracking.
"""
import json
import os
import sys
import time
import traceback
from pathlib import Path
from playwright.sync_api import sync_playwright, Page, Browser, BrowserContext

BASE_URL = os.environ.get('NEPO_URL', 'http://localhost:7173')
API_URL = os.environ.get('NEPO_API', 'http://localhost:3090')
SCREENSHOT_DIR = Path(os.environ.get('NEPO_SCREENSHOTS', '/tmp/nepo-e2e'))
SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)

DEMO_ACCOUNTS = {
    'admin':     {'identifier': 'admin',    'password': 'admin123', 'role': 'ADMIN',     'home': '/dashboard'},
    'manager':   {'identifier': 'giamdoc',  'password': 'admin123', 'role': 'MANAGER',   'home': '/dashboard'},
    'accountant':{'identifier': 'ketoan',   'password': 'admin123', 'role': 'ACCOUNTANT', 'home': '/dashboard'},
    'driver':    {'identifier': 'laixe',    'password': 'admin123', 'role': 'DRIVER',     'home': '/my-trips'},
    'forwarder': {'identifier': 'giaonhan', 'password': 'admin123', 'role': 'FORWARDER',  'home': '/my-forwarder-trips'},
    'customer':  {'identifier': 'customer',  'password': 'admin123', 'role': 'CUSTOMER',   'home': '/portal/shipments'},
}


class TestResults:
    def __init__(self, suite_name: str):
        self.suite_name = suite_name
        self.results = []
        self.start_time = time.time()

    def pass_(self, tc_id: str, title: str, detail: str = ''):
        self.results.append({'tc_id': tc_id, 'title': title, 'status': 'PASS', 'detail': detail})
        print(f'  ✅ {tc_id}: {title}')

    def fail(self, tc_id: str, title: str, detail: str = ''):
        self.results.append({'tc_id': tc_id, 'title': title, 'status': 'FAIL', 'detail': detail})
        print(f'  ❌ {tc_id}: {title} — {detail}')

    def skip(self, tc_id: str, title: str, detail: str = ''):
        self.results.append({'tc_id': tc_id, 'title': title, 'status': 'SKIP', 'detail': detail})
        print(f'  ⏭️  {tc_id}: {title} — SKIPPED')

    @property
    def passed(self):
        return sum(1 for r in self.results if r['status'] == 'PASS')

    @property
    def failed(self):
        return sum(1 for r in self.results if r['status'] == 'FAIL')

    @property
    def skipped(self):
        return sum(1 for r in self.results if r['status'] == 'SKIP')

    @property
    def total(self):
        return len(self.results)

    def print_summary(self):
        elapsed = time.time() - self.start_time
        print(f'\n{"="*60}')
        print(f'  Test Suite: {self.suite_name}')
        print(f'  Total: {self.total}  |  ✅ Pass: {self.passed}  |  ❌ Fail: {self.failed}  |  ⏭️  Skip: {self.skipped}')
        print(f'  Time: {elapsed:.1f}s')
        if self.failed > 0:
            print(f'\n  Failed tests:')
            for r in self.results:
                if r['status'] == 'FAIL':
                    print(f'    ❌ {r["tc_id"]}: {r["title"]} — {r["detail"]}')
        print(f'{"="*60}')
        return self.failed == 0

    def write_json(self, path: str = None):
        path = path or str(SCREENSHOT_DIR / f'{self.suite_name}_results.json')
        with open(path, 'w') as f:
            json.dump({
                'suite': self.suite_name,
                'total': self.total,
                'passed': self.passed,
                'failed': self.failed,
                'skipped': self.skipped,
                'elapsed_s': round(time.time() - self.start_time, 1),
                'results': self.results,
            }, f, ensure_ascii=False, indent=2)


class ApiClient:
    def __init__(self, base_url: str = API_URL):
        self.base_url = base_url
        self.token = None

    def login(self, identifier: str, password: str) -> dict:
        import urllib.request
        data = json.dumps({'identifier': identifier, 'password': password}).encode()
        req = urllib.request.Request(
            f'{self.base_url}/api/auth/login',
            data=data,
            headers={'Content-Type': 'application/json'},
            method='POST',
        )
        try:
            with urllib.request.urlopen(req) as resp:
                body = json.loads(resp.read())
                self.token = body['token']
                return body
        except urllib.error.HTTPError as e:
            return {'error': json.loads(e.read()), 'status': e.code}

    def _request(self, method: str, path: str, body=None, extra_headers=None):
        import urllib.request
        import uuid
        url = f'{self.base_url}{path}'
        headers = {'Content-Type': 'application/json'}
        if self.token:
            headers['Authorization'] = f'Bearer {self.token}'
        if method in ('POST', 'PUT', 'PATCH', 'DELETE'):
            headers['Idempotency-Key'] = f'e2e-{uuid.uuid4()}'
        if extra_headers:
            headers.update(extra_headers)
        data = json.dumps(body).encode() if body else None
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req) as resp:
                return {'status': resp.status, 'data': json.loads(resp.read())}
        except urllib.error.HTTPError as e:
            error_body = e.read()
            try:
                error_data = json.loads(error_body)
            except:
                error_data = error_body.decode()
            return {'status': e.code, 'error': error_data}
        except Exception as e:
            return {'status': 0, 'error': str(e)}

    def get(self, path):
        return self._request('GET', path)

    def post(self, path, body, headers=None):
        return self._request('POST', path, body, headers)

    def put(self, path, body, headers=None):
        return self._request('PUT', path, body, headers)

    def patch(self, path, body, headers=None):
        return self._request('PATCH', path, body, headers)

    def delete(self, path, headers=None, body=None):
        return self._request('DELETE', path, body, headers)


class NepoTestContext:
    def __init__(self, headless: bool = True):
        self.headless = headless
        self.playwright = None
        self.browser = None
        self.api = ApiClient()

    def __enter__(self):
        self.playwright = sync_playwright().__enter__()
        self.browser = self.playwright.chromium.launch(headless=self.headless)
        return self

    def __exit__(self, *args):
        if self.browser:
            self.browser.close()
        # Playwright's `Playwright` object (returned by sync_playwright().__enter__())
        # does not implement __exit__; `.stop()` is the correct shutdown call.
        # The previous `self.playwright.__exit__(*args)` raised AttributeError on
        # every suite, masking the actual test results.
        if self.playwright:
            self.playwright.stop()

    def new_page(self, viewport: dict = None) -> Page:
        vp = viewport or {'width': 1280, 'height': 900}
        context = self.browser.new_context(viewport=vp)
        page = context.new_page()
        return page

    def login_as(self, role_key: str, page: Page = None) -> tuple:
        account = DEMO_ACCOUNTS[role_key]
        api_result = self.api.login(account['identifier'], account['password'])
        token = api_result.get('token')
        user = api_result.get('user', {})

        if page:
            page.goto(f'{BASE_URL}/login')
            page.wait_for_load_state('networkidle')
            page.fill('input[id="username-input"], input[id="identifier"], input[placeholder*="Tên đăng nhập"]', account['identifier'])
            page.fill('input[type="password"]', account['password'])
            page.click('button[type="submit"], button:has-text("Đăng nhập")')
            page.wait_for_load_state('networkidle')
            page.wait_for_timeout(500)
            if token:
                page.evaluate(f'localStorage.setItem("token", "{token}")')
        return page, token, user

    def screenshot(self, page: Page, name: str):
        path = str(SCREENSHOT_DIR / f'{name}.png')
        page.screenshot(path=path, full_page=True)
        return path


def assert_url_contains(page: Page, fragment: str) -> bool:
    return fragment in page.url

def assert_element_visible(page: Page, selector: str, timeout: int = 5000) -> bool:
    try:
        page.wait_for_selector(selector, timeout=timeout)
        return page.locator(selector).is_visible()
    except:
        return False

def assert_text_visible(page: Page, text: str, timeout: int = 5000) -> bool:
    try:
        page.wait_for_selector(f'text={text}', timeout=timeout)
        return True
    except:
        return False

def assert_redirected_to(page: Page, path: str, timeout: int = 5000) -> bool:
    try:
        page.wait_for_url(f'**{path}**', timeout=timeout)
        return True
    except:
        return path in page.url


def run_suite(suite_name: str, test_fn, headless: bool = True):
    print(f'\n🧪 Running: {suite_name}')
    print(f'{"─"*60}')
    results = TestResults(suite_name)

    with NepoTestContext(headless=headless) as ctx:
        try:
            test_fn(ctx, results)
        except Exception as e:
            print(f'\n💥 Suite crashed: {e}')
            traceback.print_exc()
            results.fail('SUITE-CRASH', 'Suite terminated before completion', str(e))

    passed = results.print_summary()
    results.write_json()
    return 0 if passed else 1
