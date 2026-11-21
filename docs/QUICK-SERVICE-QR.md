# Quick-service QR ordering

Updated 25 October 2026. This is the approved workflow and acceptance contract for
the source candidate. It does not claim that the new branch QR migration, Edge
handler or frontend is deployed. Use [project status](PROJECT-STATUS.md) and
[QA evidence](DINE-IN-QA.md) for the actual release state. The existing
[counter framework](DINE-IN-COUNTER-FRAMEWORK.md) covers staff orders, bills,
manual receipts, Kitchen and reports.

## Customer and counter flow

HOT PIZZA ACE is a quick-service restaurant. Customers scan one reusable **branch
ordering QR**, choose food on their own phone, and pay at the counter. There is no
table QR, table assignment, running table tab or payment gateway in this flow.
The same branch QR may be printed at the entrance and counter.

| Stage                 | Customer sees                                                           | Admin / Kitchen effect                                                                  |
| --------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Scan QR               | Branch name and that branch's menu                                      | No order created                                                                        |
| Choose food           | One-tap Add, quantity controls, optional Customize and preparation note | No order created                                                                        |
| Enter details         | Required name and Indian mobile number; food, CGST, SGST and total      | Contact details checked on the server                                                   |
| Send order            | **Send order · pay at counter**                                         | Creates a pending request in the selected branch's **QR orders** admin queue            |
| Await counter         | **Request sent · pay at the counter** and a request reference           | No Kitchen ticket, invoice, receipt or sales recognition yet                            |
| Collect payment       | Staff identify the customer by request reference, name and mobile       | Staff review current menu totals and confirm cash received or merchant UPI credit       |
| Accept                | Accepted order reference and status                                     | Creates one counter order, invoice and receipt atomically; enters that branch's Kitchen |
| Prepare and hand over | Staff manage preparation and service status                             | Same Kitchen and counter order; no re-entry of items                                    |

Guests do not sign in, enter an address or PIN, select a table, enter payment
credentials, claim that they have paid, or choose **Pay later**. Dine-in / counter
has no delivery fee or minimum order. The regular website checkout continues to
have Delivery and Pickup only.

## Required guest details

- **Name:** trimmed, 2–80 characters.
- **Mobile:** valid Indian 10-digit mobile starting with 6–9. The public form shows
  `+91`; the stored request uses the normalized national number.
- **Preparation note:** optional, up to 300 characters. Item options and notes are
  shown to staff and then the Kitchen on the accepted order.

The mobile number is a contact and order-identification field. It is not verified
by OTP and does not establish a login, account ownership, consent to marketing or
proof of payment. No automatic SMS/WhatsApp notification is promised. A second
customer entering the same mobile number cannot access an earlier guest's request.
Staff-created walk-in orders retain optional customer details and the optional
**Order reference** field, so the normal rush-hour counter flow stays short.

## Pay by UPI from the customer's phone

When the website host sets `NEXT_PUBLIC_COUNTER_UPI_ID` (the counter sound box's merchant
UPI ID, for example `q123456789@ybl`) and optionally `NEXT_PUBLIC_COUNTER_UPI_NAME`, the
**Request sent** screen shows **Pay ₹… by UPI** plus Google Pay, PhonePe and Paytm
buttons. They open the customer's UPI app with the payee, the exact request total and the
note `HPA <request number>` already filled in. Without the variable, the screen keeps
the existing "pay at the counter" text.

The link only pre-fills the payment. It is not proof of payment: the counter sound box
announces the credit and staff accept the request in **QR orders** as before. Some UPI
apps limit pre-filled payments to merchant IDs; customers can still scan the counter
QR. The variable is public (it is the same ID printed on the counter QR) and takes
effect after a website rebuild.

## Payment and staff decision

Customers use cash or the restaurant's **existing merchant UPI QR** at the counter.
The ordering QR and payment QR have separate purposes. No Razorpay order or Checkout
is created for a branch QR request.

Staff open **QR orders → Review & collect payment**. Cash defaults to the full
current amount; staff edit tendered cash only when change is needed. For UPI,
staff verify the restaurant's actual merchant credit and record the transaction
reference. An explicit **Cash received** or **UPI verified** action accepts the
request and sends it to Kitchen. A screenshot or customer statement cannot mark
it paid. Manual UPI receipts are labelled staff-confirmed, not gateway-confirmed.

A QR submission remains a request until that decision. Accepting a request checks
its version, QR generation, expiry, current menu revision, availability, prices and
taxes. If prices changed, staff confirm the new total with the guest before
collecting payment. Unknown outcomes use the same idempotent attempt; staff must
check the saved decision before collecting payment again. A duplicate acceptance
must not create another invoice, collection or Kitchen ticket.

