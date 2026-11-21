# Bill rounding

## Released nearest-rupee update — 3 November 2026

New bills use the nearest whole rupee: ₹220.49 becomes ₹220; ₹220.50 and
₹220.99 become ₹221. The adjustment is a separate signed **Round off** line,
marked `roundOffPolicy: nearest_rupee`. Item prices, discounts, delivery charges
and CGST/SGST calculations keep their original paise amounts. Payments, cash
change and delivery minimum checks use the final payable total.

For an MRP-only basket with no delivery charge, rounding cannot collect above
the undiscounted item subtotal. A fractional MRP ceiling therefore uses the
whole rupee below that ceiling if rounding up would exceed it. Whole-rupee
₹10/₹20 water bottles are unaffected. Mixed food/MRP and delivery bills use
normal nearest rounding. A payable total of zero remains unavailable.

Saved unrounded bills and saved customer-favour floor bills retain their exact
totals, tax, invoice references and payment amounts. Reports accept each saved
policy and reconcile the signed adjustment; old receipts are never repriced.

Fresh website, counter, QR request and staff QR approval submissions bind the
displayed payable total and rounding policy to the trusted server quote. An
outdated page must reload and review its total before any new order/payment
record is created. Previously committed idempotent retries retain the original
receipt, including retries from an older page.

Owner-approved [PR #20](https://github.com/Satya2n/hotpizzaace/pull/20) is released
in production at merge `38b7a5c395baf9888cc191674f6a750439e9b132`. The source migration
`20261103050532_nearest_rupee_bill_rounding.sql` was applied in production as
`20261103175819_nearest_rupee_bill_rounding`, together with matching commerce v14
and the frontend. The migration was applied in development after a rollback-only
regression transaction passed all paise boundaries, GST/MRP cases, legacy bills,
QR/report projections, private grants and immutable historical-document checks.
All 573 application tests, lint, TypeScript and the production build passed,
including stale-quote rejection and legacy checkout/counter/QR replay acceptance.
Production quote-only acceptance confirmed ₹262.50 → ₹263, ₹110.26 → ₹110 and
MRP water ₹20 → ₹20 without creating an order or recording a payment. Existing
financial-document digests were unchanged. Website checkout, COD and Razorpay
remain paused. See [project status](PROJECT-STATUS.md) for deployment evidence.

## Previous policy — 30 October 2026

The earlier release rounded all new bills down in the customer’s favour.
Unmarked saved `roundOff` adjustments retain that meaning. Its migration was
`20261030104650_dine_in_total_rounding.sql`; its original rollback regression
file remains `supabase/tests/bill_rounding.sql`.
