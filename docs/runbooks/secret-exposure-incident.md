# Secret-exposure incident closure runbook

## Purpose and release gate

This runbook closes the historical secret-exposure incident without copying
secret material into Git, issue comments, CI logs, or this document. The
release remains **NO-GO** while any row in the
[incident ledger](../security/secret-exposure-incident-ledger.md) is
`[UNKNOWN]` or `BLOCKED`.

The repository supplies two complementary controls:

- `sh scripts/check-secrets.sh` scans tracked files and is intentionally safe
  to run locally.
- `gitleaks git --redact --no-banner` scans all reachable Git history. The
  [CI workflow](../../.github/workflows/secret-scan.yml) checks out full
  history and runs Gitleaks on pull requests and pushes to `main`; it is not a
  pre-commit hook or package lifecycle action.

Repository administrators must make the `secret-history-scan` job a required
status check on `main`. That branch-protection change is external and remains
`[UNKNOWN]` until its configuration and a successful protected-branch run are
recorded in the ledger.

## Operator procedure

1. Open an incident ticket and assign the owners named in the ledger. Record
   only the ticket ID and approved private evidence reference.
2. For the historical GitHub token, database credential, and `SESSION_SECRET`,
   revoke or rotate at the provider. Verify through the provider or a
   least-privilege application probe that the previous credential is rejected
   and the replacement works. Never place either value in shell history, logs,
   tickets, or Git.
3. Move each replacement to the approved least-privilege secret store. Root
   `.env` files are not a distribution mechanism for broad tokens; `.env` and
   `.env.*` are ignored, and tracked env files are rejected by the local scan.
4. Determine whether the exposed password hashes map to live accounts. If so,
   perform the approved account-reset and session-invalidation procedure,
   recording only its outcome and private evidence reference.
5. Request separate, explicit approval for Git-history rewrite, collaborator
   coordination, and force-push. Do not start that destructive operation from
   this runbook. After it is approved and complete, rerun the redacted history
   scan and record its result.
6. Confirm the CI workflow has a successful run and that branch protection
   requires `secret-history-scan` for `main`. Record the run URL or other
   approved non-secret evidence reference in the ledger.
7. An incident owner reviews every row against
   [the template](../security/secret-rotation-ledger.template.md). Closure is
   allowed only when no `[UNKNOWN]` field remains and every prior-credential
   rejection and replacement-verification result is `pass`.

## Local validation

Run the following without echoing environment variables:

```sh
sh scripts/check-secrets.sh --self-test
sh scripts/check-secrets.sh
sh scripts/check-secret-history.sh
git ls-files | rg -i '(^|/)\.env|secret|credential|private.?key'
git log --all --oneline -- '*.env'
```

The history command requires Gitleaks; CI provides it. Its `--redact` option
is mandatory. A clean scanner result does not prove provider-side rotation,
account reset, branch protection, or history rewrite.

## Rollback

If a rotation is wrong, restore only the prior safe version in the approved
secret manager under the incident process; do not put a value into a root
`.env` file or source control. Re-run provider verification, update the
ledger, and keep the release blocked until evidence is complete.
