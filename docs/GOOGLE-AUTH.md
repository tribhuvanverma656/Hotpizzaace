# Customer and owner Google sign-in

## Current production check — 25 October 2026

A direct sign-in from `hotpizzaace.com` reaches Google but fails with **Error 400:
`redirect_uri_mismatch`**. It uses client
`222836889070-lc192bcumhtrj86de4cn2nr67l98o5fq.apps.googleusercontent.com` and requests
`https://vzehsdwwaybcxvzodqaq.supabase.co/auth/v1/callback`. The separate production
project `oceanic-airway-512502-h4` still displays **Google Auth Platform not configured yet**.
Do not add production to the development client as a shortcut. Finish the production
OAuth app/client and save its own credentials privately in production Supabase.

The nominated production owner invite exists, but no confirmed `hotpizzaace@gmail.com`
production Auth account or trusted membership was found. Selecting the Google account
on Google's error page does not create that user. A development password is not copied
to production. The private Google Cloud sign-in handoff was prepared in Chrome profile
**Satyadev**; the last inspected handoff was expired, so a different signed-in browser
does not yet establish access in the controlled session. No password, token or client
secret was read or changed during this diagnosis.

Google sign-in uses Supabase Auth with server-managed PKCE, verified sessions, and customer/admin Google buttons. The Google client secret belongs only in the Supabase Google provider, never in application source or public environment variables. Connected administrator operations require a verified identity and trusted database membership; Google authentication alone does not grant staff access. Browser-local demo credentials cannot authorize shared commerce.

## Configure the development provider

Use the owner's Google Cloud project for Hot Pizza Ace. A Google Cloud project/client creation was attempted in the in-app browser, but resource-loading errors prevented verification there; do not assume a project ID based on those attempts. The owner subsequently confirmed creating the OAuth client manually.

1. Configure Google Auth Platform branding/audience. Use External for consumer accounts; when the OAuth app is in Testing, add the intended testers. Request only the basic identity/profile/email scopes used by Supabase.
2. Create an OAuth **Web application** client. Add `https://hotpizzaace-development.onrender.com` and, for local development, `http://localhost:3001` as separate JavaScript origin entries without paths/trailing slashes.
3. Set the authorized Google redirect URI to `https://kaypgsstngguvrpftpwo.supabase.co/auth/v1/callback`.
4. In Supabase project **hotpizzaaceDB**, reference **kaypgsstngguvrpftpwo**, enable the Google provider and save the Client ID and Client secret there. Do not paste secrets into chat, environment templates, GitHub, or Render. Leave nonce checks enabled.
5. Set Supabase Auth Site URL to `https://hotpizzaace-development.onrender.com`. Allow the app callbacks `https://hotpizzaace-development.onrender.com/auth/callback**` and `http://localhost:3001/auth/callback**` during development. The suffix accommodates allowlisted `next` and PKCE flow-ID parameters. Google returns to Supabase first; Supabase returns to the app callback. These settings were saved and the hosted owner return was verified on 20 October 2026. The previous `localhost:3000` Site URL and empty redirect list caused successful authentication to return to the wrong origin.

