# Complete the mentorship journey

The user approved fixing all gaps observed in the live two-account UI test. Success means a new account can comment/reply, apply to another person's post, receive explicit acceptance, and open the accepted person's DM by name. A repeated chat click or retry must not create another message. Existing matches, messages and unrelated user changes must survive.

## Decisions

- Keep React, the Node gateway and authoritative FastAPI/PostgreSQL architecture. Do not introduce a service or dependency.
- Use additive migrations. Existing matched requests remain matched; new applications do not change a request to matched until its author accepts. The old `/requests/{id}/match` action becomes an application alias, so an old client cannot bypass consent.
- Applications have pending, accepted, rejected and cancelled states. Only the author accepts/rejects; only the applicant cancels pending applications. Cancellation may be followed by reapplication; rejection is final for that post. Acceptance locks the request row, checks both block directions, changes one application/request and records one match event in the same transaction. Other pending applications are rejected. Repeated transitions return the existing result; competing acceptance cannot create two matches. Closing/reopening a request cancels pending applications; reopening also clears the current accepted application state without deleting its record or DM history.
- Comments are authenticated, bounded to 2,000 characters, paginated and attached to a request. Replies support one level, with a parent from the same request. Blocked author/counterpart pairs cannot create comments or applications. Text remains escaped plain text. No comment editing/deletion is introduced.
- REST chat sends accept an optional UUID `clientMessageId` for legacy compatibility. New UI always supplies it. Uniqueness is scoped to sender and room/conversation; replay returns the same row, while reusing a key with different text returns 409. Only a newly committed insert broadcasts. Existing no-key/legacy WS messages remain supported; they do not gain retry deduplication.
- The shared composer uses a synchronous send lock and retains the same key for explicit retry of the same failed draft. It does not automatically retry uncertain writes. A different or successfully sent draft receives a new key.
- Add a My connections/activity page and named contacts in DMs. Contacts come from existing matched requests (including legacy matches); existing conversations remain available. The request detail offers Message <name> for its two matched members. Server membership, blocks, district-room and Origin protections remain authoritative. No public email disclosure or arbitrary ID entry is needed.
- Application/comment queries refresh after mutations and when revisiting/focusing, with bounded polling for open activity views. Chat continues using the existing WebSocket/history reconciliation.

## Alternatives considered

Disabling the button alone misses network retries. Global message-body deduplication would reject intentional repeated messages. Sender/channel-scoped operation IDs plus a unique constraint cover both concurrent requests and uncertain retry without conflating separate drafts.

Replacing old matches would lose existing connections. An additive application table leaves legacy matches valid and changes only future transitions.

## Verification and release boundary

Use real disposable local PostgreSQL for migration upgrade/preservation, permissions, concurrency and REST tests. Add browser regression tests for composer repeat clicks, request comments, application acceptance/cancel/reject and named DM navigation. Run the repository release checks and one fresh whole-branch review. Public two-context UI verification remains pending Mac unlock and a separately approved deployment.

No remote push/PR, Neon schema/role changes, Render deployment, paid feature, credentials change or Mac lock bypass is authorized in this phase. Document migration and minimum app-role grant changes for later approval.
