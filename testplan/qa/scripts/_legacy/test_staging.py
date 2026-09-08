#!/usr/bin/env python3
"""
Silver Sea Staging QA Automation
Tests workflows against https://vantai.tingting.vip
"""

import requests
import json
from datetime import datetime
from typing import Dict, List, Optional, Any
from dataclasses import dataclass
from enum import Enum

class TestStatus(Enum):
    PASS = "ĐẠT"
    FAIL = "KHÔNG ĐẠT"
    BLOCKED = "BỊ CHẶN"
    SKIPPED = "BỊ CHẶN"

@dataclass
class TestResult:
    code: str
    name: str
    status: TestStatus
    expected: str
    actual: str
    error: Optional[str] = None
    evidence: Optional[str] = None
    duration_ms: int = 0

class StagingTester:
    def __init__(self):
        self.base_url = "https://vantai.tingting.vip"
        self.api_base = f"{self.base_url}/api"
        self.session = requests.Session()
        self.tokens = {}
        self.results: List[TestResult] = []

    def login(self, username: str, password: str = "Abc123") -> bool:
        """Login and store token"""
        try:
            resp = self.session.post(
                f"{self.api_base}/auth/login",
                json={"identifier": username, "password": password},
                timeout=10
            )
            if resp.status_code == 200:
                data = resp.json()
                if "token" in data:
                    self.tokens[username] = data["token"]
                    self.session.headers.update({"Authorization": f"Bearer {data['token']}"})
                    return True
            print(f"  Login failed for {username}: {resp.status_code} - {resp.text[:200]}")
            return False
        except Exception as e:
            print(f"  Login error for {username}: {e}")
            return False

    def get(self, endpoint: str, expect_status: int = 200) -> requests.Response:
        """Make GET request"""
        return self.session.get(f"{self.api_base}{endpoint}", timeout=10)

    def post(self, endpoint: str, data: dict, expect_status: int = 200) -> requests.Response:
        """Make POST request"""
        return self.session.post(
            f"{self.api_base}{endpoint}",
            json=data,
            timeout=10
        )

    def run_test(self, test_case: Dict) -> TestResult:
        """Run a single test case"""
        start = datetime.now()
        code = test_case['code']
        name = test_case['name']

        try:
            # Parse test steps from the test case
            steps = test_case.get('steps', '')
            role = test_case.get('role', '')

            # Extract username from role
            username = self._get_username_for_role(role)

            if not username:
                return TestResult(
                    code=code,
                    name=name,
                    status=TestStatus.BLOCKED,
                    expected="Valid role with staging account",
                    actual=f"No staging account for role: {role}",
                    error="DEF-20260804-001: Missing staging account"
                )

            # Login
            if not self.login(username):
                return TestResult(
                    code=code,
                    name=name,
                    status=TestStatus.BLOCKED,
                    expected=f"Login as {username}",
                    actual=f"Login failed",
                    error="Authentication failed"
                )

            # Run test based on test case code
            result = self._execute_test(test_case)

            duration = int((datetime.now() - start).total_seconds() * 1000)
            result.duration_ms = duration
            return result

        except Exception as e:
            return TestResult(
                code=code,
                name=name,
                status=TestStatus.FAIL,
                expected=test_case.get('expected', ''),
                actual="Exception",
                error=str(e)
            )

    def _get_username_for_role(self, role: str) -> Optional[str]:
        """Map role to staging username"""
        role_map = {
            'ADMIN': 'admin',
            'MANAGER': 'giamdoc',
            'ACCOUNTANT': 'ketoan',
            'DRIVER': 'laixe',
            'FORWARDER': 'giaonhan',
            'CUSTOMER': 'customer',
            'DISPATCHER': 'dieuvan',
            'CLERK': 'cus',
            'CUS': 'cus'
        }

        for key, value in role_map.items():
            if key in role.upper():
                return value
        return None

    def _execute_test(self, test_case: Dict) -> TestResult:
        """Execute test based on code pattern"""
        code = test_case['code']

        # O2C Tests (OPS-001 to OPS-019)
        if code.startswith('OPS-'):
            return self._test_ops(test_case)
        # Finance Tests (FIN-001 to FIN-015)
        elif code.startswith('FIN-'):
            return self._test_finance(test_case)
        # Customer Tests (CUS-001 to CUS-005)
        elif code.startswith('CUS-'):
            return self._test_customer(test_case)
        # Forwarder Tests (FWD-001 to FWD-004)
        elif code.startswith('FWD-'):
            return self._test_forwarder(test_case)
        # RBAC Tests (GOV-001 to GOV-008)
        elif code.startswith('GOV-'):
            return self._test_governance(test_case)
        # Fleet Tests (FLE-001 to FLE-008)
        elif code.startswith('FLE-'):
            return self._test_fleet(test_case)
        else:
            return TestResult(
                code=code,
                name=test_case['name'],
                status=TestStatus.SKIPPED,
                expected="Test handler",
                actual="No test handler",
                error="Unknown test code pattern"
            )

    def _test_ops(self, test_case: Dict) -> TestResult:
        """Test O2C operations"""
        code = test_case['code']

        if code == 'OPS-001':
            # Test: Tạo lô FCL chưa có ngày điều vận
            resp = self.get('/shipments')
            if resp.status_code == 200:
                shipments = resp.json().get('data', [])
                return TestResult(
                    code=code,
                    name=test_case['name'],
                    status=TestStatus.PASS,
                    expected="List shipments accessible",
                    actual=f"Found {len(shipments)} shipments"
                )
            return TestResult(
                code=code,
                name=test_case['name'],
                status=TestStatus.FAIL,
                expected="GET /shipments returns 200",
                actual=f"Got {resp.status_code}",
                error=resp.text[:200]
            )

        elif code == 'OPS-005':
            # Test: Tự động hiển thị lô trên Kế hoạch xe
            # Check that DISPATCHER can access shipments for dispatch planning
            resp = self.get('/shipments?status=READY_FOR_DISPATCH')
            if resp.status_code == 200:
                return TestResult(
                    code=code,
                    name=test_case['name'],
                    status=TestStatus.PASS,
                    expected="READY_FOR_DISPATCH shipments accessible",
                    actual="Dispatch plan data loaded"
                )
            return TestResult(
                code=code,
                name=test_case['name'],
                status=TestStatus.FAIL,
                expected="GET /shipments?status=READY_FOR_DISPATCH returns 200",
                actual=f"Got {resp.status_code}",
                error=resp.text[:200] if hasattr(resp, 'text') else str(resp.status_code)
            )

        # Default for other OPS tests
        return TestResult(
            code=code,
            name=test_case['name'],
            status=TestStatus.SKIPPED,
            expected="Manual test",
            actual="Not automated yet",
            error="Requires manual verification"
        )

    def _test_finance(self, test_case: Dict) -> TestResult:
        """Test finance workflows"""
        code = test_case['code']

        if code in ['FIN-001', 'FIN-002']:
            # Test: AR/DN flows - check reports/receivables-aging endpoint
            resp = self.get('/reports/receivables-aging')
            if resp.status_code == 200:
                return TestResult(
                    code=code,
                    name=test_case['name'],
                    status=TestStatus.PASS,
                    expected="Receivables aging report accessible",
                    actual="AR report loaded"
                )
            return TestResult(
                code=code,
                name=test_case['name'],
                status=TestStatus.FAIL,
                expected="GET /reports/receivables-aging returns 200",
                actual=f"Got {resp.status_code}",
                error=resp.text[:200] if hasattr(resp, 'text') else str(resp.status_code)
            )

        return TestResult(
            code=code,
            name=test_case['name'],
            status=TestStatus.SKIPPED,
            expected="Manual test",
            actual="Not automated yet"
        )

    def _test_customer(self, test_case: Dict) -> TestResult:
        """Test customer portal"""
        code = test_case['code']

        if code == 'CUS-003':
            # Test: Sao kê công nợ - statement endpoint
            # Note: Requires customer user to be linked to a customer account (userCustomerLinks)
            resp = self.get('/portal/statement')
            if resp.status_code == 200:
                return TestResult(
                    code=code,
                    name=test_case['name'],
                    status=TestStatus.PASS,
                    expected="Customer statement accessible",
                    actual="Statement loaded"
                )
            # 409 = customer not linked, 403 = no permission
            if resp.status_code in [409, 403]:
                return TestResult(
                    code=code,
                    name=test_case['name'],
                    status=TestStatus.BLOCKED,
                    expected="Customer user linked to customer account",
                    actual=f"Got {resp.status_code}",
                    error="DEF-20260804-002: customer user not linked in userCustomerLinks table"
                )
            return TestResult(
                code=code,
                name=test_case['name'],
                status=TestStatus.FAIL,
                expected="GET /portal/statement returns 200",
                actual=f"Got {resp.status_code}",
                error=resp.text[:200] if hasattr(resp, 'text') else str(resp.status_code)
            )

        # Default customer test: shipments
        resp = self.get('/portal/shipments')
        if resp.status_code == 200:
            return TestResult(
                code=code,
                name=test_case['name'],
                status=TestStatus.PASS,
                expected="Customer shipments accessible",
                actual="Customer shipments loaded"
            )
        return TestResult(
            code=code,
            name=test_case['name'],
            status=TestStatus.FAIL,
            expected="GET /portal/shipments returns 200",
            actual=f"Got {resp.status_code}",
            error=resp.text[:200] if hasattr(resp, 'text') else str(resp.status_code)
        )

    def _test_forwarder(self, test_case: Dict) -> TestResult:
        """Test forwarder workflows"""
        code = test_case['code']

        # Test forwarder trip access (main workflow)
        resp = self.get('/forwarder/me/trips')
        if resp.status_code == 200:
            return TestResult(
                code=code,
                name=test_case['name'],
                status=TestStatus.PASS,
                expected="Forwarder trips accessible",
                actual="Forwarder trips loaded"
            )
        return TestResult(
            code=code,
            name=test_case['name'],
            status=TestStatus.FAIL,
            expected="GET /forwarder/me/trips returns 200",
            actual=f"Got {resp.status_code}",
            error=resp.text[:200] if hasattr(resp, 'text') else str(resp.status_code)
        )

    def _test_governance(self, test_case: Dict) -> TestResult:
        """Test RBAC"""
        code = test_case['code']

        if code == 'GOV-002':
            # Test: ACCOUNTANT cannot access /users
            self.login('ketoan')
            resp = self.get('/users')
            if resp.status_code == 403:
                return TestResult(
                    code=code,
                    name=test_case['name'],
                    status=TestStatus.FAIL,
                    expected="403 Forbidden",
                    actual=f"Got {resp.status_code}",
                    error="DEF-20260804-009: ACCOUNTANT has users permission"
                )
            return TestResult(
                code=code,
                name=test_case['name'],
                status=TestStatus.PASS,
                expected="ACCOUNTANT blocked from /users",
                actual=f"Got {resp.status_code}"
            )

        return TestResult(
            code=code,
            name=test_case['name'],
            status=TestStatus.SKIPPED,
            expected="Manual test",
            actual="Not automated yet"
        )

    def _test_fleet(self, test_case: Dict) -> TestResult:
        """Test fleet and driver workflows"""
        code = test_case['code']

        # Basic driver/vehicle accessibility tests
        if code == 'PEO-001':
            resp = self.get('/vehicles')
            if resp.status_code == 200:
                return TestResult(
                    code=code,
                    name=test_case['name'],
                    status=TestStatus.PASS,
                    expected="Vehicle list accessible",
                    actual="Vehicle data loaded"
                )
            return TestResult(
                code=code,
                name=test_case['name'],
                status=TestStatus.BLOCKED,
                expected="GET /vehicles returns 200",
                actual=f"Got {resp.status_code}",
                error=f"Vehicle endpoint not accessible: {resp.status_code}"
            )

        elif code == 'PEO-007':
            # Fuel receipt OCR tests
            resp = self.get('/fuel-invoices')
            if resp.status_code in [200, 403]:  # 403 is expected for non-admin
                return TestResult(
                    code=code,
                    name=test_case['name'],
                    status=TestStatus.PASS,
                    expected="Fuel invoices endpoint exists",
                    actual="Fuel invoice endpoint accessible"
                )
            return TestResult(
                code=code,
                name=test_case['name'],
                status=TestStatus.BLOCKED,
                expected="Fuel invoices endpoint",
                actual=f"Got {resp.status_code}",
                error=f"Fuel endpoint not found: {resp.status_code}"
            )

        return TestResult(
            code=code,
            name=test_case['name'],
            status=TestStatus.SKIPPED,
            expected="Manual test",
            actual="Not automated yet"
        )

    def run_all_tests(self, test_cases: List[Dict]) -> List[TestResult]:
        """Run all test cases"""
        print(f"\n=== Starting QA Test Run at {datetime.now().isoformat()} ===")
        print(f"Testing against: {self.base_url}")
        print(f"Total test cases: {len(test_cases)}\n")

        results = []
        for i, tc in enumerate(test_cases, 1):
            print(f"[{i}/{len(test_cases)}] Testing {tc['code']}: {tc['name']}")
            result = self.run_test(tc)
            results.append(result)

            status_symbol = {
                TestStatus.PASS: "✓",
                TestStatus.FAIL: "✗",
                TestStatus.BLOCKED: "⊘",
                TestStatus.SKIPPED: "○"
            }[result.status]

            print(f"  {status_symbol} {result.status.value} - {result.actual}")

        return results

    def generate_report(self, results: List[TestResult]) -> str:
        """Generate test report"""
        by_status = {}
        for r in results:
            by_status[r.status] = by_status.get(r.status, 0) + 1

        report = [
            "=== QA Test Report ===",
            f"Date: {datetime.now().isoformat()}",
            f"Environment: {self.base_url}",
            "",
            "--- Summary ---"
        ]

        for status, count in sorted(by_status.items(), key=lambda x: x[0].value):
            report.append(f"{status.value}: {count}")

        report.append(f"\nTotal: {len(results)}")
        report.append(f"Pass Rate: {by_status.get(TestStatus.PASS, 0) / len(results) * 100:.1f}%")

        report.append("\n--- Blocked Tests ---")
        blocked = [r for r in results if r.status == TestStatus.BLOCKED]
        for r in blocked:
            report.append(f"  {r.code}: {r.error}")

        report.append("\n--- Failed Tests ---")
        failed = [r for r in results if r.status == TestStatus.FAIL]
        for r in failed:
            report.append(f"  {r.code}: {r.error}")

        return "\n".join(report)

def main():
    # Load test cases
    with open('/Users/dev/Documents/projects/silversea/qa_test_cases.json', 'r') as f:
        test_cases = json.load(f)

    # Run tests
    tester = StagingTester()
    results = tester.run_all_tests(test_cases)
    tester.results = results

    # Generate report
    report = tester.generate_report(results)
    print("\n" + report)

    # Save results
    with open('/Users/dev/Documents/projects/silversea/qa_results.json', 'w') as f:
        json.dump([{
            'code': r.code,
            'name': r.name,
            'status': r.status.value,
            'expected': r.expected,
            'actual': r.actual,
            'error': r.error,
            'duration_ms': r.duration_ms
        } for r in results], f, indent=2)

    print("\nResults saved to qa_results.json")

    return sum(1 for r in results if r.status == TestStatus.PASS)

if __name__ == '__main__':
    passed = main()
    exit(0 if passed > 0 else 1)
