import { Linking, Platform } from 'react-native';
import { WEBSITE_URL } from './config';
let opening = false;
/** Keep checkout and Google sign-in in the same system-browser cookie session. */
export async function openCustomerUrl(path: string) {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid customer page.');
  const url = new URL(path, WEBSITE_URL);
  if (url.origin !== WEBSITE_URL) throw new Error('Invalid customer website.');
  if (opening) return;
  opening = true;
  try {
    if (Platform.OS === 'web') {
      // Use the current tab so preview checkout also works when popups are blocked.
      window.location.assign(url.toString());
    } else await Linking.openURL(url.toString());
  } finally {
    opening = false;
  }
}
