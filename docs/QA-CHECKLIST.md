# Phase 1 acceptance checklist

Use a clean browser profile for the initial journey, then refresh and reopen the application to exercise local persistence. This checklist records expected behavior; unchecked entries are not evidence of a completed test.

## Customer ordering

- [ ] Homepage, menu, product detail, cart, checkout, confirmation, tracking, and order history routes load directly and through navigation.
- [ ] Demo mode and illustrative menu/restaurant details remain clear throughout the journey.
- [ ] Category, vegetarian, search, and availability filters return the expected products and have an empty state.
- [ ] Size, crust, toppings, extras, notes, and quantity affect the selected configuration and price correctly.
- [ ] Unavailable options, invalid quantities, and missing required customization are rejected with a useful message.
- [ ] Identical configurations merge; different configurations remain separate cart lines.
- [ ] Quantity edits, line removal, coupon application/removal, and empty cart behavior work.
- [ ] Cart survives refresh and page navigation; subtotal, discount, fee, and total use integer paise calculations.
- [ ] Valid delivery checkout requires customer name, Indian phone, address, locality, and serviceable postal code.
- [ ] Invalid phone/address, unsupported locality or postal code, and orders below the configured minimum show an actionable error.
- [ ] Pickup checkout requires contact details, displays restaurant information, and charges no delivery fee.
- [ ] Paused ordering, temporary closure, disabled delivery, and disabled pickup settings are enforced at checkout.
- [ ] Payment initiated, pending, simulated success, failure, and retry states are explicit and never imply a real charge.
- [ ] Failed or unpaid simulated payments do not become paid merely by opening the success route.
- [ ] A submitted order contains the selected configuration, a correct price breakdown, delivery/pickup details, and a unique order number.
- [ ] Repeated submission/retry does not create unintended duplicate orders.
- [ ] Confirmation and tracking show the submitted order after refresh.

## Administration

- [ ] Admin demo login is clearly distinguished from production security and unauthenticated admin navigation redirects to login.
- [ ] New customer orders appear in admin lists, detail views, and eligible dashboard metrics.
- [ ] Search, status filters, date filters, detail navigation, and confirmation dialogs work.
- [ ] Fulfillment and payment statuses remain independent.
- [ ] Delivery follows confirmation → preparation → dispatch/readiness → out for delivery → delivered.
- [ ] Pickup follows confirmation → preparation → ready for pickup → picked up without an out-for-delivery step.
- [ ] Invalid transitions, accidental cancellation, and rejected confirmation dialogs do not mutate the order.
- [ ] Revenue excludes failed, unpaid, and cancelled orders according to the displayed metric definition.
- [ ] Product creation/editing, configuration prices, availability, category, feature flags, and image preview persist after refresh.
- [ ] Product validation catches missing names, invalid prices, invalid configuration, and unsupported image uploads.
- [ ] Product archive requires confirmation and no longer offers the archived item for purchase.
- [ ] Category create/edit/reorder/archive works without orphaning products or deleting historical order snapshots.
- [ ] Restaurant settings, service rules, coupon rules, ordering availability, and preparation estimates persist and affect customer flows.
- [ ] Historical order names, configuration, and prices remain unchanged after product changes.

## Responsive and reliability checks

- [ ] Full delivery and pickup journeys work at 390 px mobile width and desktop width without horizontal overflow.
- [ ] Dialogs fit small screens, scrolling remains usable, and fixed cart controls do not cover form fields.
- [ ] Keyboard focus is visible; dialogs, menus, buttons, form labels, and validation messages are accessible.
- [ ] Food images load locally; image fallback/empty states remain usable.
- [ ] No important buttons, forms, or navigation links silently do nothing.
- [ ] Empty storage, unavailable storage, stale persisted menu data, and unknown product/order routes recover safely.
- [ ] No real credentials, card number inputs, or browser-granted production admin roles are present.
- [ ] Lint, TypeScript checking, production build, and relevant domain/integration tests pass.

## Phase 2 readiness gate

- [ ] Record prototype acceptance before connecting Supabase or real payment services.
- [ ] Confirm restaurant-owned menu, imagery, contact details, hours, taxes, service area, and business rules.
- [ ] Provision Supabase, implement the documented migrations and RLS, and verify server-enforced customer/admin access.
- [ ] Replace mock repositories with authenticated server-backed repositories and preserve order item snapshots.
- [ ] Recalculate pricing, coupon eligibility, availability, and service rules server-side with idempotent order creation.
- [ ] Integrate Razorpay test orders, server signature verification, signed raw-body webhooks, and duplicate-event handling.
- [ ] Test payment failure, pending, capture, refund, stale-price, unauthorized-access, and duplicate-request scenarios.
- [ ] Configure environment variables, deployment, monitoring, and backups before enabling production payment credentials.
