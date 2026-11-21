# Owner dashboard access

Updated 21 October 2026. The owner requested two administrator sign-in options only:

- Fixed user ID **hotpizzaace@gmail.com** and the owner's private password.
- **Google** using the same authorized restaurant account.

The connected login page has a readonly user ID and a blank password field. It has no signup, forgot-password, email-reset or email-setup controls. The server rejects other password login IDs, signup/reset actions on the admin password endpoint, and the deferred email-recovery update endpoints. No default or hardcoded password exists in the website or repository. Supabase Auth stores the credential.

## Create or change the owner password

Sign in with the owner's Google account, then open **Restaurant settings → Owner password**. If requested, select **Confirm identity with Google**. The server must verify a confirmed matching owner identity, Google identity, recent signed OAuth proof and trusted owner membership through the existing protected shared-commerce session before showing readiness or updating a password. An email address, editable profile metadata or browser-local admin flag cannot grant this access.

The human enters and confirms a password of 12–128 characters and submits **Save owner password**. Saving attempts global sign-out, then opens the login page. Sign in with **hotpizzaace@gmail.com** and the new password. The agent must not enter or submit a new real password, read its value, or ask for it in chat. A fresh Google session must be less than 15 minutes old; otherwise reconfirm with Google.

The settings panel sits outside the restaurant configuration form so password setup does not save kitchen, branch or delivery settings. Customer accounts and unrelated Google accounts cannot change the owner password. Every password POST repeats authorization; a prior successful readiness GET is not sufficient. Requests require same-origin protection, bounded form parsing and matching passwords. Password/token values are absent from responses, logs and app persistence.

## Verification and acceptance

The owner-password release `7915b12c7293cedef77a8852e11fdfd0daaf7e0a` was deployed on Render (deploy `dep-dbc4tke7bikc73fl6ce0`), with [GitHub CI run 39550164289](https://github.com/Satya2n/hotpizzaace/actions/runs/39550164289) successful. It passed **257 automated tests**, lint, formatting, TypeScript and an isolated production build. **52 local and 52 live authentication smoke checks passed**, including the single fixed ID, absence of email setup links, retired endpoint rejection, anonymous owner-password denial and request-origin protections. Unit tests cover fresh/stale/wrong-subject Google proof, Google identity requirements, owner membership denial/outages, GET without mutations, validation and committed-password/sign-out failure behavior.

Private owner password creation, fixed-ID/password sign-in and dashboard reload passed acceptance on **21 October 2026**. After the human privately saved the password, a scoped Supabase check confirmed `password_configured=true` and `password_session_observed=true`; both were false before the human handoff. The same browser tab reached `/admin/dashboard`, and a full reload retained the dashboard headings. The human performed credential entry and submission; the agent did not inspect password field values or database password hashes. Google owner access was already verified. See [owner acceptance evidence](OWNER-ACCEPTANCE.md).

The subsequent cloud-address application release `47f45b2` is live as deployment `dep-dbd4qhek1f9s738mcb50`, after successful [CI run 39826189244](https://github.com/Satya2n/hotpizzaace/actions/runs/39826189244). Its 292 automated tests, 52 live authentication smoke checks and 11 live address smoke checks passed. See [cloud-address acceptance](CLOUD-ADDRESSES.md).

Live health returns HTTP 200 with database and commerce connected. This is development acceptance; production cutover remains pending and payments remain simulated.

## Email recovery is deferred

No SMTP configuration is required for the requested owner password/Google workflow. The earlier email recovery implementation, template and QA are retained as historical Phase 2 work. They are not active sign-in options. Custom SMTP, future email recovery and production notifications may be considered later. The old SMTP question is superseded by the owner's decision.
