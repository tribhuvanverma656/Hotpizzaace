# MRP and GST-inclusive items

Packaged items sold at MRP keep their displayed selling price when added to an
order. MRP includes taxes; it does not establish that the item is GST-exempt.
The restaurant's existing food prices continue to have 2.5% CGST and 2.5% SGST
added. No existing product is automatically reclassified by name or category.

In **Menu & products → Edit/Add product**, enable **MRP / GST included in price**
for the appropriate packaged item. Enter its confirmed total GST rate and HSN/SAC
code, and use the printed MRP (or a lower selling price). Size variants can have
different inclusive prices; crust/topping add-ons are not accepted for these items.
An item's applicable tax classification must be supplied explicitly. A product
name such as “water” is insufficient to determine its tax rate.

The shared website, counter and branch QR use the same server pricing. The guest
cannot choose a tax rate or claim an exemption. The bill stores the item's tax
classification and the tax calculation used at acceptance, so later menu edits do
not change an old receipt. GSTIN, FSSAI and the supplier snapshot remain on bills.

For a mixed order containing ₹100 of food plus a ₹20 MRP item, the total is
₹105 + ₹20 = **₹125**, before any delivery charge or coupon. The ₹20 item has no
additional GST added; the GST already included in that ₹20 is accounted for at
the item's configured rate. This example does not assign a rate to a particular
brand or bottle size.

New mixed/inclusive tax snapshots use version 2 and group amounts by pricing
mode, configured rate and code. `tax.total` remains the complete GST liability;
`tax.includedTotal` records the amount already present in menu prices. The payable
equation is `subtotal + deliveryFee - discount + tax.total - tax.includedTotal`.
Sales excluding GST remain `total - tax.total`. Existing all-exclusive orders keep
their previous tax format and rounding. Historical orders and bills are preserved.

Coupons use the existing eligibility and maximum rules. Their paise discount is
allocated proportionally across the displayed item values, using largest
remainders with a stable group-key tie break. Delivery is not discounted. Included
GST is extracted after discount, and rounded components are subtracted from the
discounted inclusive price rather than added to it. The final MRP amount therefore
does not drift through reverse calculation or rounding.

Required verification covers inclusive-only and mixed carts, quantities, size
variants, multiple rates, coupons, rounding, delivery, immutable receipts,
server/client tax-flag isolation, database constraints and report reconciliation.
Production publication is separate from development verification; it does not
enable restaurant ordering or payments.

The owner requested two plain-water choices, ₹10 and ₹20. They use neutral names
and no invented brand or volume. Their configured HSN is 2201 and their price
includes 5% GST, based on Schedule I, entry 146 of
[Notification 9/2025-Central Tax (Rate)](https://egazette.gov.in/WriteReadData/2025/266209.pdf),
effective 22 September 2025. The corresponding
[CBIC integrated-tax schedule](https://courier.cbic.gov.in/ECCS/advisory/2025/NOTIFICATION%20NO.%209_2025-INTEGRATED%20TAX%20%28RATE%29%20-1759486719.pdf)
also lists plain water under 2201 in its 5% schedule. Existing drinks are not
automatically reclassified: prepared coffee/shakes and packaged cold drinks have
different product descriptions. Packaged cold drinks can use the same inclusive
setting with their own confirmed rate, code and MRP.

Sources: the Department of Consumer Affairs' [Consumer Handbook](https://consumeraffairs.nic.in/sites/default/files/file-uploads/consumer_information/Consumer%20Handbook.pdf)
defines MRP as inclusive of taxes. [CGST Rule 35](https://cbic-gst.gov.in/pdf/01062021-CGST-Rules-2017-Part-A-Rules.pdf)
describes extracting tax from a tax-inclusive value. These explain the pricing
model; no independent product-rate or registration verification is claimed.
