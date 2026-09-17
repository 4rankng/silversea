import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from target_contract import resolve_targets


class TargetContractTests(unittest.TestCase):
    def test_defaults_and_local_port_overrides(self):
        self.assertEqual(resolve_targets({}), {
            'frontend': 'http://localhost:7174', 'api': 'http://localhost:3001',
        })
        self.assertEqual(resolve_targets({'SILVERSEA_FRONTEND_PORT': '7175'})['frontend'],
                         'http://localhost:7175')
        targets = {'SILVERSEA_URL': 'http://127.0.0.1:7175', 'SILVERSEA_API': 'http://[::1]:3001'}
        self.assertEqual(resolve_targets(targets)['api'], targets['SILVERSEA_API'])

    def test_explicit_paired_remote_staging_is_preserved_without_network(self):
        targets = {'SILVERSEA_URL': 'https://staging.example.test',
                   'SILVERSEA_API': 'https://staging.example.test:8443'}
        self.assertEqual(resolve_targets(targets), {
            'frontend': targets['SILVERSEA_URL'], 'api': targets['SILVERSEA_API'],
        })

    def test_mixed_or_unpaired_remote_overrides_fail(self):
        for targets in [
            {'SILVERSEA_URL': 'https://staging.example.test'},
            {'SILVERSEA_API': 'https://staging.example.test'},
            {'SILVERSEA_URL': 'https://staging.example.test', 'SILVERSEA_API': 'http://localhost:3001'},
            {'SILVERSEA_URL': 'http://localhost:7174', 'SILVERSEA_API': 'https://staging.example.test'},
        ]:
            with self.subTest(targets=targets), self.assertRaises(ValueError):
                resolve_targets(targets)

    def test_mismatched_remote_host_or_scheme_fails(self):
        for api in ['https://other.example.test', 'http://staging.example.test']:
            with self.subTest(api=api), self.assertRaises(ValueError):
                resolve_targets({'SILVERSEA_URL': 'https://staging.example.test', 'SILVERSEA_API': api})

    def test_invalid_target_fails_before_connectivity(self):
        for url in ['localhost:7174', 'file:///tmp/test', 'http://localhost:invalid', 'http://user:pass@localhost']:
            with self.subTest(url=url), self.assertRaises(ValueError):
                resolve_targets({'SILVERSEA_URL': url})


if __name__ == '__main__':
    unittest.main()
