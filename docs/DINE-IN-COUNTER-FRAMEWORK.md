# Counter and quick-service QR ordering — implementation framework

Updated 25 October 2026. The owner has approved implementation and the decisions
below. This document describes the current source candidate and its acceptance
requirements; it does not establish that the candidate is deployed or that production
counter ordering has been enabled. Check the release evidence in
[project status](PROJECT-STATUS.md) before restaurant use.

## Agreed scope and access

The restaurant workspace has a **Dine-in / Counter** screen for walk-in orders, bill
printing and manually recorded cash/direct merchant UPI receipts. It uses the same
server-priced menu, GST calculations, branch and kitchen queue as other orders.

- Normal customer checkout continues to offer **Delivery** and **Pickup** only. Its
  public create-order API rejects dine-in, manual payment and staff-only fields.
- Initial staff access is restricted to the existing verified owner membership for
  **hotpizzaace@gmail.com**. No additional manager or kitchen login was nominated.
  Branch-manager/staff roles remain a later extension; the branch selector is not
  claimed to enforce a separate staff permission boundary.
- The owner selects the branch. Its ID is locked into each accepted order, invoice,
  payment receipt and kitchen ticket. Switching the UI branch never moves a receipt.
- For orders entered by staff, customer name/mobile are optional. Blank details use
  **Walk-in customer** without creating a fake customer account or requiring an address
  or delivery PIN. A guest submitting a branch QR request must provide a name and valid
  Indian mobile number; those contact details do not establish a verified identity.
- The owner chose the restaurant's **existing physical merchant UPI QR**. Counter
  payments do not create Razorpay orders, open Razorpay Checkout or rely on gateway
  settlement. Bank/merchant charges and settlement terms are not promised here.
- The restaurant uses **one reusable ordering QR per branch**, displayed at the
  counter or entrance. It has no table assignment. Guests choose food, enter their
  name/mobile and send a request to the admin queue with **Pay at counter**. The QR
  does not collect payment, mark a bill paid or send an unapproved order to Kitchen.
  See the detailed [quick-service QR contract](QUICK-SERVICE-QR.md).

## Staff workflow and payment timing

1. Open **Dine-in / Counter** and choose the branch. Tap a menu item to add its first displayed size/crust immediately; repeated taps increase its quantity. Customize is optional, and customized selections/notes stay separate. Customer details and the internal **Order reference** are optional; guests do not choose or require a table.
2. Review the current server-priced food subtotal, configured coupon discount,
   CGST 2.5%, SGST 2.5% and payable total. Dine-in has no delivery fee or minimum.
   A draft/preview is not an accepted order and consumes no invoice number.
3. Normally collect full payment first. Cash defaults to the exact current bill amount; edit it only when change is needed. Press **Cash received · Send to kitchen** once. For UPI, check the actual merchant credit, enter its transaction reference, then press **UPI verified · Send to kitchen**. The action itself confirms receipt; there is no additional checkbox.
4. **Place order and send to Kitchen** saves one accepted, branch-linked order,
   settlement, invoice and audit trail atomically. The kitchen sees the same saved
   ticket; staff do not enter the items again. The next blank order is ready immediately; viewing/printing the saved bill is optional and does not block the next customer.
5. For the rare exception, explicitly choose **Pay later** and enter a reason before
   sending the unpaid order to Kitchen. Its unpaid state remains visible. There is
   no silent bypass and a QR guest cannot grant this exception.
6. Kitchen follows **Confirmed → Preparing → Ready**. The counter then marks the
   food **Served**. Payment and food preparation remain separate states.
7. If payment was deferred, confirm the actual cash/UPI receipt later. **Close** is
   available only after food is served and the full bill is settled. Closing does
   not create a second sale, kitchen ticket, payment or invoice.
8. Print/reprint the saved bill or use the browser's Save PDF. A failed print can be
   retried without creating another order.

## Quick-service branch QR requests

The owner manages **Scan & order QR** in the staff workspace. Each branch has one
reusable ordering QR that can be printed in several places. This ordering QR is
separate from the restaurant's existing merchant UPI payment QR.

1. The owner selects a branch and creates or reprints its QR. No table name, table
   number, table assignment or customer account is needed.
2. A guest scans it, taps menu items, optionally customizes them, and enters a name
   and valid Indian mobile number. The name must contain 2–80 characters and the
   mobile number must be 10 digits starting with 6–9. The server checks these fields
   as well as the selections; browser validation alone is insufficient.
