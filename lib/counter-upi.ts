/**
 * "Pay by UPI" for branch QR orders: a UPI payment link to the counter's own merchant
 * UPI ID (the sound box QR), with the exact request total and request number filled in.
 *
 * The link only pre-fills the customer's UPI app. It never proves payment: staff still
 * confirm the credit (the counter sound box announces it) before accepting the request.
 */

export type CounterUpiConfig = { vpa: string; payeeName: string };
export type CounterUpiLinks = {
  /** Generic UPI intent; Android shows the installed UPI apps. */
  upi: string;
  /** App-specific links, needed on iPhone where `upi://` has no app chooser. */
  apps: { id: 'gpay' | 'phonepe' | 'paytm'; label: string; href: string }[];
  amountText: string;
  note: string;
};

const VPA = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,255}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/;

/** Reads the public counter UPI settings; an absent or malformed UPI ID disables the feature. */
export function readCounterUpiConfig(
  vpa: string | undefined,
  payeeName: string | undefined,
): CounterUpiConfig | null {
  const id = vpa?.trim() ?? '';
  if (!VPA.test(id)) return null;
  const name = (payeeName ?? '')
    .replace(/[^A-Za-z0-9 .&'-]/g, '')
    .trim()
    .slice(0, 50);
  return { vpa: id, payeeName: name || 'Hot Pizza Ace' };
}

/** Paise to the two-decimal rupee string UPI apps expect, e.g. 45600 -> "456.00". */
export function upiAmount(paise: number): string {
  if (!Number.isSafeInteger(paise) || paise <= 0 || paise > 10_000_000)
    throw new Error('UPI amount must be a positive whole number of paise up to ₹1,00,000.');
  return `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, '0')}`;
}

/** Builds the payment links for one pending QR request. */
export function counterUpiLinks(
  config: CounterUpiConfig,
  input: { total: number; requestNumber: string },
): CounterUpiLinks {
  const amountText = upiAmount(input.total);
  const reference = input.requestNumber.replace(/[^A-Za-z0-9-]/g, '').slice(0, 30);
  const note = `HPA ${reference || 'counter order'}`;
  const query = new URLSearchParams({
    pa: config.vpa,
    pn: config.payeeName,
    am: amountText,
    cu: 'INR',
    tn: note,
  })
    .toString()
    // UPI apps expect %20, not "+", for spaces.
    .replace(/\+/g, '%20');
  return {
    upi: `upi://pay?${query}`,
    apps: [
      { id: 'gpay', label: 'Google Pay', href: `tez://upi/pay?${query}` },
      { id: 'phonepe', label: 'PhonePe', href: `phonepe://pay?${query}` },
      { id: 'paytm', label: 'Paytm', href: `paytmmp://pay?${query}` },
    ],
    amountText,
    note,
  };
}

/** The deployment's counter UPI ID, set with NEXT_PUBLIC_COUNTER_UPI_ID on the website host. */
export const counterUpiConfig = readCounterUpiConfig(
  process.env.NEXT_PUBLIC_COUNTER_UPI_ID,
  process.env.NEXT_PUBLIC_COUNTER_UPI_NAME,
);
