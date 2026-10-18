/**
 * Utility to load Razorpay Checkout script dynamically in the browser.
 */

interface RazorpayInstance {
  open: () => void;
  on: (event: string, callback: (response: unknown) => void) => void;
}

interface RazorpayConstructor {
  new (options: unknown): RazorpayInstance;
}

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

export function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve(false);
      return;
    }

    if (window.Razorpay) {
      resolve(true);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export type RazorpayPaymentSuccessResponse = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};

export type OpenRazorpayCheckoutOptions = {
  keyId: string;
  amount: number; // in paise
  orderId: string; // Razorpay order id (rzp_order_...)
  appOrderId: string; // Internal app order id
  name?: string;
  description?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  onSuccess: (response: RazorpayPaymentSuccessResponse) => Promise<void> | void;
  onDismiss?: () => void;
  onError?: (error: unknown) => void;
};

/**
 * Opens Razorpay standard checkout popup.
 */
export async function openRazorpayCheckout(options: OpenRazorpayCheckoutOptions): Promise<boolean> {
  const loaded = await loadRazorpayScript();
  if (!loaded || !window.Razorpay) {
    throw new Error('Unable to load Razorpay payment SDK. Check your internet connection.');
  }

  const rzpOptions = {
    key: options.keyId,
    amount: options.amount,
    currency: 'INR',
    name: options.name || 'Hot Pizza Ace',
    description: options.description || `Order #${options.appOrderId.slice(0, 8)}`,
    image: '/images/brand/logo.png',
    order_id: options.orderId,
    prefill: {
      name: options.customerName || '',
      contact: options.customerPhone || '',
      email: options.customerEmail || '',
    },
    notes: {
      app_order_id: options.appOrderId,
    },
    theme: {
      color: '#ea580c', // Pizza Ace warm orange
    },
    modal: {
      ondismiss: () => {
        if (options.onDismiss) {
          options.onDismiss();
        }
      },
    },
    handler: async (response: RazorpayPaymentSuccessResponse) => {
      try {
        await options.onSuccess(response);
      } catch (err) {
        if (options.onError) {
          options.onError(err);
        }
      }
    },
  };

  const razorpay = new window.Razorpay(rzpOptions);

  razorpay.on('payment.failed', function (failureResponse: unknown) {
    if (options.onError) {
      options.onError(failureResponse);
    }
  });

  razorpay.open();
  return true;
}
