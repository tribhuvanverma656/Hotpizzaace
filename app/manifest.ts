import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Hot Pizza Ace — Order Pizza Online',
    short_name: 'Hot Pizza Ace',
    description: 'Order delicious hot pizzas, garlic breads, and sides in Kanpur.',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#18181b',
    theme_color: '#ea580c',
    icons: [
      {
        src: '/brand/hot-pizza-ace.gif',
        sizes: '192x192',
        type: 'image/gif',
        purpose: 'any',
      },
      {
        src: '/brand/hot-pizza-ace.gif',
        sizes: '512x512',
        type: 'image/gif',
        purpose: 'maskable',
      },
    ],
  };
}
