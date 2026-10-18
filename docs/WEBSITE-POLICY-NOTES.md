# Website information and policy pages

Prepared 17 October 2026 for the **current browser-local ordering prototype**.

## Routes and shared components

- `/about`, `/contact`, `/faq`
- `/privacy-policy`, `/terms-and-conditions`, `/delivery-policy`, `/refund-cancellation`
- `components/info/info-page.tsx` provides the shared server-rendered page and FAQ structure.
- `components/info/info-page.module.css` keeps typography and layout scoped to these pages.
- `components/info/business-info.tsx` reads current restaurant settings for contact details,
  delivery fees, thresholds, minimum order, service postal codes, preparation estimates,
  payment methods and coupon rules. Those figures are not duplicated in policy text.

## Implementation evidence

The privacy description was checked against `lib/store.ts`, `lib/persistence.ts`,
`lib/customer-auth.ts`, `app/checkout/page.tsx`, and `components/order-detail.tsx`.
The app stores cart, orders, menu/settings and demo session indicators in localStorage;
checkout-attempt information also uses sessionStorage. Payment and mobile verification are
simulations. No order API, live gateway, SMS, marketing analytics or third-party image hotlink
is present in the current implementation. Normal requests for website files still reach its
server. The pages make no claim about future hosting-provider logs or security certifications.

Business address, phone and hours use the confirmed restaurant settings. The map action opens
the [Google business link supplied by the owner](https://share.google/JKBLLOUz7KItONQEb).

## Official references checked

- [MeitY: notified Digital Personal Data Protection Rules, 2025](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf).
  Rule 3 describes clear notices listing data and purposes, with contact routes. Commencement
  is phased; these pages do not claim that every rule is already operative or that the app is
  certified compliant. The notice describes the actual prototype behavior.
- [Department of Consumer Affairs: Consumer Protection (E-Commerce) Rules, 2020](https://consumeraffairs.gov.in/public/upload/files/E%20commerce%20rules_1732703966.pdf).
  The rules address business/contact disclosures, grievance handling, delivery/payment and
  return/refund information. The prototype pages avoid invented legal names, officer details,
  cancellation fees or refund guarantees.
- [Department of Consumer Affairs: official acts and rules index](https://consumeraffairs.gov.in/pages/consumer-protection-acts)
  and [2026 amendment document](https://consumeraffairs.gov.in/public/upload/files/E%20Commerce%20Amendment%20Rules%202026_1789127949.pdf).
  The current index also lists an amendment with future commencement language. Applicable
  rules and commencement should be reviewed again for the actual launch date.

## Business details needed before accepting live orders

Confirm the operating legal name and applicable registrations/disclosures, customer-support
email, named grievance contact and process, payment/hosting providers, real server retention
and privacy-request handling, taxes/invoices, delivery commitments and coverage, and the
actual cancellation, missing/incorrect-item and refund process (including methods and timing).
Also verify permission to use restaurant listing photos before public launch.

This is a record of implementation choices, not a legal compliance certification. The visible
pages state that no real purchase or refund happens in the current demo and preserve applicable
consumer rights. They do not assert an unconfirmed policy for purchases through other channels.
