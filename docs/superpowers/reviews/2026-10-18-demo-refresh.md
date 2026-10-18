# Demo taxonomy and existing-batch revision review

## Reviewed behavior

The directory defaults now expose every county and supported district type, and
request filters expose all 20 subjects. Server-owned demo markers identify the
existing fictional batch across profiles, posts, interactions, matching,
scheduling, analytics, and moderation. Changing visible prose cannot remove the
marker; ordinary accounts cannot opt into it through client input.

The revision updates the existing `mc-synthetic-v1-983-782` batch in place. Its
reviewed content has 983 unique fictional names and biographies and 782 unique
titles, descriptions, and concrete learning scenarios. It preserves identities,
credentials, protected fields, timestamps, counts, and nonbatch rows. Existing
mentor relationships are distributed across 373 eligible mentors, at most five
requests each, with district, subject, and availability compatibility checks.

Only public metadata is imported from the local catalog: 24 districts and 20
subjects. Sunnyvale and Saratoga Union are correctly classified as elementary
TK–8 districts; fictional high-school accounts use the other 22 districts.
Existing Classroom district rows and Math/Science metadata remain intact.
No local accounts, private content, messages, or credentials are copied.

Content preview SHA-256:
`ff95f2d7b223e5880440f55a7bd2502130b6b54fbfa3071e13d5218481325f6f`.
Content digest:
`17fc68fc59342be1f7b2dbf0ebb96ed51c14670a281221a4b67a50b4bd0003a8`.

## Independent review

Independent content QA approved the final preview after checking every generated
scenario mapping, all distribution and relationship invariants, and 39,396
protected-field comparisons, including 10,622 timestamp comparisons. The reviewer
read all scenario/goal banks and sampled 60 compiled posts across all 20 subjects
plus 21 profiles. Initial generic-body, duplicate-biography, and name findings
were corrected before approval.

The independent safety reviewer found no remaining source-freeze blocker.
Resolved findings included transaction snapshot races, cached/redacted session
statistics, timezone-stable fingerprints, marker coverage, frozen dependency
inventory, credential-prompt isolation, native backup portability, and independent
postcommit confirmation. Reviewers did not access live databases or credentials.

## Verification

Local release runtime: Node 24.21.0, pnpm 10.33.0, Python 3.12.13, PostgreSQL 18.6.

- Release typecheck and gateway/SPA build passed.
- Full Python suite: 817 passed.
- Gateway regression suite: 174 passed; REST/WS contract and boundary checks passed.
- UI unit suite: 11 passed. Smoke-script unit suite: four passed.
- Full browser fixture run: 159 of 160 passed. The single failure was a stale
  flagged-user mock missing the newly required `isDemo: false` field. The mock
  was corrected and the entire affected classroom file passed all 13 tests.
- Dedicated taxonomy/demo browser fixtures: 23 passed, including operational
  views and narrow mobile layouts. These are fixtures, not live acceptance.
- PostgreSQL revision suite: 18 passed, including rollback, concurrent writers,
  cross-batch references, role drift, microsecond timestamps, uncertain commits,
  and UTC/non-UTC sessions.
- Handoff protocol: eight Node tests and six isolated Python tests passed.
  A complete native PostgreSQL backup → restore → revision → new read-only
  connection confirmation fixture passed.
- Independent checks: 20 pure content/protocol tests, six launcher tests, six
  gateway marker/district contract tests, and `git diff --check` passed.

No separate repository lint script exists. Required type, contract, formatting,
diff, and credential scans are used; CI results are reported separately in the PR.

## Live gates still required

This review does not establish deployed behavior or a live database revision.
Code deployment and data mutation are separate stages. The handoff requires a
clean frozen reviewed commit, verified deployment, suspended writers, three fresh
actual Render observations, a fresh private backup, and an actual local restore
proof. The user enters the database password directly into the isolated launcher.
Agents must not read the password or backup contents. A consumed or uncertain
attempt is never erased or retried. Render resumes only after independent
postcommit proof.

Live two-account acceptance remains required for shared data, bidirectional room
chat and DM, reconnect/history recovery, persistence, access controls, reports,
rank behavior, and notification redirects. No main-branch merge or paid service
change is part of this review.
