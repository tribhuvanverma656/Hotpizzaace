# Security review

## Current state — 4 November 2026

Owner-approved [PR #20](https://github.com/Satya2n/hotpizzaace/pull/20) is live at
merge `38b7a5c395baf9888cc191674f6a750439e9b132`. Its compatible billing migration,
commerce v14 and Render deployment `dep-dbl22h59el5s73f7h1ag` are released. All 573
candidate tests and required checks passed; production quote-only acceptance and
before/after financial-document digests confirmed nearest-rupee behavior without
repricing old bills. Private RPC grants remained closed and RLS remained enabled.
This billing release does not resolve the separate guest-browser finding below.

### Customer privacy candidate — 4 November 2026

The 3 November customer-security review confirmed signed-in account ownership and
private-table/RPC isolation, with 46 focused tests passing. It also identified that
the persistent guest cookie could retain access to unclaimed guest orders after
another customer signed in on the same browser. Possessing a secret tracking link
is a separate, intentional read capability and must not be confused with account
ownership. No customer records or credentials were retrieved for that review.

The current source candidate limits signed-in customer order lists and individual
order reads to the verified account owner and denies signed-in guest-cookie access.
QR request/contact capabilities are additionally partitioned by the server-verified
account ID, so a retained cookie cannot expose another account's QR request.
Guest cookies are rotated at authentication boundaries; a browser context value
supports client cache invalidation but is not a bearer credential or an ownership
grant. Browser checkout/QR drafts and private receipt caches bind to this verified
context. Explicit sign-out and cross-tab identity boundaries clear or mask stale
private state. Ordinary same-context focus checks stay quiet so they do not close
an active hosted payment popup; a changed context or verification failure still
invalidates the previous display. All **591 tests**, lint, TypeScript and the
production build pass locally, including actual callback/password/sign-out route
checks, two-customer Edge ownership checks and browser-state regression fixtures. This
candidate has **not been released to production**, and no completed two-account
production browser acceptance or comprehensive no-leak guarantee is claimed.

The isolated chef release and its dated acceptance evidence follow below.

### Earlier chef release — 3 November 2026

Owner-approved [PR #18](https://github.com/Satya2n/hotpizzaace/pull/18) is live at
merge `1973014eb741b4e575e8af9e1f4a0d861296dc8e`, retaining PR #19's product-saving
feedback. Render deployment `dep-dbkmipks728c738ru1g0` finished live at 04:59:50 UTC
on 3 November. Main CI #123 and aligned staging CI #124 passed on that merge.
Production now includes isolated chef access, the Ready/invoice correction,
historical order-detail revalidation, the admin sign-in availability fix and the
oversized thermal receipt guard. Earlier development verification remains dated
evidence, not a claim of fresh production acceptance for every flow.

Both production Kitchen migrations are applied and dedicated `hpa-kitchen` v1 is
active with the same bundle as development. The chef feature was enabled after
the approved frontend became live. Before/after checks preserved catalog revision
157, five orders and five invoices. Production has zero chef accounts, Kitchen
registrations or chef Admin memberships; private RPC client-grant violations are
zero and all four chef tables have RLS enabled. The separate Username/Password
login and owner's empty staff list render. Private production chef provisioning
and login have not occurred. No development credentials or orders were copied.

Development's actual initial chef login, Confirmed → Preparing → Ready and
owner-disable/session-revocation checks passed on 2 November with invoice/payment
records preserved. Fresh login after reactivation remains independently unverified;
the overlapping race attempt was inconclusive and exact fixture cleanup returned
zero across all 13 groups. This is not a concurrency pass. See
[Kitchen staff access](KITCHEN-STAFF-ACCESS.md) for the scoped evidence.

The released sign-in fix keeps fresh login available while background checks are
slow, preserving submission locks, safe return paths, verified-owner redirects and
server authorization. Historical-order reads reject stale responses and terminal
access/removal failures without restoring a cached bill. Their focused regressions
and the earlier complete 556-test/lint/TypeScript/build record are preserved in
[project status](PROJECT-STATUS.md); no tests were rerun for this documentation update.

The earlier Google provider setup blocker is resolved. The owner reported a
password-save problem on 2 November and deferred investigation; earlier successful
owner access does not resolve that report. Production chef password creation and
entry remain private owner actions. Barra counter/QR is enabled; website checkout,
COD and live online payments remain off. Development and production use separate
Supabase projects. Physical 58 mm printer acceptance was **deferred by the owner
on 4 November** and is excluded from the current work. No hardware pass is claimed.
Nearest-rupee rounding is released as recorded above; customer privacy changes
remain a separate candidate.

The 1 November production Supabase advisor reports leaked-password protection
**disabled**, rather than the earlier development-only warning. No billing or plan
change was made. This operational Auth setting remains open.

### Dependency audit

Both read-only audits completed against the npm registry on 1 November:

| Audit                               | Low | Moderate | High | Critical | Total |
| ----------------------------------- | --- | -------- | ---- | -------- | ----- |
| Production (`npm audit --omit=dev`) | 0   | 0        | 0    | 0        | 0     |
| Full dependency tree                | 0   | 16       | 0    | 0        | 16    |

There were also zero informational findings. The 16 moderate affected-package
entries derive from one [maintainer minimatch advisory, GHSA-g3hv-75wg-m249](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249).
The installed development-only copies are 3.1.5 and 10.2.6, through ESLint 9.39.5,
`eslint-config-next` 16.4.2 and the TypeScript-ESLint 8.71.2 toolchain. The maintainer
describes attacker-supplied pattern amplification with `optimizationLevel >= 2`
and identifies 11.0.1 as patched. The current installed `braces` 3.0.3 is not a
reported finding; the older braces result below is historical.

No application or Edge import of minimatch or customer-controlled glob input was
found in this source review. Lint runs committed configuration/fixed patterns in
CI and the Render build. That constrained input and the production-dependency
audit gate are the current mitigation; this is not a claim that development tools
are vulnerability-free. Follow up with a compatible upstream lint-toolchain update.
Do not force npm's proposed ESLint/config downgrades or a global major minimatch
override. No install, package change or immediate application-code correction was
justified by this audit.

### Compatible-toolchain follow-up — 2 November 2026

A read-only check of current upstream npm metadata found no compatible fix for
the documented minimatch advisory. This was a version/constraint check, not a new
dependency audit; the counts above remain the 1 November results.

[ESLint 9.39.5](https://registry.npmjs.org/eslint/9.39.5) remains the latest 9.x
release and requires minimatch `^3.1.5`.
[`eslint-config-next` 16.4.3](https://registry.npmjs.org/eslint-config-next/16.4.3)
still uses the same React/import/accessibility plugin branches and TypeScript-ESLint
`^8.56.0`. Current
[`@typescript-eslint/typescript-estree` 8.72.1](https://registry.npmjs.org/@typescript-eslint%2ftypescript-estree/8.72.1)
still requires minimatch `^10.2.2`; its Node requirement is
`^18.18.0 || ^20.9.0 || >=21.1.0`, with TypeScript `>=4.8.4 <6.1.0`.
The compatible minimatch 3.x/10.x releases remain 3.1.5/10.2.6. The maintainer's
patched line starts at 11.0.1; current
[minimatch 11.0.4](https://registry.npmjs.org/minimatch/11.0.4) requires Node
`20 || >=22` and falls outside those dependency ranges.

Moving to [ESLint 10.14.0](https://registry.npmjs.org/eslint/10.14.0) would not
resolve this: it still requires minimatch `^10.2.6` and raises Node requirements to
`^20.19.0 || ^22.13.0 || >=24`. Current
[`eslint-plugin-react` 7.37.5](https://registry.npmjs.org/eslint-plugin-react/7.37.5),
[`eslint-plugin-import` 2.32.0](https://registry.npmjs.org/eslint-plugin-import/2.32.0)
and [`eslint-plugin-jsx-a11y` 6.10.2](https://registry.npmjs.org/eslint-plugin-jsx-a11y/6.10.2)
do not declare ESLint 10 peer compatibility. Retain the constrained-input mitigation
and track upstream adoption of the patched minimatch major. No packages, lockfile,
overrides or application code were changed by this follow-up.

### Payment and remaining acceptance — 3 November 2026

Automatic capture with a 12-minute window and Enabled Live webhook
`Tuou26v8Zs5eMS` with the production URL and all seven payment/refund events were
verified. Production still has the exposed Live key ID and only ID/MODE/ENABLED
saved; KEY_SECRET and WEBHOOK_SECRET are absent. The private API-pair form is
prepared, not submitted. Replace the disclosed credential before activation.
Matching-secret/signed-delivery and real payment/refund/settlement acceptance remain
unverified; online payments stay off. See [payment readiness](RAZORPAY-PAYMENTS.md)
for this dated snapshot and the remaining private steps.

## Historical record — 24 October 2026

The remaining sections preserve the earlier review. Their references to current
releases, disabled Google, pending owner access and a development-only Auth warning
are statements from that dated review, superseded by the current section above.
Older audit/test/secret-scan results are not fresh acceptance or certification.

This is a scoped source, configuration and regression-test review. It is not a penetration-test certification, a guarantee that no vulnerability exists, or Google verification/approval.

## Counter, table QR and report source review — 24 October candidate

The current counter/QR/report source candidate is separate from the historical live
release evidence below. This section does not claim production rollout or fresh
owner/browser acceptance. Initial counter/table-management/report routes require the
verified owner and trusted membership; no additional manager or kitchen account was
nominated. Branch/table bindings, staff author and environment are server-authored.
Counter ordering defaults off per branch. Normal customer checkout rejects dine-in
and manual payment fields.

Table QR tokens authorize only a guest proposal/status boundary, not staff access,
a private bill or kitchen acceptance. Requests remain pending until an authorized
owner confirms receipt of cash/direct merchant UPI or records an explicit pay-later
exception. Tokens can be rotated/disabled, pending requests expire, and acceptance
rechecks current menu/prices. A QR is shareable and does not prove physical presence
or payment; staff review is an operational requirement.

The reporting RPC is read-only, service-role-only and SECURITY INVOKER with an empty
search path and an independent owner-membership check. It uses one STABLE database
snapshot for a branch's relevant placement/completion/receipt times. It rejects
ranges beyond 31 IST days, more than 10,000 orders and oversized payloads. The service
rejects incomplete, duplicate, cross-branch and malformed data instead of showing
partial financial totals. Export removes customer PII, staff IDs and UPI references,
escapes spreadsheet formulas and preserves source records. CSV download is not
automatic deletion, retention cleanup or a full database backup.

Development SQL validation ran in BEGIN/ROLLBACK and confirmed service-role/owner
access, public RPC denial, IST offset comparisons, three date clocks, projection
privacy, 1,004-row completeness and >10,000 refusal. The function and all fictional
records were confirmed rolled back afterward; no report migration was persistently
applied by that check. The development security advisor remained unchanged, with
only its pre-existing leaked-password-protection warning. Focused analytics/service
regressions cover payment provenance, test separation, prepaid/pay-later, dates,
GST reconciliation, cancellation/review and CSV defenses. Full release checks and
actual browser acceptance must be recorded separately.

See [the counter framework](DINE-IN-COUNTER-FRAMEWORK.md) for remaining rollout and
operational limits. No automatic merchant-bank verification, split payments, refund
transfer or daily-closing ledger is claimed.

## Scope and production boundary

The review covered the original `38745bef` release and the security/business release now live as `2a09b4e`: administrator authorization, customer/order/address isolation, CSRF and origin checks, OAuth/PKCE callbacks, redirects, input/body limits, error redaction, rate-limit storage, dependencies and targeted secret patterns.

[hotpizzaace.com](https://hotpizzaace.com) serves over HTTPS; www redirects to the apex. Anonymous production checks returned: auth session 200 without a user, commerce session 200 without a user/admin, saved addresses 401 and admin snapshot 403. Private responses used no-store caching and exposed no protected records. These checks did not create orders, change customer data or sign in as a production owner. Orders and payments remain disabled.

The separate production Supabase project is `vzehsdwwaybcxvzodqaq`; development is `kaypgsstngguvrpftpwo`. Development owner acceptance does not establish production owner access. No fresh authorized production-user or owner acceptance has been completed.

## Confirmed findings and fixes in source

| Finding                                                                        | Source change                                                                                                                                                                                                           | Verification                                                                                                                                                                            |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unauthenticated Google initiation parsed an unbounded form body.               | The route now accepts only one `next` field in an 8 KB URL-encoded form using the existing streaming body limit. Multipart, duplicate/extra fields, invalid UTF-8 and oversized bodies fail before provider/Auth calls. | Actual-route tests include chunked overflow and reader cancellation, valid customer/admin flows and invalid origins.                                                                    |
| Caller-selected guest nonces could create unlimited permanent rate-limit keys. | Guest rate-limit keys now use 4,096 SHA-256 buckets per operation. Full hashes remain in ownership checks and idempotency scopes.                                                                                       | Actual Edge-handler tests rotate 4,097 nonces, verify the bounded key namespace and deliberately collide buckets: another guest still receives 404 and checkout scopes remain separate. |

Both findings were assessed as availability risks, not authorization bypasses. The Google form fix remains in frontend PR #5, head `7e053cf`, merged as `2a09b4e` after both GitHub checks passed; Render deployment `dep-dbdf776k1f9s73f67png` is **live**, confirmed at `2026-10-23T05:43:37Z`. The bounded guest-rate-key fix has been deployed separately: production Edge **version 2 is ACTIVE**, and development **version 4 is ACTIVE**. Buckets bound future anonymous rate-key growth; a bot can still rotate nonces to evade individual throttles. Existing stale rows are not removed by this change. Trusted ingress/bot protection and rate-row cleanup remain open.

## Authorization and database results

Verified-identity checks and trusted user-ID membership protect connected admin operations; editable profile metadata does not grant a role. Actual-handler tests rejected forged tokens, unauthorized admin reads/mutations, another customer's order access and payment mutation through a tracking-only capability. Saved-address tests derive ownership from the verified account, including for administrators. Tracking tokens grant the documented read capability only. Redirect destinations remain allowlisted and hosted origins come from deployment configuration.

The live release applies HttpOnly, SameSite=Lax session cookies and Secure cookies on hosted HTTPS origins. Tests using the real Supabase SDK completed browser-bound PKCE exchange and subsequent verified requests with these settings. The header baseline adds MIME-sniffing and framing protection, disables unused browser capabilities and suppresses the powered-by header. Its CSP restricts objects, base URLs and embedding; it does **not** include a strict script policy and must not be described as full XSS protection.

The production Supabase security advisor reported no findings at this review. Its nine public application tables have RLS enabled with direct client access denied. Private application RPCs deny `anon`/`authenticated` execution; the public health-check RPC is the deliberate exception. Privileged keys remain server-side. The pre-existing leaked-password-protection warning belongs to development only; see [Supabase password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Tests and package/secret scans

- **314/314 automated tests and full ESLint passed** independently on PR #5 head `7e053cf`, including cookie and real-SDK PKCE coverage. Both exact-source GitHub checks passed, including production build and TypeScript: [push](https://github.com/Satya2n/hotpizzaace/actions/runs/39906919602/job/120260887230), [PR](https://github.com/Satya2n/hotpizzaace/actions/runs/39906925299/job/120260905764). PR #5 merged as `2a09b4e66581a8489a65081ab5d25b9cd0397281`; Render deployment `dep-dbdf776k1f9s73f67png` is **live**, finished at `2026-10-23T05:43:37Z`. Earlier security-candidate evidence is in `/private/tmp/hpa-security-final-*.log`. Nine production GET probes passed: public disclosures, baseline headers, production health with payments disabled, session responses and anonymous address/admin denial. No customer records or payments were created.
- Production dependencies reported **zero npm audit findings**, and CI now includes a production-dependency audit gate. The full development dependency tree retains one unresolved [`braces` advisory, GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), reported across five affected dependency entries. No forced downgrade was applied. Review the upstream fix before upgrading build/lint dependencies.
- A targeted secret-pattern scan covered **340 tracked files and 424 reachable historical text blobs of at most 2 MB**, with **zero matches** for the selected credential patterns. This is not proof that every possible secret or prior exposure has been excluded.

## Google policy and sign-in

The OAuth route explicitly requests only `openid email profile`; tests assert the complete options, with no offline access or extra Google API permission. Cancelled or denied consent fails without exchanging a code or reflecting private provider diagnostics. Supabase's [Google setup guide](https://supabase.com/docs/guides/auth/social-sign-in/auth-google) identifies these basic identity scopes and warns that additional sensitive/restricted scopes can require further verification.

Privacy/terms disclosures, Google button branding, response headers, HttpOnly-cookie hardening and owner-confirmed public business/grievance disclosures are completed in frontend source. PR #5 passed both GitHub checks and merged as `2a09b4e`; Render deployment `dep-dbdf776k1f9s73f67png` is **live**; the public pages, headers, health and anonymous access-denial checks passed. The production Google provider is still disabled. The separate free **HotPizzaAceProduction** project (`oceanic-airway-512502-h4`) exists, and the owner-approved **OAuth Config Editor** IAM grant to `hotpizzaace@gmail.com` was saved. Its OAuth app, Web client and private provider credentials are still not configured. Finish the production callback/origin, consent-screen identity, public policy URLs and applicable audience/publishing verification. Client secrets must be entered privately; development credentials should remain separate. Application changes do not establish that Google has reviewed or approved the app.

Reference requirements: [Google OAuth policies](https://developers.google.com/identity/protocols/oauth2/policies), [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy) and [Sign in with Google branding guidelines](https://developers.google.com/identity/branding-guidelines).

## Open operational work

- Complete private production Google setup and fresh owner/customer sign-in, password and access-isolation acceptance.
- Configure trusted ingress/bot-abuse controls; rotate any credential with a known exposure and retain private credential handling. Add TTL/cleanup for existing rate-limit rows.
- Public business/GSTIN/Barra FSSAI/address and Ashish Verma's grievance contact are owner-confirmed and published on the live website; independent licence-validity verification is not claimed. Agree data-retention/deletion handling and verify owner/admin operational access before enabling orders.
- Configure monitoring/alerts, backups, a restore test and a rollback process. Review repository collaborators and release protection.

Keep production ordering, COD and online payments disabled until the separate launch acceptance is complete. Release evidence is recorded above; a fresh production owner session is still pending.

## Hosted build environment regression

PR #4 passed both GitHub checks, but its first Render deployment failed before application build: two OAuth tests inherited the real production canonical origin while submitting localhost fixture requests. The strict origin guard correctly returned 403. Test fixtures now pin and restore their own canonical origin for every test; application origin checks are unchanged. All **312 tests passed with production `APP_BASE_URL` and `RENDER_EXTERNAL_URL` inherited**, and CI now supplies those public origin settings during regression testing to catch this mismatch before release. The prior production website remained live while the failed release was corrected.
