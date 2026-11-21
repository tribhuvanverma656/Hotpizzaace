# Kitchen staff access

Updated 3 November 2026. **Owner-approved [PR #18](https://github.com/Satya2n/hotpizzaace/pull/18) is released in production.**
The production chef feature is enabled, with zero provisioned chef accounts or
registered Kitchen sessions. Development has one provisioned chef; actual
preparation and owner-disable acceptance passed there, while fresh sign-in after
reactivation awaits independent verification. The shareable entry point is
`/kitchen`. Each chef
gets an individual username and password, managed by the owner in Admin. Sharing
the URL grants no access; chefs do not receive or share the owner's credentials.

## Production release — 3 November 2026

Approved candidate `78c29f0d7e45bfdab105afcd9a2f7ef68ae813e2` merged as
`1973014eb741b4e575e8af9e1f4a0d861296dc8e`. Render deployment
`dep-dbkmipks728c738ru1g0` finished live at **04:59:50 UTC on 3 November**.
Main [CI #123](https://github.com/Satya2n/hotpizzaace/actions/runs/41580946182) and
aligned staging [CI #124](https://github.com/Satya2n/hotpizzaace/actions/runs/41581623545)
passed at that merge.
Hosted migrations `20261103044028_kitchen_staff_access` and
`20261103044157_kitchen_ready_invoice` succeeded. Dedicated production
`hpa-kitchen` v1 is active with the development-matching bundle SHA256
`427e47689b4f35f8bd37a6fae00a81132133dde5465ef0ebd96dfc133fc5d5cd`.
The chef flag was enabled after the approved frontend became live.

Before/after invariant checks preserved catalog revision 157, five orders and five
invoices. There are zero chef accounts, Kitchen registrations or chef Admin
memberships; client RPC grant violations are zero and all four chef tables have RLS.
Website ordering remains off, Barra counter/QR remains on and online payment
methods remain empty. No development users, passwords or orders were copied.

Fresh production UI checks rendered the Username/Password/Sign in chef page and
the owner's empty Kitchen staff list with Add chef. The prepared Chef/chef/Barra
draft has not received its private password or been submitted. Production chef
provisioning, login and preparation acceptance therefore remain pending. The chosen
replacement development password is also not set; it requires owner entry.

Physical 58 mm printing and payment acceptance remain separate. On 3 November,
automatic capture with a 12-minute window and the Enabled Live webhook's seven
events were verified. The exposed Live API credential is still to be replaced;
production KEY_SECRET and WEBHOOK_SECRET are absent. No matching-secret, signed
delivery or real-payment acceptance is claimed. See [payment readiness](RAZORPAY-PAYMENTS.md).

The dated development evidence below is preserved. Its earlier draft/production
absence statements describe those checks and are superseded by this release.

## Implementation and verification

The dedicated Next gateway uses HttpOnly host-only cookies scoped to `/kitchen`,
separate from owner/customer cookies. The chef tree does not mount customer Auth,
commerce or address providers. Only allowlisted preparation DTOs reach the browser.
The isolated Edge backend verifies Auth identity, live Auth session, current staff
membership/version, branch, order version and preparation eligibility. Owner staff
changes also bind to the verified owner's live Auth session. A private boolean
Auth lookup avoids granting the service role broad SELECT access to Auth tables.

Owner controls are in **Restaurant settings → Kitchen staff**. Creating or resetting
a chef requires the owner's current password and private new-password entry. No
password is returned, retrieved or saved in application tables. An interrupted
credential operation remains blocked; after 15 minutes a new explicit password
reset can recover it without overlapping the previous Edge worker. Disabling the
whole feature revokes all registrations and increments membership versions.

Focused gateway/service/UI regressions cover cookie/CSRF isolation, projection,
revocation, reset failure, valid actor binding and preparation controls. The
development rollback-only SQL test exercises branch isolation, strict transitions,
financial preservation, stale versions, credential recovery and denied client RPCs.
The migration defaults to disabled. Production was enabled only after its approved
frontend and backend were live; do not copy development accounts, passwords or
orders into production.

### Development evidence — 31 October to 1 November 2026

- Initial candidate `c60ce604d7a073c6c37662392770b5ee956af8cb` passed all 543 tests,
  lint, TypeScript and the production build locally. GitHub push run
  [#97](https://github.com/Satya2n/hotpizzaace/actions/runs/41107509744) and PR run
  [#98](https://github.com/Satya2n/hotpizzaace/actions/runs/41107824586) passed.
  Render development deploy `dep-dbie6o0u01pc73c6ofq0` was verified live at that
  commit; the functional follow-up below supersedes that initial preview.
- Development migration `20261030140523_kitchen_staff_access` is applied and its
  rollback-only SQL suite passed. Dedicated `hpa-kitchen` v2 is active with bundle
  SHA256 `427e47689b4f35f8bd37a6fae00a81132133dde5465ef0ebd96dfc133fc5d5cd`.
  The development flag is enabled for acceptance; production has not been changed.
- The live Next gateway returns 401 for unsigned queue reads and 403 for a
  cross-origin login submission. The owner staff form and separate chef login render;
  the customer menu still loads with its existing cart and customer sign-in.
- Independent source review found no high-priority issues and independently passed
  the 25 focused chef tests. Its limits include real credential provisioning and
  multi-session browser acceptance.
- The SQL suite's duplicate-transition case is sequential. An additional attempt
  using separate connector calls produced one transition and one version conflict,
  but actual overlapping blocking was not observed, so it is not recorded as a
  concurrency pass. All synthetic users, sessions, staff, branch, order and events
  from that attempt were removed; exact-ID cleanup returned zero remaining records.
  The development order-reference counter was not rewound.
- At the 31 October–1 November audit, private owner-created chef
  sign-in/start/ready/revocation acceptance was pending and development had no
  provisioned chef accounts. The 2 November acceptance below supersedes that
  inventory. Password creation and entry stay with the owner.
- Follow-up migration `20261031033539_kitchen_ready_invoice` is applied in
  development. The rollback-only SQL test first reproduced the missing website
  invoice, then passed after the fix. Chef readiness now uses the existing
  idempotent invoice helper in the same transaction; counter invoices and saved
  financial fields remain unchanged. The updated suite also checks stale replay.
- Functional follow-up
  [`613d5728e75c61fd1297b70c4d6be721cfdfab20`](https://github.com/Satya2n/hotpizzaace/commit/613d5728e75c61fd1297b70c4d6be721cfdfab20)
  passes all 545 tests, lint, TypeScript and the production build. Its push and PR
  quality checks passed, and exact development Render deployment
  `dep-dbime36417fc73a45a90` is live on that commit. It rejects oversized 58 mm
  receipts before printing and displays a fixed A4 fallback message. This is the
  functional verification baseline for documentation-only follow-ups; confirm the
  latest required PR #18 checks before release. Private chef acceptance was still
  pending at that check; production had not been promoted.
- Documentation follow-up `e4a4dfd71d6f3368445fac8fc2817fda766a66ed` passed both
  GitHub checks; exact development deploy `dep-dbje05h5efls73dtm5lg` is live on that
  commit. The chef inventory at that 1 November audit was zero. This did not establish
  credential provisioning, physical printer acceptance or a real overlapping race.

### Development chef acceptance — 2 November 2026

One chef is provisioned and enabled, with zero Admin memberships. Private initial
sign-in registered its Kitchen session. Through the actual chef UI, development
ticket `930cb637…` advanced Confirmed v1 → Preparing v2 → Ready v3 and left the
active queue (three tickets became two). Two order events and two Kitchen audit
entries record the chef/branch actor. Payment fields, the original invoice and
immutable-document digests stayed unchanged; no settlement was added and the test
invoice remained valid.

Disabling the chef through the owner UI cleared the queue, redirected the chef to
`/kitchen/login` and removed all its Kitchen session registrations. Owner Settings
remained accessible. Reactivating the same chef did not revive the old session.
The owner reports that the Barra Kitchen opened after fresh sign-in, but the
inspected chef tab still shows login; independent verification awaits the correct
browser/page. This establishes the observed initial sign-in, preparation and
disable flow, not independently verified post-reactivation login or an actual
overlapping database race. Manual password reset was not
performed; its failure/recovery behavior has automated and rollback-only SQL
coverage, and this is an acceptance limit rather than a new manual release gate.
PR #18 remains a draft and no production chef release or provisioning has occurred.

A fresh 2 November execution of `supabase/tests/kitchen_staff.sql` passed branch
isolation, strict transitions, unchanged bills, stale versions, revocation,
credential-reset recovery and denied client RPCs. All fixtures and configuration
changes were rolled back. This focused database check does not establish an
actual overlapping race.

A separate 2 November overlapping attempt was inconclusive: connector worker
confirmations expired without results, and neither transition was confirmed. The
attempt was stopped. Exact guarded cleanup of its two passwordless synthetic
chefs, three tagged sessions, closed QA branch and two test bills returned zero
remaining records across all 13 checked groups (Auth users/sessions/identities,
profiles, Admin memberships, staff, Kitchen registrations/audits, orders/invoices,
events, settlements, gateway attempts and branch). Order-reference counters were
not rewound. No concurrency pass or application hang is inferred from this
connector outcome. PR #18 head `4d8df7f` had both CI checks passing and no merge
conflicts at the 2 November browser check; it remains a draft.

The physical 58 mm printer check and production Razorpay Live setup are separate
acceptance items. The 1 November payment snapshot, checked after 12:26:59 IST,
records a saved Enabled Live webhook with the production URL and all seven events.
A fresh 2 November metadata check still lists only the production key ID (last
updated 31 October) and saved mode/disabled flags; the key secret and webhook
secret are missing. Private entry fields are prepared, but Razorpay is signed out.
Matching-secret and signed-delivery acceptance remain pending. The Live API
credential disclosed in chat must be replaced privately before activation. Do not claim Live payments
are ready based on development payment tests. A local `lpstat` check found no
printer destinations or default printer on this Mac; physical 58 mm acceptance
requires the restaurant's printer.

## Experience and defaults

- `/kitchen` opens the signed-in kitchen or redirects to `/kitchen/login`. The login
  form has **Username**, **Password** and **Sign in** only. No Google, signup, email
  recovery or owner-password controls appear. Forgotten credentials go to the owner.
- After login, show the chef's display name, assigned branch, oldest-first active
  tickets, **Refresh**, **Start preparing**, **Mark ready** and **Sign out**. There
  is no Admin navigation, branch switcher or link to the full order/customer record.
- One account belongs to one chef and one branch. Use the stable branch ID, never
  the display name. Several chefs may work in the same branch with separate accounts.
  A chef who changes branch needs an owner reassignment and a fresh sign-in.
- Default usernames are unique within the deployment, trimmed and case-insensitive:
  3–32 lowercase letters, digits, dots, underscores or hyphens, beginning with a
  letter. Reserve owner/admin identifiers. Retain disabled usernames rather than
  recycling another person's identity. The owner may rename an account with the
  same uniqueness checks and session invalidation as reassignment.
- Passwords use the existing 12–128 character rule. The owner enters and confirms a
  new password when creating/resetting an account, then communicates it privately.
  The staff list never displays, retrieves or exports a password. There is no
  generated credential returned in a response, default password or shared branch PIN.
- Development and production accounts, sessions, branch assignments and audit trails
  remain separate. Production credentials are never copied into test fixtures.

Customer Google login and the owner's existing fixed-ID/password and authorized
Google login stay unchanged. The existing `/admin/kitchen` remains the owner's
cross-branch workspace. A chef is never inserted into `hpa_admin_memberships` as an
owner, and an owner/customer session does not silently become a chef session.

## Permissions

| Capability                                                                         | Owner in Admin                         | Chef in `/kitchen`                             |
| ---------------------------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------- |
| Create, rename, disable, reactivate, reset password, assign branch                 | Yes, with verified owner authorization | No                                             |
| Read active preparation tickets                                                    | Any selected branch                    | Assigned branch only                           |
| Confirmed → Preparing; Preparing → Ready                                           | Yes                                    | Yes, for eligible assigned-branch tickets only |
| Accept website/QR orders; authorize pay later                                      | Existing owner permissions             | No                                             |
| Cancel/reject, serve, close, dispatch or deliver orders                            | Existing owner permissions             | No                                             |
| Create/edit items, prices, quantities, branches or restaurant settings             | Existing owner permissions             | No                                             |
| Customers, phone/address/email, invoices, totals, sales, reports, payments/refunds | Existing owner permissions             | No                                             |
| Manage staff or view staff/order audit history                                     | Owner only                             | No                                             |

This is a kitchen role, not a general staff/manager role. Public storefront pages
remain public, but possessing a kitchen account grants no customer or admin data access.

## Preparation data contract

Create a dedicated, allowlisted kitchen ticket response instead of returning an
`Order` and hiding its extra fields in the UI. The same projection applies to queue
reads, transition responses and errors. Allow only:

- Opaque order ID, visible order reference, branch ID/name, creation time and version.
- `confirmed`/`preparing` status, fulfillment/channel label and a table/order reference
  where it is already intended for preparation use.
- Item name, quantity, selected size/crust/toppings/options and food preparation notes
  explicitly safe for kitchen display.
- A derived **Pay later · Payment still due** warning where the existing authorized
  exception applies, and a derived **TEST ORDER · Do not prepare real food** warning.

Do not serialize prices, discounts, GST, totals, invoice data, receipts/settlements,
gateway/UPI references, refund details, customer IDs, name/contact/address fields,
tracking/access tokens, staff credentials or pay-later reasons. Payment eligibility
is decided on the server; chefs receive only the operational warning they need.

Do not pass through `customer.instructions`: it contains delivery/customer text.
Existing arbitrary free text, including table labels and item notes, must not become
a backdoor for contact information. Where a kitchen-safe projection is unavailable,
omit that text and have the chef ask the owner for preparation details. Any later
note-sharing implementation must explicitly address contact content and render text
without interpreting HTML. Structured contact fields are always excluded.

Use a dedicated kitchen client/provider. Do not mount `useAdminStore` or the broad
shared admin snapshot and then filter its results in the browser. Staff data must
not enter customer/admin browser stores, local storage, analytics or error logs.

## Authentication, authorization and revocation

Use Supabase Auth for password verification and credential hashing. The application
stores staff identity/membership, **never password plaintext, reversible passwords
or a second password hash**. Supabase's password flow accepts an Auth identifier;
the server privately resolves the chef username to a separate staff Auth account.
Use an opaque, email-shaped Auth alias under a restaurant-controlled staff-only
namespace, with no real chef email/inbox, customer identity or mail recovery workflow.
Validate that alias convention against the installed SDK/Auth configuration during
implementation. Provisioning is server-only and cannot claim an owner invitation.

Keep kitchen Auth cookies in a separate namespace from customer/owner cookies,
scoped to `/kitchen`, Secure on HTTPS, HttpOnly and SameSite protected. Put the
kitchen gateway below that prefix, such as `/kitchen/api/*`, so those cookies reach
only the intended handlers. The kitchen browser calls this gateway; it does not
need a frontend Supabase Auth client or receive privileged keys. Refresh and sign-out
must use the kitchen session only. Cookie separation prevents accidental account
replacement; it is not the authorization boundary.

Each queue read and state change must verify all of the following on the trusted
server/Edge boundary, including a direct call that bypasses the Next.js UI:

1. Verified Supabase Auth identity and a live, registered kitchen Auth session.
2. Current enabled `kitchen` membership for that exact user and deployment.
3. A session authorization version that matches the current staff membership version.
4. An existing assigned branch; any supplied branch/order ID must belong to it.
5. An explicitly allowed operation, current order state and preparation eligibility.

Register kitchen sessions only after a successful username/password login through
the kitchen flow. An unrelated OAuth/customer session or a manually obtained Auth
token must not create this registration. Ignore body-supplied actors/roles and
editable `user_metadata`; token claims and browser branch selection alone cannot
grant or refresh permission. Fail closed if Auth, membership or session checks fail.

**Disable, reset, rename or branch reassignment invalidates every existing kitchen
session immediately.** First commit a membership authorization-version change and
revoke its registered kitchen sessions; then perform any Auth password change/global
sign-out. Recheck the current version on every read and in the transaction that
changes an order. Serialize this check with membership changes so an old session
cannot pass a check and commit after revocation. Old JWTs and refresh attempts must
fail, even if Auth global sign-out is delayed or fails. Reassignment never moves an
order or lets an old session start using the new branch. Reactivation requires fresh
login; it never revives revoked sessions.

Supabase access tokens can remain valid after sign-out until expiry. Therefore
global sign-out alone is insufficient: check the JWT's `session_id` against the live
Auth session and the application registration/version. See the current
[Supabase session guidance](https://supabase.com/docs/guides/auth/sessions).
The application version check also protects operations while Auth cleanup is retried.
Use an application-enforced 12-hour maximum kitchen session; expiry requires a new
password login without changing global customer/owner session settings. Do not
cache successful authorization across requests. On revoked/expired access, clear
the visible queue, stop polling and return to kitchen login.

Use same-origin/CSRF protection, bounded requests, private/no-store responses and
rate limits on login, queue reads and transitions. Unknown username, incorrect
password and disabled account return the same generic sign-in failure. Never log
credentials, Auth aliases, session tokens, cookies or full request bodies. The
Supabase privileged key remains server-only; [Auth admin operations are server-only](https://supabase.com/docs/reference/javascript/auth-admin-createuser).

## Owner administration and records

Add **Kitchen staff** in Admin settings: display name, username, assigned branch,
enabled/disabled state, last sign-in and create/edit/disable/reset actions. The owner
chooses an existing branch; a paused branch may still need to finish accepted work,
so kitchen access follows the existing-order policy rather than new-order availability.
A deleted/missing branch fails closed. Branch deletion must not orphan enabled staff.

Every management request repeats the current trusted owner authorization. Password
creation/reset additionally requires recent server-verified owner reauthentication
using an existing owner sign-in method. No new Google requirement is added to staff
login or the owner's normal password login. Invalid/stale owner proof makes no change.
Choose disable over deletion so historical order actors remain attributable.

Proposed records are a staff membership keyed by Auth user ID (unique normalized
username, display name, branch FK, fixed kitchen role, enabled state, authorization
version, owner/server timestamps), a registered kitchen-session record (Auth session
ID, user ID, authorization version, creation/expiry/revocation), and append-only staff
management events. Keep these private with RLS/explicit client denial and no public
RPC grants. Only narrow trusted server operations can read or mutate them.

An account is usable only after Auth provisioning and staff membership both succeed.
Create it disabled until that sequence completes. If reset partially fails, leave
the account blocked with sessions revoked, report the actual outcome to the owner
and offer a safe retry; do not claim a new password is active. Management actions
must serialize/reject stale versions to avoid simultaneous reset/reassign races.

Audit management actions with the verified owner actor, target staff ID, action,
previous/new branch/state/version, server time and outcome. Audit kitchen transitions
with verified chef ID, branch/order ID, previous/next status, order version and server
time. Keep stable actor identity and username/display-name snapshots for attribution
after rename. Never include a password/hash/token. The transition and its successful
order event commit together; only the owner can read the audit trail.

## Preserve order and concurrency rules

Keep `lib/kitchen.ts`, `counterKitchenEligible`, website status rules and the existing
payment/refund guards authoritative for both owner and chef queues. Kitchen access
must not broaden preparation eligibility:

- Website orders require restaurant confirmation and the existing captured-payment
  rule, permitted development simulation, or accepted cash-order rule.
- Counter/accepted QR orders require a valid recorded full settlement or the existing
  explicit owner-authorized, reasoned pay-later exception. The unpaid warning stays.
- Unaccepted QR requests, unpaid online orders, review-required/refunded/voided orders,
  wrong-branch orders and statuses outside confirmed/preparing stay out of preparation.
  Test/simulation tickets retain their warning and environment separation.
- Chef transitions are exactly `confirmed → preparing → ready`. No skipping/reversing,
  accepting, cancelling, serving, closing, dispatching, changing items or recording
  payment. Marking ready does not settle a bill or change financial fields.

Add a narrow kitchen transition endpoint and trusted database operation; do not
broaden the existing owner-wide `PATCH orders/:id` or counter payment procedures.
Accept only order ID, target preparation status and `expectedVersion`. Derive the
actor and branch server-side, lock/read the latest order, repeat the membership,
branch, eligibility and expected-version checks, then change status/version and
append the audit event atomically. Preserve existing owner transition behavior.

Two chefs racing the same version produce one committed transition/event. The other
gets a version conflict and refreshes; retries cannot silently advance the next
state or duplicate the event. Keep the synchronous double-click lock and 10-second
polling/manual refresh behavior. Connection/authorization errors disable mutations;
uncertain saves require a fresh read, and incomplete queues remain clearly flagged.

## Acceptance and staged rollout

Required automated and browser acceptance before staff use:

1. A chef logs in with username/password at `/kitchen`; there is no Google/signup/
   email-reset path. Customer Google and both owner sign-in methods still work.
   Kitchen login/logout does not replace or sign out an owner/customer in another tab.
2. Anonymous/customer/chef attempts to open Admin, staff management, reports, full
   orders, customers, invoices, payments, catalog mutations or direct table/RPC reads
   are denied. Editable metadata, forged actors and raw Auth tokens do not grant access.
3. Two branches with the same name remain isolated by ID. A chef cannot read or mutate
   the other branch by changing the URL/body/order ID, including direct Edge requests.
   No unassigned-branch data appears in JSON, HTML, caches or error messages.
4. Inspect queue and mutation responses for financial/contact/credential fields and
   planted contact details in legacy notes. Only the preparation projection is sent.
   A pay-later warning survives without amounts, contact data or the private reason.
5. Paid website, accepted cash, counter paid and authorized pay-later cases retain
   their current eligibility; unpaid online, unaccepted QR, refunded/review/voided and
   terminal cases remain blocked at read and transition time. Re-test a refund or
   payment-review change racing a preparation update.
6. Start/ready work for assigned eligible tickets; all other transitions and extra
   fields are rejected. Concurrent chefs, double clicks and uncertain retries create
   one version increment/event and preserve all financial fields.
7. Disable/reset/rename/reassign while a chef has multiple open tabs and saved tokens.
   All subsequent reads/writes/refreshes fail immediately, including a request racing
   the management transaction. New assignment requires login; reenable does not revive
   old sessions. Simulate Auth sign-out/reset failure and verify the safe blocked state.
8. Staff creation partial failures, stale owner reauthentication, duplicate usernames,
   missing branches, login rate limits, expired sessions and connection outages fail
   safely with correct owner feedback and actor-attributed audit events.

Roll out in stages: (1) review this framework; (2) implement additive private records,
session isolation, narrow APIs and owner controls behind a server feature switch;
(3) run local/unit and transactional database authorization/concurrency tests plus
development acceptance with synthetic staff/orders; (4) deploy disabled to production,
verify configuration and owner/customer regressions; (5) owner creates one chef for
one branch and privately performs login/start/ready acceptance on an explicitly
authorized test ticket; (6) enable further chefs after that evidence is recorded.
Production test actions must not instruct preparation of real food.

Rollback disables the staff feature and revokes kitchen registrations/versions.
Keep owner access, accepted orders, invoices, settlements and audit history intact.
Do not delete business records or relax owner/database policies as a workaround.

No additional product decision is required for this draft. Before implementation,
verify the current Supabase Auth/session/admin APIs and changelog, and read the
installed Next.js authentication, Route Handler and cookie guides as required by
`AGENTS.md`. Provision real usernames/passwords only during the owner's private
acceptance; never request credentials in chat.

## Source grounding

The present source has owner-only kitchen reads in
`supabase/functions/hpa-commerce/index.ts` (`admin/kitchen/:branchId`) and broad owner
order transitions that return full order data. `components/admin/kitchen.tsx` uses
the admin provider and current kitchen board. `lib/kitchen.ts`, `lib/counter.ts`,
the service-only order/counter SQL procedures and their tests define eligibility,
versioning and audit behavior. This proposal adds a separate staff boundary while
retaining those business rules. See [existing kitchen](KITCHEN.md),
[owner access](ADMIN-ACCESS.md), [branches](BRANCHES.md) and
[counter framework](DINE-IN-COUNTER-FRAMEWORK.md) for the current workflows.
