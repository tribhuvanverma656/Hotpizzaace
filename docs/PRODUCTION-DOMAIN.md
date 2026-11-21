# hotpizzaace.com production setup

Status recorded on **23 October 2026**. The production domain, DNS and HTTPS setup are complete. The owner-approved release is live at [hotpizzaace.com](https://hotpizzaace.com), with a separate production database. This is a prelaunch website: live restaurant ordering and payments remain disabled.

## Completed destinations and isolation

- Domain registrar and DNS: GoDaddy, using `ns27.domaincontrol.com` and `ns28.domaincontrol.com`. The earlier SERVFAIL/lame-delegation issue with the previous nameservers is resolved. The owner confirmed no `@hotpizzaace.com` email is in use; no domain-email service was added.
- Production Render service: `hotpizzaace`, ID `srv-dbacevmq1p3s73b5983g`, in the confirmed **My Workspace**, source branch `main`, free instance in Oregon, service hostname `hotpizzaace-eqcy.onrender.com`. Both `hotpizzaace.com` and `www.hotpizzaace.com` show **Verified** and **Certificate Issued** in Render. The HTTPS apex returns 200, and www redirects to the apex, which returns 200.
- Separate Supabase project: `hotpizzaace-production`, ID `vzehsdwwaybcxvzodqaq`, Mumbai region, in the owner's confirmed free organization. The five existing migrations are installed and `hpa-commerce` **version 2 is ACTIVE**, after the separate bounded-rate-key Edge deployment. Development independently runs **version 4, ACTIVE**; this backend deployment does not establish that a frontend release is live. Only the public catalog was copied: 111 products, 14 categories and one Barra branch. No Auth users, orders or address books were copied.
- Production commerce state is `mode=production`, `allow_simulated_payments=false`; Barra is paused and its payment-method list is empty. Direct Edge/database checks verified readiness, catalog counts, disabled ordering/payments and anonymous address/admin denial. The security advisor reported no findings for this new project at this check.
- Production Supabase Auth Site URL is `https://hotpizzaace.com`; its only app redirect entry is `https://hotpizzaace.com/auth/callback**`, accommodating the application's allowlisted next/PKCE query parameters. Development and localhost callback entries were not added to production.

## Applied DNS records

The following website records are configured in GoDaddy:

| Type  | Name  | Value                           | TTL         |
| ----- | ----- | ------------------------------- | ----------- |
| A     | `@`   | `216.24.57.1`                   | 600 seconds |
| CNAME | `www` | `hotpizzaace-eqcy.onrender.com` | 1 hour      |

Preserve unrelated verification and service records during future changes. Domain verification, valid HTTPS and the www-to-apex redirect have been checked. Sources: [Render custom domains](https://render.com/docs/custom-domains) and [DNS provider configuration](https://render.com/docs/configure-other-dns).

## Live application release and verification

The owner approved [release PR #3](https://github.com/Satya2n/hotpizzaace/pull/3), merged to `main` as [38745bef](https://github.com/Satya2n/hotpizzaace/commit/38745bef9c151f7f8e84dd840cc4f6cfa72126ca). Exact Render deployment `dep-dbda8vcp5sqc73fu99k0` reports **live**, finished at `2026-10-23T00:07:26Z`. The deployment event also reports success. A stale dashboard build duration was not a running build failure; the subsequent runtime check returned no error-level application logs.

Canonical page redirects use the exact configured HTTPS `APP_BASE_URL` as the destination. Only the corresponding www alias and this service's exact Render hostname are redirected; arbitrary/forwarded hosts cannot choose a target. POSTs, APIs and assets are not redirected, and existing exact-origin mutation checks remain. Development without `APP_BASE_URL` is unchanged.

The production service is configured with `APP_BASE_URL=https://hotpizzaace.com`, the separate production project's public URL/publishable key and `COMMERCE_ENABLED=true`. No privileged database key was added to Render. An initial automatic approval review rejected activation under the earlier domain-only scope; the owner subsequently gave explicit approval for the configuration update and production release. That earlier approval blocker is resolved.

The PR #3 release passed **302 automated tests**, lint, formatting, an isolated production build and TypeScript. Production health now reports shared commerce in **production** mode, database and commerce connected, and **payments disabled**. Narrow anonymous GET checks passed on the final HTTPS domain:

| Endpoint                       | Status and result                          |
| ------------------------------ | ------------------------------------------ |
| `/api/auth/session`            | 200; configured, no user                   |
| `/api/commerce/session`        | 200; shared mode, no user or administrator |
| `/api/commerce/addresses`      | 401; sign-in required                      |
| `/api/commerce/admin/snapshot` | 403; access forbidden                      |

These responses were private/no-store and exposed no customer or administrator records. The checks did not start Google sign-in, send email or create records. They do not establish a successful production owner session or launch acceptance.

The security/business/grievance frontend release [PR #5](https://github.com/Satya2n/hotpizzaace/pull/5), head `7e053cf`, merged to `main` as [2a09b4e](https://github.com/Satya2n/hotpizzaace/commit/2a09b4e66581a8489a65081ab5d25b9cd0397281). Both exact-source GitHub checks passed, including the production build and TypeScript: [push check](https://github.com/Satya2n/hotpizzaace/actions/runs/39906919602/job/120260887230), [PR check](https://github.com/Satya2n/hotpizzaace/actions/runs/39906925299/job/120260905764). Independent local verification on this head passed **314/314 tests** and full lint. Render deployment `dep-dbdf776k1f9s73f67png` is **live**, finished at `2026-10-23T05:43:37Z`. The release includes policy/Google-branding updates, bounded forms, HttpOnly server cookies with real Supabase SDK round-trip tests, baseline security headers and confirmed public business/grievance disclosures. The separately deployed Edge rate-bucket fix is already active in production version 2 and development version 4. See the [security review](SECURITY-REVIEW.md). The 302-test result above belongs to the PR #3 frontend release.

The owner confirmed the public business name **HOT PIZZA ACE**, address **ME346, Near Ram Janki Mandir, Barra 2, Kanpur, Uttar Pradesh 208027**, GSTIN **09ANCPV1491R1Z3** and Barra FSSAI number **12721045000614**. The confirmed public customer grievance contact is **Ashish Verma**, **tradersverma01@gmail.com**, **+91 70815 55055**. These disclosures are published on the live website; this records owner-supplied details, not independent registration-validity verification.

## Remaining Google setup and launch readiness

The separate production Google Cloud project **HotPizzaAceProduction** (`oceanic-airway-512502-h4`) has been created. The owner-approved **OAuth Config Editor** IAM grant to `hotpizzaace@gmail.com` was saved. The OAuth app, Web client and provider credentials are still not configured; IAM access alone does not complete them. The production Supabase Google provider is still **disabled**. Development owner acceptance and passwords do not establish production access.

1. Continue OAuth setup in the existing **HotPizzaAceProduction** project and create its production OAuth Web application client. Do not create a duplicate project, reuse the development client or add localhost/development origins to the production client. Google's [production OAuth policy guide](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance) requires separate testing and production projects. The approved OAuth Config Editor handoff is complete; use that access to finish setup rather than creating another project.
2. Complete production branding and the appropriate audience using Hot Pizza Ace's public homepage, privacy policy, terms and confirmed support email. Complete the applicable domain/brand verification steps; no Google verification approval or overall compliance certification is claimed here. Request only basic identity/profile/email permissions.
3. Add `https://hotpizzaace.com` as the production JavaScript origin and `https://vzehsdwwaybcxvzodqaq.supabase.co/auth/v1/callback` as the authorized Google redirect URI. Enter the new client ID and secret privately in the production Supabase Google provider, then enable it. Do not put the secret in chat, Git or Render.
4. Complete fresh production owner sign-in, confirm trusted owner membership for the verified production user ID, and set the production owner password privately. No development users, sessions or passwords were copied. Verify account/address isolation, dashboard access and reload on the final HTTPS domain.
5. Both GitHub checks passed for PR #5 head `7e053cf`, including build/TypeScript; it merged as `2a09b4e`. Render deployment `dep-dbdf776k1f9s73f67png` is live on the exact merged revision and its public-page, header, health and anonymous authorization probes passed. Keep the 314-test evidence separate from PR #3 and production owner acceptance.
6. Keep the restaurant paused until payment integration, operational/business details, policies and owner launch acceptance are ready. Domain completion does not enable restaurant order acceptance or payments.
