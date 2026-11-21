# 58 mm receipt printer acceptance

The receipt defaults to a 58 mm roll with a 48 mm printable column. Its page height
follows the bill content. A bill exceeding the supported 3000 mm receipt height
stops before printing and asks for A4, avoiding a long blank tail from pagination.
A4 is available separately. Automated tests cover the height boundary, the
isolated print frame, cleanup, cancellation and reprinting; they cannot verify the
physical printer driver, cutter or paper feed.

Use a **development test bill**, never a new production order just for this check.
Open its bill and select **58 mm receipt → Print / save PDF**. In the system print
dialog, choose the actual thermal printer, a 58 mm roll/paper size, 100% scale, no
additional margins and no browser headers or footers. A driver configured for A4
can override the website's receipt dimensions.

Print one short test bill and one longer bill with several items/options. Check:

- Both edges are visible, with no clipped prices, references or wrapped digits.
- Item quantities, options, GSTIN, FSSAI, CGST/SGST, round off and payable total are readable.
- Paper ends shortly after the receipt, without an A4-length blank tail.
- Cancelling and printing again leaves the order, payment and invoice unchanged.
- The print button returns to its normal state and another receipt can be printed.

If it clips or feeds too much blank paper, record the printer model, driver name,
chosen paper size and scale. Keep the existing bill; printing does not require a
new order or payment. Physical acceptance remains pending until those two prints
are checked on the restaurant's device.
