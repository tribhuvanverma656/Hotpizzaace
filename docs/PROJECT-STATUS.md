# Project status — 6 November 2026

## Current merged release baseline — PR #21

[PR #21](https://github.com/Satya2n/hotpizzaace/pull/21) merged on **5 November
2026** as `155b4b575c589919fa808f209fed5fa2e527ed2f`. Its customer-privacy
baseline passed **591 tests**, lint, TypeScript and the production build. It
restricts signed-in orders to their account owner, separates guest-browser access
at authentication boundaries and scopes private browser drafts to a verified
context. The 4 November privacy-candidate statements in the historical record
below are superseded by this merge. This status does not supply a new Render
deployment identifier or backend-version claim for PR #21.

## Usage-reduction candidate — unreleased

The current local candidate reduces recurring Supabase requests using route-aware
commerce refreshes, address reads only on checkout/saved-address screens, hidden-tab
polling guards and a dependency-free `/api/liveness` endpoint. Operational queues,
active customer tracking, visible receipt payment/refund updates and explicit
mutation/retry refreshes retain their immediate or ten-second paths. The longer
idle-storefront cadence is 60 seconds; overview/customer-directory snapshots use
30 seconds. See [Supabase Free usage](SUPABASE-FREE-USAGE.md) for exact route
cadences and validation limits.

This candidate has not been released, and no live usage reduction is claimed.
Local validation passed **619 tests**, lint, TypeScript and the production build;
the local development-backed menu and owner counter loaded in the browser.
`render.yaml` proposes `/api/liveness` for development only; it does not change an
existing service's saved health path. Deploy the endpoint first, verify it, then
change and verify each intended live Render Health Check Path. Keep `/api/health`
for deliberate dependency-readiness checks. Production needs its own approved
configuration change. See [Render liveness](RENDER-LIVENESS.md).

## Ownership transfer — blocked on Free

The **6 November** production transfer preview recognized the restaurant-owned
destination organization but disabled the final transfer because the source
organization is in a grace period or under service restrictions and the target
is Free. The source Billing page last showed **19 October–19 November**, with
grace ending **7 November**. A reset/restriction recheck is needed; automatic
transfer eligibility on 19 November is not guaranteed.

The approved destination **Developer** membership was accepted and the
owner-confirmed unused placeholder project was paused. No production or
development project has transferred, and no paid plan/billing change, credential
change, data/key export or application-URL change occurred. The unrelated personal
project remains excluded. The usage candidate affects future traffic; it cannot
erase accrued quota or guarantee that the transfer blocker is lifted. Details and
remaining prerequisites are in [Supabase Free usage](SUPABASE-FREE-USAGE.md).

Fresh read-only production preparation recorded **8 orders, 8 invoices, catalog
revision 220 and zero chef accounts**. Barra counter acceptance remained enabled;
website ordering and online payment methods remained disabled. These are dated
preflight observations, not a post-deployment or eventual-transfer acceptance.
Private chef creation/login, replacement payment credentials and real payment,
refund and settlement acceptance remain pending. Physical printer acceptance and
owner password-save investigation remain deferred as previously recorded.

## Historical status — 4 November 2026

The following release and acceptance record predates PR #21. Its statements that
the privacy candidate awaits deployment describe the 4 November snapshot; use the
merged baseline and unreleased usage-candidate status above for current source
status. Earlier payment, chef and printer evidence retains its stated limits.

### Production rounding release — PR #20

Owner-approved [PR #20](https://github.com/Satya2n/hotpizzaace/pull/20) is live at
[hotpizzaace.com](https://hotpizzaace.com), merged as
`38b7a5c395baf9888cc191674f6a750439e9b132` from tested head
`908f474010e933f7806c3265e9c9a4b5e8d2e279`. All **573 tests**, lint, TypeScript,
the production build and both candidate CI checks passed. Main and staging were
fast-forward aligned after release.

Production migration `20261103175819_nearest_rupee_bill_rounding` applied the
approved SQL, SHA256
`a4a2e55a759dc422af021bad52a214aa9bba968dcd7d60b5d7f37d8ad2fc0631`.
Production `hpa-commerce` v14 is ACTIVE with bundle SHA256
`21427f30f726b3f361c13c79c535e2076bb7e0fc9478009ca78fb91dd5ccf440`, matching
tested development v17. Render deployment `dep-dbl22h59el5s73f7h1ag` finished
**live at 18:04:28 UTC on 3 November** on the approved merge.

Production quote-only checks confirmed ₹262.50 → ₹263, ₹110.26 → ₹110 and MRP
water ₹20 → ₹20. The temporary draft was cleared; no order, invoice, settlement
or payment was created. All five saved orders/invoices and financial-document
digests were unchanged, with catalog revision **181** preserved. Database checks
confirmed the half-rupee boundary, legacy bill acceptance, MRP ceiling and closed
private RPC grants with RLS enabled. New bills record their rounding policy;
existing bills are never repriced. See [bill rounding](BILL-ROUNDING.md).

Barra counter/QR remains enabled. Website checkout, COD and Razorpay remain paused.
The earlier chef release and its separate private acceptance limits follow below.

### Earlier production chef release — 3 November 2026

Owner-approved [PR #18](https://github.com/Satya2n/hotpizzaace/pull/18) is released
at [hotpizzaace.com](https://hotpizzaace.com), merged as
`1973014eb741b4e575e8af9e1f4a0d861296dc8e` from the approved candidate
`78c29f0d7e45bfdab105afcd9a2f7ef68ae813e2`. Render deployment
`dep-dbkmipks728c738ru1g0` finished **live at 04:59:50 UTC on 3 November**.
The candidate's push and PR quality checks both passed. Main
[CI #123](https://github.com/Satya2n/hotpizzaace/actions/runs/41580946182) and aligned
staging [CI #124](https://github.com/Satya2n/hotpizzaace/actions/runs/41581623545)
also passed at the release merge; both branches are aligned there at this snapshot.
This release includes
separate branch-scoped chef access, the Ready/invoice correction, historical order
detail loading, the admin sign-in availability fix and the oversized thermal receipt
guard. The earlier PR #19 product-saving feedback is retained.

Production applied hosted migrations `20261103044028_kitchen_staff_access` and
`20261103044157_kitchen_ready_invoice`. Dedicated `hpa-kitchen` v1 is active with
bundle SHA256 `427e47689b4f35f8bd37a6fae00a81132133dde5465ef0ebd96dfc133fc5d5cd`,
matching development. The chef feature was enabled after the frontend became live.
Before/after checks preserved catalog revision **157**, **5 orders** and **5
invoices**. Chef accounts, Kitchen session registrations and chef Admin memberships
are all zero; private RPC client-grant violations are zero and all four chef tables
have RLS enabled. Website ordering remains off, Barra counter/QR remains on and
its online payment-method list remains empty.

Fresh production browser checks rendered the separate `/kitchen/login` form with
Username, Password and Sign in only, and the owner's Kitchen staff list with zero
accounts and Add chef. A nonsecret Chef/chef/Barra draft is prepared; private
password entry and submission have not occurred. This verifies the released UI and
configuration, not a production chef login or preparation transition.

### Acceptance record — 4 November 2026

Customer privacy source changes now pass **591 tests**, lint, TypeScript and the
production build. The candidate removes signed-in guest-order fallback, rotates
guest access at verified login/explicit logout boundaries, and partitions checkout,
QR and receipt caches using a non-bearer browser context. Ordinary anonymous
checkout retries and explicit read-only tracking links retain their behavior.
This candidate still requires deployment; see [security review](SECURITY-REVIEW.md).

Fresh 4 November production verification still shows zero chef accounts and saved
Razorpay names KEY_ID/ENABLED/MODE only. The owner's reported private saves have
not yet appeared in production; exact form success/error and URL are requested.

- Privately create the production chef through owner Settings and verify its
  separate login, branch queue and preparation controls. The chosen replacement
  development chef password has not been set; owner entry remains pending. The
  observed development Start/Ready and disable/revocation checks below passed;
  fresh post-reactivation login and an actual overlapping race remain unverified.
- **Deferred by the owner on 4 November:** physical 58 mm printer acceptance.
  The requested work continues without a hardware-printing gate. No physical
  printer pass is claimed; the deferred procedure remains in
  [printer QA](THERMAL-PRINTER-QA.md).
- Replace the exposed Live API credential and privately save the production key
  secret and matching webhook secret. On 3 November the existing exposed key ID
  remained saved, while KEY_SECRET and WEBHOOK_SECRET were absent; the API-pair
  entry form is prepared. Automatic capture with a 12-minute window and the Enabled
  Live webhook's seven events were verified. Signed-delivery, real-money payment,
  refund and settlement acceptance remain pending; online payments stay disabled.
  See [payment readiness](RAZORPAY-PAYMENTS.md).
- Owner password saving remains deferred at the owner's request.
- Complete and verify the separate customer privacy candidate before release.
  It restricts signed-in customer order reads to the account owner, denies guest-cookie
  order access to signed-in customers and rotates guest cookies at authentication
  boundaries. Client integration is in progress; no production privacy-fix release
  is claimed. See [security review](SECURITY-REVIEW.md).

Development and production continue to use separate Supabase projects; no accounts
or test orders were copied. Nearest-rupee rounding is released as recorded above;
the customer privacy candidate is separate work.

## Historical status — 2 November 2026

The dated record below preserves earlier release and acceptance evidence. Its
statements that PR #18 is a draft, production chef access is absent or promotion
approval is pending are superseded by the 3 November release above. Its payment,
password and printer evidence remains limited to the checks described on each date.

### Production record — 2 November 2026

[hotpizzaace.com](https://hotpizzaace.com) runs the owner-approved
[PR #19 saving-feedback release](https://github.com/Satya2n/hotpizzaace/pull/19), merge
`09ea0b54f25e1f5309453c1e40fcc27985588ef0`, on top of the
[PR #17 counter-billing release](https://github.com/Satya2n/hotpizzaace/pull/17).
The earlier counter-billing release is recorded as
[release-2026-10-30-counter-billing](https://github.com/Satya2n/hotpizzaace/releases/tag/release-2026-10-30-counter-billing).
PR #19 deployment `dep-dbk6i7dg1s2s738lvleg` is live on the approved merge commit.
Its isolated candidate passed all **521 tests**, lint, TypeScript, the production
build and GitHub CI. Production browser verification observed the disabled Save
button with a spinner and “Saving…”, a loading notification, and successful
navigation back to the product list after saving an existing product unchanged.
There were no new error-level runtime logs in the scoped post-deploy check. The
browser blocked a separate `/api/health` probe; this is application-UI and Render
deployment verification, not a successful direct health-endpoint check.

This release changes only the product form and its regression tests. It adds
progress and completion feedback, keeps duplicate submissions blocked, and lets
failed saves be retried without losing the draft. It changes no menu data, prices,
database/backend rules, credentials, ordering switches or payment settings.
Staging includes the same fix and the approved main history; the separate chef
candidate below remains unreleased.

The live release includes branch counter and quick-service QR ordering, food photos
on customer QR cards, home delivery from the counter, cash/direct merchant UPI,
pay-later collection, GST-inclusive MRP items, GST bills, rounding down new bills,
daily numeric order references, compact owner Kitchen cards, 58 mm receipt printing
and provider-verified refund reconciliation. Counter billing stays photo-free.
The older Google provider setup blocker is resolved. After a rejected production
password on 1 November, fresh Google confirmation opened Owner password settings.
The owner privately saved a new website password and reported successful password
sign-in. A fresh browser page independently loaded the protected production
dashboard as hotpizzaace@gmail.com with no error alert. The agent did not read,
enter or save the password. On 2 November the owner reported another password-save
problem and explicitly deferred that work. It is open again; the earlier successful
dashboard check is historical evidence, not proof that this new report is resolved.

Barra counter/QR acceptance is enabled. Website checkout, COD and live online
payments remain paused. The confirmed no-money production software tests were
removed from operational lists and reports while their original documents were
retained for audit. Development and production use separate Supabase projects;
credentials, customers and test orders are not copied between them.

### Development candidate record — 2 November 2026

[Draft PR #18](https://github.com/Satya2n/hotpizzaace/pull/18) adds separate chef
username/password access at `/kitchen`, with one assigned branch, preparation-only
tickets, Start preparing / Mark ready, and owner-managed staff accounts. It does
not grant Admin, customer, billing or payment access. Initial chef UI/backend
changes are deployed to development; no production chef feature is deployed.
At the 2 November browser check, PR #18 head `4d8df7f` had both CI checks passing
and no merge conflicts; it remains a draft.

The development schema includes the correction that issues a website invoice when
a chef marks its order Ready, preserving existing counter invoices and saved
amounts. The latest source also refuses oversized thermal receipts before printing
and offers A4 instead. Functional candidate
[`613d5728e75c61fd1297b70c4d6be721cfdfab20`](https://github.com/Satya2n/hotpizzaace/commit/613d5728e75c61fd1297b70c4d6be721cfdfab20)
passed all **545 automated tests**, lint, TypeScript and the production build.
Both its push and PR quality checks passed; exact development Render deployment
`dep-dbime36417fc73a45a90` is live on that commit. Documentation-only follow-ups
retain this functional verification record; check the latest required PR #18
checks before release.

Documentation follow-up `e4a4dfd71d6f3368445fac8fc2817fda766a66ed` also passed both
GitHub checks; exact development deployment `dep-dbje05h5efls73dtm5lg` is live on
that commit. This records deployment evidence, not private chef acceptance.

The 2 November Render check confirms development deployment
`dep-dbjllurm8hqs73ftu3eg` live at documentation follow-up
`e690461232d97bce1d4e0bc883d7b26222bd701e`. That earlier deployment check preceded
the production PR #19 release recorded above. Development's chef feature is enabled
with active `hpa-kitchen` v2; the fresh acceptance below supersedes its earlier
zero-staff inventory. Production chef tables and backend are not deployed.

The 1 November login follow-up prevents slow background session checks from
disabling fresh Google/password sign-in. Only initialization and actual submissions
lock the forms; duplicate submission guards, browser-back reset and verified-owner
redirect checks remain. All **549 tests**, lint, TypeScript and the production build
pass locally. Commit `079ac222ee8c40ed8656b142e0729020ad393284` is live in exact
development deployment `dep-dbjeiheq1p3s73alt2hg`. This UI correction does not
establish why the owner's password was rejected or change that password. The
separate private production password acceptance and reopened issue are recorded
above. Production now runs the separately approved PR #19 release.

The 2 November historical-order follow-up loads protected admin order details
directly instead of relying on the latest 1,000-order snapshot. It retains the same
bill/workflow presentation, uses the loaded version for changes, revalidates on
focus/interval without overlapping reads, and rejects stale responses after
account/order/branch changes. Unavailable, removed or unauthorized responses never
fall back to a cached bill; terminal reads also invalidate older pending writes.
All **556 tests**, lint, TypeScript and the production build pass locally. Fresh
browser acceptance opened development order `930cb637-a21b-4628-91ad-9337775f3e53`
through its protected direct link and reloaded it successfully: the order heading
and saved test bill rendered with 58 mm selected and no error alert. This verifies
that existing development ticket, not an order outside the latest 1,000-order
window. It does not add list pagination, change server permissions or promote the
production release.

Branch/session/permission and invoice checks passed in rollback-only SQL tests.
A fresh 2 November repeat of `supabase/tests/kitchen_staff.sql` also passed branch
isolation, strict transitions, unchanged bills, stale versions, revocation,
credential-reset recovery and client RPC denial; all fixtures and configuration
changes were rolled back. The duplicate-transition assertion is sequential. A
separate 2 November overlapping attempt was inconclusive when connector worker
confirmations expired without results; neither transition was confirmed. Exact
guarded cleanup returned zero remaining records across all 13 fixture groups,
including Auth identities/sessions, staff/registrations, the QA branch and test
orders/documents. Order-reference counters were not rewound. This does not establish
a concurrency pass or an application hang; the scoped cleanup is recorded in
[Kitchen staff access](KITCHEN-STAFF-ACCESS.md).
The 2 November acceptance confirms one enabled, provisioned development chef with
zero Admin memberships. Actual chef sign-in and Confirmed → Preparing → Ready
passed; the completed ticket left the queue with payment/invoice records unchanged.
Owner-disable cleared the chef queue and Kitchen session registrations and
redirected it to `/kitchen/login`, while owner Settings stayed accessible.
Reactivation did not revive the old session. The owner reports the Barra Kitchen
opened after fresh sign-in, but the inspected chef tab still shows login; independent
verification awaits the correct browser/page. Manual
password reset was not performed (automated/SQL recovery coverage passed); that is
an acceptance limit, not a new manual release gate. A real overlapping race is not
established. See the scoped evidence in
[Kitchen staff access](KITCHEN-STAFF-ACCESS.md).

### Historical pending list — 2 November 2026

- Owner password saving was reopened on 2 November and deferred by the owner.
  Resume only when the owner wants to investigate the actual save error privately.
- Independently verify the reported fresh chef sign-in after reactivation. Initial sign-in,
  Start/Ready and owner-disable revocation passed in development. Record actual
  overlapping database-race evidence separately from stale-version checks.
- Confirm the latest required PR #18 checks and obtain production release approval
  after private acceptance, before promoting it or provisioning production chefs.
- Print a short and long development bill on the restaurant's actual 58 mm printer;
  verify width, readability, paper feed and cancellation/reprinting. This Mac has
  no configured printer destinations or default printer, so hardware acceptance
  requires the restaurant's device. See [printer acceptance](THERMAL-PRINTER-QA.md).
- Replace the Live API credential exposed in chat and complete private production
  Razorpay credentials, matching webhook-secret verification, merchant capture
  configuration and owner-operated real-money acceptance. The 1 November snapshot
  checked after 12:26:59 IST verified the Live webhook Enabled with the production
  URL and all seven events. Fresh 2 November metadata still lists only KEY_ID
  (last updated 31 October), MODE and ENABLED in production Supabase; KEY_SECRET
  and WEBHOOK_SECRET are missing. Private entry fields are prepared and Razorpay
  is signed out; replacement-key sign-in/private saves remain incomplete.
  Matching-secret and signed-delivery acceptance remain pending;
  live payments stay off.
  Signed Test refund-event delivery is not yet established. See
  [payment readiness](RAZORPAY-PAYMENTS.md).

The 2 November aggregate ledger check found zero Live attempts and zero committed
production webhook events. The existing processed Test refund still has a
verification-time timestamp, rather than a signed provider-event timestamp.
The earlier chef browser connection error was recovered before the actual
preparation/revocation acceptance recorded above; it is no longer the current
chef-acceptance blocker.

Separate backlog items include durable image uploads, restaurant/customer
notifications, actual mobile-device acceptance, historical list pagination, and
production monitoring/backup/restore verification. CSV downloads copy records;
they do not delete Supabase orders or financial documents.

The 1 November production security advisor reports one warning: Supabase leaked
password protection is disabled. Supabase makes this feature available on Pro and
above; no billing or plan change was made. See its
[password-security guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
This warning is not a completed security acceptance check.

The 1 November dependency audit found zero production-dependency vulnerabilities.
The full tree reports 16 moderate affected-package entries from one development
lint-tool advisory, with no high or critical findings. Current reachability and
the compatible-toolchain follow-up are recorded in [security review](SECURITY-REVIEW.md).

The [25 October status archive](PROJECT-STATUS-HISTORY-2026-10-25.md) preserves older
release and acceptance evidence. Its provider, account and pause-state statements
are historical; use this page for the current work list.
