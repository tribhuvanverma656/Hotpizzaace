import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'in.hotpizzaace.app',
  appName: 'Hot Pizza Ace',
  webDir: 'public',
  server: {
    // Points to the live Render URL or local dev server
    url: process.env.NEXT_PUBLIC_APP_URL || 'https://hot-pizza-ace.onrender.com',
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
