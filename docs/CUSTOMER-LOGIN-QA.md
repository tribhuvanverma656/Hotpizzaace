# Customer demo login and tracking

Verified on 17 October 2026 using an isolated production preview at localhost:3002. This kept the user's localhost:3001 session and orders unchanged. Tests used only illustrative seed customers.

- Invalid Indian mobile input produced a validation error.
- An incorrect six-digit demo code produced an error; the visible code 123456 signed in without an SMS.
- My Orders displayed three records for the first seed mobile. Signing out hid all order cards. Signing in with the second seed mobile displayed only its one matching pickup order.
- The customer session and filtered history persisted through refresh.
- A history row opened the correct tracking URL and the same order remained selected after refresh.
- Find another order cleared the query and returned to the recent-order list.
- Signed-in checkout filled the correct mobile number and made it read-only, keeping future orders under that same demo account.
- At 360px, My Orders, sign out, the always-visible mobile tracking links, and each order's Track order action rendered without horizontal overflow. Screenshot: screenshots/customer-orders-mobile.jpg.
- The main localhost:3001 cart shortcut opened its existing order and retained the selection after refresh before account gating was added.

The automated tests additionally cover phone normalization, incorrect codes, customer/admin session independence, per-mobile order separation, payment-aware labels, terminal states, and safe tracking URL encoding.

These checks verify a browser-local simulation. Real SMS/OTP verification, secure server authorization, and cross-device order history are Phase 2 work.

Final validation: ESLint, TypeScript, production build, and all 20 unit tests passed. The isolated QA cart was cleared and its customer signed out; the main preview remains on port 3001.
