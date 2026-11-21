# Hot Pizza Ace

[![Website](https://img.shields.io/badge/Live%20website-hotpizzaace.com-e63628)](https://hotpizzaace.com)
[![CI](https://github.com/tribhuvanverma656/Hotpizzaace/actions/workflows/ci.yml/badge.svg)](https://github.com/tribhuvanverma656/Hotpizzaace/actions/workflows/ci.yml)

A restaurant ordering platform with a customer website, QR ordering, counter management, kitchen display, and an Android/iPhone customer app in development.

**Live website:** [hotpizzaace.com](https://hotpizzaace.com)  
**Project maintained by:** [Tribhuvan Verma](https://github.com/tribhuvanverma656)

This public repository contains the current website source and the customer app preview. The app is still being tested; an APK, iPhone test build and store release are not available yet. The deployed website and this development snapshot can differ.

## Website features

- Responsive menu with search, vegetarian filters and category-specific food symbols.
- Pizza size, crust, topping and quantity options, with prices calculated in integer paise.
- Persistent cart, delivery/pickup checkout, coupons and itemized GST.
- Customer account, saved addresses, order history and private order tracking.
- Razorpay checkout integration for website and QR online orders, with server-side payment verification and refund handling.
- QR ordering with online payment or pay at the counter; counter requests appear in the restaurant workspace.
- Restaurant-wide order acceptance, repeating alerts for eligible orders, and kitchen preparation workflows. Pay-at-counter QR requests remain silent.
- Kitchen ready-order history, branch-scoped chef access, menu/settings management, and thermal receipt layouts including 80 mm.
- Optional local POS workspace, disabled on hosted deployments by default.

Features depend on the deployment configuration. Cloning the source does not grant access to the restaurant's database, owner account or payment credentials.

## Customer app

The `mobile/` directory contains an Expo/React Native app for Android and iPhone:

- Home, searchable menu, saved favourites, cart and account entry points.
- Product customization and size-specific option prices.
- Cart persistence and removal even when quantity is one.
- Website/app food symbols share the same category mapping.
- Secure cart handoff to the existing website checkout. Login, payment and tracking currently open the website in the system browser.

The app defaults to the isolated staging website. Native-device testing, final launcher artwork, signing and store distribution remain pending. See [mobile setup](mobile/README.md).

## Technology

| Layer | Tools |
| --- | --- |
| Website | Next.js 16, React, TypeScript, Tailwind CSS |
| State and validation | Zustand, Zod, shared pricing logic |
| Backend | Supabase Postgres, Auth, Storage and Edge Functions |
| Payments | Razorpay; additional provider modules are configuration-dependent |
| Customer app | Expo SDK 58, React Native, Expo Router |
| Hosting and checks | Render, GitHub Actions, Node test runner |

## Run the website locally

Use the Node.js version in `.nvmrc`.

```sh
git clone https://github.com/tribhuvanverma656/Hotpizzaace.git
cd Hotpizzaace
npm ci
cp .env.example .env.local
npm run dev
```

Open [localhost:3000](http://localhost:3000). With `COMMERCE_ENABLED=false`, the website uses its browser-local demonstration mode. For shared commerce, configure **your own** Supabase project, apply migrations, deploy the Edge Functions and set server-side secrets using the backend guides.

```sh
npm run build
npm start
```

Never enable `LOCAL_POS_ENABLED` on a public host. Enable it only on the intended POS computer when using the local POS workflow.

## Run the customer app preview

```sh
cd mobile
npm ci
npm start
```

For the browser preview:

```sh
npm run web
```

The browser preview uses a fixed development proxy for the public staging catalogue. This proxy is not included in a static export. Native builds read the selected website's public catalogue directly. See [mobile/README.md](mobile/README.md) for the staging/production origin rules and EAS build setup.

## Checks

From the repository root:

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

From `mobile/`:

```sh
npm run lint
npm run typecheck
npx expo-doctor
npm run export
```

The development snapshot passed 680 automated tests and the website build. Mobile type/lint checks, all 20 Expo compatibility checks, and Android/iOS/web bundle exports passed. Browser checks covered saved cart recovery, quantity-one removal, product customization and staging checkout transfer. Bundle export is not a signed APK/IPA or proof of native-device acceptance.

## Project structure

```text
app/                  Website routes and API endpoints
components/           Storefront, counter, admin and kitchen UI
lib/                  Pricing, cart, authentication and backend services
mobile/               Android/iPhone customer app
supabase/             Database migrations and Edge Functions
tests/                Domain, payment, authorization and workflow tests
public/               Restaurant branding and menu assets
docs/                 Setup guides and historical implementation notes
```

Some older documents describe earlier prototype stages. Use this README, current source and environment configuration when assessing the current version.

## Configuration and security

- `.env.example` contains placeholders. Real environment files, signing keys, database exports and customer data are not included.
- Keep payment key secrets, service-role keys and webhook secrets on the server.
- Use Razorpay Test Mode for test payments. Never use real payment details in development tests.
- Supabase migrations and Edge Functions enforce trusted pricing, order ownership and staff permissions. Apply them to your own project before enabling shared commerce.
- Test fixtures contain fictional credentials and simulated records; they do not provide access to the live restaurant.

## Assets and attribution

Restaurant branding and menu photographs retain their existing attribution. See [branding notes](public/branding/README.txt), [menu photo sources](public/images/menu/SOURCES.md), and [image sources](public/images/SOURCES.md). Public source visibility does not transfer third-party branding or photography rights. Existing contributors remain credited in the repository history and source documentation.

---

[Visit the website](https://hotpizzaace.com) · [GitHub profile](https://github.com/tribhuvanverma656)
