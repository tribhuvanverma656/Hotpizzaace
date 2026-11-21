# Dine-in acceptance — 24 October 2026

Development only: hotpizzaaceDB (`kaypgsstngguvrpftpwo`) and the separate development Render site. Production was not migrated, enabled or merged for this release. No real cash, UPI or Razorpay payment was taken.

## Completed checks

- 392 automated tests pass, plus full lint and TypeScript. The original feature production build and exact-head CI passed; the final rush-flow follow-up must pass its own fresh CI before deployment.
- Counter, table QR and reports migrations plus their SQL fixtures passed together in one rollback transaction before application. They exercised service-role permissions, client RLS/RPC denial, branch/guest ownership, once-only payment/order/invoice, duplicate UPI rejection, stale versions, immutable ledger, pay-later closure denial, table rotation/expiry and complete financial reports beyond 1,000 rows. Reports refuse oversized ranges instead of silently truncating them.
- The applied development migrations and Edge v5 were verified present. Security advisor has no new schema finding; the pre-existing leaked-password-protection warning remains.
- The exact deployed Edge artifact includes every shared dependency and one validation bundle. It compiles in the artifact test; a separate-module test also covers error constructor identity.
- Fictional cash browser order `HPA-261024112446-0D50CCE5`: French Fries ₹80, CGST ₹2, SGST ₹2, payable ₹84. ₹100 cash gives ₹16 change. Bill contains GSTIN/FSSAI and test invoice `TST/26-27/000002`. It reached Barra Kitchen with its item note and completed preparing → ready → served → closed. A targeted read confirmed the same invoice and server completion clock.
- Fictional table request `TBL-5B18C0CC` waited outside Kitchen. Owner review confirmed a fictional direct-UPI receipt, creating one order `HPA-261024113517-CD752AFC`, test invoice `TST/26-27/000003`. Guest status changed to confirmed. The correct branch Kitchen displayed the table label and general preparation note. The test ticket was marked ready.
- Overview separated completed sales from receipts: ₹80 sales excluding GST from the served cash meal, and ₹168 total collections from the cash meal plus the still-unserved UPI meal. No second sale was created by closing the cash bill.
- A temporary connection gate was observed to discard a counter draft. The fix keeps drafts/exact retry payloads in memory per verified owner/branch across remounts; verified sign-out/account changes clear them. It does not persist financial references to browser storage. Full reload remains a distinct boundary.

## Rush-flow follow-up

One tap adds the displayed default size/crust; repeated taps adjust quantity. An optional Customize action retains other sizes/toppings/notes. Cash defaults to the exact current total and only needs editing for change. Pressing the explicitly labelled Cash received / UPI verified action is the receipt confirmation; the redundant checkbox is removed. Successful placement leaves the next blank order ready, with optional bill viewing/printing. Server pricing, trusted owner checks, append-only receipts, UPI reference validation/uniqueness, version checks and idempotency remain enforced.

Pure cart tests cover repeated default taps, preservation of customized notes/options, default-crust pricing and server quantity/line bounds.

## Acceptance limits

The CSV backend/formatter/privacy/completeness tests pass. The in-app-browser download event timed out, so no saved file was accepted as proof of a completed download. Its automation session restarted signed out. Finish final rush-screen and saved-CSV review with the owner's existing development login; do not ask for or record a password in this document. Production release, real merchant receipts, physical printer/device acceptance, refunds and live gateway acceptance remain separate.

Test receipts and their immutable ledgers are retained as development evidence. CSV download never deletes orders, invoices or payments.

## 25 October release and export follow-up

Exact-head push and PR CI for `8fa44fb` both passed. PR #9 merged as `de0930d` and production Render deploy `dep-dbeo42dg1s2s739jmlgg` reached live with the separate production backend v3 and six additive schema deltas. Anonymous counter/table admin API checks return 403 with private/no-store caching; health reports production and payments disabled. Website/counter acceptance remain false. No owner membership exists yet in production, so authenticated operational acceptance is not claimed.

The development financial-report RPC supplied a complete 24–25 October snapshot. The application formatter saved a CSV; Python's CSV reader reopened all four unique Barra rows, reconciled ₹80 completed sales and ₹168 collections and verified no customer/UPI-reference/staff-ID columns. Source order count remained seven before/after. This is a saved backend-report export check, not evidence of the browser's Download button.

