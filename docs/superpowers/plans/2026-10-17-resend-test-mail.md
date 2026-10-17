# Resend test delivery and exact-address signup exception

The user approved testing with one general-email inbox because they have no domain or `.edu` mailbox. Use the fixed `onboarding@resend.dev` sender and only the email associated with the user's Resend account. The exact address was confirmed privately and must never enter source, fixtures, documentation or the public PR. Provider signup is user-reported; a replacement sending-only key and secure user entry remain separate from implementation. No agent API key creation/storage/transmission, real send, administrator grant, live DB change or deployment is part of this implementation stage. The user sets their password privately.

## Boundaries

- `EMAIL_DELIVERY_MODE` defaults to `disabled`; add only `resend-test` alongside the existing local `development-file` mode. Production still refuses development-file delivery.
- `EMAIL_TEST_ALLOWLIST_ENABLED` must be exactly `true`, and `EMAIL_TEST_RECIPIENT` must be one valid bare address. Missing/invalid configuration never grants an exception. The same normalized exact address controls gateway/Python signup and Resend recipients. Preserve ordinary valid `.edu` eligibility; no domain-wide, wildcard, list, alias or client-controlled expansion. No ownership or administrator bypass.
- Use one fixed HTTPS POST to `https://api.resend.com/emails`, fixed sender/subject/plain text, one recipient and the approved canonical HTTPS origin matching `GATEWAY_PUBLIC_ORIGIN`. The token stays in the link fragment, never metadata or logs. Use a random independent idempotency key per logical send, with no automatic transport/application retry.
- Use stable locked HTTPX 0.28.1 with normal TLS verification, no redirects/proxy environment, a three-second total asynchronous deadline plus finite phase limits and a 16 KiB uncompressed JSON response cap. Definite acceptance requires the documented success status and message ID. Provider acceptance does not prove mailbox receipt. Keep fixed public errors, persisted attempts, account locking, previous-token preservation on failed send and commit before 202.
- Signup UI permits the server to decide the approved exception without exposing the configured address. Verification UI says accepted for delivery, keeps manual requests and never retries uncertain mutations automatically.

## Work and verification

1. Verify official Resend/HTTPX behavior; record safe future setup and remaining user/security inputs.
2. Implement separate server policy, UI and provider adapter changes with failing regressions first. Test malformed/missing settings, arbitrary recipients, provider rejection/redirect/timeout/oversized/malformed responses, token/key privacy, single attempts and transaction outcomes.
3. Run meaningful local DB and browser coverage, independent review, complete release validation and native AMD64 resource comparison on the final PR revision. Preserve existing user changes, do not merge main.
4. Report code/test evidence and exact pending setup. Before 0006, prove real inbox receipt and same-account confirmation in an isolated new-schema rehearsal, then complete exact-target backup/restore and maintenance review. Any administrator grant is separately approved for one precisely identified verified account; no credentials are generated or printed here.
