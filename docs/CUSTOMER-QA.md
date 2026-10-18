# Customer prototype verification

Verified on 17 October 2026 in the Codex in-app browser against the local development server. All customer details below are fictitious test data; no restaurant or payment service received orders.

- Desktop homepage, category controls, product images, and pizza customization rendered correctly.
- A medium Margherita with cheese burst and extra mozzarella calculated ₹524. Repeating it from the card merged the identical configuration into quantity 2 and subtotal ₹1,048.
- An invalid coupon produced an error. ACE20 gave the capped ₹200 discount; ₹49 delivery produced a final ₹897 total.
- Cart options, notes, quantities, and coupon remained after refresh.
- A delivery postal code outside the configured service area was rejected. Changing to 560001 allowed checkout.
- Simulated payment entered pending, failed without marking the order paid, and succeeded after retry. The confirmation displayed the correct ₹897 snapshot and explicitly stated that no money was charged. The cart then emptied.
- The newly created order appeared in the admin order list with matching customer, configuration, payment, and totals.
- Admin confirmation and preparation changes updated the open customer tracking tab without refresh. Fulfillment changes left payment status separate.
- A combo added directly from its card without opening customization. The category URL selected Combos.
- Pickup removed delivery/address requirements and displayed the restaurant address, hours, and preparation estimate. A cash pickup order totalled ₹449 and remained payment-pending with no money collected.
- Local order history found that pickup order using its test mobile number.
- Empty menu search rendered reset controls; resetting recovered the menu. Veg-only filtering showed 12 vegetarian products and zero non-vegetarian products.
- Mobile navigation and pizza customization worked at 390px. Checkout and menu had no horizontal document overflow. A 320px menu also rendered two usable product columns and scrollable categories.
- Local image upload was verified separately in the in-app browser: the file chooser accepted the supplied Margherita JPEG and rendered it in the product preview. The unsaved product draft was cancelled. Chrome-specific file access remains a separate limitation documented in ADMIN-QA.md.

The automated domain/store suite separately verifies option tampering, quantity limits, minimum/service rules, snapshots, idempotency, valid fulfillment paths, revenue eligibility, storage failures, and cross-tab hydration. This manual record is not an automated browser test suite.

Test orders intentionally remain as local demo records. Data is browser-profile and origin specific. See ADMIN-QA.md for the independent Chrome admin checks and its local upload limitation.
