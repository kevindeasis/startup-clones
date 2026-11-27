# FIDELITY.md - known, deliberate gaps between the twins and the real APIs

Rehearsal does **not** run daily fidelity checks against the live vendor APIs (the real product does).
Everything below was written from public API docs and is unverified against production. Treat the twins as
"close enough to exercise agent control flow", not as a conformance suite.

## Cross-cutting
- State is in-memory per env; restarting the server loses all envs. Snapshots are also copied to `REHEARSAL_PERSIST_DIR`
  but are only restored from memory.
- `drop_after_write` does not truly sever the TCP connection. The write is applied, then the client gets an HTTP 500
  (`Internal Server Error`, `Connection: close`) instead of the real response. SDKs see a 5xx rather than a transport error.
- Egress events (webhooks) are recorded, never delivered to a URL. Event objects are simplified (`{"object": ...}` payloads).
- No pagination beyond `limit` / `starting_after` (Stripe) and `per_page` / `page` (GitHub, no `Link` headers); Slack cursors are ignored.
- Rate limiting uses wall-clock time (not the pinned env clock) and a simple sliding window per env.
- No auth beyond key-prefix checks (`sk_test_`, `xoxb-`, `ghp_`); permissions/scopes are not modelled.

## Stripe
- **Refund limits:** the twin rejects any refund that would exceed the unrefunded amount with 400 `charge_already_refunded`
  (real Stripe uses different messages/codes for some over-refund cases). Two *partial* refunds within the charge total are
  accepted, as in real Stripe; the flaky-network demo relies on exactly that (no twin deviation).
- Not modelled: payment methods, disputes, balance transactions, fees, webhooks signatures, `expand[]`, API versioning,
  search beyond `email:'...'`, idempotency-key parameter-mismatch errors, test-clock objects.
- Idempotency keys never expire and are shared across endpoints in an env.
- Error responses omit `doc_url` and `request_log_url`.

## Slack
- Only the 13 methods in SPEC are implemented. No Block Kit validation, mrkdwn parsing, rate-limit tiers, events API,
  `conversations.members`, files, or user-group APIs. Joining/membership is not modelled (the bot can post anywhere).
- Thread bookkeeping (`reply_count`, `latest_reply`) is not maintained on parent messages.
- `ts` values are `<env clock epoch>.<per-env counter>`; the counter is not per channel.

## GitHub
- Subset of REST v3: repos (get), issues (list/get/create/patch), comments, labels. No pull requests, search, GraphQL,
  assignees, milestones, reactions, pagination `Link` headers, ETags or conditional requests.
- Issue URLs in responses point at the twin (required for PyGithub); `html_url` points at github.com.
- `X-RateLimit-Remaining` is `5000 - number of GitHub requests in this env`.
