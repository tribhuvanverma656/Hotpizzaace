# Shared commerce development integration

Status recorded on **22 October 2026**. This work connects customer checkout, order tracking and the restaurant dashboard to the development Supabase project `hotpizzaaceDB` (`kaypgsstngguvrpftpwo`). It is a development integration with simulated payments.

The schema, saved-address migration and `hpa-commerce` Edge Function version 3 are deployed. The database contains **111 products, 14 categories and one Barra branch**. The branch is paused and COD is disabled. Local shared commerce is enabled. Application release `47f45b2` is live from `staging`; cloud-address browser acceptance passed, including defaults, stale-edit review and checkout integration. See [cloud addresses](CLOUD-ADDRESSES.md). Google owner sign-in and a separate-browser guest order → admin status updates → customer tracking journey passed. Private owner password creation, fixed-ID/password sign-in and dashboard reload also passed on 21 October. See the [owner acceptance record](OWNER-ACCEPTANCE.md). Production release and real payments remain pending.

## Application and trust boundaries

The browser calls same-origin `/api/commerce/*` routes. Next.js checks the server-controlled `COMMERCE_ENABLED=true` switch, verifies the Supabase customer session, checks the origin of mutations and forwards the request to the Supabase Edge Function. The Edge Function independently verifies access tokens, checks trusted administrator membership and authorizes each order operation.

Direct customer/publishable-key access to commerce tables and transaction RPCs is denied. RLS is enabled. The privileged database client lives only in the Edge Function; its secret is never placed in browser code, Git or Render application variables. Public menu reads and server-priced order creation use the Edge API.

When shared commerce is enabled, local demo admin sessions cannot open the connected dashboard. Administrator orders never fall back to browser-local orders after an authorization or connection failure. Shared orders are not copied into the persisted demo store; only the public menu, branch settings and the customer's local cart use that store. The labelled local prototype remains available when shared commerce is disabled.

## Implemented behavior

- Checkout recalculates product options, availability, branch coverage, coupons, delivery fees and the minimum order on the server. Client-provided totals and payment states are not trusted.
- Order creation uses an idempotency key, request hash and transactional catalog revision check. Retrying the same request does not create another order; changing a request under the same key is rejected.
- Signed-in orders belong to the verified Supabase user ID. A phone number is contact information, not proof of account ownership.
- Guest orders use a random, HttpOnly browser nonce. The database stores its hash. Guest order access does not extend to another signed-in customer's orders.
- An order tracking link carries a separate capability whose hash is stored in the database. It can read the matching order; possession of the link does not authorize status changes or payment mutations.
- The connected administrator can see shared orders, customer contact details and branch summaries, update fulfillment states, simulate cash collection, and edit products, categories, branches and settings.
- Catalog writes use revision compare-and-swap. Order changes use version checks and append audit events. Invalid state transitions and stale changes are rejected.
- Customer and admin screens refresh while visible and on focus. The current polling interval is approximately ten seconds. Sign-out and account changes clear private views rather than showing stale local records.
- Payment simulation is permitted only when the database is in development mode and explicitly allows it. Paid labels remain marked as simulated. No payment-provider verification or real money transfer is implemented.

## Owner access and acceptance

The nominated owner is **`hotpizzaace@gmail.com`**. Trusted owner membership is linked to the verified account’s user ID; an email typed in a form or editable user metadata cannot grant dashboard access.

Supabase confirms that this account exists, its email is verified, and trusted owner membership is assigned. The live development application opened the owner dashboard and retained access after reload. A separate Chrome guest placed a fictional ₹50 pickup order; the owner saw it and updated it through confirmed, preparing, ready and picked up. Guest tracking reflected every update automatically and retained the final state and private history after reload. An unauthenticated guest could not open the dashboard. The test order, audit events and temporary branch were removed; Barra remains paused with COD disabled. The owner subsequently saved a password privately and completed password sign-in/dashboard reload acceptance. Email recovery is deferred by owner decision.

Successful Google authentication initially returned to `localhost:3000` because Supabase had that Site URL and no redirect allowlist. The development Site URL is now `https://hotpizzaace-development.onrender.com`; allowed callback patterns are restricted to that host and `http://localhost:3001`. A fresh hosted sign-in verified the correction. See [Google authentication configuration](GOOGLE-AUTH.md).

## Owner user ID/password and Google