Source: [Supabase Google provider guide](https://supabase.com/docs/guides/auth/social-login/auth-google).

## Separate production setup — 23 October 2026

The public domain [hotpizzaace.com](https://hotpizzaace.com) has its own Supabase project, `vzehsdwwaybcxvzodqaq`. A separate free Google Cloud project, **HotPizzaAceProduction** (`oceanic-airway-512502-h4`), was created for production. The owner-approved **OAuth Config Editor** IAM grant to `hotpizzaace@gmail.com` was saved; the OAuth app, Web client and production provider credentials remain unconfigured. Google requires separate testing and production projects; do not add development or localhost origins to this production project or reuse the development client.

Production Google sign-in remains disabled until the owner finishes the private OAuth client setup. The public business/grievance disclosures and Google/security frontend changes are in **PR #5, head `7e053cf`**, merged as `2a09b4e` after both exact-source GitHub checks passed, including build/TypeScript; 314 local tests and lint passed. Render deployment `dep-dbdf776k1f9s73f67png` is **live**; the public pages, headers, health and anonymous access-denial checks passed. Production Edge version 2 and development Edge version 4 are already ACTIVE from a separate backend deployment.

Use these production settings:

- Home page: `https://hotpizzaace.com`
- Privacy policy: `https://hotpizzaace.com/privacy-policy`
- Terms: `https://hotpizzaace.com/terms-and-conditions`
- App name: **Hot Pizza Ace**; support contact: **hotpizzaace@gmail.com**.
- Authorized origin: `https://hotpizzaace.com`.
- Google Web application callback: `https://vzehsdwwaybcxvzodqaq.supabase.co/auth/v1/callback`.
- Scopes: only `openid email profile`; no Gmail, Drive, Contacts or offline API access.

Use an external audience for customer Google Accounts, verify the owned domain as required by Google, and review production branding/audience before public sign-in. Do not declare a Google approval or verification that has not occurred. The owner must enter and save the new Client ID/secret privately in the production Supabase Google provider; leave **Skip nonce checks** and **Allow users without an email** disabled. No secret belongs in chat, Git or Render.

The owner-confirmed source disclosures identify HOT PIZZA ACE, GSTIN `09ANCPV1491R1Z3`, Barra FSSAI `12721045000614` and its public business address. The confirmed customer grievance contact is Ashish Verma, `tradersverma01@gmail.com`, `+91 70815 55055`; this is distinct from the Google support/admin email. No independent licence-validity verification is implied.

Development users/passwords were not copied. Final human production acceptance remains pending: verify a fresh production owner sign-in and trusted dashboard access after configuring the provider; a successful development login is separate evidence. Use an ordinary supported browser for Google consent, not an embedded user-agent under the application's control. Sources: [Google production policy checklist](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance), [OAuth policies](https://developers.google.com/identity/protocols/oauth2/policies) and [user-data policy](https://developers.google.com/terms/api-services-user-data-policy).

## Application behavior and identity boundary

- `/account/login` presents **Continue with Google** as the primary action. Phone/code demo sign-in is available only in the browser-local prototype. `/admin/login` offers exactly the readonly owner ID **hotpizzaace@gmail.com** with a blank password field, and Google using the same authorized account. Signup, forgot-password and email-setup controls are removed; the sign-in server enforces the fixed ID and rejects signup/reset actions.
- **Restaurant settings → Owner password** allows private password creation/change after a fresh Google owner sign-in and trusted membership checks. **Confirm identity with Google** returns to `/admin/settings`. A password-only or stale OAuth session cannot authorize the change. Private password creation, fixed-ID/password sign-in and dashboard reload passed acceptance on 21 October; SMTP is not required. Email recovery is deferred; see [Admin access](ADMIN-ACCESS.md).
- POST `/api/auth/google` requires the website's exact Origin, checks provider readiness, and uses PKCE. GET cannot start login. Missing/disabled provider settings show a readable retry/setup message; they never create a fake authenticated account.
- `/auth/callback` exchanges the code, verifies the user with Supabase, and redirects only to exact destinations in `lib/auth/google.ts`. Unknown, external and encoded destinations fall back to the customer profile. An admin destination is navigation only: trusted membership is checked independently. The legacy `/auth/reset-password` destination retains strict recovery checks, but the deferred email-recovery/update endpoints fail closed. Raw provider errors and codes are not reflected in application error redirects.
- `/api/auth/session` returns only verified display identity, with private/no-store responses. No access/refresh token or role is returned. Next.js Proxy refreshes session cookies on account/checkout/auth paths except the exact `/auth/callback`, which exchanges the code before verifying the new identity itself. The server verifies identity again independently of UI state.
- Hosted callback origins use `APP_BASE_URL`, or Render's trusted `RENDER_EXTERNAL_URL`. Local development supports exact loopback hosts/ports, including Next's wildcard listener normalization; arbitrary Host/forwarded headers cannot choose a hosted redirect target. Cookies are Secure when the configured canonical origin uses HTTPS.
- Sign-out is POST-only, requires the same Origin, and supports the account UI's JSON request. Refreshed account state cannot restore an older session response after sign-out.
- Google identity never adopts a phone-only demo account. A verified Google session clears demo phone sign-in. Connected orders, address books and admin operations use verified account IDs and server-side ownership/membership; editable contact phones never establish ownership. Cloud address books and checkout autofill are live in development with completed browser acceptance recorded in [cloud addresses](CLOUD-ADDRESSES.md). Social display metadata is never used for permissions.

## Verification

Development release `47f45b2` passed **292 automated tests**, an isolated production build, TypeScript, formatting and lint. **52 live authentication smoke checks and 11 live address smoke checks passed**, including private anonymous sessions, GET mutation rejection, origin protections, document referrer policies, callback failures/safe destinations, fixed-ID sign-in, absent email-setup controls, retired email endpoint rejection, anonymous owner-password denial and provider readiness. Those automated checks do not enter or save a real owner password; the separate human password creation/sign-in/dashboard reload acceptance passed on 21 October. See [Admin access](ADMIN-ACCESS.md) and the dated [owner acceptance evidence](OWNER-ACCEPTANCE.md).

```sh
AUTH_SMOKE_BASE_URL=http://localhost:3001 node scripts/auth-smoke.mjs
```

For the hosted development service, use `https://hotpizzaace-development.onrender.com` as the base. The script never follows external OAuth redirects, completes consent, or creates a user. With Google enabled it checks the Supabase authorization URL, callback destination, PKCE verifier and HTTPS Secure/SameSite cookies. A disabled provider's graceful error path is distinct from successful Google OAuth.

The nominated owner `hotpizzaace@gmail.com` completed Google verification. Supabase confirms a verified Auth identity and trusted owner membership. A fresh hosted sign-in opened the actual dashboard, retained access after reload, and authorized updates to a separate guest's fictional pickup order. Customer tracking reflected those updates and retained the final state after reload. That 20 October browser journey did not cover interactive sign-out/replay or owner password sign-in. On 21 October, fresh Google access authorized private password setup; scoped checks then confirmed a configured password and a password-authenticated session, and the dashboard retained access after full reload. The human performed credential entry and submission; the agent did not inspect password field values or database password hashes. See [owner acceptance](OWNER-ACCEPTANCE.md). Email recovery remains deferred.

## Native form origin fix — 20 October 2026

A global `Referrer-Policy: no-referrer` caused browser-native authentication forms to submit an opaque `Origin: null`, which the server correctly rejected. Earlier HTTP smoke requests supplied Origin manually and missed this browser behavior. Auth documents now use `strict-origin`, including the password-recovery page metadata. This preserves the origin needed for native form CSRF validation while omitting paths, query strings and private tracking tokens from referrers. Private JSON/API and callback responses retain `no-referrer`; origin validation remains strict and null/foreign origins remain rejected.

At that release, 173 automated tests, lint, TypeScript and an isolated production build passed. The human completed the Google account's password and two-step verification privately; the agent selected the existing verified account during the subsequent routine sign-in. The hosted Google owner journey then passed after correcting Supabase's return URL configuration. The website's separate owner password acceptance is now tracked in [Admin access](ADMIN-ACCESS.md); the earlier email approach is [historical recovery QA](PASSWORD-RECOVERY-QA.md). See [MDN's Origin behavior documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy#effect_on_the_origin_header).
