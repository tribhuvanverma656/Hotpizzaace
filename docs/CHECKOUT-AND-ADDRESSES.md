# Checkout and saved addresses

The minimum order setting applies only to home delivery and uses the final payable total, including delivery and after coupon discounts. With the default ₹199 minimum, ₹170 food + ₹49 delivery = ₹219 is eligible. Pickup has no minimum order value or delivery fee. The separate free-delivery threshold remains ₹250 food subtotal before coupons.

Checkout shows any minimum shortfall before submission and uses the same calculation when creating an order. Kitchen availability, enabled payment methods and delivery PIN coverage still apply. Fees and totals are always calculated from current settings rather than a saved form draft.

Checkout drafts use versioned tab session storage, scoped to the selected branch and the signed-in mobile number or guest identity. They preserve contact/address fields, optional instructions and fulfillment/payment choices when returning from the cart or refreshing. Saved account addresses use persistent browser storage and are separate from these temporary drafts.

Signed-in customers can manage addresses at `/account/addresses`, accessible from My orders, the mobile navigation and the footer. A default address fills a fresh checkout; an existing edited draft takes priority. Checkout also allows choosing another address or explicitly saving the current address. Addresses remain local to this browser profile and origin; this prototype has no server account database or secure production authentication.

Regression coverage checks pickup below the former minimum, ₹219 delivery eligibility, exact minimum boundaries, coupon-adjusted totals, address ownership/default/validation, migration without clearing existing data and draft scope/restoration. Browser QA uses fictional details on an isolated local origin, preserving the main storefront's data.

Browser QA at 390×844 verified a two-item ₹170 food order reaching the ₹219 payment simulator and confirmation; a ₹50 pickup reaching payment with no address requirement or minimum; guest and signed-in drafts retaining addresses through Back and refresh; Home/Work creation, editing and changing the default; and Work autofilling a fresh signed-in checkout. Unsaved checkout edits did not change the address book until Update saved address was explicitly selected. Both the address page and checkout had no horizontal overflow. Screenshots: `docs/screenshots/checkout-payment-219.jpg` and `docs/screenshots/mobile-saved-addresses.jpg`.

Store revision 8 adds saved addresses without resetting existing carts, categories, orders, sessions or settings. The complete automated suite has 94 passing tests; ESLint and the production build pass.

The address audit adds explicit create/update operations with an expected customer identity and original record snapshot. An older editor cannot silently overwrite a changed address or recreate a deleted one. Removal confirmations verify the original address too. Duplicate addresses are compared using normalized case, spaces and commas, independently of their label. Forms validate individual fields and reject PINs beginning with zero. Malformed persisted address records are skipped, duplicate records and defaults are normalized, and the rest of the application state is preserved.

Checkout keeps its selected address snapshot with backwards-compatible v1 drafts. If the saved record changes or disappears, entered details stay intact, a notice explains the conflict and the user must reselect the latest record or explicitly keep details as a new address before saving to the book. Async payment simulation stops if the component, branch or signed-in customer changes.

Final browser checks used two tabs: the second tab changed Home while the first retained unsaved edits; the first displayed a conflict and disabled Save until Load latest was selected. Duplicate creation was rejected, field errors exposed `aria-invalid`, and signing in as another test customer removed the previous customer's cards and unsaved form.

This is still browser-local persistence. Sequential cross-tab edits are checked against the latest received record; local storage does not provide atomic transactions for truly simultaneous writes. Production account security, cross-device address synchronization and concurrent-write guarantees require a server-side database and authenticated access.
