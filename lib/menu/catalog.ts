import type { Category, Option, Product } from '@/types';
import { menuPhotos } from './photos';

export const MENU_REVISION = 4;
export const menuCategories: Category[] = [
  ['veg-pizza', 'Veg Pizzas'],
  ['value-pizzas', 'Value Pizzas'],
  ['combos', 'Combos'],
  ['burgers', 'Burgers'],
  ['pasta', 'Pasta'],
  ['garlic-bread', 'Garlic Breads'],
  ['sides', 'Fries & Pizza Puffs'],
  ['pockets', 'Pockets'],
  ['wraps', 'Wraps'],
  ['rice', 'Rice'],
  ['pav-bhaji', 'Pav Bhaji'],
  ['desserts', 'Desserts'],
  ['dips', 'Dips'],
  ['beverages', 'Beverages'],
].map(([id, name], sortOrder) => ({ id, name, slug: id, sortOrder }));

const paise = (rupees: number) => rupees * 100;
function extra(id: string, name: string, prices: [number, number, number]): Option {
  return {
    id,
    name,
    price: paise(prices[0]),
    sizePrices: { small: paise(prices[0]), medium: paise(prices[1]), large: paise(prices[2]) },
  };
}
const pizzaCrusts: Option[] = [
  { id: 'classic', name: 'Classic hand tossed', price: 0 },
  extra('thin', 'Italian thin crust', [30, 60, 90]),
  extra('cheese-burst', 'Cheese burst', [60, 90, 130]),
];
const pizzaExtras: Option[] = [
  extra('real-mozzarella', 'Real mozzarella', [40, 60, 80]),
  extra('extra-cheese', 'Extra cheese', [30, 40, 60]),
  ...[
    'Black olives',
    'Red pepper',
    'Corn',
    'Capsicum',
    'Tomato',
    'Mushroom',
    'Paneer',
    'Pineapple',
    'Jalapeño',
    'Golden corn',
    'Baby corn',
  ].map((name) => extra(name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, [20, 30, 45])),
];
const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// Transcribed from the supplied pizza sheet. Amounts here are rupees; domain objects use paise.
type PizzaRow = [
  name: string,
  group: string,
  prices: [number, number, number],
  ingredients: string,
];
const pizzas: PizzaRow[] = [
  ['Simple Cheese', 'Simple Veg', [90, 210, 280], 'Mozzarella cheese.'],
  ['Cheese Tomato', 'Simple Veg', [95, 220, 280], 'Mozzarella cheese and tomato.'],
  ['Green Chilli Corn', 'Veg 1', [105, 230, 370], 'Green chilli and golden corn.'],
  ['Double Cheese', 'Veg 1', [130, 230, 370], 'Double mozzarella cheese.'],
  ['Fresh Vegi', 'Veg 1', [130, 260, 399], 'Onion, capsicum and mozzarella cheese.'],
  ['Vegi Lover', 'Veg 1', [140, 270, 399], 'Onion, capsicum and golden corn.'],
  ['Real Mozzarella', 'Veg 1', [130, 260, 399], 'Mozzarella cheese.'],
  ['Country Feast', 'Veg 2', [140, 270, 399], 'Onion, capsicum and tomato.'],
  ['Tomato Tandoori', 'Veg 2', [140, 270, 399], 'Corn, tomato and tandoori sauce.'],
  ['Makhani Paneer', 'Veg 2', [140, 270, 399], 'Paneer, capsicum and makhani sauce.'],
  ['Paneer Angara', 'Veg 2', [140, 270, 399], 'Onion, paneer and garlic sauce.'],
  ['French Fri Pizza', 'Veg 2', [140, 270, 399], 'Onion, capsicum and French fries.'],
  ['Spicy Spicy Pizza', 'Veg 2', [140, 270, 399], 'Green chilli, red pepper and jalapeño.'],
  ['Farm Fresh', 'Veg 2', [150, 280, 419], 'Onion, capsicum, tomato and mushroom.'],
  ['Spicy Loaded', 'Veg 2', [150, 300, 419], 'Corn, jalapeño, red pepper and mozzarella.'],
  ['Achari Paneer', 'Pizza Ace Special', [110, 250, 350], 'Achari paneer and mozzarella cheese.'],
  ['Mazza Achari', 'Pizza Ace Special', [105, 230, 320], 'Achari flavour and mozzarella cheese.'],
  [
    'Poney Achari',
    'Pizza Ace Special',
    [180, 350, 440],
    'Onion, capsicum, paneer and jalapeño with achari mozzarella cheese.',
  ],
  [
    'Veg. Paradise',
    'Super Veg',
    [180, 345, 470],
    'Red pepper, capsicum, black olives and baby corn.',
  ],
  [
    'Veg. Triple Tango',
    'Super Veg',
    [180, 345, 470],
    'Red pepper, jalapeño, extra cheese, black olives and golden corn.',
  ],
  [
    'Deluxe Delight',
    'Super Veg',
    [180, 345, 470],
    'Onion, capsicum, mushroom, golden corn and paneer.',
  ],
  [
    'Green House',
    'Super Veg',
    [210, 400, 520],
    'Onion, capsicum, tomato, corn, jalapeño and baby corn.',
  ],
  [
    'Ace Chilli Paneer',
    'Super Veg',
    [210, 400, 520],
    'Mozzarella cheese, chilli paneer, onion, capsicum and spring onion.',
  ],
  [
    'Maxican Pizza',
    'Fire Veg',
    [210, 360, 475],
    'Onion, capsicum, tomato, jalapeño and Maxican herbs.',
  ],
  ['Paneer Paprika', 'Fire Veg', [210, 360, 475], 'Paneer, capsicum, tomato and extra cheese.'],
  ['Spicy Fire', 'Fire Veg', [210, 360, 475], 'Onion, golden corn, red paprika and jalapeño.'],
  [
    'Paneer Peppy',
    'Fire Veg',
    [210, 400, 520],
    'Paneer, capsicum, red paprika, jalapeño and red chilli.',
  ],
  [
    'Classic Pizza',
    'Fire Veg',
    [200, 350, 460],
    'Golden corn, jalapeño, black olives, onion and extra cheese.',
  ],
  [
    'Ace Exotica Pizza',
    'Fire Veg',
    [210, 400, 520],
    'Red pepper, capsicum, golden corn, baby corn, pineapple and black olives.',
  ],
  [
    'Ace Spicy Twist',
    'Fire Veg',
    [210, 400, 520],
    'Mozzarella, baby corn, corn, jalapeño, pineapple and green chilli.',
  ],
  [
    'Veg Supreme',
    'Heavy Veg',
    [220, 420, 570],
    'Onion, capsicum, tomato, jalapeño, baby corn, mushroom and paneer.',
  ],
  [
    'Tanduri Paneer',
    'Heavy Veg',
    [230, 475, 630],
    'Onion, capsicum, tomato, jalapeño, baby corn, tandoori paneer and extra cheese.',
  ],
  [
    'Tanduri Mushroom',
    'Heavy Veg',
    [230, 475, 630],
    'Onion, capsicum, red pepper, jalapeño, tandoori mushroom, black olives and extra cheese.',
  ],
  [
    'Spicy Veg Wonder',
    'Heavy Veg',
    [230, 475, 630],
    'Crispy capsicum, red pepper, paneer, baby corn, jalapeño, black olives and mushroom.',
  ],
  [
    'Tanduri Tomato',
    'Heavy Veg',
    [230, 475, 630],
    'Onion, capsicum, red paprika, tomato, tandoori sauce, paneer and extra cheese.',
  ],
  [
    'Ace Paneer Vegi',
    'Ace Best Seller',
    [170, 330, 490],
    'Fresh onion, capsicum, tomato, paneer and extra cheese.',
  ],
  [
    'Ace Pasta Pizza',
    'Ace Best Seller',
    [170, 330, 490],
    'Pizza loaded with red saucy pasta, onion, capsicum, corn and extra cheese.',
  ],
  [
    'Delight Golden Corn',
    'Ace Best Seller',
    [170, 330, 490],
    'Fresh onion, paneer, spicy golden corn and extra cheese.',
  ],
  [
    'Ace Veg House',
    'Ace Best Seller',
    [170, 330, 490],
    'Fresh onion, red paprika, capsicum, paneer and extra cheese.',
  ],
  [
    'Make Your Choice Pizza with Extra Cheese',
    'Your Choice Pizza',
    [90, 210, 280],
    'Add your favourite toppings; extra topping charges apply.',
  ],
];
function pizzaProduct(row: PizzaRow): Product {
  const [name, group, prices, description] = row;
  const id = `hpa-${slug(name)}`;
  return {
    id,
    slug: slug(name),
    name,
    description,
    image: '/images/menu/photo-coming-soon.svg',
    categoryId: 'veg-pizza',
    vegetarian: true,
    price: paise(prices[0]),
    available: true,
    featured: group === 'Ace Best Seller',
    bestseller: group === 'Ace Best Seller',
    badge: group,
    sizes: [
      { id: 'small', name: 'Small · 7 inch', price: paise(prices[0]) },
      { id: 'medium', name: 'Medium · 10 inch', price: paise(prices[1]) },
      { id: 'large', name: 'Large · 12 inch', price: paise(prices[2]) },
    ],
    crusts: structuredClone(pizzaCrusts),
    toppings: structuredClone(pizzaExtras),
  };
}
type DishRow = [name: string, price: number, description: string];
function dishes(categoryId: string, rows: DishRow[]): Product[] {
  return rows.map(([name, price, description]) => ({
    id: `hpa-${slug(name)}`,
    slug: slug(name),
    name,
    description,
    image: '/images/menu/photo-coming-soon.svg',
    categoryId,
    vegetarian: true,
    price: paise(price),
    available: true,
    featured: false,
    bestseller: false,
    sizes: [],
    crusts: [],
    toppings: [],
  }));
}

