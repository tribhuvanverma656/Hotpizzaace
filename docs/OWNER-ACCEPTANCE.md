# Owner and shared-order acceptance

Date: 20 October 2026. Target: `hotpizzaace-development.onrender.com`, development Supabase project `hotpizzaaceDB`.

This test uses a fictional guest pickup order and simulated payment. The temporary branch is `qa-owner-e2e-20261020` (QA owner verification · test only). Test instructions explicitly say not to prepare or dispatch food.

## Acceptance checklist

- [x] Owner completes Google sign-in as the nominated restaurant account; Supabase confirms trusted owner membership.
- [x] A separate guest browser places one pickup order and completes simulated payment.
- [x] The owner dashboard shows that exact order, customer label, amount and payment state after reload.
- [x] Owner confirmation and preparation updates appear in guest tracking.
- [x] Pickup follows the valid path through ready and picked up; the guest sees the final status after reload.
- [x] The guest cannot open the owner dashboard; `/admin/dashboard` redirects to `/admin/login`.
- [x] Temporary test order/branch are removed and the original Barra kitchen/COD settings are preserved.

## Evidence

Google verification completed: Supabase confirms that `hotpizzaace@gmail.com` exists, its email is verified, and trusted owner membership is assigned. The first return failed because the project still used `http://localhost:3000` with no allowed redirect URLs. The development Site URL is now `https://hotpizzaace-development.onrender.com`, with callback patterns `https://hotpizzaace-development.onrender.com/auth/callback**` and `http://localhost:3001/auth/callback**`. A fresh hosted session opened the owner dashboard and persisted through full reloads. Human verification was completed privately; no password or verification code was supplied to the agent.

The separate Chrome guest browser created pickup order `HPA-261020084626-6D00DDED` (`6d00dded-ef53-414f-87bc-5376b425477a`): ₹50 Aloo Tikki Burger, customer label QA Owner Flow Test, fictional phone 9000000001. The receipt showed successful simulated payment and cleared the cart. The owner dashboard displayed the same number, customer, item, amount, pickup and simulated-paid state after reload.

Every fulfillment update was made through the real owner UI and its confirmation dialog. Customer tracking automatically showed each state without a reload:

| Admin status         | Customer tracking    | Database version           |
| -------------------- | -------------------- | -------------------------- |
| Pending confirmation | Pending confirmation | 2, after simulated payment |
| Confirmed            | Order confirmed      | 3                          |
| Preparing            | In the oven          | 4                          |
| Ready                | Ready to go          | 5                          |
| Picked up            | Picked up            | 6                          |

The final admin page, guest tracking and guest history retained picked-up status after full reloads. Guest history contained exactly this one order, ₹50 and simulated paid. An unauthenticated guest's admin-dashboard visit redirected to sign-in. Earlier shared-commerce API checks cover private-order ownership and tracking capability isolation; this UI journey did not repeat every API security case.

Supabase audit events confirmed creation, simulated payment and all four valid status transitions in order. The test order, cascading audit events and temporary branch were then removed using their exact identifiers. Final database verification showed only Barra, `acceptingOrders=false`, payment methods `upi` and `card`, and zero matching QA orders/events. The owner workspace and guest storefront were restored to Barra; the guest cart remained empty. No real payment was collected and no real fulfillment was requested.

## Release and scope

Tested application: staging commit `517fcc458423268f7d08b98cc67f0fbc0b5f47dd`, Render deployment `dep-dbbgkpd9fdbs73e4u8jg`. The existing release checks passed 173 automated tests, lint, TypeScript, a production build, 24 commerce API checks and 31 authentication smoke checks. This acceptance step changed hosted Auth return settings and test data; no application code changed.

At the conclusion of the 20 October journey, Google owner access and the pickup order/admin/tracking path had passed. Owner password setup/sign-in and email recovery were not covered by that journey. The separate 21 October password acceptance is recorded below; email recovery was deferred. Real device acceptance, production domain cutover, real payment integration and notifications remain separate work. These results do not establish production readiness.

## Owner password acceptance — 21 October 2026

Target: the same development application, release `7915b12c7293cedef77a8852e11fdfd0daaf7e0a` on Render deployment `dep-dbc4tke7bikc73fl6ce0`. This acceptance follows the owner's decision to use the fixed user ID **hotpizzaace@gmail.com** and a private password, alongside Google. Email recovery remains deferred and SMTP is not required for this workflow.

- [x] Fresh Google owner confirmation authorized **Restaurant settings → Owner password**.
- [x] The owner privately saved a password and completed fixed-ID/password sign-in.
- [x] The connected `/admin/dashboard` opened in the same browser after sign-in.
- [x] A full reload retained the connected dashboard headings and owner access.

Before the human handoff, narrowly scoped checks returned `password_configured=false` and `password_session_observed=false`. After the private action, the same checks returned **`password_configured=true`** and **`password_session_observed=true`**. The owner's most recent and only remaining Auth session was created at **2026-10-21 13:49:27 UTC**, with authentication method **`password`**. This provider evidence distinguishes the accepted password sign-in from a retained Google session. The browser dashboard was verified both before and after full reload.

The human performed credential entry and submission; the agent did not inspect password field values or database password hashes. The checks exposed only configuration/session evidence, not a password, password hash, access token or refresh token. No credential values are recorded here. The password form is separate from restaurant settings; this acceptance does not claim a change to kitchen, branch or payment settings.

The release's existing verification remains **257 automated tests**, lint, formatting, TypeScript, an isolated production build, and **52 local and 52 live authentication smoke checks**. No additional automated tests were run for this documentation update. At this 21 October acceptance, payments remained simulated and cloud saved addresses were still pending. The cloud-address release subsequently passed on 22 October; see [cloud-address acceptance](CLOUD-ADDRESSES.md). Production release and the other launch work in [project status](PROJECT-STATUS.md) remain pending. See [Admin access](ADMIN-ACCESS.md) for the accepted workflow and future password changes.