3. **Send order · pay at counter** submits a request to that branch's **QR orders**
   queue. The guest sees a request reference and **Request sent · pay at the counter**.
   They show that reference at the counter. No invoice, receipt, sale or kitchen
   ticket exists at this stage.
4. The owner opens **Review & collect payment**, confirms the current bill and
   records full cash received or verified credit on the existing merchant UPI QR.
   Staff then accept and send the order to Kitchen. Current menu revision,
   availability, prices and tax are checked again before acceptance.
5. Acceptance atomically creates one branch-linked counter order, invoice and
   settlement and links the request to it. The kitchen receives that same order.
   The guest sees the accepted order reference. Staff alone may instead grant the
   existing explicit, reasoned **Pay later** exception; acceptance is not itself
   proof of payment. Declined requests never enter Kitchen.
6. Pending requests expire no later than 30 minutes after creation. Disabling or
   replacing a branch QR invalidates its old generation and pending requests.
   Reactivation creates a fresh QR; staff replace every printed copy. Accepted
   orders, invoices, payment records and historical references remain intact.

The new source candidate replaces table ordering through an additive migration.
That migration disables existing table QR links; it does not silently turn them
into branch QR links. Historical accepted table orders and their financial records are retained.
Compatibility names such as `/dine-in/[token]`, `table-qr`, `table-requests` and table
storage/type names may remain internally. They do not expose table ordering in the
new guest or admin workflow. Applying a migration in development does not establish
that it has also been applied in production; follow the release record.

A photographed/shared branch QR can be opened away from the restaurant. Opaque links,
rate limits and staff payment confirmation reduce abuse; they do not prove physical
presence, identity or payment. Name/mobile are contact details, without OTP or account
verification. A private HttpOnly guest cookie binds request-status access to the
browser that submitted it; knowledge of another guest's name/mobile/reference must
not reveal their request or private bill. A missing guest session cannot be replaced
by entering a phone number. Development and production QR tokens, requests, payment
records and reports remain separate.

## Payment and bill records

| Tender              | Staff confirmation                                           | Saved record                                                                            |
| ------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Cash                | Enter sufficient tendered cash; confirm actual receipt       | Bill amount, tendered cash, change, trusted staff ID and server time                    |
| Direct merchant UPI | Check restaurant merchant/bank credit; record full reference | Full bill amount, reference, trusted staff ID and server time; labelled staff-confirmed |

A screenshot, QR scan, guest assertion, served ticket or ready state cannot mark
payment received. Manual UPI is never labelled gateway verified/captured. Duplicate
UPI references are rejected across this restaurant's branches within an environment.

The first release supports one full cash or UPI settlement per bill. No split tenders,
partial credit, running table tabs, automated bank verification or automatic refunds
are implemented. Settlement rows are append-only; concurrent changes and retries use
expected versions and idempotency keys. Unfinished staff drafts and exact payment attempts stay in memory across temporary connection gates or route remounts, scoped to the verified account and branch; verified sign-out or account changes clear that cache. They are not stored in browser storage, and a full page reload still requires staff to review recent orders before re-entering an uncertain order. A cancelled paid/review-required receipt needs
owner reconciliation; it is not silently erased or treated as net sales. A refund
record alone would not send money through a bank app.

Counter invoices are allocated on accepted order creation, including an explicitly
unpaid pay-later order. The draft consumes no number. Website invoice issue timing
remains independent. Both channels use the same environment/financial-year numbering
policy; production invoices and development test bills are labelled separately and
reprints retain the original reference and frozen supplier/tax amounts.

Bills show branch/business identity, GSTIN, FSSAI number, items, quantities, prices,
discounts, separate CGST/SGST, total, invoice reference, issue time and accurate payment
state. Kitchen slips show preparation information and are not proof of payment.
Issued bill/settlement corrections require a separate auditable process; editing or
deleting a paid bill is not an available shortcut.

## Branch availability and authorization

`counterAcceptingOrders` is a separate branch setting and defaults to **false** for
new/existing branches in the migration. The owner must explicitly enable it after
acceptance. `temporarilyClosed` blocks new counter orders and QR proposals/acceptance.
Pausing website ordering or website COD does not silently switch off counter cash.
Existing saved orders can still be fulfilled/settled through authorized operations.

Private Edge routes obtain identity from verified Auth and check trusted owner
membership. Service-only database functions independently check membership. Customer
JWTs, editable user metadata, body-supplied staff IDs, branch selectors and ordering QR
links never grant owner access. Direct `anon`/`authenticated` table/RPC access is denied
with explicit grants and RLS. Kitchen reads are branch-filtered active-order queries;
financial reports do not reuse the latest-1,000-orders admin preview.

