# Counter and billing release — historical candidate record, 30 October 2026

This document preserves the prerelease evidence for the subsequently approved
[PR #17](https://github.com/Satya2n/hotpizzaace/pull/17). It merged as
`a1519e9fb63f311425d1af4692b1099f9e251ad7`; its production frontend, database and
backend release is live. The pending-work language below records the original
candidate review and is not the current release checklist. Use
[project status](PROJECT-STATUS.md) for current work and
[payment readiness](RAZORPAY-PAYMENTS.md) for the separate disabled Live payment setup.

## Staff and customer changes

- Pay-later counter orders have a visible Collect payment action and a dedicated,
  branch-scoped Awaiting payment list, including served orders. Collection records
  actual cash or staff-verified direct merchant UPI. A kitchen version conflict asks
  for fresh confirmation; an uncertain network result reuses its original request.
- A cursor-paginated unpaid endpoint filters before limiting, so recent paid orders
  cannot hide an outstanding bill. Refresh is single-flight and deeper loaded pages
  use explicit refresh to avoid unbounded polling.
- All new bills round the final payable amount down to whole rupees. Signed Round
  off is shown separately; base prices, taxable values, CGST/SGST and MRP snapshots
  are unchanged. Historical bills and payment amounts are not recalculated.
- New order references use a daily server sequence, `HPA-DDMMYY-0001`, shared by
  branches and channels within each separate environment database. Retries reuse
  the original reference; UUIDs and invoice numbers remain unchanged.
- Kitchen cards use smaller fonts, less padding and responsive columns. The local
  sample preview passed at 1366, 820 and 390 pixels, without horizontal overflow;
  preparation notes remain complete and action buttons are at least 44 pixels tall.
- Bill printing defaults to an isolated 58 mm receipt with measured content height,
  avoiding dashboard whitespace; A4 remains selectable. Native printer/driver paper
  acceptance still requires the actual 58 mm printer.
- Provider-verified refunds remain separate from original captured sales and bills.
  Pending or inconsistent refund evidence stops fulfillment for restaurant review.
  Reports and CSV expose refunds, retained collections and rounding explicitly.

## Database and deployment order

Apply missing migrations by name, in source order, before the matching commerce and
webhook bundles and frontend. Never reapply an already recorded migration merely
because an MCP-generated remote version differs from its source filename.

1. `razorpay_refund_reconciliation` (already recorded in development).
2. `razorpay_refund_review_guard`.
3. `dine_in_total_rounding` (the final policy covers all new order types).
4. `daily_order_numbers`.

The pending SQL and rollback-only refund, rounding and numbering regression files
were executed together in the development database. They passed and rolled back;
this did not create permanent test orders, invoices, receipts or counters.

All 518 developer regression tests, TypeScript, ESLint and the production build passed.
Record final CI, deployed commit, function versions and owner browser acceptance
below when performed; a local check is not a deployment claim.

Development database updates are applied. Remote MCP migration versions are
`20261030055512` (refund reconciliation), `20261030112111` (refund review guard),
`20261030112127` (rounding), and `20261030112143` (daily references). The three
rollback-only SQL regression files passed again after application. The security
advisor reports no new findings; its existing leaked-password-protection warning
remains an independent Auth configuration item.

Development commerce **v16** and webhook **v7** are active. The commerce upload
initially hit a stale remote import-map path; explicitly selecting the included
`deno.json` resolved it. Uploaded artifact SHA-256 values are
`aad7ac2604b2c6aaf870e779e62db079b18d716e1eef8da79678ee19630aa223`
(commerce) and `d0011f2fa35ec9e197fcd5003eaad276637869610c482bae53ba1e38a88abf47`
(webhook). Development Render deployment `dep-dbi9br3ncjis73aojdrg` is live on
`269086c7642670a0844859484cb0616e102c5b11`; both GitHub checks passed.

Live development acceptance passed for `HPA-301026-0001`: unpaid create → Kitchen
preparing/ready → served → simulated cash collection → closed. Closing was disabled
while unpaid. ₹210 plus ₹10.50 GST less ₹0.50 round off gave ₹220; ₹250 tendered
returned ₹30. The saved settlement and test invoice reconcile, and the order left
the Awaiting payment list. No real money or food was involved.

`HPA-301026-0002` verifies mixed food/MRP pricing and direct UPI confirmation in
development: ₹85 food plus ₹20 inclusive-MRP water, ₹4.26 additional GST and
₹0.26 reduction give ₹109. Its UPI reference is an explicit software-test value.

The browser refund-refresh check exposed a missing JSON body on its POST. A
follow-up sends `{}` and an interactive regression covers the actual callback and
HTTP headers/body, success and failure recovery. Recheck this action after that
frontend fix deploys; it needs no additional schema or Edge change.

## Original prerelease checklist — historical

- Verify rounded amounts in the downloaded sales report.
- Reconcile the historical refunded Test Mode capture and test signed refund events.
- Complete physical 58 mm printer acceptance; use the driver’s 58 mm roll, 100%
  scale and no browser headers/footers.
- Obtain production release approval before production schema/function/frontend
  promotion. Live online payment activation remains a separate owner-approved step.

PR #17 did not add chef-only accounts or grant new kitchen access. The separate
[PR #18 candidate](KITCHEN-STAFF-ACCESS.md) now implements that flow in development;
private chef acceptance and its own production release approval remain pending.
