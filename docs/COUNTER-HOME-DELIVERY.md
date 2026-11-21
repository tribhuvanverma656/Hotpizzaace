# Staff counter Home delivery

The admin counter can create Dine-in or Home delivery orders. Customer QR ordering remains scan-and-order/pay-at-counter for dine-in; the public website checkout remains a separate flow.

For Home delivery, staff enter the customer name, valid Indian 10-digit mobile, complete address, locality and six-digit PIN. Landmark and delivery instructions are optional. Details remain only in the existing owner/branch-scoped in-memory draft until an order is saved; entering a phone does not associate an order with a customer login or overwrite saved account addresses.

The server reprices the menu, delivery fee, GST/MRP classification and discounts. It checks the selected branch delivery flag, service PINs and minimum payable total. The existing branch delivery settings apply: free delivery uses the food-subtotal threshold before coupons; the minimum uses the payable total including delivery/GST after discounts. Dine-in keeps zero delivery fee, no minimum, and optional contact details. Counter availability is independent of website checkout and its enabled gateway/COD methods.

Staff still confirm actual cash or direct merchant UPI. The explicit rare pay-later exception may send an unpaid order to preparation, but delivery dispatch and completion require a recorded valid receipt. There is no new customer COD option or Razorpay requirement for counter orders.

Kitchen shows COUNTER DELIVERY for packing. Staff advance Ready → Out for delivery → Delivered. Delivery completion records its server completion time; dine-in retains Served → Closed. Bill printouts show delivery charges, address, mobile, GSTIN and FSSAI. Analytics records these as delivery sales and manual counter collections, without counting them again as dine-in or online payments.

Database migration: `20261027124736_counter_home_delivery.sql`. SQL verification: `supabase/tests/counter_home_delivery.sql` inside BEGIN/ROLLBACK using fictional development fixtures only. Legacy dine-in request hash format is retained so an older in-flight counter attempt can safely retry after deployment.
