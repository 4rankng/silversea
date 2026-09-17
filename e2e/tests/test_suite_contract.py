import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from suite_contract import all_cases_pass, discover_suites, summarize, validate_result


def artifact(rows):
    return {'results': rows, 'total': len(rows),
            'passed': sum(row.get('status') == 'PASS' for row in rows),
            'failed': sum(row.get('status') == 'FAIL' for row in rows),
            'skipped': sum(row.get('status') == 'SKIP' for row in rows)}


class SuiteContractTests(unittest.TestCase):
    def test_default_discovery_includes_both_real_driver_suites(self):
        names = [path.name for path in discover_suites(Path(__file__).resolve().parents[1])]
        self.assertIn('test_20_driver_flow_e2e.py', names)
        self.assertIn('test_20_visual_driver.py', names)

    def test_explicit_selection_keeps_multiple_files_and_deduplicates(self):
        with tempfile.TemporaryDirectory() as directory:
            for name in ['test_00_auth.py', 'test_20_flow.py', 'test_20_visual.py', 'test_helper.py']:
                Path(directory, name).touch()
            self.assertEqual([path.name for path in discover_suites(directory, ['20', '20'])],
                             ['test_20_flow.py', 'test_20_visual.py'])
            self.assertEqual(len(discover_suites(directory)), 3)
            for selector in ['99', '-1', 'all', '200', '../20']:
                with self.subTest(selector=selector), self.assertRaises(ValueError):
                    discover_suites(directory, [selector])

    def test_empty_discovery_is_nonpassing(self):
        with tempfile.TemporaryDirectory() as directory, self.assertRaises(ValueError):
            discover_suites(directory)

    def test_only_nonempty_all_pass_results_succeed(self):
        self.assertTrue(validate_result(artifact([{'status': 'PASS'}])))
        for verdict in ['FAIL', 'SKIP', 'BLOCKED', 'ERROR', 'INCONCLUSIVE', None]:
            with self.subTest(verdict=verdict):
                rows = [{'status': 'PASS'}, {'status': verdict}]
                self.assertFalse(all_cases_pass(rows))
                self.assertFalse(validate_result(artifact(rows)))
        for value in [None, [], {}, {'results': []}]:
            self.assertFalse(validate_result(value))

    def test_summary_counters_cannot_override_case_results(self):
        passing = artifact([{'status': 'PASS'}])
        for key, value in [('total', 2), ('passed', 0), ('failed', 1), ('skipped', 1)]:
            with self.subTest(key=key):
                self.assertFalse(validate_result({**passing, key: value}))

    def test_aggregation_fails_for_missing_empty_corrupt_or_skipped_evidence(self):
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()):
            self.assertFalse(summarize(directory, 1))
            self.assertFalse(summarize(directory, 0))
            output = Path(directory, 'suite_results.json')
            output.write_text(json.dumps(artifact([{'status': 'PASS'}])))
            self.assertTrue(summarize(directory, 1))
            self.assertFalse(summarize(directory, 2))
            output.write_text(json.dumps(artifact([{'status': 'SKIP'}])))
            self.assertFalse(summarize(directory, 1))
            output.write_text('{invalid')
            self.assertFalse(summarize(directory, 1))


if __name__ == '__main__':
    unittest.main()
