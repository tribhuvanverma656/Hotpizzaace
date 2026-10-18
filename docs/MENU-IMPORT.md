# Restaurant menu import — 17 October 2026

The supplied pizza and branded combo menu sheets are preserved in `public/menu-sheets/` for reference. `lib/menu/catalog.ts` transcribes 111 vegetarian products in 14 categories: 40 pizzas, 13 value pizzas, 10 combos, 7 burgers, 2 pastas, 4 garlic breads, 3 fries/puffs, 2 pockets, 4 wraps, 4 rice dishes, 3 pav/bhaji servings, 2 desserts, 5 dips and 12 beverages.

The latest instruction uses the **maximum price** when sheets overlap: red and white pasta ₹109, pizza puff (3 pieces) ₹129, French fries ₹80, masala French fries ₹90. Onion & Paneer value pizza is ₹109. Other prices follow the supplied printed sheets, including pizza sizes, add-ons and rice portions. Zomato prices do not override printed prices.

Pizza sizes are Small 7 inch, Medium 10 inch and Large 12 inch. Add-ons are per selected size: real mozzarella ₹40/60/80; cheese burst ₹60/90/130; extra cheese ₹30/40/60; Italian thin crust ₹30/60/90; each selected extra topping ₹20/30/45. The add-on list is exposed as individual topping choices at the printed extra-topping rate. Standalone value pizza tiles have no stated size, so no size has been invented. Printed names/spellings such as Maxican, Tanduri, Poney Achari, Vanila, Orgeno, Browny and Blue Carlo are retained. Combo contents follow the printed sheet where online variants differ.

## Photos and logo

Per the latest user instructions, product photos come **only** from the [restaurant's Zomato ordering menu](https://www.zomato.com/kanpur/hot-pizza-ace-barra/order). No cropped menu-sheet images are used. There are 71 matched local dish photos and 40 neutral “Photo coming soon” placeholders. Four pasta/rice photos carrying a Zomato watermark were excluded without editing their marks. The Hot Coffee listing image was excluded because it depicts a bottled cold drink. Some online items have no attached image; others differ from the printed dish. No unrelated image is substituted.

`docs/menu-photo-provenance.json` records original listing names, source URLs, local paths and exclusion reasons. `lib/menu/photos.ts` contains approved mappings. Existing restaurant branding in photos is retained. The original supplied logo is served unchanged from `public/brand/hot-pizza-ace.gif` in the storefront and admin. Header logo widths are 72px on desktop and 60px on mobile.

## Restaurant details

The supplied [Google share link](https://share.google/JKBLLOUz7KItONQEb) resolves to Hot Pizza Ace's business listing (kgmid `/g/11c32cgwc6`). Verified in the browser: ME 346, near Ram Janki Mandir, Hemat Vihar, Barra 2, Barra World Bank, Barra, Kanpur, Uttar Pradesh 208027; phone +91 70815 55055; all seven days 11 AM–midnight. Phone also matches the supplied menu. Header location is Kanpur. The original import used free delivery from the supplied sheet; the later confirmed policy supersedes that default: ₹49 below ₹250 food subtotal, free at ₹250 or more before coupons. Admin can edit both values. `208027` is a demo service area, not a confirmed coverage boundary.

The ₹199 minimum, 25-minute preparation estimate and ACE20 promotion remain explicitly demo settings. Ordering and payment are still local simulations.

## Saved data

Persist revision 4 imports the menu once, archives old illustrative products, and preserves receipt snapshots, orders, cart objects, custom products, sign-in sessions and idempotency records. Archived cart lines remain removable and cannot be checked out. Initial illustrative contact details are replaced with the supplied restaurant listing. Unrelated settings and custom fees/coverage are retained. Subsequent admin catalog edits survive refresh. Photo-only revisions replace import-provided images while preserving uploaded/custom image URLs.

## Verification

Lint, TypeScript, domain/menu tests and production build are run for this import. Tests cover all products and local assets, unique IDs/slugs, category membership, maximum overlap prices, size-dependent charges, half/full rice, migration preservation, one-time persistence and removal of the four watermark photos. Browser QA covers logo sizing, populated categories, dynamic add-on prices and photo/placeholder rendering.

## Admin deletion

Admin → Menu & products now exposes text **Edit** and **Delete** buttons. Delete asks for confirmation, removes the item from the storefront and offers immediate Undo. The **Deleted items** view supports later Restore; restored items remain unavailable until edited, while Undo restores the previous availability. Items whose category was also archived can be restored through Edit after choosing an active category. Existing order receipts remain unchanged. Action buttons stay visible at the right edge of the product table on narrow screens.