The rare **Pay later** exception remains available only to authorized staff with
an explicit reason. It can create an unpaid Kitchen order; the guest cannot grant
it. The accepted status therefore must not tell the guest that payment was received
unless a receipt exists. Such orders remain visibly unpaid and cannot close until
fully settled. A declined or expired request never enters Kitchen.

## Branch QR management and lifecycle

The staff navigation label is **Scan & order QR**. Its screen, retained at
`/admin/dine-in-qr`, says **One QR for your branch** and has a branch selector,
Create, Print/Download, Replace and Disable controls. It does not ask for a table
label or show a table list. A branch may have one canonical reusable ordering QR. Repeating Create returns that
same QR and does not reactivate a disabled link; only an explicit, versioned
reactivation/replacement generates the next active token.

The QR opens `/dine-in/[token]`; this compatibility URL does not imply table service.
The server derives the branch from the opaque token, not a guest-supplied branch ID.
Requests appear only in that branch's authorized queue. Accepted orders, invoices,
settlements and Kitchen tickets retain the branch chosen by that server lookup.
Changing an admin branch selector does not move any request or receipt.

- A pending request expires no later than 30 minutes after creation.
- **Replace QR** generates a new token generation. The old link and its pending
  requests stop working; every printed copy must be replaced.
- **Disable QR** stops that QR and its pending requests. Reactivation uses a new QR.
- Disabling/replacing a QR does not cancel or alter accepted orders, payments,
  invoices or historical references.
- The branch's separate counter availability flag and temporary-closure setting
  control new QR requests and acceptance. Existing accepted orders can still be
  prepared, served and settled by authorized staff.

## Guest access and abuse boundaries

A shared or photographed QR may be opened away from the restaurant. It does not
prove physical presence. Opaque links, bounded requests, rate limits and staff
payment confirmation reduce abuse without claiming that QR access is identity.

A private HttpOnly guest cookie binds request-status reads to the originating guest
browser. The public status projection must not expose other guests, private bills,
bank references or staff identifiers. Name, mobile and a request reference are not
a substitute for that guest session. Losing the private session requires staff
help; a phone-number lookup must not reveal another guest's order.

Only verified, trusted owner membership can manage the QR, review the full request,
record receipt or send it to Kitchen. The public link and customer login grant no
admin access. Service-only database operations, explicit grants/RLS and verified
server identity remain the authorization boundary. No editable user metadata or
body-supplied actor identity grants staff permissions.

Development and production use separate databases, tokens, guest requests, accepted
orders, invoice sequences, payments and reports. Development QR printouts and bills
are marked as tests. Print only the production QR for customers after that branch
is accepted for service; a test QR must not become a live restaurant QR.

## Replacing the former table QR source

An additive migration disables former table QR links and their pending requests.
It preserves historical accepted table orders, references, invoices, receipts and
audit records. It does not delete financial data or silently reinterpret old table
links as the new branch QR. Staff create and print the new branch QR after release.

Internal names such as `hpa_table_qr`, `hpa_table_requests`, `table-qr`,
`table-requests` and retained TypeScript names may remain for compatibility. New
customer/admin wording and validation use branch ordering. These compatibility
names are not a promise of table service or a reason to expose a table field.

## Acceptance before restaurant use

1. Run matching migration, Edge and frontend versions in development. Check one
   branch QR, disabled legacy links and preserved historical accepted orders.
2. Scan the branch QR on a mobile viewport. Add and customize food, validate missing
   or malformed name/mobile, review GST, send once, and see the correct `QR-…` request reference. Historical `TBL-…` references stay intact.
3. Confirm no Kitchen order, invoice, receipt or sale exists before staff decision.
4. Find that request by reference/name/mobile in the correct branch's **QR orders**
   queue. Accept with actual test cash or a fictional, explicitly marked test UPI
   reference. Confirm exactly one order/invoice/receipt and the same branch Kitchen
   ticket. Do not initiate a real payment or ask staff to prepare test food.
5. Check the staff-only pay-later exception, declined/expired requests, QR replacement
   and disable, duplicate submissions, lost responses, stale prices, duplicate UPI
   references and another guest's session. Confirm no duplicate payment or ticket.
6. Confirm authorized staff can read accepted historical orders after QR replacement; confirm
   customer Delivery/Pickup checkout and branch/date CSV reports remain correct.
7. Record evidence and owner acceptance, deploy the matching release, then explicitly
   enable the intended production branch. Deployment alone does not enable ordering.

No unattended public acceptance, automatic bank verification, split payments,
refund workflow, table service, OTP login, scheduled marketing or daily database
deletion is included in this change.
