# Render and Supabase development connection

Updated 22 October 2026. The connection foundation began on 18 October. The current application release is [47f45b2](https://github.com/Satya2n/hotpizzaace/commit/47f45b28ee785ab75daa7494fc463dae3e4875d0), deployed from `staging` to [hotpizzaace-development.onrender.com](https://hotpizzaace-development.onrender.com). The confirmed production domain is **hotpizzaace.com**, registered with GoDaddy; its DNS and production cutover remain pending. Hostinger remains a possible later migration target.

## Current boundary

- Render hosts the Next.js Node web service `hotpizzaace-development`, in `My Workspace`, Singapore, on the free development instance. Development changes use `staging`; approved production releases use `main`. See [the two-branch workflow](DEVELOPMENT-WORKFLOW.md).
- Supabase project `hotpizzaaceDB` (`kaypgsstngguvrpftpwo`) stores shared commerce records. The schema, saved-address migration `20261021141254` and `hpa-commerce` Edge Function version 3 are deployed. The database contains 111 products, 14 categories and the original Barra branch, paused with COD disabled. Owner-acceptance order fixtures were removed; see [OWNER-ACCEPTANCE.md](OWNER-ACCEPTANCE.md).
- With `COMMERCE_ENABLED=true`, same-origin Next.js routes and the Edge API handle checkout, tracking, admin orders, catalog and settings. Direct publishable/customer access to commerce tables and transaction RPCs is revoked, and RLS is enabled. The Edge Function independently verifies identity, ownership and trusted admin membership before using its privileged client.
- No privileged database key is needed in Render or browser configuration. The application's public project URL and publishable key support Auth and the connection probe; privileged database access is confined to the Supabase Edge Function.
- The owner `hotpizzaace@gmail.com` has a verified Auth identity and trusted membership. Live dashboard access and independent-browser order/status/reload acceptance are complete. See the [owner acceptance record](OWNER-ACCEPTANCE.md) for evidence and cleanup results. A demo password, contact phone or editable metadata cannot authorize the connected dashboard.
- Payments remain simulated. Cloud address books and checkout integration are live, with browser acceptance covering defaults, conflict review and checkout autofill. Storage uploads, verified payments and notifications remain pending. Existing browser-local orders/addresses are separate and are not automatically imported. See [cloud addresses](CLOUD-ADDRESSES.md) and [shared-commerce status](SHARED-COMMERCE.md).

## Local setup

Copy `.env.example` to `.env.local`, enter the development project's URL and **publishable** key, and set the server variable `COMMERCE_ENABLED=true` for connected development. Restart Next.js after changing server configuration. Browser bundles embed public variables during the build, so changing projects requires a rebuild. The local environment file is ignored by Git.

```sh
npm ci
npm run dev
```

The connected mode requires the deployed commerce schema, seed and Edge Function. Adding only connection variables does not enable shared ordering. With the commerce switch absent or false, the labelled browser-local prototype remains. Enabling shared development does not enable verified payments or production operation.

## Readiness endpoint

`/api/health` is uncached and returns no customer data or credentials. It checks the database through the non-sensitive `hpa_healthcheck` invoker RPC, with a five-second timeout. In shared mode it also checks the Edge commerce catalog, with a separate ten-second timeout. Only successful checks produce `database: connected` and `commerce: connected`; the development response also identifies `payments: simulation`.

Missing configuration reports `database: not_configured` only in demo mode. Shared mode requires configuration and returns HTTP 503 when configuration, the database or the Edge service is unavailable. SDK errors and connection details are redacted. Infrastructure health does not replace browser/order acceptance.

## Render service configuration

`render.yaml` records the development service configuration. It is not automatically applied to an existing manually created service; that service must be linked to a Blueprint or updated in the dashboard. The separate development service is the verified target here; the state of another public Render service is not inferred from it.

Use `staging`, Node `24.20.0`, the **Free** development instance and these commands:

```sh
# Build
npm ci --include=dev && npm run lint && npm test && npm run build && npm run typecheck

# Start: Next.js reads Render's PORT and the package script binds 0.0.0.0
npm start
```

Configure `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `COMMERCE_ENABLED=true` for this connected development service. Configure its canonical application origin consistently with OAuth callbacks. Do not set privileged database keys in Render or any `NEXT_PUBLIC_*` variable. The health-check path is `/api/health`. Prefer auto-deploy after checks pass; the build command independently enforces the quality checks.

Render's free service sleeps after inactivity, can take time to wake, has usage limits and uses ephemeral disks. Shared order/catalog records are durable in Supabase, not Render's filesystem; no Render database is needed for this architecture. See [Next.js on Render](https://render.com/docs/deploy-nextjs-app) and [free-service limits](https://render.com/docs/free).

## Authentication configuration

The verified development Supabase Auth settings are:

- Site URL: `https://hotpizzaace-development.onrender.com`
- Allowed app callbacks: `https://hotpizzaace-development.onrender.com/auth/callback**` and `http://localhost:3001/auth/callback**`
- Google provider's authorized redirect URI: `https://kaypgsstngguvrpftpwo.supabase.co/auth/v1/callback`
- Email and Google enabled, signup allowed, and **automatic email confirmation disabled** (`mailer_autoconfirm=false`).

The earlier Site URL `http://localhost:3000` and missing callback allowlist were corrected before live owner access was verified. Google returns through Supabase to the app's `/auth/callback`. Keep these development origins separate from production settings. See [Google setup and native-form origin handling](GOOGLE-AUTH.md).

The current admin UI has exactly the readonly user ID **hotpizzaace@gmail.com** with a blank password field, and Google. **Restaurant settings → Owner password** supports private password creation/change after fresh Google authentication, a matching verified owner/Google identity and trusted membership checks. Passwords use 12–128 characters with matching confirmation; the server independently repeats authorization on every password POST. Automatic email confirmation remains disabled. See [Admin access](ADMIN-ACCESS.md).

Signup, forgot-password and email-setup controls are removed. The admin sign-in endpoint rejects other IDs and signup/reset actions, and the deferred email-recovery/update endpoints fail closed. **SMTP is not a dependency for the current owner password/Google workflow.** On 21 October the owner privately saved a password and completed fixed-ID/password sign-in and dashboard reload acceptance. Scoped provider evidence confirmed the configured password and password-authenticated session. The human performed credential entry and submission; the agent did not inspect password field values or database password hashes. Earlier PKCE/TokenHash email recovery and SMTP work are [historical and deferred](PASSWORD-RECOVERY-QA.md).

## Verification and remaining work

Live application release `47f45b2` passed **292 automated tests**, lint, formatting, TypeScript, an isolated production build, **52 live authentication smoke checks** and **11 live address smoke checks**. Earlier shared-commerce QA passed **24 API checks**. Live readiness confirms shared commerce and database connectivity with simulated payments. Google owner access and independent-browser shared-order acceptance are complete; the [acceptance record](OWNER-ACCEPTANCE.md) contains the detailed tracking, reload, isolation and cleanup evidence. Automated owner-password tests do not enter or change a real password.

The new cloud-address implementation passed **292 automated tests**, lint, an isolated production build and TypeScript. PostgreSQL rollback checks and browser creation/default/conflict/checkout acceptance passed. The live site read the same cloud records as independent local origins; exactly two fictional QA addresses were removed afterward. Actual mobile-device acceptance remains pending. The security advisor has no address-schema finding but retains the existing [leaked-password-protection warning](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). See [cloud addresses](CLOUD-ADDRESSES.md).

The separate production domain, DNS, HTTPS and backend cutover are complete; see [production setup](PRODUCTION-DOMAIN.md). Production Google credentials and fresh owner acceptance remain pending; the completed owner password/Google acceptance above applies to development. Remaining work includes actual mobile-device acceptance; Storage uploads; verified payment-provider integration; restaurant/customer notifications; pagination/server reporting; trusted ingress abuse protection; and retention/TTL cleanup for rate-limit rows. Admin snapshots currently cap at 1,000 orders and customer history at 200. Confirm backups, restore checks, monitoring and release/rollback operations. Keep development and production projects, credentials and payment modes separate. Email recovery remains deferred.

Historical foundation verification passed 119 tests. The first shared application release, `f490e63`, passed [CI run 39328964330](https://github.com/Satya2n/hotpizzaace/actions/runs/39328964330); Google owner/order acceptance passed on `517fcc4`; the later `c6c17a1` email-recovery approach was superseded by the owner's decision. Current release `47f45b2` passed [CI run 39826189244](https://github.com/Satya2n/hotpizzaace/actions/runs/39826189244) and is live as Render deployment `dep-dbd4qhek1f9s738mcb50`. See [Admin access](ADMIN-ACCESS.md) and [owner acceptance](OWNER-ACCEPTANCE.md) for completed private password acceptance, [project status](PROJECT-STATUS.md), [shared-commerce implementation](SHARED-COMMERCE.md) and the [historical Phase 2 plan](PHASE-2.md).
