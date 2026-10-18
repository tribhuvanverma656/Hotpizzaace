# Admin browser verification

Verified on 17 October 2026 using the running Next.js development app at `http://localhost:3001`, through Codex Computer Use in a dedicated Google Chrome tab. All changes used the browser UI. This Chrome profile has separate local storage from the main customer verification session in the in-app browser.

## Verified flows

| Area                         | Browser steps and observed result                                                                                                                                                                                                                                           |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Demo sign-in                 | An invalid password displayed the account mismatch message. `owner@hotpizzaace.in` / `Demo@1234` opened the dashboard. The login page clearly described the gate as cosmetic, local, and insecure for production.                                                           |
| Category safety              | Attempting to archive **Veg Pizza**, which contained four active products, showed the explicit “Move or archive all products” error and retained the category.                                                                                                              |
| Category create/edit/reorder | Created **QA Kitchen Test**, renamed it **QA Kitchen Test Edited**, and moved it up from position 08 to 07. The displayed order and success messages updated.                                                                                                               |
| Product creation             | Created **QA Kitchen Pizza** in the QA category with a local image URL and preview, ₹199 base price, `qa-regular` full-price size ₹199, `qa-thin` crust surcharge ₹20, and `qa-cheese` extra ₹30. Featured and bestseller flags appeared in the product list.               |
| Product editing              | Renamed the item **QA Kitchen Pizza Edited**, changed the base to ₹219, and disabled availability. The first size also changed to ₹219; the catalog showed the updated name, price, and unavailable state.                                                                  |
| Product search/filter        | Search for “QA Kitchen” and the unavailable filter isolated the edited QA product.                                                                                                                                                                                          |
| Product archive              | The archive dialog named the exact product and explained preservation of order history. Confirming removed the QA product from the active catalog.                                                                                                                          |
| Category archive             | After the QA product was archived, its now-empty category could be archived through its confirmation dialog. The active category count returned to seven.                                                                                                                   |
| Settings persistence         | Changed the restaurant name, delivery charge ₹49→₹59, preparation estimate 25→30 minutes, temporary closure flag, service postal codes, and coupon code. Saved, refreshed, and observed every modified value restored from browser storage.                                 |
| Settings restoration         | Restored the name **Hot Pizza Ace**, delivery charge ₹49, preparation estimate 25 minutes, closure disabled, original six postal codes, and coupon **ACE20**. The page displayed “All changes saved locally.” Other settings were left unchanged.                           |
| Order filters                | Search **HPA-1043**, status **Pending confirmation**, and date **2026-10-17** returned the matching seed cash-delivery order with total ₹617.                                                                                                                               |
| Confirmation cancellation    | Opened the “Mark order confirmed?” dialog, selected **Go back**, then reopened and confirmed it. The order remained pending until the explicit confirmation.                                                                                                                |
| Delivery status workflow     | Advanced seed order **HPA-1043** through pending → confirmed → preparing → ready → out for delivery → delivered. Every transition required its confirmation dialog. The terminal delivered state offered no further transitions.                                            |
| Independent cash state       | While preparing, explicitly opened **Simulate cash collection** and confirmed the disclaimer. Payment became “Paid · simulated” separately from fulfillment. No card details or real money were involved.                                                                   |
| Revenue definition           | Initial eligible revenue was ₹1,125 across two fulfilled, simulated-paid sales. After the ₹617 cash order was simulated-paid and delivered, the dashboard displayed ₹1,742 across three completed sales. Preparing, unpaid, failed, and cancelled orders remained excluded. |
| Customer aggregation         | Searching **Aarav** displayed one grouped customer with three orders and eligible demo spend ₹617, matching only the fulfilled paid order.                                                                                                                                  |
| First-size regression        | In a fresh unsaved product form, entered base ₹259 and added the first size. Both the base and new size retained ₹259. Cancelled without saving.                                                                                                                            |

## Issues found and corrected

1. Adding the first size reset an already-entered base price to zero. The first added size now inherits the current base price; later edits remain synchronized in both directions. Verified in the browser with ₹259.
2. A bottom-right success toast could cover a form’s final Save button when a background browser tab kept the toast alive. Admin form footers now reserve additional space below their action row.
3. The payment explanation referred to a collection control “below” even after collection was complete. It now explains the explicit demo action without promising an absent control.

## Coverage limits

- URL-based image preview passed. The local file chooser opened, but Chrome’s extension blocked `setFiles` because file-URL access is disabled. No extension permissions were changed. File type/size validation and FileReader handling remain implemented but a browser upload is not claimed as verified.
- Chrome’s documented enablement guidance, if file upload testing is desired: open `chrome://extensions`, click **Details** under the ChatGPT browser extension, and enable **Allow access to file URLs**. See [official upload instructions](https://developers.openai.com/codex/app/chrome-extension#upload-files).
- The main customer-to-admin order handoff, live tracking across in-app browser tabs, pickup path, and mobile viewport are covered by the root verification session, rather than this separate Chrome storage profile.
- This is a Phase 1 local demo. These checks do not establish secure server authentication, production authorization, real payment capture, or cross-device persistence.

## Cleanup

- QA product and category are archived.
- The temporary ₹259 product form was cancelled without saving.
- Restaurant settings are restored to their original values.
- The seed order **HPA-1043** remains delivered with explicitly simulated payment in this Chrome demo profile, preserving verification history.

Admin TypeScript and ESLint checks pass after the fixes.

## Menu import and Delete / Restore — 17 October 2026

Verified on isolated `localhost:3002` storage using the final production build:

- 111 active menu items, with visible text Edit/Delete controls.
- Delete confirmation explains removal, restoration and receipt preservation.
- Deleting Simple Cheese moves it to Deleted items; Restore returns it as unavailable.
- Editing a deleted item exposes Restore product; enabling availability and saving restores it.
- Size-specific cheese-burst prices remain ₹60/90/130 after editing/restoring.
- Immediate Undo returns the original availability and active count.
- At 375px viewport, Delete is inside the visible page (right edge 348px); the Actions column stays sticky and the page has no horizontal overflow.
- QA item returned to available; 111 active/available items remained. Existing demo orders were unchanged.

Screenshot: `docs/screenshots/admin-products-delete.jpg`. The temporary QA server was stopped afterward. The user preview on port 3001 stays running.
# Category archive and restore

Admin → Categories now has Active categories and Archived categories views with counts. Archive an empty category to remove it from the customer menu. The confirmation explains recovery; its success toast offers Undo. Archived categories have a visible Restore action. Restoring preserves the category ID, URL slug and order, while deleted products and order receipts remain unchanged. Categories containing active products remain protected from archiving.

Verified the user's existing archived category `new` appears in Archived categories on the main local site without modifying it. Screenshot: `docs/screenshots/admin-archived-categories.jpg`. All 62 tests, ESLint and the production build passed; the category regression includes persistence round-trip coverage.

Archived categories also provide **Delete permanently**. Only archived categories with no linked products (including deleted products) can be removed. The store repeats these guards at confirmation time; no products, cart items or receipts are deleted. The confirmation explicitly states that the category cannot be restored. Browser QA opened and cancelled this confirmation for `new`, leaving it intact; screenshot: `docs/screenshots/admin-category-permanent-delete.jpg`. All 65 tests, ESLint and production build pass, including deletion guards, persistence after refresh, slug reuse and unchanged receipt/cart data.
