# Razorpay payment readiness

## Current launch plan — 8 November 2026

The owner has paused PhonePe and selected **Razorpay** for website online payments.
The existing gateway selection supports this without a runtime code change: keep
`PHONEPE_ENABLED=false` so an enabled PhonePe configuration does not take priority.

The replacement Live API pair supplied in the owner's newer CSV was accepted by
Razorpay's read-only Orders API on 8 November (HTTP 200). No order was created,
response order records were not read, and credentials were not printed. A complete
six-entry private Supabase paste file was prepared outside Git. The Owner's save,
deployed HMAC readiness and website activation still require verification; provider
authentication alone does not establish that Supabase has the replacement pair.

The website is deployed at `https://hotpizzaace.com`. Production now uses the
restaurant-owned Supabase project **`xkvydujnsdqcsmooylwq`**, in
**hotpizzaace-cloud's Org**. Both former hosted projects are paused; do not save
new credentials or send new webhooks to them. Testing is local.

On 8 November the live health endpoint returned HTTP 200, with database and
commerce connected and **payments disabled**. The menu and liveness endpoints
also returned HTTP 200. This does not establish that Live credentials or a
matching webhook secret are saved. No real payment acceptance is claimed.

Use this production webhook URL:

`https://xkvydujnsdqcsmooylwq.supabase.co/functions/v1/hpa-razorpay-webhook`

Subscribe to `payment.authorized`, `payment.captured`, `payment.failed`,
`order.paid`, `refund.created`, `refund.processed` and `refund.failed`.

The 8 November merchant dashboard inspection confirmed that existing webhook
`Tuou26v8Zs5eMS` already uses this new URL, is Enabled and subscribes to all seven
events. Its Details panel explicitly showed **Secret: Not provided**. The owner
subsequently reported saving the secret, but a fresh Details view retained that
label and the previous update timestamp. Treat persistence as unverified until
signed delivery is checked; do not repeatedly regenerate credentials based only
on this display. A private random replacement webhook secret was prepared outside
the repository; the owner must save matching values at Razorpay and Supabase.

Private setup belongs in the Owner account's production Edge Function Secrets
form. Save a replacement, unexposed Live API pair as `RAZORPAY_KEY_ID` and
`RAZORPAY_KEY_SECRET`, and a separate strong `RAZORPAY_WEBHOOK_SECRET` matching
the Razorpay webhook. Use `RAZORPAY_MODE=live`; keep `RAZORPAY_ENABLED=false`
until the private setup is complete. Never reuse a credential disclosed in chat.
The connected Developer account cannot change production secrets. Credential
entry, submission and any required OTP must be completed privately by the owner.

Activation then requires `RAZORPAY_ENABLED=true` and the branch's website-ordering
switch, delivery/pickup configuration and online payment methods to be enabled.
Do not enable COD or simulated payments as part of this change. Counter and branch
QR orders continue using staff-confirmed cash or the existing direct merchant UPI.

Recheck live health and catalog capability after the private save. A
`razorpay_live` capability validates the configuration shape, not merchant
authentication or a completed charge. Finish with an owner-operated real payment
and verify the saved order, capture, signed webhook, Kitchen and bill; refund and
settlement acceptance remain separate evidence. The 8 November focused Razorpay
and counter-setting regression suite passed **68 tests**.

## Historical records below

The dated sections below describe the former projects before migration. Their
project URLs, saved-secret snapshots and disabled-switch observations must not be
used as current setup instructions.

Updated 3 November 2026. **Production live online payments remain disabled.**
Development Test Mode evidence does not establish real-money acceptance.

## Current configuration snapshot — 3 November 2026

Production automatic capture is configured with a **12-minute window**. Live
webhook `Tuou26v8Zs5eMS` remains Enabled with the production URL and all seven
payment/refund events. This verifies merchant configuration metadata, not an actual
Live capture or accepted signed delivery.

Production Supabase still saves only `RAZORPAY_KEY_ID`, `RAZORPAY_MODE=live` and
`RAZORPAY_ENABLED=false`; `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` are
absent. The saved key ID is still associated with the credential exposed in chat
and must be replaced privately before activation. The private API-pair entry form
is prepared; unsaved fields are not saved configuration. No key or secret values
are recorded here. The owner must save replacement API credentials and matching
webhook-secret values privately, then complete signed-delivery and owner-operated
real payment/refund/settlement acceptance.

