const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');
const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, '..')];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];
const original = config.server.enhanceMiddleware;
config.server.enhanceMiddleware = (middleware, server) => {
  const next = original ? original(middleware, server) : middleware;
  return async (req, res, done) => {
    // Dev preview only: a fixed public-menu proxy, never a general URL proxy or cookie forwarder.
    if (req.url === '/mobile-catalog' && req.method === 'GET') {
      const origin =
        process.env.EXPO_PUBLIC_WEBSITE_URL || 'https://hotpizzaace-development.onrender.com';
      if (
        !['https://hotpizzaace.com', 'https://hotpizzaace-development.onrender.com'].includes(
          origin,
        )
      ) {
        res.writeHead(400);
        res.end();
        return;
      }
      try {
        const response = await fetch(`${origin}/api/commerce/catalog`, {
          signal: AbortSignal.timeout(25000),
          headers: { Accept: 'application/json' },
        });
        res.writeHead(response.status, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        res.end(await response.text());
      } catch {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: 'The restaurant is waking up. Please try again in a moment.' }),
        );
      }
      return;
    }
    return next(req, res, done);
  };
};
module.exports = config;
