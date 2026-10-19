# User-only revision handoff support

This directory contains support code and local tests. It is **not a frozen or
execution-ready bundle**. There is no production manifest, release gate,
credential, writer observation, or database revision in this checkout.

The approved scope is the existing synthetic batch identified by the original
receipt: update 983 users and 782 questions/requests, with their approved related
rows and public district/tag metadata. The core operator owns the exact allowlist
and preserves all nonbatch rows and password hashes. The target is fixed in
`protocol.mjs`: Neon project `purple-pond-78194407`, branch
`br-super-queen-b5j58k39`, direct host
`ep-crimson-night-b552ar17.c-7.us-east-2.aws.neon.tech`, database `neondb`, owner
`neondb_owner`, port 5432; Render service `srv-db96aglg1s2s739tbtd0`.

## Preparing a frozen copy after review

1. Finish review and commit the actual release. Create a **new clean local
   checkout** of exactly that commit. Keep previous sealed rollout/seed bundles
   unchanged. Install/copy the verified dependencies into this checkout; all
   dependency symlinks must resolve within it. Do not use hard-linked source or
   dependency files if changing their permissions would affect another checkout.
2. Run the code-only builder from that new checkout using trusted Python with
   `-I -B`:

   ```text
   <trusted-python> -I -B <new-checkout>/ops/demo-refresh-handoff/freeze_manifest.py \
     --release <reviewed-40-character-commit> \
     --directory <new-private-handoff-directory> \
     --receipt /tmp/mentor-seed-0008-20261018/apply-receipt.json
   ```

   The placeholders deliberately are not an executable production command.
   The builder performs no database/cloud/credential access. It requires clean
   Git state and the exact original receipt SHA-256, makes the runtime scopes
   read-only, and creates a mode-0600 manifest in a new mode-0700 directory.
   It checks Node 24 and PostgreSQL **18.6** for production. It prints a manifest
   hash and `FROZEN_AWAITING_DEPLOYMENT_GATE`, never a ready-to-execute claim.
3. The closed file inventory covers **all** `ops/`, `lib/db/`, `database/`, and
   `node_modules/` files and symlinks, including taxonomy, migration and schema
   assets. It also pins the Node/Python executables, `initdb`, `postgres`,
   `pg_ctl`, `pg_dump`, `pg_restore`, and `/private/etc/ssl/cert.pem` by SHA-256.
   Standard OS/Python libraries and system dynamic libraries remain part of the
   trusted installed runtime. Every inventoried source directory and regular
   file is read-only, and changes/additions/link retargeting/dirty Git state
   reject the handoff before credentials. The driver rechecks hashes and Git
   state before application. The manifest hash and launcher hash must be retained
   in the reviewed operator record; do not accept replacement hashes from an
   untrusted file.
4. Deploy the reviewed code separately. The authorized parent/operator must
   inspect the real Render service and deployment, suspend application writers,
   and record an exclusive, fsynced `release-gate.json` in the handoff directory:

   ```json
   {
     "formatVersion": 1,
     "approval": "Sentinel_ffd3ea6a2ec481918348d4055e1c5da7",
     "target": "the exact TARGET object from protocol.mjs",
     "releaseSha": "the reviewed deployed commit",
     "manifestSha256": "the independently retained manifest hash",
     "reviewed": true,
     "deployed": true,
     "deploymentUrl": "https://dashboard.render.com/web/srv-db96aglg1s2s739tbtd0/deploys/dep-...",
     "verifiedAt": "actual inspection time in ISO 8601"
   }
   ```

   `target` above is explanatory; the real file must contain the full object.
   The gate is valid for at most 30 minutes. It is not a substitute for the
   phase-specific observations below. Only after these prerequisites are real
   should the parent give the user the concrete trusted-Python `-I -B`
   `launcher.py --manifest ... --manifest-sha256 ...` command. Do not launch
   Terminal, enter credentials, or start this command on the user's behalf.

## Credential and attempt boundary

`launcher.py` requires isolated Python (`-I -B`), a real input/output TTY, a
verified clean frozen release, all runtime file hashes, the exact receipt hash,
and a current reviewed deployment gate. It disables core dumps, strips inherited
environment variables, and runs a no-secret Node preflight. It then creates
`attempt.json` using exclusive/no-follow creation, fsyncs the file and directory,
**and only then** prompts once with `getpass`. An echoing fallback is forbidden.

The password and an ephemeral claim token travel only through the child's
private stdin pipe. The claim stores only the token digest. The driver creates
`attempt-consumed.json` exclusively and fsyncs it; a second consumption fails.
Cancellation, authentication failure, changed baseline, rejected evidence, a
crash, or an uncertain COMMIT **never erase either claim and never retry**.
Resolving a consumed or uncertain attempt requires a separate reviewed inspection;
do not remove claim files or rerun the revision to discover the result.