The connected admin sign-in screen offers exactly the readonly user ID **hotpizzaace@gmail.com** with a blank password field, and **Google** using the same owner account. Signup, forgot-password and email-setup controls are removed. No owner password is prefilled, stored in source or supplied as a shared demo credential. See [Admin access](ADMIN-ACCESS.md).

- Password sign-in posts to `/api/auth/password` with `action=signin`. The server enforces the fixed owner ID, verifies the Supabase identity and confirmed email, and rejects signup/reset actions. Protected dashboard operations independently require trusted membership.
- **Restaurant settings → Owner password** supports private password creation/change. Readiness requires a verified matching owner, an actual Google identity, recent signed OAuth proof and trusted owner membership. An older or password-only session must first use **Confirm identity with Google**.
- The human enters and confirms a 12–128-character password. Every password POST independently repeats authorization, same-origin checks and bounded validation. This separate form does not save kitchen, branch or delivery settings.
- Saving attempts global sign-out, then opens sign-in. The owner privately saved a password and completed fixed-ID/password sign-in and dashboard reload acceptance on 21 October. Scoped provider evidence confirmed a configured password and a password-authenticated session. The human performed credential entry and submission; the agent did not inspect password field values or database password hashes. Readiness and automated tests remain distinct from that completed human journey.
- Feedback uses finite application messages. Raw provider errors, passwords and authentication tokens are absent from responses and app persistence; password fields clear after submission and browser-history return.
- Email recovery is deferred. The email-recovery/update endpoints fail closed, and SMTP is not required for the current owner password/Google workflow. The earlier implementation and template are retained only as [historical recovery work](PASSWORD-RECOVERY-QA.md).

The `email_password_admin` migration remains applied; the additive saved-address migration is also applied and Edge Function version 3 is deployed. Email and Google providers remain enabled, and automatic email confirmation remains disabled. Hosted provider settings do not reactivate the application's retired signup/reset endpoints. Both Google owner acceptance and actual owner password creation/sign-in have passed; see the dated [acceptance evidence](OWNER-ACCEPTANCE.md).

## Verification recorded so far

- The latest combined implementation passed **292 automated tests**, lint, TypeScript and an isolated production build. Cloud-address database checks and browser acceptance passed. Live Render and independent local origins read the same book; the two fictional QA addresses were removed afterward. Actual mobile-device acceptance remains pending.
- **24 shared-commerce API checks passed** with fictional orders; these do not cover a completed email/password owner journey.
- Application release `47f45b2` passed **52 live authentication and 11 live address smoke checks**, including the fixed owner ID, absent email-setup controls, retired endpoint rejection, anonymous owner-password denial and origin protections.
- Owner-password tests cover fresh/stale/wrong-subject Google proof, trusted membership, validation, GET without mutations and committed-password/sign-out failure handling. They do not enter a real password or send email.
- Chrome guest checkout was verified through an explicit failed simulated payment, retry and successful simulated payment.
- The schema, saved-address migration and Edge Function version 3 are deployed to the development project. The existing Auth leaked-password-protection advisor warning is recorded in [cloud addresses](CLOUD-ADDRESSES.md); there is no address-schema advisor finding.

The completed owner/admin and cross-browser tracking journey is recorded in [OWNER-ACCEPTANCE.md](OWNER-ACCEPTANCE.md), alongside the separate 21 October password sign-in/dashboard reload acceptance. These human journeys supplement automated checks and do not establish production readiness.

## Deployment boundary

