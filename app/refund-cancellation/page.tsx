import type { Metadata } from 'next';
import Link from 'next/link';
import { InfoNote, InfoPage } from '@/components/info/info-page';

export const metadata: Metadata = {
  title: 'Refunds & cancellations',
  description:
    'What cancellation and payment simulation mean in the Hot Pizza Ace ordering prototype.',
};

export default function RefundCancellationPage() {
  return (
    <InfoPage
      title="Refunds & cancellations"
      intro="Clear information about demo orders, payment retries and where to ask about a real purchase."
      currentPath="/refund-cancellation"
      sections={[
        {
          id: 'before-checkout',
          title: 'Before submitting checkout',
          content: (
            <p>
              You can change quantities, remove items and review the total in your cart before
              submitting checkout. Review size, crust, toppings and notes carefully. Cart edits are
              drafts; submitting an enabled connected test checkout sends order and contact details
              to the server, where authorized staff can view them. Live ordering is currently
              paused.
            </p>
          ),
        },
        {
          id: 'demo-cancellation',
          title: 'After a test order is created',
          content: (
            <p>
              Unpaid online orders awaiting confirmation can be cancelled from the order tracking
              page in the original ordering browser or account. For paid orders or orders already
              accepted by the restaurant, contact the restaurant for assistance. Local demo
              cancellations update only the browser-local record. This does not cancel orders placed
              by telephone, in person or through another platform.
            </p>
          ),
        },
        {
          id: 'demo-payments',
          title: 'Test payments and retries',
          content: (
            <p>
              The separate development website may offer a payment simulator or Razorpay test
              checkout. These test payments do not charge real money, so there is no real refund to
              process. Closing a payment screen does not establish a successful or failed payment.
              Check the server-confirmed status before retrying; retries stay attached to the same
              restaurant order. Cancelled or rejected orders cannot be paid again. Check the payment
              and order status in <Link href="/track-order">Track order</Link> before starting
              again.
            </p>
          ),
        },
        {
          id: 'real-order-help',
          title: 'Questions about a real order',
          content: (
            <p>
              If you bought food directly from the restaurant,{' '}
              <Link href="/contact">call the restaurant</Link> with the order reference and a
              description of the issue. If you ordered through a delivery platform, use that
              platform’s order support so the request is attached to the actual transaction. Never
              share a UPI PIN, OTP or full card details when asking for help.
            </p>
          ),
        },
        {
          id: 'live-policy',
          title: 'Live order policy',
          content: (
            <p>
              Cancellation eligibility, any applicable charges, handling of missing or incorrect
              items, refund methods and processing times must be confirmed by the operating business
              before live ordering begins. This demo does not establish those rules or promise a
              refund timeline. Nothing on this page removes rights available under applicable law.
            </p>
          ),
        },
      ]}
    >
      <InfoNote>
        <p>
          <strong>No real payments are collected here.</strong> This page explains the current demo,
          rather than a policy for purchases made through another channel.
        </p>
      </InfoNote>
    </InfoPage>
  );
}