The only deliberate password environment is passed to `pg_dump`; it is never
placed in argv, a credential file, logs, or tool output. No inherited PG/cloud/
Node/Python settings are used. Native tools use `PGPASSFILE=/dev/null` and
`--no-password`. For the remote dump, libpq is constrained to verify-full TLS,
the pinned CA, SCRAM authentication, disabled GSS and disabled client certificate
use. Certificate/key/CRL fallback paths point to checked-absent files in the
private handoff directory. These options follow the
[PostgreSQL 18 connection parameter documentation](https://www.postgresql.org/docs/18/libpq-connect.html).
Native stdout/stderr and exception details are discarded; the launcher emits
only fixed allowlisted status messages.

## Fresh writer observations

The driver emits one private immutable request for each `initial`,
`locked-prewrite`, and `precommit` phase. Each request binds a cryptographically
random nonce, attempt, revision, preview digest, target digest, exact release,
manifest, approval and fixed target. The provider waits at most 55 seconds,
below the core transaction's 60-second idle timeout.

The **authorized parent/operator** must actually read the Render control-plane
UI after each request is created, confirm the exact deployed release, suspended
service and no active deployment, and create the corresponding response using
`durableCreate` from the reviewed frozen `protocol.mjs`. The response must copy
the request bindings and include:

```json
{
  "requestDigest": "digest(request) using protocol.mjs canonical hashing",
  "source": "actual-render-control-plane-ui",
  "sourceUrl": "https://dashboard.render.com/web/srv-db96aglg1s2s739tbtd0",
  "suspended": true,
  "activeDeploy": false,
  "deployedReleaseSha": "exact reviewed release",
  "verifiedAt": "time of the new actual observation"
}
```

The response filename replaces `.request.json` with `.response.json`. It must
be created exclusively and durably, not overwritten. Observation must postdate
the request, cannot be in the future, and must be at most 30 seconds old when
accepted. The driver also checks this age immediately before submitting COMMIT.
Wrong/stale/replayed scope or nonce fails closed. A fixed statement such as
“writers stopped” is never accepted. This is a tested **local handoff protocol**,
not automatic Render observation or cryptographic proof of UI truth; only the
authorized operator supplies real observations. Fixture responses are not live
evidence. No persistent Render API credential is added.
The parent/operator must remain active and watch this private directory during
the user's run so each observation can complete within the bounded wait. Starting
the launcher while the observer is unavailable consumes the attempt and then
fails closed; it does not queue a later automatic revision.

## Backup, restore, and independent confirmation

Before revision, an exported repeatable-read snapshot locks current schema-8
tables and fingerprints **all rows**, including the migration ledger and a
separate server-side hash over every user ID/password hash. Its source baseline
must equal the exact preview baseline. UTC and the reviewed search path make
fingerprints stable. Other source sessions cause rejection.

The fresh custom-format `before-revision-schema8.dump` is mode 0600 in the private
handoff directory. It contains the existing real data and password hashes and is
owned by the user; agents must not read, print, attach, or upload its contents.
All native tool output is suppressed. No old preseed counts or old bundle CLI
is used. Source proof remains byte-for-byte equivalent before/after dumping.

A fresh disposable Unix-socket-only cluster (host TCP connections rejected)
restores that exact checksum. It recreates nonsecret role **names**, database
owner/name/locale, and direct database ACLs before restoring public objects,
ownership and ACLs. Verification compares complete row/password fingerprints,
ledger, sequence states/definitions/dependencies, catalog, object owners, direct
table/column/sequence/schema/database grants, and exact server version/locale.
Global role definitions/passwords/memberships are not restored; the core binds
and preserves source role authority separately in its baseline digest.

Only two portable representations differ: PostgreSQL regenerates internal FK
trigger names containing catalog OIDs, so those are compared by function,
constraint, timing, enabled state, arguments and full structural properties;
the original source schema is retained. ACL entry order is canonicalized after
PostgreSQL decodes `aclitem[]`; every entry, grantor and grant option is preserved.
Null ACLs and explicit ACLs remain distinct. User trigger definitions and every
other schema/catalog property remain checked; the core rejects user triggers.

After a COMMIT acknowledgement, the writer connection closes. A **new read-only
connection** compares all row, schema, role-authority and sequence fingerprints
with the proof captured immediately before COMMIT. Only its success and durable
receipt produce `REVISION_COMMITTED`. A lost COMMIT acknowledgement produces
`REVISION_COMMIT_UNCONFIRMED`; a confirmed commit with incomplete follow-up
produces `REVISION_COMMITTED_FOLLOWUP_NOT_CONFIRMED`. Neither resumes Render or
retries. Application resume and public UI verification remain separate steps.

## Tests

`sh ops/demo-refresh-handoff/run-tests.sh` is included in `@workspace/db test`.
It runs fake-credential Python tests, Node protocol/failure tests, and a complete
disposable local backup/restore/revision/read-only-confirmation fixture. The
fixture supports PostgreSQL 16 for existing CI and PostgreSQL 18.6 locally;
source/destination versions must match exactly. Production freeze is restricted
to 18.6. Set `PYTHON_BIN` when using the repository's configured Python runtime.
These tests do not access Neon, Render, Keychain, a browser, or real credentials.
