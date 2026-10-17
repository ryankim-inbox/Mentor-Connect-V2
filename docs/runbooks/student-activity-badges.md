# Student activity badges

Production profile badges measure the number of **distinct eligible study
partners** in accepted requests whose current status is `matched` or `closed`.
The accepted application must identify the request's current `matched_user_id`.
Both the author and accepted applicant receive one partner credit. Multiple
requests with the same partner, including reversed author/applicant roles, still
count once. Posts, comments, room messages and direct messages contribute nothing.
A legacy matched flag without the corresponding accepted application contributes
nothing.

Mentor, mentee and both-role students qualify through the current
`member_access.has_student_access` policy, which applies member access with
administrators excluded. This
preserves the explicitly configured two-account student exception without treating
it as verified email ownership. Synthetic accounts locked by the server-written
password sentinel never qualify, even if a historical verification flag is set.
The 983 synthetic demo profiles therefore cannot receive or contribute credit.
Self-pairs and relationships blocked in either direction also contribute nothing.

| Minimum distinct partners | Tier |
| ---: | --- |
| 1 | Bronze |
| 3 | Silver |
| 5 | Gold |
| 10 | Platinum |
| 20 | Emerald |
| 35 | Diamond |
| 50 | Master |
| 75 | Grand Master |
| 100 | Challenger |

Zero partners means both `rank` and `tier` are null. Competition ranks use the
actual `mentor_ranks.sort_mentors` and `mentor_ranks.assign_ranks` functions: equal
counts share a position and the next position skips the tied entries. Numeric user
IDs provide deterministic ordering within ties. Tiers depend on partner counts,
so a student with one partner receives Bronze even when ranked first. The lesson
module's API and its separate lesson badge thresholds remain unchanged.

## Service integration

`Python/activity_ranks.py` exposes:

```python
get_activity_rank(user_id: int) -> dict | None
# Example: {"userId": 7, "distinctPartners": 3, "rank": 1, "tier": "Silver"}
```

Missing, ineligible, and invalid targets return `None`. Existing eligible students
with no activity return the same four fields with a zero count and null rank/tier.
The caller must authenticate and authorize access and map absent targets to its
HTTP response. Database errors propagate; an unavailable query must not become a
fabricated zero-activity badge. No names, email addresses, partner IDs or account
policy fields are returned.

`rank_activity_counts(rows)` is the pure adapter for trusted aggregate rows with
`id` and `matched_count`. It copies through the existing lesson functions and
returns the four public fields for each row in display order.

## Read cost and consistency

Each eligible profile lookup performs two data queries, plus one transaction
configuration statement, within one read-only repeatable-read transaction. The
first reads minimal account policy fields and excludes administrators and locked
synthetic accounts in SQL, then evaluates the current member policy in Python.
An absent/ineligible target stops there. The second query aggregates accepted,
eligible, unblocked distinct pairs in PostgreSQL and transfers at most one count
per eligible participant. It never queries each user or each request separately,
and never loads messages or individual historical request rows into Python.

For E eligible students, sorting costs O(E log E) and ranking uses O(E) memory.
The eligibility read also scales with the candidate account population. The SQL
work scales with request/application history and distinct pairs; a constant query
count does not make historical work constant. Current request-status, application
request/applicant, and unique block-pair indexes support the filters. This is a
bounded one-profile response suitable for the current demo, not a claim of measured
production latency. Before significantly larger deployment, measure realistic
`EXPLAIN (ANALYZE, BUFFERS)` and consider maintained aggregate data with explicit
invalidation for acceptance, reopening, deletion, blocks and eligibility changes.
Do not silently truncate the global population: that would change competition
ranks. Results are deliberately not cached, so a later lookup reflects account
promotion, verification changes and new blocks. A single lookup uses one snapshot.

## Meaning and limits

Badges indicate recorded accepted connections, not completed sessions, teaching
quality, safety, or learning outcomes. They resist repeated posts/messages and
repeated pairing with the same account. They do not prevent collusion across many
eligible identities. Closing an accepted request retains credit; reopening or
removing acceptance, deleting the request, blocking the relationship, or losing
participant eligibility removes that relationship's credit on the next lookup.
This describes current evidence, not a permanent achievement ledger.

## Local verification

Run from the repository root with local Node, pnpm and PostgreSQL tools available:

```sh
sh scripts/test-python.sh tests/test_demo_activity_ranks.py -q
```

The harness provisions and removes disposable loopback-only PostgreSQL databases.
Tests exercise all tier boundaries, competition ties, zero activity, both
participants and all three roles, exact acceptance, repeated activity, both block
directions, current account exclusions, all 983 locked synthetic profiles and the
configured test-member exception. No deployment or remote database is required.