const valuePizzas = dishes('value-pizzas', [
  ['Veg Single', 85, 'Onion, corn, tomato and capsicum.'],
  ['Corn & Paneer', 119, 'A pizza with corn and paneer.'],
  ['Spicy Corn & Capsicum', 119, 'A spicy pizza with corn and capsicum.'],
  ['Paneer & Capsicum', 119, 'A pizza with paneer and capsicum.'],
  ['Onion & Capsicum', 109, 'A pizza with onion and capsicum.'],
  ['Onion & Corn', 109, 'A pizza with onion and corn.'],
  ['Tomato & Corn', 109, 'A pizza with tomato and corn.'],
  ['Tomato & Capsicum', 109, 'A pizza with tomato and capsicum.'],
  ['Onion & Redpepper', 109, 'A pizza with onion and red pepper.'],
  ['Spicy Paneer', 119, 'A pizza with spicy paneer.'],
  ['Onion & Paneer', 109, 'A pizza with onion and paneer.'],
  ['Jalapeno & Corn', 109, 'A pizza with jalapeño and corn.'],
  ['Babycorn & Capsicum', 109, 'A pizza with baby corn and capsicum.'],
]);
const pasta = dishes('pasta', [
  ['Italian Red Pasta', Math.max(99, 109), 'Pasta with Italian-style red sauce.'],
  ['Italian White Pasta', Math.max(99, 109), 'Pasta with Italian-style white sauce.'],
]);
const sides = dishes('sides', [
  ['French Fries', Math.max(70, 80), 'A portion of French fries.'],
  ['Masala French Fries', Math.max(85, 90), 'French fries with masala seasoning.'],
  ['Pizza Puff (3 Pieces)', Math.max(110, 129), 'Three pizza puffs.'],
]);
const breads = dishes('garlic-bread', [
  ['Garlic Bread Plain', 85, 'Plain garlic bread.'],
  ['Cheese Garlic Bread', 99, 'Garlic bread with cheese.'],
  ['Stuffed Garlic Bread', 110, 'Stuffed garlic bread.'],
  ['Chilli Cheese Garlic Bread', 120, 'Garlic bread with chilli and cheese.'],
]);
const pockets = dishes('pockets', [
  ['Pocket Calzone', 99, 'A folded calzone pocket.'],
  ['Pocket Parcel', 60, 'A savoury pocket parcel.'],
]);
const wraps = dishes('wraps', [
  ['Cheese Wrap', 109, 'A cheese wrap.'],
  ['Paneer Cheese Wrap', 129, 'A wrap with paneer and cheese.'],
  ['Aloo Tikki Cheese Wrap', 119, 'A wrap with aloo tikki and cheese.'],
  ['Mix Special Cheese Wrap', 159, 'The menu’s mix special cheese wrap.'],
]);
const burgers = dishes('burgers', [
  ['Aloo Tikki Burger', 50, 'A burger with aloo tikki.'],
  ['Cheese Burger', 69, 'A vegetarian cheese burger.'],
  ['Veg Hariyali Burger', 60, 'A vegetarian hariyali burger.'],
  ['Spicy Burger', 65, 'A spicy vegetarian burger.'],
  ['Paneer Burger', 80, 'A burger with paneer.'],
  ['Tandoori Paneer Burger', 85, 'A burger with tandoori paneer.'],
  ['Double Cheese Burger', 100, 'A burger with double cheese.'],
]);
const rice = dishes('rice', [
  ['Veg Fried Rice', 80, 'Vegetarian fried rice. Half and full portions available.'],
  ['Chilli Fried Rice', 100, 'Chilli fried rice. Half and full portions available.'],
  ['Paneer Fried Rice', 100, 'Paneer fried rice. Half and full portions available.'],
  ['Mushroom Fried Rice', 100, 'Mushroom fried rice. Half and full portions available.'],
]).map((product, index) => ({
  ...product,
  sizes: [
    { id: 'half', name: 'Half', price: product.price },
    { id: 'full', name: 'Full', price: paise(index === 0 ? 140 : 170) },
  ],
}));
const pav = dishes('pav-bhaji', [
  ['Pav Bhaji', 80, 'Pav served with bhaji.'],
  ['Extra Pav', 20, 'An extra serving of pav.'],
  ['Extra Bhaji', 40, 'An extra serving of bhaji.'],
]);
const desserts = dishes('desserts', [
  ['Choco Lava Cake', 80, 'Chocolate lava cake.'],
  ['Hot Chocolate Browny with Ice Cream', 105, 'Hot chocolate brownie served with ice cream.'],
]);
const dips = dishes('dips', [
  ['Cheese Dip', 25, 'Cheese dip.'],
  ['Jalapeno Cheese Dip', 30, 'Jalapeño cheese dip.'],
  ['Orgeno Cheese Dip', 30, 'Oregano cheese dip.'],
  ['Thousand Dip', 25, 'Thousand dip, as listed on the printed menu.'],
  ['Peri Peri Dip', 25, 'Peri peri dip.'],
]);
const combos = dishes('combos', [
  ['Combo 1', 140, 'French fries, cheese burger and Coke 250 ml.'],
  [
    'Combo 2',
    330,
    'Three pizzas: onion capsicum, tomato corn and jalapeño corn, with Coke 750 ml.',
  ],
  [
    'Combo 3',
    399,
    'Set of four pizzas: cheese, corn pineapple, baby corn capsicum and onion red pepper.',
  ],
  ['Combo 4', 249, 'Set of two pizzas: green chilli corn and onion capsicum, with Coke 750 ml.'],
  ['Combo 5', 410, 'Four pizzas: onion capsicum, tomato capsicum, onion paneer and jalapeño corn.'],
  ['Combo 6', 179, 'Spicy aloo tikki burger, red pepper paneer pizza and Coke 250 ml.'],
  ['Combo 7', 130, 'Red pepper paneer pizza with Coke 250 ml.'],
  ['Combo 8 · Friendship Combo', 289, 'Peri peri medium pizza and Coke 750 ml.'],
  [
    'Combo 9 · Veg Single Combo',
    349,
    'Cheese onion, cheese capsicum, cheese tomato and cheese corn pizzas.',
  ],
  [
    'Combo 10 · Party Pack',
    549,
    'Five small pizzas: onion capsicum, tomato capsicum, onion paneer, jalapeño corn and onion corn, with Coke 1.25 L.',
  ],
]);
const beverages = dishes('beverages', [
  ['Fruit Juice', 70, 'Fruit juice. Ask the restaurant about available flavours.'],
  ['Cold Coffee', 75, 'Cold coffee.'],
  ['Chocolate Milk Shake', 75, 'Chocolate milk shake.'],
  ['Vanila Milk Shake', 70, 'Vanilla milk shake.'],
  ['Strawberry Milk Shake', 75, 'Strawberry milk shake.'],
  ['Kaju Butter Scotch', 80, 'Kaju butterscotch shake.'],
  ['Rabdi Milk Shake', 80, 'Rabdi milk shake.'],
  ['Hot Coffee', 60, 'Hot coffee.'],
  ['Blue Carlo Mojito', 60, 'Blue Carlo mojito.'],
  ['Mint Mojito', 75, 'Mint mojito.'],
  ['Blue Berry Mojito', 75, 'Blueberry mojito.'],
  ['Green Apple Mojito', 75, 'Green apple mojito.'],
]);

/** Names and prices from both user-supplied sheets; overlapping prices use the maximum. */
export const menuProducts: Product[] = (
  [
    ...pizzas.map(pizzaProduct),
    ...valuePizzas,
    ...combos,
    ...burgers,
    ...pasta,
    ...breads,
    ...sides,
    ...pockets,
    ...wraps,
    ...rice,
    ...pav,
    ...desserts,
    ...dips,
    ...beverages,
  ] satisfies Product[]
).map((product) => ({
  ...product,
  image: menuPhotos[product.slug] ?? '/images/menu/photo-coming-soon.svg',
}));
