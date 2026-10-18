import type { Metadata } from 'next';
import Link from 'next/link';
import { InfoNote, InfoPage } from '@/components/info/info-page';
import { BusinessContact } from '@/components/info/business-info';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description:
    'How the Hot Pizza Ace ordering prototype uses and stores information in your browser.',
};

export default function PrivacyPolicyPage() {
  return (
    <InfoPage
      title="Privacy policy"
      intro="A clear look at what this website remembers, why it remembers it, and how you can remove it."
      currentPath="/privacy-policy"
      updated="18 October 2026"
      sections={[
        {
          id: 'information',
          title: 'Information used by this prototype',
          content: (
            <>
              <p>The ordering features use the information you choose to provide:</p>
              <ul>
                <li>Cart items, quantities, sizes, crusts, toppings, kitchen notes and coupons.</li>
                <li>Your mobile number when you use demo sign-in.</li>
                <li>Delivery addresses and labels you choose to save to your demo account.</li>
                <li>
                  Name, mobile number, delivery address, locality, postal code, optional landmark
                  and handover instructions submitted with a demo checkout.
                </li>
                <li>
                  Demo order numbers, item and price snapshots, payment simulation results and order
                  status.
                </li>
                <li>
                  Local demo session indicators and restaurant settings or menu edits made in the
                  admin dashboard on the same browser.
                </li>
              </ul>
              <p>
                These details let you return to a cart, test checkout, see local order history and
                follow status changes made in the local admin dashboard.
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
                Cart, orders, saved addresses, demo sessions and settings are saved in this
                browser’s local storage. Checkout details and the checkout attempt are also saved in
                the current tab’s session storage so you can return from the cart without retyping
                and avoid duplicate demo submissions. Drafts are separated by branch and demo
                account. This version has no shared order database and does not send your checkout
                details to the restaurant.
              </p>
              <p>
                Demo orders are available only in the browser profile and website address where you
                created them. Signing in on another device does not retrieve orders or addresses.
                Signing out does not erase saved orders or addresses. Essential page requests still
                reach the server serving the website; browser-local ordering does not make browsing
                anonymous.
              </p>
            </>
          ),
        },
        {
          id: 'payments-and-sharing',
          title: 'Payments, tracking and external links',
          content: (
            <>
              <p>
                There is no live payment gateway, SMS service, advertising tracker or analytics
                integration in the current ordering prototype. Payment success and failure are
                simulated. The application does not request card numbers, bank details or a UPI PIN.
                Menu photos are served as local website files.
              </p>
              <p>
                Choosing a telephone or external map link opens a separate service. Your use of that
                service is covered by its own privacy practices. No external map is embedded on the
                contact page.
              </p>
            </>
          ),
        },
        {
          id: 'control',
          title: 'Your controls and retention',
          content: (
            <>
              <p>
                You can change or remove cart items, manage saved addresses under{' '}
                <Link href="/account/addresses">Saved addresses</Link> and sign out of a demo
                session using the website. Removing a saved address does not alter addresses already
                recorded on order receipts. To remove saved demo orders, contact details and
                settings, use your browser’s site-data settings to clear storage for this website,
                then reload it. This also resets the local menu edits and cart on that browser.
                Initial sample data may appear again after a reset.
              </p>
              <p>
                There is no automatic retention deadline configured for local demo data. It remains
                until it is cleared, reset, or removed by your browser. The restaurant cannot
                remotely erase information stored only in your browser.
              </p>
            </>
          ),
        },
        {
          id: 'shared-devices',
          title: 'Using a shared device',
          content: (
            <p>
              Demo sign-in is a convenience for testing, not production account security. Someone
              with access to the same browser profile can inspect its saved data and local admin
              screens. Use test contact and address details. Do not enter passwords, payment
              credentials or sensitive personal information in notes.
            </p>
          ),
        },
        {
          id: 'questions',
          title: 'Questions and future changes',
          content: (
            <>
              <p>
                You can contact the restaurant using the details below. Before live ordering is
                launched, this notice must be updated to identify the operating business and privacy
                contact, service providers, server storage, retention periods and the process for
                privacy requests. The current notice describes this prototype only. See also our{' '}
                <Link href="/terms-and-conditions">terms and conditions</Link>.
              </p>
              <BusinessContact />
            </>
          ),
        },
      ]}
    >
      <InfoNote>
        <p>
          <strong>This website currently runs as a local ordering demo.</strong> It does not place
          real restaurant orders or collect real payments.
        </p>
      </InfoNote>
    </InfoPage>
  );
}
