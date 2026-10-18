# Phase 2 — production integration plan

This document specifies work to perform after prototype acceptance. The current app has no Supabase clients, SQL migrations, authenticated server order endpoints, Razorpay integration, or production authorization. Its local mock data and `simulated_paid` state must remain clearly separate from real orders and captured payments.

Decision recorded 18 October 2026: use **Supabase** for the production database/authentication/storage and **Hostinger managed Node.js / Web Apps hosting** for deployment. Implementation and account provisioning are deferred to Phase 2 at the owner's request. Google sign-in with email OTP fallback is the current recommendation, not yet a confirmed login requirement. Git/GitHub and automated quality checks can be prepared before external integrations; see [development and release workflow](DEVELOPMENT-WORKFLOW.md) and [current readiness status](PROJECT-STATUS.md).

The owner already owns a domain registered with **GoDaddy**. Keep the domain there; connect its DNS to the chosen Hostinger app during Phase 2. Do not purchase another domain or a Vercel subscription for this setup. Preserve existing mail/DNS records when preparing the connection. The exact domain name and DNS access are needed at deployment time, not for local development or GitHub CI.

## 1. Approve and confirm the business configuration

Complete the delivery and pickup acceptance journeys in [QA-CHECKLIST.md](QA-CHECKLIST.md). Obtain approval of the storefront, inline Add/quantity behavior, customization, administration, and order workflow. Confirm the restaurant's real address, phone, opening schedule, holidays/closures, service postal codes, preparation times, menu, prices, dietary labels, images, coupon rules, taxes/invoicing requirements, delivery fees, cancellation/refund policy, and cash collection workflow. Kanpur contact details and the supplied printed-menu prices have been imported; operational defaults remain demo settings. Confirm the coverage, minimum, preparation estimate and promotion before launch.

Choose whether customer sign-in is required or guest checkout is supported. Admin authentication is mandatory for production. Authenticated order history can be enabled with Supabase Auth; a phone number by itself must never authorize access to production orders. If guest tracking is retained, design a high-entropy, expiring order-access token or verified OTP flow and rate-limit lookup attempts. Store guest access tokens hashed, limit their scope, and redact private address/contact data in public responses.

## 2. Provision isolated development services

Create a development Supabase project and a separate production project. Set up a Razorpay account, confirm account eligibility and currently available UPI/card methods, and obtain test-mode keys. Start with a separate Hostinger staging app using development data and Razorpay test mode. Verify the selected plan's Node.js support, app slots and build/runtime compatibility with this project's resolved Next.js version before purchase. Do not import browser-local demo customer/order data into a real customer database.

After approval, install the integration packages in a dedicated change:

```sh
npm install @supabase/supabase-js @supabase/ssr razorpay server-only
```

