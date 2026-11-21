import type { NextConfig } from 'next';
const config: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        // Native form POSTs need their Origin for CSRF checks. Send only the origin,
        // never a receipt path or private tracking token from the URL.
        headers: [
          { key: 'Referrer-Policy', value: 'strict-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value:
              'camera=(), microphone=(), geolocation=(), payment=(self "https://api.razorpay.com" "https://checkout.razorpay.com" "https://mercury.phonepe.com" "https://mercury-t2.phonepe.com" "https://mercury-uat.phonepe.com")',
          },
          {
            key: 'Content-Security-Policy',
            // Static Next.js pages contain generated inline scripts. These directives
            // protect embedding and base URLs without claiming a strict script CSP.
            value: "object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
          },
        ],
      },
    ];
  },
};
export default config;
