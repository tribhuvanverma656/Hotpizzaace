# Hot Pizza Ace customer app

Expo SDK 58 / React Native customer app for Android and iPhone. Source lives alongside the existing website; shared catalogue types, product validation and price calculation come from the website modules.

## Working screens

- Home, live menu search/categories, product sizes/crust/toppings and preparation notes.
- Local favourites, selected branch and persistent cart. Quantity 1 can be removed. Matching configurations merge; quantity is limited to 20 and cart lines to 30.
- Secure checkout handoff: proposes product selections to `/app-checkout` using the URL fragment, with no customer credentials or client-supplied totals. The website validates the current catalogue, asks before replacing an existing browser cart, then uses existing checkout/payment logic.
- Account, order history, tracking, addresses, restaurant contact and policy entry points open the customer website in the system browser. They are **not yet native account/order screens**. Browser cookies stay in that browser; the app never stores authentication or payment credentials.

The first version intentionally keeps authentication and gateway checkout on the existing secure website. The cart is not cleared merely because a browser opened; the customer can return after an abandoned payment without losing items.

## Run

From `mobile/`:

```sh
npm ci
npm start
```

Use the SDK-compatible Expo Go app or an appropriate signed preview build. For the local browser preview:

```sh
npm run web
```

Metro serves a development-only `/mobile-catalog` proxy for web CORS. This is a fixed public-catalogue path, never a general proxy. Native apps fetch the public catalogue directly. Static web exports validate bundling but do not include this development proxy.

Default environment: `https://hotpizzaace-development.onrender.com` (isolated test backend). Set `EXPO_PUBLIC_WEBSITE_URL` to `https://hotpizzaace.com` only after the website handoff route is released and the app is approved for live testing. Other origins are rejected. No secrets belong in EXPO_PUBLIC variables.

## Checks

```sh
npm run typecheck
npm run lint
npx expo-doctor
npm run export
```

The repository's root test suite includes `tests/mobile-cart.test.ts` for forged fields, current-catalogue validation, handoff size limits, cart merging, quantity-one removal and saved-cart recovery.

## Signed device builds / store publishing

`eas.json` contains an internal staging APK preview profile, a `production-apk` profile for an installable APK connected to the live website, and a future store production profile. The app is linked to the authorized `hotpizzaaces-team/hot-pizza-ace` Expo project. iPhone distribution also needs Apple signing/provisioning; store publishing needs the owner's Apple/Google developer accounts.

Signed Android staging and production APK builds have completed. The [production APK build](https://expo.dev/accounts/hotpizzaaces-team/projects/hot-pizza-ace/builds/8d92e908-adb2-4dd0-8278-c91d9d49ee59) uses https://hotpizzaace.com; the staging preview is separate. No IPA, TestFlight build or store listing has been created yet. Native-device payment/app-return and sign-in tests are still required. Native launcher images use the original restaurant logo with Android safe-area padding; store artwork still needs review. Push notifications and fully native authenticated account/order screens are not implemented in this first version.
