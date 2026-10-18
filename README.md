# Hot Pizza Ace

[![CI](https://github.com/Satya2n/hotpizzaace/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Satya2n/hotpizzaace/actions/workflows/ci.yml)

A responsive Indian pizza ordering prototype with a customer storefront and a separate restaurant administration workspace. Phase 1 runs entirely with browser-local demonstration data. Customer demo sign-in uses a visible test code. Supabase, real OTP authentication, production authorization, Razorpay, and deployment integration are planned for Phase 2; no external service credentials are required to run this version.

## Run locally

Use Node.js 24.20.0 and npm to match `.nvmrc` and CI. The installed Next.js package requires at least Node.js 20.9.

```sh
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The development script listens on `0.0.0.0`; if port 3000 is occupied, read the terminal for Next.js's selected port, or pass `npm run dev -- --port 3001`.

For a local production build:

```sh
npm run build
npm start
```

No `.env.local` file is needed for Phase 1. Adding Supabase or Razorpay environment variables does not activate an integration.

## Try the prototype

1. Browse `/menu`, select a category, search, or turn on **Veg only**.
2. Use the inline **Add** control. Configurable pizzas open a customization dialog; standard dishes add immediately. The resulting `− / quantity / +` control changes the last added configuration. Use **Customise it your way** to add a different configuration. The total card quantity includes all configurations.
3. Choose a size, crust, extras, quantity, and optional preparation notes. Continue to `/cart`, update quantities, and try `ACE20` on a qualifying food subtotal.
4. At `/checkout`, choose delivery or pickup. For delivery, a demo address with postal code `208027` and a valid Indian mobile format works. Pickup requires contact details and removes the delivery fee.
5. Choose UPI or card to open the explicit payment simulator, or choose cash awaiting collection. Exercise success, failure, pending, and retry states. No money is transferred and no card credentials are collected.
6. Open `/admin/login` and use the demo account below. Find the new order, inspect its receipt, and advance it through the valid fulfillment states. Customer tracking updates from the same browser storage, including across tabs on the same origin.

| Demo administrator | Value                  |
| ------------------ | ---------------------- |
| Email              | `owner@hotpizzaace.in` |
| Password           | `Demo@1234`            |

This account is public demonstration data. The client-side admin session is a cosmetic navigation guard, and browser state can be edited by the user. It provides no production access control. Use fictitious customer details while testing.

### Customer sign-in and tracking

Open `/account/login`, enter the mobile number used at checkout, and use **123456** as the demo verification code. No SMS is sent and this is not secure authentication. `/account/orders` shows only browser-local orders matching the signed-in mobile, with a **Track order** link for each. The demo session persists after refresh and can be ended with **Sign out**. Signed-in checkout fills and retains that mobile number so the new order appears in the same history.

The confirmation page has a prominent **Track order** button. The cart has a tracking shortcut even when empty; mobile navigation always exposes **Track order** and customer sign-in/My orders. A signed-in customer also sees an active-order banner. Tracking URLs reopen the selected order after refresh. Guest lookup still accepts an order number and matching mobile at `/track-order`. These are local demo conveniences; server-verified ownership, real OTP, and cross-device history require Phase 2.

## Implemented experience

The storefront includes a promotional homepage, 111 products across 14 menu categories, vegetarian markers, product details, reusable customization, inline quantity controls, a persistent cart, coupons, delivery/pickup checkout with configurable delivery fees and a free-delivery threshold, simulated payment outcomes, order confirmation, tracking, and local order history. Different configurations remain separate cart lines; matching configurations merge. Money is calculated in integer paise and displayed in INR. Orders preserve product names, selected option labels, and unit prices so subsequent menu edits do not rewrite receipts.

The administration workspace includes order metrics, a seven-day sales chart, recent orders, bestsellers, searchable and filtered order lists, details, valid status transitions, product creation/editing/deletion/restoration, image uploads and previews, size/crust/extra pricing, category creation/editing/reordering/archiving, customer summaries, and restaurant settings. A category containing active products must be emptied or its products archived before the category can be archived.

Delivery orders progress through `pending → confirmed → preparing → ready → out_for_delivery → delivered`. Pickup orders use `pending → confirmed → preparing → ready → picked_up`. Cancellation/rejection choices depend on the current state. Payment status is separate from fulfillment status. Demo revenue counts only delivered or picked-up orders with `simulated_paid`; failed, initiated, pending, cancelled, and rejected orders contribute no revenue. The revenue figure includes the eligible order total after discount and including any delivery fee.

### Routes

| Customer                | Purpose                                                  |
| ----------------------- | -------------------------------------------------------- |
| `/`                     | Homepage and featured menu                               |
| `/menu`                 | Menu, categories, search, vegetarian filter              |
| `/menu/[slug]`          | Product details and customization                        |
| `/cart`                 | Configuration lines, quantities, coupons, totals         |
| `/checkout`             | Delivery/pickup and payment simulation                   |
| `/order-success?id=...` | Local order confirmation and receipt                     |
| `/track-order`          | Local order lookup and fulfillment progress              |
| `/account/login`        | Simulated mobile/code sign-in; demo code 123456, no SMS  |
| `/account/orders`       | Signed-in demo history filtered by the customer's mobile |
| `/account/addresses`    | Saved delivery addresses, editing and default selection  |

| Administration                                        | Purpose                                                          |
| ----------------------------------------------------- | ---------------------------------------------------------------- |
| `/admin/login`                                        | Demo login                                                       |
| `/admin`                                              | Redirect to the dashboard                                        |
| `/admin/dashboard`                                    | Metrics, chart, recent orders, bestsellers                       |
| `/admin/orders` and `/admin/orders/[id]`              | Search/filter, order details, fulfillment/payment actions        |
| `/admin/products`                                     | Search/filter, delete and restore menu products                  |
| `/admin/products/new` and `/admin/products/[id]/edit` | Reusable product form and image preview                          |
| `/admin/categories`                                   | Add, edit, reorder, archive/restore and delete unused categories |
| `/admin/customers`                                    | Customers derived from local demonstration orders                |
| `/admin/settings`                                     | Restaurant profile, ordering rules, methods, and coupons         |

## Restaurant menu and demo defaults

The menu contains 111 items transcribed from the two supplied menu sheets. Overlapping prices use the higher amount. Pizzas use 7/10/12-inch size prices and size-based crust/topping charges; rice supports half/full portions. The supplied logo is used unchanged. Restaurant contact details come from the supplied Google business listing: ME 346, near Ram Janki Mandir, Hemat Vihar, Barra 2, Barra World Bank, Barra, Kanpur, Uttar Pradesh 208027; +91 70815 55055; daily 11 AM–midnight.

Only matching Zomato ordering-menu photos without Zomato watermarks are used for menu items: 71 photos, with neutral placeholders for 40 dishes. No menu-sheet crops are displayed. See [menu import notes](docs/MENU-IMPORT.md) and [photo provenance](docs/menu-photo-provenance.json).

| Setting                | Initial value                                                                    |
| ---------------------- | -------------------------------------------------------------------------------- |
| Delivery fee           | ₹49 below ₹250 food subtotal; free at ₹250 or more before coupons; pickup free   |
| Minimum delivery total | ₹199 demo default, including delivery and after discounts; pickup has no minimum |
| Delivery postal codes  | `208027` demo coverage, to be confirmed by restaurant                            |
| Preparation estimate   | 25 minutes, demo default                                                         |
| Coupon                 | Demo `ACE20`: 20% off food subtotal from ₹499, capped at ₹200                    |
| Payment methods        | Simulated UPI/card and cash awaiting collection                                  |

Orders remain demonstration data. Service coverage, minimum, estimate and coupon remain configurable demo rules. The imported address and contact details replace the original illustrative location.

These rules are editable in Admin → Restaurant settings. Delivery fee and the optional free-delivery subtotal are separate from minimum order value. Payment options include an Enable Cash on Delivery (COD) control; turning it off and saving removes cash from delivery/pickup checkout while preserving existing orders. Opening hours are display text; checkout enforces the explicit accepting-orders/temporary-closure switches rather than parsing an automatic opening schedule. There is no tax invoicing, tax configuration, real dispatch, SMS, email, or cross-device synchronization.

## Persistence and images

The versioned menu migration imports the new catalog without clearing browser storage. Previous sample products are archived; their cart lines stay visible but must be removed before checkout. Historical receipt snapshots, custom products, sessions and other ordering settings are preserved. Future admin edits survive reloads.

Zustand stores the catalog, categories, cart, coupon, settings, orders, saved addresses, demo customer/admin sessions, and checkout idempotency records in `localStorage` under `hot-pizza-ace-demo-v1`. Checkout drafts use tab session storage, scoped to branch and demo account, and survive navigating back to the cart. Data belongs to the browser profile and origin; a different port, browser, private session, or device has separate data. Clearing site data removes all local changes. To reset this prototype, run the following in the browser console and reload:

```js
localStorage.removeItem('hot-pizza-ace-demo-v1');
location.reload();
```

Product uploads accept JPG, PNG, and WebP files up to 1.5 MB. Uploaded images are base64 data URLs in local storage, so several uploads can exceed the browser's storage quota. A visible error explains when changes cannot persist; the app can continue in memory, but those changes may be lost on refresh. Use compact images or the supplied local files for testing. Category management stores names, slugs, sort order, and archive state; categories do not have uploaded images in this prototype.

Current menu photos and exclusions are documented in [photo provenance](docs/menu-photo-provenance.json) and [restaurant photo sources](public/images/menu/SOURCES.md). Legacy stock assets remain for historical demo receipts and promotional artwork; their sources are documented in [public/images/SOURCES.md](public/images/SOURCES.md).

## Architecture

The app uses Next.js App Router, React, TypeScript, Tailwind CSS, Lucide icons, Zustand, Zod, Sonner notifications, and shadcn-style Button/Dialog primitives built with Radix/CVA.

| Location               | Responsibility                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| `app/`                 | Customer/admin routes, layouts, global styles, loading/error/unknown-page states                 |
| `components/`          | Storefront shell, menu, customization, receipts, shared UI                                       |
| `components/admin/`    | Admin layout, reusable order/catalog tables, forms                                               |
| `types/index.ts`       | Shared domain contracts                                                                          |
| `lib/menu/`            | Printed menu, approved photo mappings and versioned migration                                    |
| `lib/data.ts`          | Imported menu exports, historical demo orders and restaurant settings                            |
| `lib/store.ts`         | Browser-local state, persistence, mutations, cross-tab sync                                      |
| `lib/pricing.ts`       | Configuration validation, integer-paise pricing, coupons, valid transitions, revenue eligibility |
| `lib/validation.ts`    | Zod schemas and configurable checkout validation                                                 |
| `lib/repositories/`    | Repository scaffolding; production services and UI/store rewiring still required                 |
| `tests/domain.test.ts` | Domain/store regression tests                                                                    |

The UI currently reads and mutates the local store directly. Repository contracts are a starting point for the production boundary; replacing the adapters alone will not secure the UI. Phase 2 must move trusted operations to authenticated server services.

## Checks and acceptance

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

The automated suite covers pricing, invalid options and quantities, coupon limits, service rules, cart merging, order snapshots and idempotency, payment retry, cash/pickup behavior, fulfillment transitions, revenue eligibility, category safety, base/size price alignment, storage failures, and cross-tab hydration. It is a domain/store suite, not a browser end-to-end suite. Completed manual checks are recorded in [customer QA](docs/CUSTOMER-QA.md) and [admin QA](docs/ADMIN-QA.md). See [docs/QA-CHECKLIST.md](docs/QA-CHECKLIST.md) for the broader acceptance checklist; unchecked items do not claim completed verification.

## Begin Phase 2

Supabase and Hostinger managed Web Apps hosting are the selected Phase 2 direction; external integration is deferred. See [current status and remaining work](docs/PROJECT-STATUS.md) and [the proposed GitHub/release workflow](docs/DEVELOPMENT-WORKFLOW.md). Confirm the remaining operational rules before following [docs/PHASE-2.md](docs/PHASE-2.md) for database migrations, server authorization, repository replacement, trusted pricing/order creation, Razorpay verification, the test matrix and Hostinger deployment. None of those production integrations are implemented by the current prototype.

## Version control and CI

The repository is [Satya2n/hotpizzaace](https://github.com/Satya2n/hotpizzaace). GitHub Actions runs lint, all regression tests, a production build and TypeScript checking for pull requests and pushes to `main`/`staging`. It can also be run manually from Actions. A successful CI run checks the prototype; it does not deploy a site or activate production authentication/payments.

Use feature branches and pull requests for future changes. `staging` is reserved for release testing and `main` for accepted code. Connect hosting only during Phase 2, after configuring the appropriate review/check rules. The complete setup and release procedure is in [docs/DEVELOPMENT-WORKFLOW.md](docs/DEVELOPMENT-WORKFLOW.md).
