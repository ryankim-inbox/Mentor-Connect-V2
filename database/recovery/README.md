# Historical recovery assets

The 0005 catalog/version files are unchanged exports from reviewed deployed commit `4fc6f11a2f5a04391b9aeeef9d9bb7d299bd5bc4`. They are used only by explicitly versioned backup/restore operations. Canonical SQL is reconstructed from the first five immutable checked migrations, then checked against the archived manifest hash.

These assets do not change the current schema, readiness, or migration ledger. See `docs/runbooks/account-trust-recovery.md`. Do not regenerate historical files from a newer schema.
