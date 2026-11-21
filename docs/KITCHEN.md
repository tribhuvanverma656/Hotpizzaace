# Kitchen workspace

Open `/admin/kitchen` or choose **Kitchen** in the owner dashboard. Production is
<https://hotpizzaace.com/admin/kitchen>; the separate development workspace is
<https://hotpizzaace-development.onrender.com/admin/kitchen>.

The queue is connected to the selected branch by its stable branch ID. Its visible
branch selector shares the dashboard's persisted branch selection. Changing the
selection replaces the queue; duplicate branch display names do not mix orders.
The owner can switch branches. A separate restricted kitchen-staff account or role
is not implemented by this selector.

Only confirmed or preparing orders appear, oldest first. Online orders must have
verified captured payment (or an explicitly marked development simulated payment).
Cash orders enter after the restaurant confirms them. Unpaid online, review-required,
pending, cancelled, rejected, ready and handed-over orders stay out of preparation.

Use **Start preparing**, then **Mark ready** after every item is prepared. Updates
use the existing versioned server order transition; a failed update preserves the
ticket and shows an error. A synchronous lock blocks double submissions. The
shared order snapshot refreshes on the dashboard's existing polling interval;
**Refresh** provides a manual update. Connection errors warn that tickets may be stale.

The owner authentication boundary is unchanged. Login returns to an exact allowlisted
admin destination, including Kitchen. Public navigation does not grant order access.
Branch selection is a queue filter for the authorized owner, not a substitute for
server authorization.

## Release and acceptance

- Branch selector and safe login return release: PR #7, commit `aab5c0e`, production
  deployment `dep-dbdovee1egvs73f2a7gg` live. Both exact-source CI checks passed.
  The development browser verified the visible Barra selector and address; a fresh
  production browser correctly returned to `/admin/login?next=%2Fadmin%2Fkitchen`.
- Initial kitchen release: PR #6, production commit `c90633b`, Render deployment
  `dep-dbdnok942hec739ednv0` live on 23 October 2026. Development deployed the same
  commit as `dep-dbdnq13m8hqs73ej5100`.
- The signed-in development kitchen displayed both existing preparation orders,
  item quantities/options and ready buttons. These are visibly labelled test orders.
  No order was changed for this visual check.
- Automated checks cover branch isolation, duplicate branch names, oldest-first
  ordering, excluded statuses, payment eligibility and safe kitchen return paths.
- Production Google was enabled with owner approval and its public Auth settings
  confirmed `external.google=true`. The redirect reaches Google but Google reports
  `redirect_uri_mismatch`: the saved client does not accept the production callback
  `https://vzehsdwwaybcxvzodqaq.supabase.co/auth/v1/callback`.
  The client was traced to the development `hotpizzaace` Google project and only
  allows its development/localhost origins and development Supabase callback.
  Fresh production owner sign-in is still pending. The dedicated production Cloud
  project `oceanic-airway-512502-h4` still shows its OAuth app as unconfigured.
- The user reported creating a production owner, but the subsequent targeted check
  still returned `owner_account_confirmed=false` and `trusted_owner_exists=false`
  in production. The active browser was the development Kitchen. Treat production
  owner acceptance as unverified; do not infer it from development access.
- Automatic approval review rejected opening the production Auth users page to
  avoid exposing unrelated accounts. Creation was handed to the human privately;
  subsequent checks are restricted to the nominated owner account.

Production ordering and payments remain paused. Enabling Google does not enable
restaurant fulfillment or grant administrator membership to customers.
