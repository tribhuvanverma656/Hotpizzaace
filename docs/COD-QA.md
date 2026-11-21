# COD availability regression — 18 October 2026

## Findings and fixes

The reported setup had Restaurant settings on `localhost:3001` with accepting-orders and COD off, while orders were being placed on `localhost:3002` where the saved settings still enabled them. Different ports are different browser-storage origins in this prototype. Admin and customer testing must use the same preview address; Visit storefront opens the matching address. These settings become shared across real clients only with the Phase 2 backend.

Two additional defects were reproduced independently of the port difference:

1. Before a checkout tab processed another tab's storage event, it could create a new cash order with an outdated COD-on snapshot and overwrite the saved COD-off state. Checkout now synchronously observes completed storage saves before reading its current policy.
2. An older admin settings draft could save unrelated edits and restore its old COD-on value. Form saves now verify the original branch/settings snapshot. External changes show a conflict while retaining draft edits; Load latest settings resets the editor explicitly.

Payment switches save immediately against the current branch settings. They work independently of invalid/unsaved profile fields, preserve unrelated settings, reject an outdated managed branch and refuse to disable the final payment method. The saved COD status is visible beside the controls. New checkout hides cash for delivery and pickup when disabled and explains its unavailability. Re-enabling cash restores the option. Existing cash orders retain their receipt, payment method and valid fulfillment/collection workflow.

## Automated evidence

All **112 tests** pass, including 15 focused cases in `tests/cod.test.ts` and three settings snapshot comparisons. Focused coverage includes delivery/pickup, pre-prepared submissions, online methods, re-enabling cash, old receipts/idempotent replay, branch isolation, persisted migration, cross-tab events, the pre-event storage race, stale settings writes, the last enabled method, and quota/unavailable-storage fallbacks. The cache records only successful storage reads/writes, so failed writes do not reload older disk data over newer in-memory changes.

Lint and the production build/type check passed in a temporary project copy. The main development server's build directory was preserved.

## Browser evidence

Tests ran on an isolated `localhost:3003` production build with synthetic QA details:

- Selected cash at delivery checkout, then unchecked COD in admin without Save settings. The saved status immediately became disabled; the existing checkout removed cash, selected an enabled online method and displayed its unavailability.
- Cleared the required restaurant-name draft before toggling COD. The payment change still saved; refreshing restored the original saved name and retained COD-off.
- Pickup displayed no cash option, no delivery fee and no minimum.
- A second older admin tab showed the external-change warning, updated its saved payment display and disabled Save. Load latest settings restored editing.
- Trying to disable the last online method kept it checked and displayed the validation error.
- Re-enabled COD, placed QA pickup order `HPA-MVDNZGM6-906E` for ₹170, then disabled COD again. The existing cash receipt remained pending collection.

`docs/screenshots/cod-disabled-admin.jpg` records the saved off state. The second user preview was restarted with the tested build, COD was disabled there to match the owner's intent, and the existing nine order rows were retained. No test orders were added to the main user previews. Port 3001's saved kitchen pause was preserved.

Truly simultaneous cross-tab writes are not transactional in localStorage. Real authentication, shared policy, atomic order creation and reliable cross-device enforcement remain Phase 2 work; these tests do not establish production payment or authorization guarantees.