Pin and test the resolved versions. Create separate browser, request-scoped server, and privileged server Supabase helpers. Cookie-based SSR sessions use `@supabase/ssr`; refresh sessions using the current Next.js 16 `proxy.ts` pattern, verify identity with `getClaims()` or a server-confirmed `getUser()` lookup, and avoid shared caching of authenticated responses. Follow the [official Supabase SSR guide](https://supabase.com/docs/guides/auth/server-side/nextjs).

The following environment names are a proposed contract, not variables used by Phase 1:

| Proposed variable                      | Exposure and purpose                                                          |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Public project URL                                                            |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public publishable key; protection comes from RLS and authorization           |
| `SUPABASE_SECRET_KEY`                  | Server-only privileged key, only where required for narrow trusted operations |
| `RAZORPAY_KEY_ID`                      | Read on the server; return the key ID as part of safe Checkout configuration  |
| `RAZORPAY_KEY_SECRET`                  | Server-only API/signature secret                                              |
| `RAZORPAY_WEBHOOK_SECRET`              | Server-only webhook verification secret, separate from the API secret         |
| `APP_BASE_URL`                         | Server-side canonical application URL used for allowed callbacks              |

Keep `.env.local` uncommitted. Mark privileged integration modules with `import 'server-only'`. Never prefix secret keys with `NEXT_PUBLIC_`, place them in client-imported modules, expose them in logs, or put them in `next.config`'s `env` object. [Next.js documents how public environment variables are bundled into the browser.](https://nextjs.org/docs/app/guides/environment-variables)

## 3. Implement reviewed, versioned migrations

Create `supabase/migrations/` only when implementation begins. Review and test migrations against a clean database and an upgrade database before applying them to hosted environments. A proposed migration sequence is:

1. Domain enums, common timestamps, `profiles`, private `admin_memberships`, `branches`, `branch_postal_codes`, `branch_staff_memberships`, and `saved_addresses`.
2. Catalog: `categories`, `products`, `product_variants`, `addon_groups`, and `addons`.
3. Commerce: `orders`, `order_items`, `order_item_addons`, `payments`, `coupons`, and `restaurant_settings`.
4. Reliability records such as `payment_webhook_events` and `order_status_events`; uniqueness/idempotency constraints, indexes, and trusted transaction functions.
5. Explicit grants, RLS policies, Storage bucket policies, and verified development seed data.

| Table                      | Required design                                                                                                                                                                                                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `profiles`                 | Auth user foreign key, customer display/contact fields, timestamps; no customer-writable privileged role                                                                                                                                                                    |
| `admin_memberships`        | Trusted assignment of owner/staff capability to an Auth user; private schema or equivalent protected access, no self-promotion                                                                                                                                              |
| `branches`                 | Stable branch ID, unique slug, name and contact details, enabled state; seed only the confirmed Barra location                                                                                                                                                              |
| `branch_postal_codes`      | Branch FK and canonical six-digit delivery PIN; unique branch/PIN pair; overlapping coverage requires an explicit customer choice                                                                                                                                           |
| `branch_staff_memberships` | Auth user FK, branch FK and scoped capability assigned by a trusted owner; no staff self-assignment                                                                                                                                                                         |
| `saved_addresses`          | Auth user FK, label, recipient/contact/address fields, canonical duplicate identity, default flag and optimistic version; one default per customer and bounded address count                                                                                                |
| `categories`               | Unique slug, name, sort order, archive/publication state; protect referenced products                                                                                                                                                                                       |
| `products`                 | Category FK, unique slug, name/description, image storage path, vegetarian flag, publication/availability/archive state, feature flags, integer-paise base price                                                                                                            |
| `product_variants`         | Product FK, stable option ID, size label, full integer-paise price, active/archive state; unique product/option identity                                                                                                                                                    |
| `addon_groups`             | Product association, type such as crust/toppings, selection minimum/maximum, single/multiple-selection rules                                                                                                                                                                |
| `addons`                   | Group FK, label, surcharge in paise, active/archive state, stable option identity                                                                                                                                                                                           |
| `orders`                   | Unique order number, branch FK and immutable branch/contact snapshot, optional customer Auth FK, fulfillment/payment summaries, customer/address snapshot, all amount fields in paise, currency, coupon snapshot, status, timestamps, version, idempotency key/request hash |
| `order_items`              | Order FK, optional product/variant references for provenance, immutable product/variant name and image snapshots, unit price, quantity, notes, line total                                                                                                                   |
| `order_item_addons`        | Order-item FK, optional addon reference, immutable group/label/price snapshots and quantity                                                                                                                                                                                 |
| `payments`                 | Order FK, provider, test/live mode, unique provider order/payment IDs where present, attempted amount/currency, lifecycle status, captured/refunded amounts, verification timestamps; support multiple attempts per order                                                   |
| `coupons`                  | Branch scope and unique normalized code within that scope, percentage/fixed rule as agreed, minimum/cap, validity period, active state, redemption limits                                                                                                                   |
| `restaurant_settings`      | Branch FK, restaurant profile, structured operating schedule/timezone/closures, ordering switches, fee/minimum, preparation estimate, enabled methods                                                                                                                       |
| `payment_webhook_events`   | Unique provider event ID, verified event type, processing state/error, received/processed timestamps; limited retention of necessary payload data                                                                                                                           |
| `order_status_events`      | Order FK, previous/new fulfillment states, actor, timestamp, reason; append-only audit trail                                                                                                                                                                                |

Use UUID primary keys, `timestamptz`, foreign keys, nonnegative money constraints, positive bounded quantities, and clear delete behavior. Use `bigint` paise where needed and safely validate conversion to JavaScript numbers. Index category/publication/availability, order customer/created time, order status/created time, payment provider IDs, coupon code, and idempotency identity. Add checks that totals reconcile and currency is INR for this deployment.

Preserve the shared menu across branches unless branch-specific inventory/prices become an explicit requirement. Use authenticated user IDs for saved-address and order ownership; phone numbers remain contact information. Enforce address duplicates, maximum count, default replacement and stale-update checks transactionally, with ownership derived from the verified session. Deleting a saved address must not change order snapshots. A code rollback must not roll back customer orders or address records.

Store order customer, item, variant, addon, price, and discount snapshots at creation. Menu changes and archiving must not rewrite historical snapshots. Restrict updates to snapshot columns; use separately audited corrections/refunds rather than overwriting a completed receipt. Product/category deletion must never cascade into order history. Live pricing tables stay normalized; immutable order snapshots deliberately duplicate the purchased facts.

Separate production payment states (`created`, `pending`, `authorized`, `captured`, `failed`, `partially_refunded`, `refunded`, as finally agreed) from fulfillment states. Do not map browser `simulated_paid` values into production `captured` records. Keep demo seeds in their own environment.

## 4. Enforce authentication, grants, RLS, and Storage access

Replace the public demo password and `adminSession` flag with Supabase Auth. Enforce a verified identity and trusted admin membership on every admin page, server action, and endpoint. A redirect is a usability feature; authorization belongs inside each operation. Never infer admin privileges from browser state, request body fields, email alone, or customer-editable user metadata.

Enable RLS on every exposed table, explicitly limit grants, and test every policy as anonymous, customer A, customer B, and staff. Keep privileged keys server-side; they bypass ordinary RLS protection. See [Supabase's grants and RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security).

Implement this access matrix:

| Principal                | Read                                                                                                      | Mutate                                                                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Anonymous visitor        | Published, available, nonarchived public catalog and safe restaurant fields                               | Only validated public checkout/guest-token endpoints; no direct order/payment table writes                                                      |
| Authenticated customer   | Own profile, saved addresses and own orders/items/safe payment summaries                                  | Own allowed profile/address fields; order submission through trusted services; no price, fulfillment, role, or payment-status edits             |
| Authorized staff/owner   | Permitted catalog and assigned-branch settings/customer/order operations; owner may have all-branch scope | Validated menu/settings changes and valid fulfillment transitions within trusted branch membership; no blanket access to customer address books |
| Verified payment service | Necessary order/payment records                                                                           | Narrow payment updates and append-only webhook records                                                                                          |

Add policies for child tables by ownership of the parent order. Avoid recursive role policies: use a narrowly scoped, reviewed role-check function if needed, with a fixed `search_path` and limited execution grants. Bootstrap the first owner through a trusted administrative process. Do not allow users to grant roles to themselves.

Create a menu-images Storage bucket. Allow public reads only for approved product imagery; restrict uploads/changes/deletes to authorized staff, validate MIME/type/size and object names on the server, and document cleanup of unused files. Replace local base64 uploads with stored object paths. Test Storage policies separately from table policies.

## 5. Move pricing and order creation to the server

Keep `lib/pricing.ts` as reusable pure domain logic where suitable, but run authoritative validation against current database records. Extend the existing repository contracts for caller scope and transactions. In particular, unrestricted `listOrders()` is not a customer API, and client-callable `updatePaymentStatus()` must not exist in the production browser boundary.

Implement request-scoped production repositories and services under `lib/repositories/`, `lib/supabase/`, and server-only order/payment modules. Update UI components currently using `useDemoStore` directly to call the new boundary. Keep Zustand for provisional cart/UI state; do not treat its product prices, admin session, or orders as trusted server facts. Make demo versus production mode explicit and fail closed when production configuration is absent.

The production create-order request should contain product/option IDs, quantities, notes, fulfillment, customer data, coupon code, and an idempotency key. It must not accept authoritative prices, totals, payment status, customer ownership, or admin capability from the browser.

1. Authenticate the customer when required or verify the guest checkout context. Rate-limit requests and validate content length and schema.
2. Load current published/available products, variants, addons, coupons, and restaurant settings from trusted storage.
3. Validate option membership, duplicates, quantities, notes, branch identity, operating hours/closure, service area and enabled fulfillment/payment methods. Apply the confirmed delivery minimum to the final payable total including delivery and after discounts; pickup has no minimum or delivery fee. Keep the free-delivery threshold separate: ₹250 food subtotal before coupons, with the current ₹49 fee below that threshold.
4. Recalculate unit prices, food subtotal, discount, delivery fee, any agreed taxes, and total in integer paise. Return a clear reprice response when a previously displayed amount changed.
5. Within one database transaction, reserve the scoped idempotency key, compare its request hash on repeats, enforce coupon redemption limits, create the order and snapshots, and create the initial payment attempt record. Enforce uniqueness in the database so concurrent retries cannot duplicate orders.
6. Return the same safe order response for an identical retry; reject a reused key with a different payload. Do not return private records to a caller without ownership/access checks.

Use a reviewed PostgreSQL function/transaction or equivalent server transaction mechanism for the atomic write, rather than a sequence of unrelated browser requests. Plan compensation/reconciliation for external-provider calls that time out after the provider may have accepted them. Log correlation IDs without logging secrets or unnecessary personal data.

Fulfillment updates must recheck the current database state and allowed delivery/pickup transitions under concurrency. Use row locking or a version comparison; record an audit event atomically. Enable safe customer polling or authorized realtime subscriptions for updates across devices. Opening hours should become structured `Asia/Kolkata` rules rather than the Phase 1 display string.

## 6. Integrate and verify Razorpay in test mode

Create the Razorpay order on the server using the server-calculated INR amount, associate it with the local payment attempt, and return only safe Checkout fields. Load official Razorpay Checkout in the browser with its provider order ID. A browser success callback must be verified server-side using the persisted provider order ID and secret; also verify provider payment status and matching order/amount/currency. Only a verified capture can establish payment completion. Keep authorized/pending/failed attempts separate, and preserve retry attempts on the same local order. See the [official Standard Checkout integration steps](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/).

Implement a Node runtime webhook Route Handler with the following behavior:

1. Read the request body as raw text/bytes once, apply a body-size limit, and validate `X-Razorpay-Signature` using the webhook secret before parsing JSON.
2. Validate the event schema, provider identifiers, test/live environment, order association, amount, and currency.
3. Claim `x-razorpay-event-id` using a database uniqueness constraint and apply the event transactionally. A verified duplicate is a harmless success; invalid signatures are rejected.
4. Handle out-of-order events without regressing captured/refunded state. Reconcile ambiguous events with the provider API. Record failed processing for safe retry; acknowledge success only after durable handling.

Use the [Razorpay webhook verification documentation](https://razorpay.com/docs/webhooks/validate-test/) for raw-body signatures, duplicate IDs, and event ordering. Keep fulfillment independent, and define when captured online orders become eligible for staff confirmation. Never set a payment to paid because a customer loads a redirect, confirmation page, or receipt. Cash collection requires a separate authorized, audited collection action. Refunds need their own records, amounts, and revenue treatment.

## 7. Run the production test matrix

Keep the Phase 1 domain suite and add integration/browser tests that exercise real authorization and server boundaries:

| Area             | Required evidence                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migrations       | Clean install, safe upgrade, constraints/FKs, indexes, seed isolation, historical snapshot immutability                                                 |
| Authentication   | Valid/expired/forged session, logout, owner/staff permissions, denied self-promotion, authenticated response caching isolation                          |
| RLS/Storage      | Anonymous/customer A/customer B/staff access per table and bucket; direct API attempts cannot bypass the app                                            |
| Pricing          | Forged prices/totals, invalid IDs, duplicate addons, unavailable products, stale prices, money bounds, coupon caps and concurrent limits                |
| Checkout         | Delivery/pickup, unsupported postal code, minimum, closures/hours, disabled methods, validation, parallel identical requests and mismatched reused keys |
| Payments         | Test UPI/card success, failure, dismissal, pending, retry, invalid signature, wrong order/amount/currency, verified capture, full/partial refund        |
| Webhooks         | Altered raw body, missing/invalid signature, duplicate/concurrent event, out-of-order event, secret rotation/retry, database failure then retry         |
| Fulfillment      | Both paths, invalid/concurrent transitions, cancellation/rejection, payment/fulfillment independence, revenue exclusions                                |
| Customer privacy | Cross-account order lookup denied, unguessable guest tokens/OTP, rate limits, redacted safe responses                                                   |
| Browser journeys | Mobile and desktop customer/admin journey, refresh, cross-device tracking, unavailable storage, image upload, loading/error/empty states                |
| Deployment       | Build/lint/types/tests, scoped environment values, callback URLs, HTTPS webhook delivery, log redaction, rollback and restore exercise                  |

Verify test payments in the Razorpay dashboard/API and database; a UI screenshot alone is insufficient. Keep evidence of policy tests and payment events. Re-run representative tests after enabling production keys without executing unintended customer charges.

## 8. Deploy with separate environments and a controlled cutover

Use separate Hostinger staging and production apps, connected to the intended GitHub branches, with separate environment values. Staging uses the development Supabase project and Razorpay test keys. Keep production secrets out of pull-request checks and staging. Set approved Supabase Auth redirect URLs and stable webhook endpoints; staging must not receive production payment events. Redeploy after changing build-time public variables. Verify Hostinger's current deployment behavior before wiring automation; a Git push can trigger deployment without waiting for GitHub Actions. Enforce required checks before the production branch changes, and include quality checks in the Hostinger build command. See [the release workflow](DEVELOPMENT-WORKFLOW.md) and [Hostinger's Node deployment guide](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/).

Apply reviewed migrations and RLS tests before switching the app to production repositories. Confirm backups, database restore procedures, deployment rollback compatibility, payment reconciliation, webhook monitoring, error reporting, and access to operational logs. Seed only the confirmed restaurant catalog/settings; bootstrap authorized staff securely. Test a full delivery and pickup journey on the hosted preview and obtain release acceptance.

Configure live Razorpay keys and live webhook secrets only after account activation, test acceptance, capture settings, refund handling, and restaurant policies are confirmed. Remove the public demo credentials and payment simulator from production routes, preserve a clearly isolated demo environment if desired, and ensure customer receipts only report verified payment state. Monitor failed webhooks, stalled payments, duplicate attempts, and order creation errors during launch.