## Analytics and daily sales downloads

The owner selects a branch and **From/To** dates in Overview. **Today** selects one
India Standard Time business day; **Download sales CSV** saves the selected report.
The report distinguishes **Dine-in / counter**, **Website delivery** and **Website
pickup**, with food subtotal, discounts, sales excluding GST, delivery fees, CGST,
SGST, paid/fulfilled order count, average sale and unpaid dine-in balances.

Three clocks have different meanings:

| Figure                                  | Date basis                                                  | Conditions                                                                                                       |
| --------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Orders placed and open dine-in balances | Order placement time                                        | Current saved status in the selected placed-date cohort                                                          |
| Sales excluding GST                     | Food completion time (`completedAt`, or dine-in `servedAt`) | Paid and delivered/picked up/served/closed; cancelled, rejected and review-required receipts contribute no sales |
| Counter cash/direct UPI collections     | Actual server-recorded staff receipt time                   | Full matching settlement; cancelled/review receipts are disclosed separately for reconciliation                  |

These are operational reports using the latest saved state, not frozen daily ledger
closings. A pay-later meal served yesterday and paid today contributes today's cash/
UPI receipt; once paid, its recognized sale is attributed to its saved service date.
Closing a previously served/paid order does not move or duplicate that sale. Website
provider payouts and settlement dates are not counter receipts. Historical paid,
fulfilled receipts without a completion timestamp are disclosed separately using
their placement cohort, never assigned an invented completion or collection date.

Real production figures never include Razorpay test captures, simulations or
counter receipts authored in the development environment. Development reports are
clearly labelled **TEST REPORT**. A pending QR request contributes no order/sale
until staff accepts it into an actual order.

The read-only report RPC uses one database snapshot across relevant placement,
completion and collection dates. It supports at most 31 inclusive IST days and
10,000 matching orders, with explicit response-size limits. Larger/incomplete reports
fail with an instruction to choose fewer dates; no partial financial report is shown
or downloaded. CSV period columns use the matching event dates so their recognized
sales/collection totals can reconcile to the screen. Bill face amounts remain
separate columns. Customer names, phones, addresses, bank references and staff IDs
are omitted; spreadsheet formula injection is escaped.

**Downloading only creates a copy. It never deletes, archives or clears Supabase
orders, invoices, payments or audit data.** No daily automatic deletion or background
cleanup is added. A CSV is not a full database backup or a replacement for statutory
records. Any later retention/archival policy needs separate approval, recoverable
backups and applicable tax/legal review. The existing rate-limit-row cleanup work is
separate from retaining business financial records.

## Verification and rollout

Current source-level tests cover pricing/GST, default-disabled availability, paid vs
pay-later kitchen eligibility, cash/UPI confirmation, expected versions/idempotency,
branch-bound queues, financial classification/dates, CSV privacy/formula safety and
read-only report limits. Report PostgreSQL checks were run in a development
**BEGIN/ROLLBACK** transaction: owner/service-role access, public denial, IST bounds,
completion/collection dates, a complete 1,004-row report and refusal above 10,000.
The report function and fictional records were confirmed absent after rollback.
Those checks do not establish browser acceptance or a deployed database migration.

Before enabling a branch:

1. Apply the reviewed counter/report and branch-ordering-QR migrations with the
   matching Edge/frontend release to development. Verify default-off gates, owner
   access, one reusable QR per branch and disabled legacy table links.
2. Complete counter → kitchen → ready → served → settled/closed → bill/reprint and
   branch/date CSV journeys with fictional development data, including pay-later.
3. Verify guest name/mobile → branch QR request → staff payment decision → same
   branch kitchen order. Verify missing/invalid contact fields, expired/replaced QR
   generations, duplicate/forged-price and another-guest requests are rejected. Check
   the staff-only pay-later exception does not imply that the guest paid.
4. Verify simultaneous submissions, lost responses, stale menu versions, duplicate
   UPI references and failed prints without duplicate orders/payments/invoices.
5. Review complete-range totals and CSV against saved receipts. Confirm ordinary
   customer checkout still rejects dine-in/manual-paid fields.
6. Record the tested release, production owner acceptance and required operational
   handoff, then explicitly opt the intended branch into counter service. Keep live
   website/gateway launch decisions separate.

Dedicated branch-manager/kitchen accounts, split payments, running table tabs,
reversals/refund workflow, automatic daily closing, scheduled backups/exports and
thermal-printer integration remain later scope. No legal/Google certification is
claimed by implementation or these tests.
