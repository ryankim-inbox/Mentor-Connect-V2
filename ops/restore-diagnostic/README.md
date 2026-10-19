# Local restore diagnostic

This separate user-run tool diagnoses an existing backup in a fresh disposable
local PostgreSQL 18.6 cluster. It has no remote DB connection, password prompt,
refresh retry, seed operation, or migration application. It never updates the
original handoff records or backup. The operator builds and verifies a new pinned
bundle before handing a short clean-environment `.command` wrapper to the user.

`build_bundle.py` reads the safe backup evidence metadata and public code/schema
assets. It takes the recorded dump checksum from the metadata; it does not open
the dump. The frozen launcher's `--check` verifies code/runtime/evidence hashes
and input permissions, without opening the dump or creating the run directory.
Only the user's actual execution reads the archive, verifies its checksum,
restores it locally, compares the complete recorded proof, and removes the
disposable data. Do not share dump contents or native logs.

The launcher requires isolated Python and uses an empty inherited environment.
The wrapper hashes the launcher's exact bytes before explicitly invoking `main()`
with fixed arguments. It prints `LOCAL_DIAGNOSTIC_WRAPPER_STARTED` immediately;
the launcher prints validation and live allowlisted stages, followed by its final
safe result and numeric exit. The shell also prints `LOCAL_DIAGNOSTIC_WRAPPER_EXIT`.
INT, TERM and HUP are forwarded to the owned supervisor, and the wrapper waits
for bounded cleanup. An abrupt OS kill cannot report or guarantee cleanup.
Node, PostgreSQL binaries, bundled dependencies and assets are pinned. A macOS
sandbox denies TCP, other Unix sockets, writes outside the new private run
directory, and reads of unrelated user and temporary files. Only the exact new
PostgreSQL socket is allowed. The launcher supervises cleanup even if Node exits
abnormally; an unconfirmed stop retains private data and returns cleanup failure.

Output contains fixed status/stage/category names, fixed proof-field names, and
an optional allowlisted SQLSTATE. It contains no row contents, password hashes,
SQL, connection strings, raw native errors, or role values. Normal results are
saved as `result.json` in the new private run directory. `progress.jsonl` records
only stage names; `supervisor-result.json` records the final cleanup outcome and
exit code. A result of `LOCAL_RESTORE_DIFFERENCE` identifies fields to
investigate; it does not authorize modifying the source DB or resuming the app.
The separate run directory cannot be silently reused.
When replacing a prepared wrapper, freeze a new bundle and preserve the earlier
bundle. Bind both versions to the same one-use output directory, so either
version's execution prevents a second restore. A replacement wrapper's `--check`
must be verified before handoff; it does not consume that directory.

## Relation mismatch investigation

The completed user-run v3 report confirms 106 source/restored relations with
exactly three `relacl` changes: explicit built-in owner defaults became `NULL`.
All three complete ACL meanings match. There are no added/missing relations,
owner/other-field differences, ordering changes or real privilege differences.
Cleanup succeeded. PostgreSQL 18.6 generated fixtures reproduce this behavior.

The additional `relationAnalysis` is diagnostic evidence only. It reports fixed
field labels, bounded counts, relation-order changes and ACL categories. A single
read-only PostgreSQL query compares every grantor, grantee, privilege and grant
option, expanding `NULL` through `acldefault`. An explicit empty ACL stays empty.
Changed owners/kinds and unsupported relation kinds are not declared equivalent;
invalid shapes or SQL errors produce `unavailable`. No names or ACL values are
reported. Frozen v3 deliberately retained `LOCAL_RESTORE_DIFFERENCE` and exit 2;
its existing files and result are historical evidence and remain unchanged.

Current comparison uses shared `ops/restore-relation-acls.mjs` with the refresh
backup verifier. It creates comparison-only proof copies whose table/sequence
ACL fields contain complete PostgreSQL grant tuples. NULL defaults are expanded
and explicit empty ACLs stay empty. Owners, relation identity/order/structure,
grantor/grantee/grant options and all other proof fields remain checked. SQL or
metadata errors fail closed. Neither original proof is modified, and a saved
diagnostic summary is never accepted as a substitute for comparing both proofs.

An already consumed diagnostic must not be rerun or its files edited. A second
actual-backup diagnostic requires a separately reviewed frozen bundle, an
explicitly authorized new one-use directory and a new user execution. Its only
purpose is local verification; it does not authorize
refresh, a remote database change, or service resumption.

The exact earlier readable command and its frozen public bundle passed a full
synthetic restore, so the user's observed absence of output remains unexplained.
The earlier supervisor buffered all child output until completion. The new
wrapper removes dependence on implicit `__name__` entry and makes startup,
progress, rejected preflight, interruption, and final exits visible.

## Comparison with the earlier successful seed recovery

Both paths use PostgreSQL 18.6 and support builtin `C.UTF-8`. The old seed path
used `--no-owner --no-acl` and replayed selected app/readiness grants with owner
normalization. The newer failed refresh preserves exact owners, database/object/
column/default ACLs and wider catalog metadata. It creates role names without
source role memberships. Consequently `information_schema.table_privileges` can
differ even when underlying ACLs match: PostgreSQL uses `pg_has_role` to determine
visible grants and grantability. This is a reproduced synthetic failure surface,
not a confirmed cause of the actual failed backup.

The diagnostic copies the existing verifier's read-only proof query body and
restore preparation/restore options. It adds stage reporting, fixed error
classification, all-field comparison, bounded native calls, and independent
cleanup supervision. It does not weaken comparison criteria or add memberships.

## Verification

Run Node 24 tests with `node --test ops/restore-diagnostic/diagnostic.test.mjs`.
Run `test_launcher.py` and `test_command.py` with isolated Python (`-I -B`).
Native macOS tests require `RUN_LOCAL_RESTORE_DIAGNOSTIC_TEST=1`:
`test_sandbox.py` and `integration.test.mjs`. All inputs for these tests are
generated fake data in new disposable clusters. They test successful builtin
locale restore with ACL/default grants, membership-only proof mismatch, untouched
source files/rows, the full frozen user launcher, no silent rerun, extra unpinned
file rejection, native failure/timeout filtering, OS access restrictions, and
cleanup after abrupt child exit, live progress before child completion, wrapper
signal forwarding, and repeated termination during supervisor cleanup. They never
use the real backup or Neon.

The targeted `relations.integration.test.mjs` uses only new generated fixtures.
It covers a table and two sequences with explicit default ACLs, real grants,
grant options, grantors, empty ACLs, SQL parse-error recovery in a read-only
transaction, and the complete newly frozen wrapper accepting only semantic ACL
equivalence. It does not execute a historical frozen diagnostic. The production
handoff suite adds negative tests for owners, grantors, grantees, grant options,
empty/reduced ACLs, relation identity/order/structure, malformed metadata and
other proof-field drift.