The owner then replaced the table-ordering requirement with a single branch quick-service QR, required name/mobile and pay-at-counter requests. Its additive follow-up retains financial history and disables old table links; see the quick-service contract for current behavior. New follow-up deployment/acceptance evidence must be recorded separately.

## Quick-service source and database checks — 25 October

The updated source passes **394 automated tests**, full lint and TypeScript. Development migration `branch_ordering_qr` is applied, `hpa-commerce` **v6 ACTIVE** uses artifact `79a697d592f131ce4eeb28a96037f891873de3c070d1171097dd4b02d000793f`, and its updated SQL fixture passed inside a rollback transaction after application. Checks cover one canonical QR per branch, retained legacy-label collision, required name/mobile, request-only creation, guest isolation, payment-first acceptance/pay-later, contact/item binding, exact retries, expiry/rotation and browser/RPC denial. The pre-existing development Auth leaked-password warning remains; no new schema issue was reported.

The first revised fixture exceeded the old 40-character internal label limit; shortening the fictional label fixed that fixture. A subsequent combined DDL rehearsal hit an expired connector request twice and produced no active transaction or schema change. Applying the additive development migration with the purpose-built migration tool and running the fixture separately succeeded. The final migration preserves the existing label index and historical labels.

## Quick-service guest browser and paused-QR regression

Source `2191e82` passed exact-head CI and reached live development deploy `dep-dbeppics728c73cqpr60`. Against the real development backend, a local preview submitted fictional request `QR-E12953DB` (French Fries ₹80 + ₹2 CGST + ₹2 SGST = ₹84), required name/mobile and displayed **Request sent · pay at the counter**. No accepted order/invoice was created: source order count stayed seven. This check did not collect cash/UPI or instruct real food preparation.

The development canonical QR was disabled during that check (version 2); it remains off pending the owner's reactivation preference. The inactive request is correctly excluded from the counter queue. The rollback SQL fixture additionally verifies a live pending request is visible to the nominated owner with matching name/mobile before acceptance. Human-owned orders are untouched.

This uncovered a guest-screen gap: a definitive QR 404 could retain its old pending payment prompt. The follow-up stops stale submissions and payment prompts, asks staff to check the earlier request/current QR, preserves an accepted receipt and revalidates before another order. Transient errors keep exact retries. The actual disabled QR browser check now shows **Ask the counter for the current QR**, with no stale payment/retry action. The follow-up passes 394 tests, full lint and TypeScript; its own GitHub CI/development deployment must be verified separately.

Automatic approval review rejected applying `branch_ordering_qr` to production because the new schema/function change and legacy-link deactivation were not covered clearly enough by prior approval. No attempt was made to bypass that decision. Production remains on the preceding counter/report backend v3 and main release `de0930d`; the quick-service migration/frontend requires explicit approval. A narrow inventory confirmed zero production QR rows, pending requests and orders at that check.

## Development QR reactivation and phone layout — 25 October

The owner explicitly approved reactivating the development test QR only. The canonical Barra QR was rotated through the version-checked owner management RPC: generation 2, version 3, active. Existing old links remain invalid. No production setting or migration was changed by this reactivation.

A 390px browser check exposed minimum-content grid overflow and a fixed Review order bar covering the Send order button. The follow-up uses shrinkable grid tracks/children and form controls, wraps long content, and hides the review shortcut while the order form is visible. After the fix, the real browser submitted fictional request **QR-C30BA2E0** against the development backend. The nominated owner's queue contains the matching request/name/mobile in Barra; it is pending, unexpired and bound to the active generation. It has **zero kitchen orders and zero payment receipts**, and source order count remains seven. No real payment or food preparation occurred.

Phone/tablet/desktop DOM measurements passed: document width equals viewport at 320, 390, 768 and 1280px, with the form inside each viewport. This is emulated-browser acceptance, not a physical-device claim. TypeScript, full lint, formatting and whitespace checks passed for the follow-up; its own CI and development deployment remain to be recorded in PR #10 before considering the fix published.
