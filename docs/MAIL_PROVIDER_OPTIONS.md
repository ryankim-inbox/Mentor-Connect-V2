# Transactional mail options for the Free Render test service

Checked against official documentation on 2026-10-17. No provider has been selected, configured or contacted with an actual message.

Render Free blocks outbound SMTP ports 25, 465 and 587. Use a transactional HTTPS API; changing SMTP credentials cannot remove that hosting restriction. [Render Free limits](https://render.com/docs/free)

| Provider | Ongoing Free allowance | Setup and credential considerations |
| --- | --- | --- |
| Resend | 3,000/month, 100/day; 3 verified domains | Owned verified sending domain for arbitrary recipients; sending-only key can be restricted to that domain. Shared `resend.dev` test sender reaches only the account email. |
| Brevo | 300/day; no rollover; no card required | Verified sender and preferably authenticated owned domain. Standard API keys have full account access, requiring explicit approval of that broader scope. |
| MailerSend | 500 per 30 days, 100/day, 100 API requests/day | Regular Free requires approval and payment details; no Free overage sends. Separate no-card sandbox permits 100/month and initially two recipients. |

Sources: [Resend quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits), [key scope](https://resend.com/docs/dashboard/api-keys/introduction), [test sender](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain); [Brevo Free limits](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan), [pricing](https://help.brevo.com/hc/en-us/articles/208589409-About-Brevo-s-pricing-plans), [key permissions](https://help.brevo.com/hc/en-us/articles/209467485-Create-and-manage-your-API-keys); [MailerSend limits](https://www.mailersend.com/help/plans-features-and-limits), [pricing](https://www.mailersend.com/pricing), [sandbox](https://www.mailersend.com/help/sandbox-mode-and-the-professional-trial).

Resend is the conditional preference if the user controls a domain and 100 sends/day is sufficient, because the runtime key can be narrowly scoped. This is a recommendation, not a selected service. No paid plan, card enrollment, domain purchase or DNS change is included. Confirm current account-specific limits when setting it up.

## Decisions needed for a concrete setup

1. Provider/account owner, owned domain or subdomain, exact sender name/address, and who can approve its DNS records. Domain ownership and provider account login must not be inferred from repository access.
2. Explicit security approval to create/use the exact credential scope and persist it only in the existing Free Render `mentor-connect-test` server environment. Use secure secret entry; never put keys in chat, Git, PRs, client bundles, command arguments or logs. Do not reuse unrelated stored credentials.
3. Exact user-controlled test recipient and authorized message/count. Suggested first send: one verification email, fixed subject `Mentor-Connect email verification`, containing the approved test-origin link and 30-minute expiry text. Do not infer that recipient is the administrator.
4. Actual mailbox receipt plus successful same-account confirmation in an isolated new-schema rehearsal before applying 0006 to existing Neon `purple-pond-78194407/neondb`. Provider acceptance or a mock/outbox success is insufficient. The old deployed app does not have the new ownership flow; do not send a new-flow link to it and claim verification works.

## Implementation boundary

Keep production delivery disabled until the selected HTTPS adapter is reviewed. Preserve bodyless authenticated requests, persisted cooldown/hourly limits, a single synchronous delivery seam, account lock and delivery-before-token-commit ordering. Offload blocking authority/transaction work from the event loop. Return fixed public errors, independent of provider exception text. Never automatically retry an uncertain send or claim exactly-once delivery.

The selected adapter must use a fixed provider endpoint, normal TLS verification, no redirects/proxy inheritance/retries, bounded request/response size and a total send budget below the existing five-second gateway deadline. Validate one bare recipient from the locked account record, one approved sender, and the canonical HTTPS origin. Disable tracking/link rewriting and avoid logging tokens, links, addresses, keys or provider bodies. Test failures, ambiguous acceptance, commit failure and event-loop responsiveness with mock transport before an explicitly authorized real send.

0006 remains blocked until real delivery, backup restoration, exact-target migration/grant review and coordinated maintenance are ready. Administrator identity and its later minimal audited grant require separate explicit approval; do not assign administration in the migration. See [the rollout runbook](ACCOUNT_TRUST_RUNBOOK.md).
