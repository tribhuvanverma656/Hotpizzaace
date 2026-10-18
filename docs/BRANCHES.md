# Branch management

The initial website has exactly one confirmed branch: Barra · Kanpur, serving demo PIN 208027. No unverified restaurant locations are seeded.

Admin → Branches adds or edits custom locations with a branch name, address, phone, opening hours and six-digit delivery PINs. New locations start paused. Use the admin branch selector and Restaurant settings to enable the kitchen and configure that branch's delivery fees, threshold, pickup, payment methods and coupon. The menu catalogue is currently shared across branches.

Customer and admin branch selections are separate. Managing another branch does not change a customer's selected branch or cart. The header branch picker checks exact PIN coverage, offers eligible branches and can show all locations for pickup. If two branches cover a PIN, customers choose. Checkout validates the selected branch's current PIN list again. No nearest-branch or distance-routing claim is made.

A cart belongs to one branch. Changing branch with items requires explicit confirmation to clear the cart; coupons are also cleared, and the checkout form remounts. New orders snapshot branch ID/name/address/phone. Retrying an order under another branch is rejected. Older receipt snapshots are retained and are treated as Barra for queue filtering.

The selected admin branch scopes the dashboard, customer directory and default order queue. Orders also offers an All branches view. This remains a local owner demo; production branch-manager permissions must be enforced on the server with real authentication and branch-scoped access.

Persistence revision 7 wraps existing restaurant settings in the Barra branch and assigns existing carts without clearing orders, sessions or cart items. Domain coverage includes 14 branch tests and 62 tests overall. Receipt contacts resolve from the purchased branch snapshot, with a Barra fallback for legacy orders, independently of the branch currently selected in either interface.

Browser QA on a separate local origin verified creating a paused custom branch, PIN matching and the cart-protection dialog. The main storefront retains only the confirmed Barra branch.
