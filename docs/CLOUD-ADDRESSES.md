# Cloud saved addresses

Status recorded on **22 October 2026**. Migration `20261021141254_shared_customer_addresses` is applied to the development Supabase project and `hpa-commerce` **version 3 is ACTIVE**. The address-book UI and checkout integration are live in application release [`47f45b2`](https://github.com/Satya2n/hotpizzaace/commit/47f45b28ee785ab75daa7494fc463dae3e4875d0), after successful [CI run 39826189244](https://github.com/Satya2n/hotpizzaace/actions/runs/39826189244). Render deployment `dep-dbd4qhek1f9s738mcb50` became live on 22 October at 17:54:41 UTC.

## Ownership and storage

Signed-in customers manage their own book through same-origin `/api/commerce/addresses`, forwarded by Next.js to the Edge Function. The Edge independently verifies a nonanonymous Auth user and derives ownership from that user's ID. Contact phone numbers remain editable delivery details. Guest cookies, client-supplied owner fields and administrator membership cannot grant access to another account's book.

`hpa_address_books` stores one bounded JSONB book and revision per Auth user, with a cascading ownership foreign key. Browser roles have no table or RPC grants, and RLS denies their direct access. The service-role-only `SECURITY INVOKER` RPCs are `hpa_get_address_book` and `hpa_replace_address_book`; privileged credentials stay inside the Edge Function. A missing book reads as revision `0` with an empty list without creating a row.

The cloud book is authoritative. The UI keeps fetched books in memory; unsent checkout drafts remain tab/origin/account-scoped session storage. Browser-local demo addresses remain separate and are never automatically imported. Editing or deleting a saved address does not rewrite an existing order's customer/address snapshot.

## Rules and API

- At most **10** addresses per account; strict UUID, text, Indian contact-number and six-digit PIN validation applies. Saving an address does not establish branch delivery coverage; checkout checks current service rules.
- A nonempty book has exactly one default. The first address becomes default automatically. Explicitly promoting another replaces the previous default; unchecking the existing default preserves it. Deleting the default promotes the earliest remaining address.
- Canonical duplicates compare recipient name, normalized phone, street address, locality, PIN and landmark. Case, Unicode compatibility forms, commas and whitespace are normalized; labels and instructions do not distinguish a destination.
- Every accepted mutation increments the book revision. The transaction locks only that account's row and compares the expected revision; concurrent first writes also serialize safely. Stale edits are rejected instead of overwriting another session.

GET returns `{ revision, addresses }`. POST accepts exactly one mutation:

```text
{ action: 'create' | 'update', expectedRevision, address: { id, label, customer, isDefault } }
{ action: 'remove' | 'default', expectedRevision, id }
```

Create IDs are generated once by the client with `crypto.randomUUID()`. Clients do not automatically retry writes after a conflict or an uncertain response: refresh the book and review it first. The API returns finite codes including `auth_required`, `address_invalid`, `address_duplicate`, `address_limit`, `address_conflict`, `address_not_found`, `address_revision_conflict`, `address_unavailable` and `rate_limited`. Private responses are uncached. No user ID or account phone is accepted in a mutation.

## Verification and release boundary

The combined implementation passed **292 automated tests**, lint, an isolated production build and TypeScript checking. Domain and actual Edge/SDK transport tests cover ownership, malformed input, duplicates, defaults, revision conflicts and finite errors. PostgreSQL rollback tests verified null handling, duplicate/default constraints, CAS, removal, grants and RLS. Browser Google-owner sign-in and creation of fictional addresses passed. An isolated production preview then verified editing, changing the default, and a two-tab stale-edit warning that preserved the draft and required explicit review before saving. Checkout filled the default address, allowed a different saved selection and editable delivery phone, retained typed edits after cart navigation, and explicitly updated a saved address. Pickup showed no address fields or save controls. These checks placed no order and collected no payment.

The same Supabase address book was read from independent local application origins (ports 3001 and 3017) and the live Render site. Anonymous access and direct publishable-key denial checks passed all **11** probes both locally and on Render. Its effective `strict-origin` referrer policy withholds private paths. All **52 live authentication smoke checks** passed; live health returned HTTP 200 with database and commerce connected and payments in simulation. Cleanup removed exactly the two fictional QA addresses, preserved the account and unrelated data, and left an empty book at revision 9; the live UI was checked after cleanup. Actual mobile-device acceptance remains pending; no 390px cloud-address layout acceptance is claimed. These checks do not establish production readiness, Storage uploads, real payments or notifications.

The security advisor reported no address-schema finding. It does report the existing Auth warning **`auth_leaked_password_protection`**; follow [Supabase's password-strength and leaked-password protection guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). This is not a claim of zero advisor findings.
