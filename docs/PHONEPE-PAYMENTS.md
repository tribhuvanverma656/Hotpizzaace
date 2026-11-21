# PhonePe online payments (website checkout)

PhonePe PG **Standard Checkout v2** is now the website's online payment gateway. It replaces Razorpay.
Razorpay code stays in place so older `razorpay_*` orders still display, reconcile and handle refund review.
Counter and table-QR orders are unchanged and keep using cash or merchant UPI. The database rejects PhonePe
reservations for counter-channel orders.

## How it works

1. The customer places a website order with online payment. The order is saved with `paymentMode`
   `phonepe_test` (development) or `phonepe_live` (production).
2. The browser calls `POST /orders/{id}/payment/checkout` with an attempt UUID kept in `sessionStorage`.
   The Edge function `hpa-commerce` reserves an attempt (`hpa_payment_reserve`) and calls PhonePe
   `POST /checkout/v2/pay` using the **server-side amount** in paise and `merchantOrderId = hpa_<attempt uuid>`.
   It then stores the PayPage URL (`hpa_payment_bind_checkout`).
3. The PayPage opens in PhonePe's iframe (`checkout.js` from `mercury.phonepe.com`). The iframe callback
   (`CONCLUDED` / `USER_CANCEL`) is **not** a payment result.
4. The browser asks `POST /orders/{id}/payment/verify`. The server calls PhonePe Order Status, and the order
   becomes `paid` only on `COMPLETED` with exactly one completed payment attempt for the full amount and the bound
   PhonePe order ID. `FAILED` marks the payment failed. A later attempt is then allowed, up to 5 per order.
5. The PhonePe webhook (`hpa-phonepe-webhook`) does the same server-side check, so a closed browser
   still ends up with the right status.

The kitchen only sees online orders after the payment is verified. The owner's **Check PhonePe status**
button in Admin → Orders runs the same reconciliation.

## Secrets (Supabase Edge function secrets, never in the repo, Render or `NEXT_PUBLIC_*`)

| Secret                     | Value                                                          |
| -------------------------- | -------------------------------------------------------------- |
| `PHONEPE_ENABLED`          | `true`                                                         |
| `PHONEPE_MODE`             | `test` for the development project, `live` only for production |
| `PHONEPE_CLIENT_ID`        | from PhonePe Business dashboard → Developer settings           |
| `PHONEPE_CLIENT_SECRET`    | same place; rotate there if it is ever exposed                 |
| `PHONEPE_CLIENT_VERSION`   | the client version shown with the credentials (usually `1`)    |
| `PHONEPE_WEBHOOK_USERNAME` | a username you choose when creating the webhook                |
| `PHONEPE_WEBHOOK_PASSWORD` | a long random password you choose for the webhook              |
| `PHONEPE_SITE_ORIGIN`      | the exact HTTPS production site origin, with no path           |

The mode must match the catalog mode (`development` ↔ `test`, `production` ↔ `live`), or checkout fails closed.
While PhonePe is configured it takes precedence over Razorpay for new orders.

## Deploy and verify

The production destination is `xkvydujnsdqcsmooylwq`. Test locally with fictional provider responses and an
isolated database before releasing. The old source project is not a test environment for this release.

1. The baseline migration `20261107100000_phonepe_payments.sql` is already applied to the destination.
   Apply the separate forward migration `20261107100001_phonepe_recovery_and_refund_ordering.sql` after it.
   Do not reapply or edit the already-deployed baseline.
2. Run `node scripts/bundle-commerce-edge.mjs`, then deploy the updated `hpa-commerce` and webhook bundles.
3. Deploy `hpa-phonepe-webhook` with JWT verification **off**. PhonePe can't send a Supabase JWT; the
   function authenticates by the SHA-256 `Authorization` header instead:
   `supabase functions deploy hpa-phonepe-webhook --no-verify-jwt`.
4. Set the secrets above with `supabase secrets set …` (or Dashboard → Edge Functions → Secrets).
5. In the PhonePe dashboard, add the webhook URL
   `https://xkvydujnsdqcsmooylwq.supabase.co/functions/v1/hpa-phonepe-webhook`, select **SHA** authentication,
   and use the same username and password. Subscribe to `checkout.order.completed`, `checkout.order.failed`, `pg.refund.completed` and
   `pg.refund.failed`.
6. Redeploy the Render site so `Permissions-Policy` allows PhonePe's checkout frame.
7. Confirm `PHONEPE_MODE=live`, catalog mode `production`, the production webhook, and the exact site
   origin before accepting payments. Sandbox credentials cannot be used against the production catalog.

Go-live also needs PhonePe's production merchant activation and credentials. Enabling the website without
those secrets leaves online payment unavailable.

## Known limits

- **Refunds** are issued from the PhonePe dashboard, never by the app. A verified PhonePe refund flags the
  order for owner review and pauses fulfilment, including when the refund callback arrives before local
  capture verification. The webhook acknowledges only after that hold is saved. Refund amounts are not
  posted to the bill automatically; the owner must reconcile them with the PhonePe dashboard.
- If PhonePe's create response is lost, the attempt becomes `unknown`. Customer payment checks, webhooks,
  and Admin → Orders can recover a terminal `COMPLETED` or `FAILED` response using the stored
  `merchantOrderId` and exact amount. Recovery never issues another create request. A verified failure
  permits one fresh attempt; a verified capture records payment without reopening a PayPage.
- A lost PayPage URL cannot be recovered from Order Status. If that status remains `PENDING`, or PhonePe
  cannot prove the order exists, the reservation stays blocked for restaurant review. Check again after
  PhonePe reaches a terminal state; do not create a replacement order or payment to bypass this hold.
- If the PayPage expires while PhonePe still reports `PENDING`, a new attempt is blocked until PhonePe
  marks the order `FAILED`. This prevents a double charge.

## Tests

- `tests/phonepe.test.ts`: config, OAuth caching, pay request, status verification, webhook auth, early refund
  persistence/failure, unknown-attempt recovery, and blocked pending/mismatched outcomes.
- `supabase/tests/phonepe_payments.sql`: reserve, bind, apply, failure/retry, kitchen eligibility,
  early refund holds through late capture, terminal recovery/replay, Razorpay compatibility, and that no
  public role can call the RPCs. Apply both PhonePe migrations before running this rollback-only suite.
