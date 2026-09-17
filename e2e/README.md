# E2E runner

Run `bash e2e/run_all.sh` for every numbered suite, or `bash e2e/run_all.sh 00 20`
for selected numbers. Selection includes every matching file, including both
suite-20 scripts. `bash e2e/run_all.sh --list` lists files without connecting.

The default frontend is `http://localhost:7174` and API is
`http://localhost:3001`. Change local ports with `SILVERSEA_FRONTEND_PORT` and
`SILVERSEA_BACKEND_PORT`, or provide `SILVERSEA_URL` and `SILVERSEA_API`.
The runner prints and checks the actual effective endpoints before workflows.

Explicit staging execution remains supported: set both `SILVERSEA_URL` and
`SILVERSEA_API` to the intended staging origin. Their scheme and hostname must
match; different ports are supported. Mixed local/remote targets and unpaired
remote overrides fail before test execution. Loopback aliases are treated as
the same local target. Credentials and environment details are maintained in
[`testplan/testaccounts.txt`](../testplan/testaccounts.txt).

Suites create and update test data. The database-dependent dispatch suite also
needs its intended `SILVERSEA_DATABASE_URL` and the external customer workbook
documented in that suite. Missing prerequisites remain incomplete evidence.
Both driver suite-20 scripts create their own native CUS/direct-dispatch order,
target its exact trip, and cancel that trip in cleanup.

Results and screenshots use a fresh run directory under `SILVERSEA_SCREENSHOTS`
(default `/tmp/silversea-e2e`). A complete run requires one result artifact per
selected script, nonempty case results, and every case `PASS`. `SKIP`, blocked
workflows, missing/corrupt artifacts, failures and timeouts return nonzero.
`SILVERSEA_SUITE_TIMEOUT_SECONDS` defaults to 300 seconds per script.

Pure runner regression checks: `python3 -m unittest discover -s e2e/tests -v`.
