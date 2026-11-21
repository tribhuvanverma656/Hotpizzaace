export const WEBSITE_URL =
  process.env.EXPO_PUBLIC_WEBSITE_URL || 'https://hotpizzaace-development.onrender.com';
const allowed = new Set([
  'https://hotpizzaace.com',
  'https://hotpizzaace-development.onrender.com',
]);
if (!allowed.has(WEBSITE_URL)) throw new Error('Choose an approved Hot Pizza Ace website.');
export const IS_TEST = WEBSITE_URL !== 'https://hotpizzaace.com';
export function imageUrl(path: string): string | undefined {
  if (path.startsWith('/') && !path.startsWith('//')) return `${WEBSITE_URL}${path}`;
  try {
    const u = new URL(path);
    return u.protocol === 'https:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}
