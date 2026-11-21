import type { Metadata } from 'next';
import Link from 'next/link';
import { InfoNote, InfoPage } from '@/components/info/info-page';
import { BusinessIdentity, GrievanceContact } from '@/components/business-identity';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description:
    'How Hot Pizza Ace uses Google sign-in, account and address information, cookies and connected services, and how to request access or deletion.',
};

export default function PrivacyPolicyPage() {
  return (
    <InfoPage
      title="Privacy policy"
      intro="How Hot Pizza Ace handles your information and how you can manage it or contact us."
      currentPath="/privacy-policy"
      updated="25 October 2026"
      sections={[
        {
          id: 'about-this-policy',
          title: 'Who we are and what this notice covers',
          content: (
            <>
              <p>
                Hot Pizza Ace is the restaurant behind{' '}
                <a href="https://hotpizzaace.com">hotpizzaace.com</a>. This notice covers the
                website’s account, address, menu, branch QR ordering and order features. For privacy
                questions or account data requests, email{' '}
                <a href="mailto:hotpizzaace@gmail.com">hotpizzaace@gmail.com</a>.
              </p>
              <BusinessIdentity branchId="barra" />
              <p>
                Live ordering and payments are not available on the public website yet. Account
                sign-in and saved addresses use connected services and can store real information.
                Separate development testing may include test orders and simulated payments; those
                tests do not arrange food preparation, delivery or collection.
              </p>
            </>
          ),
        },
        {
          id: 'google-sign-in',
          title: 'Google sign-in and account information',
          content: (
            <>
              <p>
                When you choose Google sign-in, we request only the basic identity permissions
                needed to sign you in: your account identifier, email address and basic profile.
                Google may supply your name and profile image as part of that profile. Supabase, our
                sign-in provider, stores the returned account information. The current account
                screen uses your name and email; it does not display your Google profile image.
              </p>
              <p>
                We use this information to verify your identity, maintain your session and connect
                your account to its saved addresses and any orders submitted while signed in. We do
                not request access to your Gmail messages, Google Drive files or Google Contacts.
                You enter your Google password with Google, not with Hot Pizza Ace.
              </p>
              <p>
                We do not sell Google account information, use it for advertising or ad targeting,
                or use it to train AI models. We use it for the account features and service
                protection described in this notice.
              </p>
            </>
          ),
        },
        {
          id: 'information',
          title: 'Other information you provide',
          content: (
            <>
              <p>Depending on the features you use, the website also handles:</p>
              <ul>
                <li>Cart items, quantities, sizes, crusts, toppings, kitchen notes and coupons.</li>
                <li>
                  Delivery contact details, addresses and labels you choose to save to your account.
                </li>
                <li>
                  Name, mobile number, delivery address, locality, postal code, optional landmark
                  and handover instructions submitted at checkout.
                </li>
                <li>
                  Order numbers, item and price records and order status. Development test orders
                  may also record simulated payment results or Razorpay test payment references.
                </li>
                <li>
                  Branch QR order requests require your name and mobile number to identify your
                  order at the counter. We also record your selected items, preparation notes,
                  request number and staff decisions. No account or Google sign-in is required for
                  this ordering flow.
                </li>
                <li>Sign-in and guest-session information, selected branch and checkout drafts.</li>
                <li>Messages and information you send with support or privacy requests.</li>
              </ul>
              <p>
                These details support saved addresses, returning to checkout, order history and
                status tracking when available. Authorized restaurant staff can view submitted
                orders and their contact and delivery details. Saved address books belong to the
                signed-in account; an address included in an order is also kept with that order.
              </p>
            </>
          ),
        },
        {
          id: 'storage',
          title: 'Where information is kept',
          content: (
            <>
              <p>
                The connected website stores account information, saved addresses and submitted
                orders in Supabase. Orders placed while signed in and addresses saved to that
                account can be retrieved on another device after signing in to the same account.
                Where guest checkout is enabled, guest orders are also stored on the server; access
                uses this browser’s guest session or the order’s private tracking link. Anyone with
                that link can view the order, so keep it private.
              </p>
              <p>
                Cart and branch choices use this browser’s local storage. Checkout details and
                attempt information use the current tab’s session storage so you can return without
                retyping. Cookies maintain sign-in and guest-order access. These local drafts are
                separate from saved account addresses and submitted cloud orders.
              </p>
              <p>
                Branch QR requests are stored in Supabase and visible to authorized restaurant
                staff, including the name and mobile number needed to match your request at the
                counter. Your browser’s guest session controls access to your request status. This
                tab may retain an unfinished submission and its contact details in session storage
                so a connection retry does not send a duplicate request. The ordering QR is separate
                from the restaurant’s merchant UPI payment QR; it does not collect payment
                credentials.
              </p>
              <p>
                A separately labelled browser-local demo stores its demo orders, addresses, settings
                and test sessions on that browser instead. Those demo records do not become
                connected account records or sync across devices.
              </p>
            </>
          ),
        },
        {
          id: 'sharing',
          title: 'Service providers and sharing',
          content: (
            <>
              <p>
                Render hosts the website. Supabase provides authentication, database storage and
                connected order and address services. Choosing Google sign-in involves Google’s
                authentication service. These providers process information needed to host the
                website, sign you in, store records and protect the service. Website and sign-in
                requests also involve connection information, such as your IP address, browser and
                request time. Providers may process information in the countries where they operate.
              </p>
              <p>
                We do not have an advertising or analytics integration that receives your Google
                account data. Access to submitted orders by restaurant staff supports handling those
                records and customer questions. We may also disclose information when required by
                applicable law or necessary to investigate abuse and protect the service.
              </p>
              <p>
                Links to maps, social pages and other websites open separate services with their own
                privacy practices. No external map is embedded on the contact page. The public
                website currently collects no payments or card, bank or UPI PIN details.
              </p>
            </>
          ),
        },
        {
          id: 'payment-testing',
          title: 'Payment processing and test payments',
          content: (
            <>
              <p>
                Where online payment is enabled, PhonePe Payment Gateway processes it on PhonePe’s
                own payment page. The separate development website uses PhonePe’s test mode; the
                payment screen identifies test mode, and test payments do not transfer real money or
                arrange restaurant fulfillment. The public production website does not currently
                accept online payments.
              </p>
              <p>
                Starting a payment sends PhonePe the order amount and a payment reference for your
                order. Payment details such as UPI, card or bank credentials are entered only on
                PhonePe’s page. Our server stores payment references, amounts, verification results
                and payment status to match a payment to its restaurant order, handle retries and
                investigate payment issues. It does not store full card details, bank login details
                or a UPI PIN. PhonePe also processes connection and transaction information under
                its <a href="https://www.phonepe.com/privacy-policy/">privacy policy</a>. Earlier
                test orders may show Razorpay, which processed them under its{' '}
                <a href="https://razorpay.com/privacy/">privacy policy</a>.
              </p>
            </>
          ),
        },
        {
          id: 'control',
          title: 'Your controls, access and deletion requests',
          content: (
            <>
              <p>
                You can change or remove cart items, manage saved addresses under{' '}
                <Link href="/account/addresses">Saved addresses</Link> and sign out using the
                website. Removing or editing a saved address does not alter the address snapshot
                already recorded on an order receipt. Order receipts also preserve the item names,
                selected options and prices recorded when the order was submitted.
              </p>
              <p>
                Clearing this website’s browser data removes local carts, drafts and session
                information, and may remove access to guest orders unless you keep their private
                links. It does not delete your Supabase account, saved cloud addresses or submitted
                cloud orders. Signing out also does not delete those records. Clearing storage for a
                separate local demo removes its local records; initial sample data may appear again
                when it is reopened.
              </p>
              <p>
                For access to, correction of or deletion of account information or other stored
                personal information, email{' '}
                <a href="mailto:hotpizzaace@gmail.com">hotpizzaace@gmail.com</a>. Send the request
                from your account email where possible and describe the information involved. We may
                ask for reasonable proof that the account or records belong to you before acting.
                Never send passwords, sign-in codes, payment credentials or private tracking links
                in an initial request.
              </p>
              <p>
                You can remove Hot Pizza Ace’s Google access from{' '}
                <a
                  href="https://myaccount.google.com/connections"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  your Google Account connections
                </a>
                . Removing Google access does not itself delete information already stored by Hot
                Pizza Ace or necessarily end an existing website session. Sign out of the website
                separately and use the email above for an account or data deletion request.
              </p>
              <p>
                Account, saved-address and order records do not currently have an automatic expiry.
                We review deletion requests and explain if particular records need to be retained,
                for example to resolve a dispute or meet an applicable legal obligation. Deleting a
                saved address does not delete an order receipt or its original delivery details.
              </p>
            </>
          ),
        },
        {
          id: 'shared-devices',
          title: 'Using a shared device',
          content: (
            <p>
              Sign out when you finish on a shared device. Someone with access to that browser may
              see local cart or checkout details, an active account session, or guest-order links.
              The separately labelled local demo’s test sign-in is not verified account security.
              Use test details in development testing, and never put passwords, payment credentials
              or sensitive personal information in order notes. Sign-in and access checks protect
              connected records, but no internet service can promise complete security.
            </p>
          ),
        },
        {
          id: 'questions',
          title: 'Changes and contact',
          content: (
            <>
              <p>
                We will update the date above when this notice changes. Before accessing additional
                Google data or using Google account information for a new purpose, we will provide a
                prominent notice and request your consent. Material changes to other uses of
                personal information will be explained before they take effect.
              </p>
              <p>
                Contact Hot Pizza Ace at{' '}
                <a href="mailto:hotpizzaace@gmail.com">hotpizzaace@gmail.com</a> for questions or
                requests about this notice. See also our{' '}
                <Link href="/terms-and-conditions">terms and conditions</Link> and{' '}
                <Link href="/contact">restaurant contact details</Link>.
              </p>
              <p>If you have a grievance about how we handle your personal information, contact:</p>
              <GrievanceContact />
            </>
          ),
        },
      ]}
    >
      <InfoNote>
        <p>
          <strong>Live ordering and payments are not yet available on hotpizzaace.com.</strong>{' '}
          Account sign-in and saved addresses can still store real information. Payment simulations
          belong to separate development testing and do not charge money.
        </p>
      </InfoNote>
    </InfoPage>
  );
}
