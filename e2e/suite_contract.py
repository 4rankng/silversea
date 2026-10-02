"""Discovery and complete-result validation for the local E2E runner."""
import argparse
import json
import re
from pathlib import Path


def discover_suites(directory, selectors=()):
    paths = sorted(path for path in Path(directory).glob('test_*.py')
                   if re.fullmatch(r'test_\d{2}_.+\.py', path.name))
    if not selectors:
        if not paths:
            raise ValueError('No E2E suite scripts found')
        return paths
    selected = []
    for value in selectors:
        if not re.fullmatch(r'\d{1,2}', value):
            raise ValueError(f'Invalid suite number: {value}')
        prefix = f'test_{int(value):02d}_'
        matches = [path for path in paths if path.name.startswith(prefix)]
        if not matches:
            raise ValueError(f'No test script for suite {value}')
        selected.extend(path for path in matches if path not in selected)
    return selected


def all_cases_pass(results):
    return isinstance(results, list) and bool(results) and all(
        isinstance(row, dict) and row.get('status') == 'PASS' for row in results
    )


def validate_result(result):
    if not isinstance(result, dict):
        return False
    rows = result.get('results')
    return all_cases_pass(rows) and result.get('total') == len(rows) \
        and result.get('passed') == len(rows) and result.get('failed') == 0 \
        and result.get('skipped') == 0


def summarize(directory, expected_suites):
    files = sorted(Path(directory).glob('*_results.json'))
    complete = len(files) == expected_suites and expected_suites > 0
    totals = {'PASS': 0, 'FAIL': 0, 'SKIP': 0}
    if not complete:
        print(f'❌ Expected {expected_suites} suite artifacts; found {len(files)}')
    for path in files:
        try:
            result = json.loads(path.read_text())
        except (OSError, ValueError) as error:
            complete = False
            print(f'❌ Invalid result artifact {path.name}: {error}')
            continue
        if not validate_result(result):
            complete = False
            print(f'❌ Incomplete or non-passing suite: {path.name}')
        rows = result.get('results', []) if isinstance(result, dict) else []
        for row in rows if isinstance(rows, list) else []:
            verdict = row.get('status', 'MISSING') if isinstance(row, dict) else 'INVALID'
            totals[verdict] = totals.get(verdict, 0) + 1
            if verdict != 'PASS':
                print(f'  {verdict}: {row}')
    print(f'Suites: {len(files)}/{expected_suites} | Cases: {sum(totals.values())} | '
          + ' | '.join(f'{key}: {value}' for key, value in totals.items()))
    return complete


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    listing = commands.add_parser('list')
    listing.add_argument('directory')
    listing.add_argument('selectors', nargs='*')
    summary = commands.add_parser('summarize')
    summary.add_argument('directory')
    summary.add_argument('expected_suites', type=int)
    args = parser.parse_args()
    if args.command == 'list':
        try:
            print('\n'.join(str(path) for path in discover_suites(args.directory, args.selectors)))
        except ValueError as error:
            parser.error(str(error))
        return 0
    return 0 if summarize(args.directory, args.expected_suites) else 1


if __name__ == '__main__':
    raise SystemExit(main())
