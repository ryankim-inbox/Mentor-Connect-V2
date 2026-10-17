# Historical recovery assets

The 0005 catalog/version files are unchanged exports from reviewed deployed commit `4fc6f11a2f5a04391b9aeeef9d9bb7d299bd5bc4`. They are used only by explicitly versioned backup/restore operations. Canonical SQL is reconstructed from the first five immutable checked migrations, then checked against the archived manifest hash.

These assets do not change the current schema, readiness, or migration ledger. See `docs/runbooks/account-trust-recovery.md`. Do not regenerate historical files from a newer schema.

The 0006 catalog/version files are unchanged copies of verified commit `813899f8` before appending notification migration 0007. Explicit `CLASSROOM_SCHEMA_VERSION=0006` selects that six-migration prefix for backing up or restoring a notification-upgrade source. The default remains the current schema, now 0007. Frozen 0005 assets and their existing recovery checks remain unchanged.