The known development preview is [hotpizzaace-development.onrender.com](https://hotpizzaace-development.onrender.com), with development work flowing through `staging`. Release `47f45b2` is live there with `COMMERCE_ENABLED=true` and a successful shared-service health check. This does not promote the release to production.

The owner confirmed **hotpizzaace.com** as the production domain. Its hosting/DNS cutover, production Render service, environment variables and Supabase OAuth redirects must be verified before production release. DNS and the existing GoDaddy registration are not changed by this work. Keep production and development data and payment credentials separate.

## Remaining work

| Area                     | Remaining work                                                                                                                                                                                                                                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application release      | Development release `47f45b2` is live. Production configuration, domain cutover and promotion remain separate.                                                                                                                                                                                                  |
| Saved addresses          | Cloud books, default rules, per-account transactions and checkout integration are implemented. Browser/default/conflict/checkout acceptance and the Render release passed; actual mobile-device acceptance remains separate. See [cloud addresses](CLOUD-ADDRESSES.md). Existing order snapshots are unchanged. |
| Product images           | Existing bundled images and HTTPS image URLs work. Shared file uploads require Supabase Storage, upload validation and access rules. File upload remains available only in the local demo.                                                                                                                      |
| Payments                 | Integrate a provider's test environment, server verification, signed webhooks, reconciliation and refund handling before accepting real online payments.                                                                                                                                                        |
| Notifications            | Restaurant/customer alerts, delivery notifications and an operational order-handling process remain to be implemented and agreed. Current order updates use polling.                                                                                                                                            |
| Pagination and reporting | Admin snapshots currently return at most 1,000 orders; customer history returns at most 200. Pagination and server aggregates are needed before these limits can truncate history or undercount dashboard totals.                                                                                               |
| Rate-limit maintenance   | Order and tracking rate limits exist. Old rate-limit rows still need a retention/TTL cleanup process and operational monitoring.                                                                                                                                                                                |
| Launch operations        | Confirm service PINs, kitchen schedule, support/policy details, backups, restore checks, monitoring and production release/rollback procedures.                                                                                                                                                                 |

Earlier browser-local orders and addresses are preserved locally and are not automatically imported into Supabase.

## Historical local verification — 20 October 2026

At that stage, **200 automated tests** passed, with lint, TypeScript, an isolated production build, **24 shared-commerce API checks** and **36 authentication smoke checks**. Chrome verified a fictional guest pickup order, failed payment simulation, successful retry, receipt/tracking after reload and private guest history. Supabase security advisors reported no findings. Owner Google access and cross-browser staff updates subsequently passed. Email recovery was still being investigated then and is now deferred; current password acceptance is tracked in [Admin access](ADMIN-ACCESS.md).

## Development release history

The initial shared-commerce [commit f490e63](https://github.com/Satya2n/hotpizzaace/commit/f490e63020b50ad73a48d9555bd458dc88ffe951) passed [CI run 39328964330](https://github.com/Satya2n/hotpizzaace/actions/runs/39328964330) and deployed as `dep-dbb8s5d9fdbs738ivku0`. Its five fictional QA orders and temporary branch were removed.

The subsequent native-form authentication fix and regression coverage, [commit 517fcc4](https://github.com/Satya2n/hotpizzaace/commit/517fcc458423268f7d08b98cc67f0fbc0b5f47dd), passed [CI run 39380544381](https://github.com/Satya2n/hotpizzaace/actions/runs/39380544381) and deployed as `dep-dbbgkpd9fdbs73e4u8jg`. Its live health check returned HTTP 200 with database/commerce connected and payments simulated. Live authentication smoke passed 31 checks. The [owner acceptance journey](OWNER-ACCEPTANCE.md) then verified the real Google owner session and separate-browser order status propagation. Its additional fictional order and branch were also removed. Only the paused Barra branch remained, with COD disabled.

The dependency audit for that earlier release reported zero production findings. Five preexisting development-chain findings referred to the same unpatched braces advisory; no incompatible ESLint downgrade was applied.

The earlier password-recovery release [63a88f8](https://github.com/Satya2n/hotpizzaace/commit/63a88f89d8a2a2cb5007dd738189c9287946ea87) passed [CI run 39414007925](https://github.com/Satya2n/hotpizzaace/actions/runs/39414007925) and deployed as `dep-dbbksrqvcj2c739v9sj0`. Its 36 live authentication checks and health check passed. The subsequent email-recovery findings are retained in [historical recovery QA](PASSWORD-RECOVERY-QA.md).

The single-submit email recovery implementation in `c6c17a1` passed 240 automated tests and 44 authentication smoke checks locally and live. Its email requests were disabled pending SMTP/template configuration. The owner subsequently deferred that workflow; it is not an active sign-in option.

The earlier owner-password release, `7915b12`, passed [CI run 39550164289](https://github.com/Satya2n/hotpizzaace/actions/runs/39550164289) and deployed as `dep-dbc4tke7bikc73fl6ce0`. It passed **257 automated tests** and **52 local and 52 live authentication smoke checks**. Fresh Google owner access was verified, followed by the owner's private password creation/sign-in and full dashboard reload acceptance. No additional automated tests were required for this acceptance record; see [Admin access](ADMIN-ACCESS.md) and [owner acceptance](OWNER-ACCEPTANCE.md).
