// Shared food symbols for the website and customer app. Never depend on category order.
export const foodIconPaths = {
  menu: ['M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z'],
  pizza: ['M3 20 9 3c6 1 10 5 12 11L3 20Z', 'M8 6c5 1 8 4 10 9', 'M9 12h.01 M13 15h.01 M7 17h.01'],
  burger: [
    'M3 10C3 1 21 1 21 10H3Z',
    'M3 13h18 M3 16l4-1 5 2 5-2 4 1',
    'M3 19h18c0 2-2 3-4 3H7c-2 0-4-1-4-3Z',
    'M8 6h.01 M12 5h.01 M16 6h.01',
  ],
  drink: ['M6 7h12l-2 14H8L6 7Z', 'M5 7h14 M13 7l2-5h5', 'M8 12h8'],
  bread: [
    'M3 12c0-5 5-9 12-9 4 0 6 2 6 5 0 6-5 13-11 13-4 0-7-4-7-9Z',
    'm9 6 3 3 M6 10l3 3 M5 15l3 3',
  ],
  fries: ['M5 11h14l-2 11H7L5 11Z', 'M7 11V3h3v8 M10 11V1h3v10 M13 11V4h3v7 M16 11V2h3v9'],
  momo: [
    'M2 15c1-4 5-8 10-10 5 2 9 6 10 10-1 5-19 5-20 0Z',
    'M12 5v8 M8 7l1 6 M16 7l-1 6 M5 10l2 4 M19 10l-2 4',
    'M3 16c5 2 13 2 18 0',
  ],
  noodles: [
    'M3 13h18c-1 6-4 8-9 8s-8-2-9-8Z',
    'M7 13V8c0-3 3-3 3 0v5 M13 13V6c0-3 3-3 3 0v7',
    'm5 3 16 5 M6 1l15 4',
  ],
  pasta: [
    'm4 7 4-4 4 4-4 4-4-4Z M12 16l4-4 4 4-4 4-4-4Z',
    'm6 7 2-2 M14 16l2-2 M3 17l4-4 4 4-4 4-4-4Z',
  ],
  rice: [
    'M3 13h18c-1 5-4 8-9 8s-8-3-9-8Z',
    'M5 13c0-9 14-9 14 0',
    'm8 9 1 1 m3-3 1 1 m2 2 1 1 M5 22h14',
  ],
  wrap: [
    'm6 4 12 3-4 15-5-1L5 7 6 4Z',
    'M6 4c2-4 13-1 12 3-1 3-13 0-12-3Z',
    'm7 11 9 3 M10 3l1 2 M14 4l1 2',
  ],
  pocket: ['M3 17 12 4l9 13c-5 5-13 5-18 0Z', 'm6 17 6-9 6 9 M9 16h.01 M13 14h.01 M15 18h.01'],
  dessert: ['M3 11 17 4l4 7v10H3V11Z', 'M3 11h18 M3 16h18 M17 4V2'],
  dip: ['M5 11h14l-2 9H7l-2-9Z', 'M5 11c0-5 14-5 14 0 M4 7l3-3 4 2-3 3 M14 5h6'],
  combo: ['M2 15h12v7H2z M3 12c0-6 10-6 10 0H3Z', 'M16 8h6l-1 14h-5 M19 8l1-6h3'],
  pav: ['M2 10c0-5 9-5 9 0v7H2v-7Z M2 12h9', 'M13 13h9c0 6-9 6-9 0Z M15 10h5 M15 21h5'],
  chinese: ['M3 13h18c-1 6-4 8-9 8s-8-2-9-8Z', 'm4 3 17 7 M7 1l14 6 M7 13l3-4 4 4 3-3'],
} as const;
export type FoodIconKind = keyof typeof foodIconPaths;
export function foodIconKind(category?: {
  id?: string;
  name?: string;
  slug?: string;
}): FoodIconKind {
  const name =
    `${category?.name || ''} ${category?.slug || ''} ${category?.id || ''}`.toLowerCase();
  if (/burger/.test(name)) return 'burger';
  if (/beverage|drink|shake|coffee|juice|soda/.test(name)) return 'drink';
  if (/momo|dumpling/.test(name)) return 'momo';
  if (/garlic|bread/.test(name)) return 'bread';
  if (/fries|french/.test(name)) return 'fries';
  if (/pasta/.test(name)) return 'pasta';
  if (/maggi|noodle/.test(name)) return 'noodles';
  if (/rice/.test(name)) return 'rice';
  if (/wrap|roll/.test(name)) return 'wrap';
  if (/pocket|calzone/.test(name)) return 'pocket';
  if (/dessert|cake|brownie|ice.cream/.test(name)) return 'dessert';
  if (/dip|sauce/.test(name)) return 'dip';
  if (/combo|meal/.test(name)) return 'combo';
  if (/pav|bhaji/.test(name)) return 'pav';
  if (/chinese/.test(name)) return 'chinese';
  if (/pizza/.test(name)) return 'pizza';
  return 'menu';
}
