# Project status — 18 October 2026

Supabase and Hostinger are selected for Phase 2. Authentication, database, payments and hosted deployments remain deferred. The owner supplied [Satya2n/hotpizzaace](https://github.com/Satya2n/hotpizzaace) for version control; local Git is now connected to the existing repository history and a GitHub Actions quality workflow is configured. The running local demo and its customer data were not modified by this setup.

The owner already owns the website domain at GoDaddy. A second domain purchase is not needed. Hostinger will provide hosting, with the GoDaddy DNS connected during Phase 2; Vercel is optional and is not part of the selected setup.

## Completed prototype work

The storefront, 111-item/14-category menu, customization, cart, coupons, mobile category rail and sticky search, quantity controls, checkout, simulated payments, order tracking, saved addresses/default/autofill/drafts, admin catalog/category management, branch/PIN management, kitchen/COD/fee switches, information/policy pages and supplied branding are implemented. Detailed browser evidence is in the customer/admin/mobile/checkout QA documents.

The confirmed delivery rule is ₹49 below ₹250 food subtotal before coupons, free delivery at ₹250 or above; pickup is free with no minimum. The delivery minimum uses final payable total including delivery and after discounts, so ₹170 food + ₹49 delivery qualifies for the current ₹199 minimum.

The automated domain/store suite was rerun for this setup: **94 passed, 0 failed** using `node --import tsx --test tests/*.test.ts`. The npm `tsx` launcher could not open its sandbox IPC socket; direct Node invocation ran the same test files successfully. Lint, the production build and the post-build TypeScript check also passed in a separate temporary project copy, preserving the running local site's build directory. That local copy used the existing installed dependencies; the GitHub job additionally verifies a fresh `npm ci` installation. This suite is not a full browser end-to-end test suite.

## Remaining before Phase 2 implementation

| Work                                                                                             | Responsibility / input                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verify the first uploaded CI run, review repository visibility and configure release permissions | Local Git and CI configuration are in place for Satya2n/hotpizzaace. Check Actions for each uploaded commit; branch protection depends on the GitHub plan.                                                      |
| Final acceptance on actual Android/iPhone devices and desktop                                    | Developer verification plus owner review of menu, ordering and administration. Existing emulated-mobile QA already covers the main fixes.                                                                       |
| Complete product photography or accept placeholders for launch                                   | 71 unwatermarked matching photos and 40 neutral placeholders are currently used. Obtain restaurant-approved imagery and permission for public use.                                                              |
| Confirm operational settings                                                                     | Actual delivery PINs (208027 remains demo coverage), preparation estimate, final promotion, opening/holiday handling and staff order-handling process. Do not reopen already-confirmed delivery-fee decisions.  |
| Supply final live policy/business details                                                        | Legal business name, support email/grievance contact, applicable business disclosures, tax/invoice requirements, cancellation/missing-item/refund procedure and timing. Existing policy pages explain the demo. |
| Choose production login/guest flow and notifications                                             | Google plus email OTP is recommended; mandatory sign-in versus guest checkout and restaurant/customer alert channels still need a scope decision.                                                               |

No new confirmed Phase 1 defect was identified by this read-only code/document audit. An unchecked general acceptance checklist is not evidence that a feature failed, nor is it a completed test record.

## Deferred Phase 2 implementation

- Real customer/admin authentication, stable user-ID ownership and branch staff permissions.
- Shared database, saved-address transactions, cross-device orders and server pricing/order creation.
- Durable image storage, replacing browser-local base64 uploads.
- Live online payment verification, webhooks, reconciliation and refunds after test-mode acceptance.
- Restaurant/customer notifications; automatic hours, invoices and dispatch capabilities only as agreed in scope. Existing tracking shows staff-updated fulfillment states, without rider GPS.
- Hostinger staging/production, domain, HTTPS callbacks, monitoring, database backups, restore and release rollback.

The prototype still stores records locally per browser and origin; its public demo OTP and admin login provide no production security. See [Phase 2 implementation plan](PHASE-2.md) and [development workflow](DEVELOPMENT-WORKFLOW.md).
