# Mobile ordering improvements

The menu uses a vertical category rail on the left at widths up to 700px, compact dish cards on the right, and sticky search below the measured header. The rail scrolls separately when its categories exceed the available height. Desktop keeps a horizontal category row with non-shrinking tabs and search fixed together below the header.

Product customization prioritizes required size and standard crust; optional toppings and kitchen notes use disclosures. Pricing still changes with the selected size and add-ons. Larger controls improve touch use.

The cart uses clear functional labels and a readable shared Order summary. Coupon entry is optional/expandable, applied codes stay visible, and invalid codes show inline errors. Delivery eligibility remains visible alongside totals.

Checkout keeps guest ordering on one page, clearer delivery/payment sections and collapsed optional address notes. At 400–767px, name/mobile and locality/PIN share rows while the address spans the full width. Below 400px fields stack, because two 140px columns truncated placeholders at 360px. Inputs are 16px. A mobile bottom bar shows the exact total and submits the existing form, preserving native validation and submission guards. It hides while the payment simulator is open.

The fabricated rating was removed from the homepage. Current delivery and preparation settings are shown instead. Policy/help pages and restaurant social links are available from the footer.

Quantity steppers use a white, bold 16px count and 44px buttons. Their handlers resolve the latest cart configuration on each tap, avoiding stale quantities during rapid changes. Automated checks cover rapid additions, independent configurations, limits, removals, totals and cross-tab quantity updates.

Browser verification at 390×844 confirmed no horizontal page overflow, a 12px gap between the category rail and products, and form validation from the fixed checkout action. A quick double increase changed Green Chilli Corn from 1 to 3, the cart showed 3 × ₹105 = ₹315, and a double decrease returned it to 1. The corrected count is white, 16px and weight 700. Screenshot: `docs/screenshots/mobile-quantity-fixed.jpg`. Full validation: 62 tests, ESLint and production build passed.

## Mobile refinement — 6 November 2026

A 360×780 audit of customer, QR, account and staff screens led to layout-only changes. Pricing, GST, rounding, server calls, validation and order flows are unchanged.

- **Type and touch:** CSS font sizes below 12px were raised to 12px (print styles excluded). Inputs, selects and text areas are 16px up to 900px so iOS does not zoom. Header, drawer, footer, back/text links and menu controls have 44px tap areas.
- **Header:** one 60px row (logo, branch, cart, menu). Track order and sign-in stay in the drawer, the cart tracking shortcut and the active-order banner. The ribbon shows only the environment badge on phones.
- **Notices:** phones show notifications at the bottom above the cart bar instead of over the header.
- **Menu:** compact dish rows with price and Add/stepper on one line and "Customise it your way" below. Menu, customiser and QR photos use `next/image` for bundled files (owner HTTPS/data URLs keep a plain element); scrolling the full menu dropped from about 4.6 MB to about 1 MB of images in local measurement.
- **Cart:** items come first; the tracking shortcut moves below the summary. A ₹0 round-off line is hidden in the live summary (non-zero adjustments and saved bills still show it).
- **Checkout:** fields stack below 400px; a shorter bottom bar; the disabled pay button stays readable.
- **QR guest ordering:** brand red, Add turns into a − / quantity / + stepper on the card, singular/plural fixed, and "Review order" opens a bottom sheet with lines, name, mobile, note, GST and Send so guests keep their menu position.
- **Counter on phones:** the bill opens from a sticky "N items · ₹total · Bill & payment" bar as a sheet; it closes after a successful send. Branch and QR-queue panels are compact.
- **Admin:** single-line top bar, order lists render as tappable cards below 650px, dashboard filters fit two columns, the calculation note and kitchen hint are disclosures, and wide tables scroll inside their own container.

Validation: 620 tests, ESLint, TypeScript and the production build passed. Real-device (Android/iOS Safari) checks are still recommended before release.
