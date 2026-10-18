# Mobile ordering improvements

The menu uses a vertical category rail on the left at widths up to 700px, compact dish cards on the right, and sticky search below the measured header. The rail scrolls separately when its categories exceed the available height. Desktop keeps a horizontal category row with non-shrinking tabs and search fixed together below the header.

Product customization prioritizes required size and standard crust; optional toppings and kitchen notes use disclosures. Pricing still changes with the selected size and add-ons. Larger controls improve touch use.

The cart uses clear functional labels and a readable shared Order summary. Coupon entry is optional/expandable, applied codes stay visible, and invalid codes show inline errors. Delivery eligibility remains visible alongside totals.

Checkout keeps guest ordering on one page, clearer delivery/payment sections and collapsed optional address notes. At 360–767px, name/mobile and locality/PIN share rows while the address spans the full width. At narrower widths fields stack. Inputs are 16px. A mobile bottom bar shows the exact total and submits the existing form, preserving native validation and submission guards. It hides while the payment simulator is open.

The fabricated rating was removed from the homepage. Current delivery and preparation settings are shown instead. Policy/help pages and restaurant social links are available from the footer.

Quantity steppers use a white, bold 16px count and 44px buttons. Their handlers resolve the latest cart configuration on each tap, avoiding stale quantities during rapid changes. Automated checks cover rapid additions, independent configurations, limits, removals, totals and cross-tab quantity updates.

Browser verification at 390×844 confirmed no horizontal page overflow, a 12px gap between the category rail and products, and form validation from the fixed checkout action. A quick double increase changed Green Chilli Corn from 1 to 3, the cart showed 3 × ₹105 = ₹315, and a double decrease returned it to 1. The corrected count is white, 16px and weight 700. Screenshot: `docs/screenshots/mobile-quantity-fixed.jpg`. Full validation: 62 tests, ESLint and production build passed.
