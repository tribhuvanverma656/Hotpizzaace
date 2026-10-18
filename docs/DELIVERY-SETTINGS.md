# Delivery fee and COD controls — 17 October 2026

The confirmed policy is **₹49 delivery below ₹250 food subtotal, free delivery from ₹250**. Eligibility uses the food subtotal before coupon discounts. Pickup remains free and has no minimum. The minimum delivery order value is a separate rule and uses the final payable total, including delivery and after coupons; ₹170 food + ₹49 delivery qualifies for the ₹199 minimum.

Admin → Restaurant settings → Delivery & pickup allows editing the delivery charge, enabling/disabling a free-delivery threshold and changing that threshold. Disabling the threshold applies the configured fee to all delivery orders. A zero delivery fee makes all delivery free. Save settings applies the draft to the storefront, cart, checkout and new orders.

Payment options exposes **Enable Cash on Delivery (COD)**. Uncheck it and Save settings to remove cash from delivery and pickup checkout. At least one payment method must remain enabled. Existing orders and their recorded delivery fees/payment methods are preserved.

The shared pricing calculation applies the rule to cart and checkout totals and is called again when creating an order. The checkout delivery selector shows the current calculated fee. Customers see the threshold and any remaining food subtotal required for free delivery.

Store migrations are separate from menu import migrations in `lib/persistence.ts`. Version 5 adds the ₹250 threshold; version 6 applies the user's confirmed ₹49 charge to existing saved settings once. Catalog, carts, sessions, historical receipts and other settings remain intact. Later admin changes to the fee/threshold persist without being overwritten.

Verification includes ₹249.99 / ₹250 / ₹250.01 boundaries, coupons, pickup, empty cart, threshold changes/disable, invalid amounts, saved data migration, latest-settings repricing, immutable receipts and COD restrictions.

## Kitchen availability

Kitchen availability uses explicit On/Off switches for **Accepting orders** and **Temporarily closed**, with the saved effective status and an unsaved preview. Temporary closure overrides Accepting orders. A nearby Save settings button applies changes; an unsaved switch change does not close or reopen checkout. Opening hours are display text and do not control an automatic schedule. Existing orders remain manageable while new ordering is paused. Delivery or pickup and at least one payment method must be enabled for checkout.

To accept new orders: turn Accepting orders On, Temporarily closed Off and Save settings. Turning Accepting orders Off or Temporarily closed On and saving blocks new order creation; reverting the switches and saving reopens it.

## Coupon connection flow

Coupon code, percentage, minimum subtotal and discount cap are shared settings. Saving updates the homepage offer, cart and checkout, including other tabs on the same browser origin. Code entry ignores case and outside whitespace. A code must be 3–20 letters/numbers; settings normalize it to uppercase. Clearing the code, setting 0% or setting a zero cap disables the offer everywhere.

Renaming or disabling an offer clears an old applied code atomically with the settings change. Quantity, product price and product deletion changes revalidate eligibility. Rehydration also clears stale applied codes. Checkout validates the current offer again; new receipts snapshot the code/discount, and past receipts retain the original offer. Invalid-code messages suggest the current configured code.

Coupon discounts apply only to food subtotal and respect the configured minimum and cap. They do not discount delivery. Free-delivery eligibility continues to use subtotal before coupons.

Automated coverage now includes 62 tests across coupon rename/disable/cap/minimum, stale checkout, cross-tab sync, delivery boundaries, COD restrictions, kitchen pause/closure/reopen, branch ownership and prior ordering/menu behavior. Completed COD and simulated-paid orders always start a fresh checkout attempt for a subsequent order; only superseded unfinished online payment attempts may be cancelled.
