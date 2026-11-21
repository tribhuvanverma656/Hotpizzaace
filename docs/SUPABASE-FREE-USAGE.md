# Supabase Free usage and transfer status — 6 November 2026

The usage-reduction changes are a local, unreleased candidate based on
[PR #21](https://github.com/Satya2n/hotpizzaace/pull/21), merged on 5 November as
`155b4b575c589919fa808f209fed5fa2e527ed2f`. That baseline passed **591 tests**,
lint, TypeScript and the production build. Baseline checks do not establish that
this new candidate is deployed or has reduced live usage.

## Verified Free transfer blocker

The production project's Supabase transfer preview was checked on 6 November.
The destination organization was selectable, but **Transfer Project was disabled**
because the source organization has an active grace period or service restrictions
and the destination is Free. This is an observed eligibility blocker, beyond a
general billing warning. The final transfer was not submitted. A separate
development transfer preview was not attempted after this source-organization
blocker was established.

The source Billing page last showed a **19 October–19 November 2026** cycle and
a grace period ending **7 November 2026**. Recheck the actual billing and transfer
preview after the restriction is resolved. The 19 November reset is a recheck
point; it is not a promise that transfer eligibility or service availability will
automatically recover at a particular time. Supabase documents that quota-related
restrictions can take time to clear after a reset, and that a historical grace
notice can persist. See the [Fair Use Policy](https://supabase.com/docs/guides/platform/billing-faq#fair-use-policy).

Preparation completed with the owner's approval: the source operator accepted
**Developer** membership in the restaurant-owned destination organization, and the
owner-confirmed unused destination placeholder project was **paused**, with its
paused status verified. No duplicate invitation was sent. Pausing that placeholder
addresses one capacity consideration; the destination's complete account/project
eligibility and the source projects' other transfer prerequisites still need a
fresh check. Supabase's [transfer guide](https://supabase.com/docs/guides/platform/project-transfer)
requires source ownership and destination membership and lists additional
integration/role/log-drain prerequisites. Its [Free-project limit](https://supabase.com/docs/guides/platform/billing-faq#how-many-free-projects-can-i-have)
also considers active projects and the relevant Owner/Admin accounts.

**Neither the existing production nor development project has transferred.** No
paid plan, billing setting, credential, application environment URL or stored
commerce data was changed during this preparation. No project data or keys were
exported. The unrelated personal project remains outside the transfer scope. Do
not use another account, an alternate API/CLI path or a dump/recreation to bypass
the provider restriction. Any eventual transfer needs fresh eligibility checks,
current data/configuration baselines and approval for the concrete transfer.

## Candidate changes that reduce future requests

Previously, each connected browser refreshed catalog, session and customer orders
every ten seconds. An owner session additionally downloaded a full admin snapshot,
even on pages that did not consume those orders. Saved addresses refreshed every
15 seconds on every signed-in page. Some operational pollers also read while the
tab was hidden. The candidate changes scheduling without changing server-side
ownership checks, RLS, private RPC grants or payment authorization.

| Visible screen or demand                                              | Automatic cadence and data                                                                                                       |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Customer storefront without a known active order                      | Session, public catalog and customer orders every 60 seconds; customer orders remain available for the global tracking banner    |
| Customer order history, tracking, or a known active customer order    | Global refresh every 10 seconds                                                                                                  |
| Admin orders and order-detail routes                                  | Admin snapshot every 10 seconds; its included catalog avoids a second catalog download                                           |
| Admin overview and customer directory                                 | Admin snapshot every 30 seconds                                                                                                  |
| Other admin screens                                                   | Session/public catalog every 60 seconds; no automatic full admin snapshot or customer-order list                                 |
| Auth and branch QR pages                                              | No automatic customer-order list; their general session/catalog cadence is 60 seconds                                            |
| Counter, owner Kitchen, separate chef Kitchen and pending QR requests | Their dedicated operational feeds retain their 10-second cadence while visible                                                   |
| Signed-in checkout and saved-address screen                           | Address book refresh on visible entry, then every 15 seconds; other routes do not start address-book reads                       |
| Open customer receipt                                                 | Dedicated receipt refresh every 10 seconds while visible, including fulfilled orders whose payment/refund state can still change |

Automatic pollers skip hidden tabs, coalesce paired focus/visibility events and
avoid overlapping scheduled reads. Returning to a visible screen revalidates its
data. Route entry refreshes needed data; explicit retries, writes and their
post-mutation refreshes retain their immediate paths. Address account/context
invalidation, revision checks, dirty-form review and conflict recovery are
preserved. The separate chef application continues to use its own access scope.

The longer idle cadence permits up to a minute before another device's new
customer order is discovered on an idle storefront. Once a known customer order
is active, its global tracking cadence remains ten seconds. This is an intentional
freshness tradeoff, not a change to order ownership or server validation.

## Render liveness and deployment order

The candidate adds **`GET /api/liveness`**, an uncached HTTP 200 response with only
`{ "status": "ok" }`. It makes no Supabase Auth, database, commerce Edge or payment
requests and sets no cookies. It confirms that the web process responds.
`/api/health` remains the unchanged deep diagnostic: in shared mode a successful
check performs a database health RPC and an Edge catalog request. A liveness
success does not establish that those dependencies, checkout or payments work.

`render.yaml` now proposes `/api/liveness` for **hotpizzaace-development only**.
The existing setup record uses `/api/health`; a local manifest edit does not prove
that either running service's saved Health Check Path has changed. This candidate
has not changed any live Render setting. The actual saved path and probe frequency
must be inspected separately; no exact cloud saving is attributed to an assumed
hosting-probe cadence.

1. Deploy code containing `/api/liveness` while the existing health path remains
   valid. Coordinate any Blueprint sync so an older deployment is not switched to
   a route it lacks.
2. After the deployment is live, verify the endpoint's HTTP 200, small JSON body
   and `Cache-Control: no-store, max-age=0`. Use `/api/health` deliberately once to
   check dependency readiness separately.
3. Set and verify each intended running service's actual **Health Check Path** to
   `/api/liveness`. Apply this independently to production if approved; the
   development Blueprint does not configure production.
4. Confirm subsequent probes use the new route and observe usage over time. Keep
   the endpoint in a rollback revision, or restore the previous health path before
   rolling back to a revision that lacks it.

See [Render liveness](RENDER-LIVENESS.md) for the operational tradeoff and rollback
details.

## Verification and limits

The candidate passed **619 tests**, lint, TypeScript and the production build.
Coverage includes address-route demand, hidden-tab/focus scheduling, request
budgets, delayed reads, policy upgrades during navigation, mutation conflicts,
private identity boundaries and a liveness response that cannot call external
dependencies. A local production-build browser check loaded the development menu
and owner counter. Deployed acceptance and live usage measurement remain required
before claiming a production release or measured savings.

A one-time follow-up is scheduled for **19 November at 10:00 IST** to recheck Free
usage and transfer eligibility. It does not authorize a paid change or a transfer.

After deployment, record time-bounded usage for both existing Supabase projects
and both intended Render services. Compare Edge invocations and egress with a
similar period and account for open browser tabs and real orders. Source-level
request reductions do not establish an exact percentage or a guarantee that the
Free allowance will cover future traffic.

Reducing reads or pausing a project cannot erase usage already incurred in the
current cycle. Moving a project also does not remove its accrued source usage.
The changes lower future requests and response bytes; they do **not** guarantee
that today's transfer block disappears or that service remains uninterrupted
through the 7 November grace deadline. Supabase documents these limits in
[egress usage](https://supabase.com/docs/guides/platform/manage-your-usage/egress)
and [project-transfer billing](https://supabase.com/docs/guides/platform/project-transfer#usage-billing-and-project-add-ons).
No paid upgrade or spend change has been approved or made.