The chef release below did not activate payment gates or change these private
credentials. The dated records below retain their earlier evidence; browser/session
blockers and missing-configuration claims describe those checks, not a continuing
inability to inspect the normal HTTPS pages.

## Historical read-only acceptance check — 2 November 2026

The production ledger contains zero Live payment attempts and zero committed
webhook events. Development retains one processed Test refund with
`timestamp_source=verified_at`, last verified on 30 October. There is no recorded
processed-refund provider-event timestamp establishing signed refund delivery.
These aggregate checks expose no credentials or customer/payment references and
do not perform a charge, refund, fake production collection or activation.

Browser security review blocked the prepared payment-page check because of an
unsupported address. The separate chef test tab also shows a connection-error
page with a blocked `data:` address. Saved-secret names and merchant webhook/capture
settings could not be freshly inspected. The private
configuration list below remains a dated 1 November snapshot; it must not be
treated as a fresh missing-secret or completed-secret assertion. The owner must
reopen the normal HTTPS pages before browser verification resumes.

## Deployed safeguards

Owner-approved [PR #16](https://github.com/Satya2n/hotpizzaace/pull/16) payment safety
and [PR #17](https://github.com/Satya2n/hotpizzaace/pull/17) refund/billing changes
are released in production. PR #17 merged as
`a1519e9fb63f311425d1af4692b1099f9e251ad7`; production commerce v10 and refund-aware
webhook v2 were deployed with that release. Its frontend, database and backend
release checks passed. This did not activate live payments.

The server determines payable amounts and verifies provider identifiers,
signatures and capture status. Closing Checkout or receiving an authorization is
not proof of a completed payment. An unresolved attempt does not authorize another
charge. Resume/retry uses the existing provider order; older ambiguous attempt
history fails closed for trusted reconciliation.

Verified refunds are recorded separately from original captures and immutable
invoices. Incomplete or inconsistent refund history puts fulfillment under review.
Reports distinguish captured amounts, processed refunds, retained collections and
rounding. The application does not initiate a refund through this reconciliation
flow.

Owner-approved [PR #18](https://github.com/Satya2n/hotpizzaace/pull/18) released
separate chef access and invoice/thermal safeguards on 3 November as
`1973014eb741b4e575e8af9e1f4a0d861296dc8e`. Render deployment
`dep-dbkmipks728c738ru1g0` is live, both Kitchen migrations are applied and the
dedicated Kitchen backend/feature are active. This preserves website invoice
issuance when a chef marks Ready and offers A4 for oversized receipts. It did not
enable Razorpay or change payment credentials. Private production chef provisioning,
physical printing and payment acceptance remain separate. See
[project status](PROJECT-STATUS.md) for exact release and CI evidence. Earlier
545-test functional-candidate evidence remains in the dated Kitchen release record;
it is not a new payment-acceptance result.

## Environments and channels

- Development uses `hotpizzaaceDB` (`kaypgsstngguvrpftpwo`) and Razorpay Test Mode.
  Historical Test captures and refunds moved no real money.
- Production uses `hotpizzaace-production` (`vzehsdwwaybcxvzodqaq`). Its website
  checkout and live online payment gates remain off.
- Counter/branch QR orders use staff-confirmed cash or the existing direct merchant
  UPI QR. They do not open Razorpay Checkout. Guests cannot mark payments received.

Hosted Checkout can complete through a different method from the customer's
original selection. Administration labels that original choice as Checkout
selection; CSV leaves an unrecorded actual provider method blank and includes
`requestedPaymentMethod`. Recording the verified provider method remains separate
scope. Manual cash/direct UPI records retain their own classifications.

## Verified development evidence

The earlier hosted Test journey verified capture, dismissal/resume, an
insufficient-funds failure, signed payment-event delivery, owner confirmation,
Kitchen readiness and a bill with the supplied GSTIN/FSSAI and CGST/SGST breakup.
The historical failed-payment retry used an older backend that created a separate
provider attempt; it is not the current retry rule.

The second historical Test capture, application order
`b943eb6b-2879-43a8-a5b4-e1d246621855`, was refunded at Razorpay. The application's
₹220.50 refund projection has now been reconciled through a provider-verified
refresh, preserving the original invoice. It is no longer an unreconciled refund
candidate. This API reconciliation does not prove signed refund-webhook delivery.

The earlier Test merchant webhook accepted signed payment events after the owner
saved its matching private secret. Its recorded subscriptions were
`payment.authorized`, `payment.captured`, `payment.failed` and `order.paid`.
Adding and verifying `refund.created`, `refund.processed` and `refund.failed` in Test
Mode remains pending. No signed Test refund-event delivery is claimed.

The merchant capture setting previously left one Test payment authorized until
manual capture. Production's automatic capture configuration was verified on
3 November with a 12-minute window, as recorded above. Actual Live capture, refund
and settlement acceptance remain unverified.

## Private configuration snapshot — 1 November 2026

This snapshot was checked after the Live webhook's creation at **12:26:59 IST**.
Subsequent private saves and delivery results belong in the PR/release verification
record; this is not an assertion about future configuration.

Production Custom secrets at this check contain
`RAZORPAY_KEY_ID`, `RAZORPAY_MODE` and `RAZORPAY_ENABLED`. Mode was saved as `live`
with activation explicitly `false`. It does **not** list
`RAZORPAY_KEY_SECRET` or `RAZORPAY_WEBHOOK_SECRET`.
A saved key ID alone does not establish working Live credentials. Secret values
must never appear in source, `NEXT_PUBLIC_` variables, logs or this document.

The Live API credential previously disclosed in chat must be replaced privately at
Razorpay before activation. Save only the replacement key ID and key secret in
production Supabase; do not reuse the disclosed credential. No credential value is
recorded here. Unsaved form drafts do not establish saved or verified configuration.
The owner reported that a replacement-key popup was open; its contents were not
inspected and this does not establish that replacement credentials were saved.

Live webhook `Tuou26v8Zs5eMS`, created **1 November 2026 at 12:26:59 IST**, is saved
and **Enabled**, with this verified production URL:

`https://vzehsdwwaybcxvzodqaq.supabase.co/functions/v1/hpa-razorpay-webhook`

Its seven saved events are `payment.authorized`, `payment.captured`,
`payment.failed`, `order.paid`, `refund.created`, `refund.processed` and
`refund.failed`. This completes webhook metadata setup. It does not establish a
matching private secret or accepted signed delivery. A new random webhook secret
is prepared privately; the owner must save matching values in Razorpay and
production Supabase. The Supabase webhook-secret entry is still absent at this
snapshot. No signature or real-payment acceptance is claimed.

Development uses the separate endpoint:

`https://kaypgsstngguvrpftpwo.supabase.co/functions/v1/hpa-razorpay-webhook`

Do not copy development credentials into production. API credentials and the
webhook secret are separate values: a missing webhook secret alone does not require
API-key regeneration, but the disclosed Live API credential does require replacement.

## Remaining activation work

1. Replace the disclosed Live API credential privately at Razorpay and save the
   replacement key ID and key secret in production Supabase. Keep
   `RAZORPAY_MODE=live` and `RAZORPAY_ENABLED=false`; do not send credentials in chat.
2. Finish the two missing private secret entries and confirm that the saved Live
   webhook uses the matching webhook secret. Its URL/event metadata is verified;
   signature and delivery acceptance remain outstanding. Record subsequent private
   configuration and delivery evidence in PR/release verification.
3. Add the three Test refund events and record signed delivery/replay acceptance.
   Verify actual capture behavior and unresolved-attempt recovery; the production
   automatic capture configuration was checked on 3 November with a 12-minute window.
4. Obtain explicit launch approval, then complete an owner-operated real payment
   and dashboard/Kitchen/bill reconciliation, including applicable refund and
   settlement checks, before describing live payments as accepted.

Source promotion follows [the development workflow](DEVELOPMENT-WORKFLOW.md).
An API key, prepared form, enabled webhook, local test or Git tag alone is not a
payment launch. Physical printer acceptance is tracked independently in
[58 mm receipt QA](THERMAL-PRINTER-QA.md).

Provider references: [Test card details](https://razorpay.com/docs/payments/payments/test-card-details/),
[webhook validation and testing](https://razorpay.com/docs/webhooks/validate-test/),
and [webhook retries and event handling](https://razorpay.com/docs/webhooks/best-practices/).
