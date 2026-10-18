import type { Category, Customer, Order, Product, RestaurantSettings } from '../types';

export const initialCategories: Category[] = [
  { id: 'veg-pizza', name: 'Veg Pizza', slug: 'veg-pizza', sortOrder: 0 },
  { id: 'non-veg-pizza', name: 'Non-Veg Pizza', slug: 'non-veg-pizza', sortOrder: 1 },
  { id: 'garlic-bread', name: 'Garlic Bread', slug: 'garlic-bread', sortOrder: 2 },
  { id: 'burgers', name: 'Burgers', slug: 'burgers', sortOrder: 3 },
  { id: 'sides', name: 'Sides', slug: 'sides', sortOrder: 4 },
  { id: 'beverages', name: 'Beverages', slug: 'beverages', sortOrder: 5 },
  { id: 'combos', name: 'Combos', slug: 'combos', sortOrder: 6 },
];

const crusts = [
  { id: 'classic', name: 'Classic hand-tossed', price: 0 },
  { id: 'thin', name: 'Thin & crispy', price: 3000 },
  { id: 'cheese-burst', name: 'Cheese burst', price: 8000 },
];
const toppings = [
  { id: 'extra-cheese', name: 'Extra mozzarella', price: 4500 },
  { id: 'jalapenos', name: 'Jalapeños', price: 2500 },
  { id: 'olives', name: 'Black olives', price: 3000 },
  { id: 'mushrooms', name: 'Mushrooms', price: 3500 },
];

function pizza(
  id: string,
  name: string,
  description: string,
  price: number,
  vegetarian = true,
  flags: Partial<Product> = {},
): Product {
  return {
    id,
    name,
    slug: id,
    description,
    image: `/images/${id}.jpg`,
    categoryId: vegetarian ? 'veg-pizza' : 'non-veg-pizza',
    vegetarian,
    price,
    available: true,
    featured: false,
    bestseller: false,
    sizes: [
      { id: 'regular', name: 'Regular · 7"', price },
      { id: 'medium', name: 'Medium · 10"', price: price + 15000 },
      { id: 'large', name: 'Large · 12"', price: price + 30000 },
    ],
    crusts: structuredClone(crusts),
    toppings: structuredClone(toppings),
    ...flags,
  };
}

function dish(
  id: string,
  name: string,
  description: string,
  categoryId: string,
  price: number,
  flags: Partial<Product> = {},
): Product {
  return {
    id,
    slug: id,
    name,
    description,
    categoryId,
    price,
    image: `/images/${id}.jpg`,
    vegetarian: true,
    available: true,
    featured: false,
    bestseller: false,
    sizes: [],
    crusts: [],
    toppings: [],
    ...flags,
  };
}

/** Illustrative demo menu; these are not the restaurant's confirmed prices. */
export const initialProducts: Product[] = [
  pizza(
    'margherita',
    'The Margherita',
    'Our signature tomato sauce, creamy mozzarella and fresh basil. A timeless, wood-fired classic.',
    24900,
    true,
    { featured: true, bestseller: true, badge: 'THE CLASSIC' },
  ),
  pizza(
    'farmhouse',
    'Farmhouse Feast',
    'Bell peppers, sweet corn, mushrooms and red onion on a generous bed of mozzarella.',
    34900,
    true,
    { featured: true, bestseller: true, badge: 'CROWD FAVOURITE' },
  ),
  pizza(
    'paneer-tikka',
    'Paneer Tikka Fire',
    'Smoky tandoori paneer, crisp capsicum and onion, finished with our spicy makhani drizzle.',
    39900,
    true,
    { featured: true, bestseller: true, badge: 'DESI FAVOURITE' },
  ),
  pizza(
    'pepperoni',
    'Pepperoni Party',
    'Generous pepperoni, stretchy mozzarella and slow-cooked tomato sauce. Big flavour in every slice.',
    44900,
    false,
    { featured: true, bestseller: true, badge: 'ACE SPECIAL' },
  ),
  pizza(
    'veggie-supreme',
    'Garden Supreme',
    'A colourful mix of olives, mushrooms, peppers, sweet corn and jalapeños.',
    37900,
    true,
  ),
  pizza(
    'bbq-chicken',
    'Smoky BBQ Chicken',
    'Tender barbecue chicken, caramelised onion and mozzarella with a smoky BBQ swirl.',
    42900,
    false,
    { featured: true },
  ),
  pizza(
    'chicken-tikka',
    'Chicken Tikka Ace',
    'Tandoori chicken, green peppers and red onion with a bold tikka sauce.',
    44900,
    false,
  ),
  dish(
    'garlic-bread',
    'Golden Garlic Bread',
    'Warm, buttery bread brushed with roasted garlic and parsley. Six golden pieces.',
    'garlic-bread',
    12900,
  ),
  dish(
    'cheesy-garlic-bread',
    'Cheesy Garlic Pull-Apart',
    'Our garlic bread loaded with bubbling mozzarella and a little oregano.',
    'garlic-bread',
    17900,
    { bestseller: true },
  ),
  dish(
    'veggie-burger',
    'Crispy Veg Burger',
    'A crunchy vegetable patty, lettuce, tomato and our house sauce in a toasted bun.',
    'burgers',
    14900,
  ),
  dish(
    'chicken-burger',
    'Crispy Chicken Burger',
    'Golden chicken, crunchy slaw and pepper mayo in a soft toasted bun.',
    'burgers',
    19900,
    { vegetarian: false },
  ),
  dish(
    'peri-peri-fries',
    'Peri Peri Fries',
    'Crisp, golden fries tossed in our punchy peri peri seasoning.',
    'sides',
    11900,
  ),
  dish(
    'choco-lava',
    'Chocolate Lava Cake',
    'A warm chocolate cake with a gooey, molten heart. The perfect final bite.',
    'sides',
    9900,
  ),
  dish(
    'lemonade',
    'Fresh Lime Fizz',
    'Fresh lime, a little sparkle and just the right amount of sweetness. 300 ml.',
    'beverages',
    7900,
  ),
  dish('cola', 'Chilled Cola', 'A chilled 300 ml cola. Made for pizza nights.', 'beverages', 5900),
  dish(
    'pizza-combo',
    'The Perfect Pair',
    'A regular Margherita, golden garlic bread and two chilled colas. Better together.',
    'combos',
    44900,
    { featured: true, badge: 'SAVE ₹47' },
  ),
];

export const initialSettings: RestaurantSettings = {
  name: 'Hot Pizza Ace',
  address: '12, Church Street, Bengaluru, Karnataka 560001',
  phone: '+91 98765 43210',
  openingHours: 'Every day · 11:00 AM – 11:00 PM',
  temporarilyClosed: false,
  acceptingOrders: true,
  deliveryEnabled: true,
  pickupEnabled: true,
  deliveryFee: 4900,
  freeDeliveryThreshold: null,
  minimumOrder: 19900,
  servicePostalCodes: ['560001', '560002', '560003', '560025', '560034', '560038'],
  preparationMinutes: 25,
  paymentMethods: ['upi', 'card', 'cash'],
  couponCode: 'ACE20',
  couponPercent: 20,
  couponMinimum: 49900,
  couponMaximum: 20000,
};

const customers: Customer[] = [
  {
    name: 'Aarav Sharma',
    phone: '9876543210',
    address: '24, Residency Road, Apartment 4B',
    locality: 'Ashok Nagar',
    postalCode: '560025',
    landmark: 'Near the metro station',
    instructions: 'Please ring the doorbell.',
  },
  {
    name: 'Ananya Rao',
    phone: '9988776655',
    address: '',
    locality: '',
    postalCode: '',
    landmark: '',
    instructions: 'Will collect at the counter.',
  },
  {
    name: 'Rohan Mehta',
    phone: '9123456780',
    address: '8, MG Road, Second floor',
    locality: 'MG Road',
    postalCode: '560001',
    landmark: '',
    instructions: '',
  },
];

function sampleOrder(index: number, productIds: string[], overrides: Partial<Order>): Order {
  const date = new Date();
  date.setHours(12, 10 + index * 30, 0, 0);
  if (index > 2) date.setDate(date.getDate() - 1);
  const items = productIds.map((id, itemIndex) => {
    const product = initialProducts.find((item) => item.id === id)!;
    return {
      id: `sample-${index}-${itemIndex}`,
      productId: id,
      name: product.name,
      image: product.image,
      options: product.sizes.length ? [product.sizes[0].name, product.crusts[0].name] : [],
      notes: '',
      quantity: 1,
      unitPrice: product.price,
    };
  });
  const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const deliveryFee = overrides.fulfillment === 'pickup' ? 0 : initialSettings.deliveryFee;
  return {
    id: `demo-order-${index}`,
    number: `HPA-${1041 + index}`,
    createdAt: date.toISOString(),
    customer: structuredClone(customers[index % 2 === 0 ? 0 : 2]),
    fulfillment: 'delivery',
    items,
    subtotal,
    deliveryFee,
    discount: 0,
    total: subtotal + deliveryFee,
    coupon: '',
    paymentMethod: 'upi',
    paymentStatus: 'simulated_paid',
    status: 'delivered',
    ...overrides,
  };
}

export const initialOrders: Order[] = [
  sampleOrder(0, ['paneer-tikka', 'cheesy-garlic-bread', 'cola'], { status: 'preparing' }),
  sampleOrder(1, ['farmhouse', 'lemonade'], {
    fulfillment: 'pickup',
    status: 'picked_up',
    customer: structuredClone(customers[1]),
  }),
  sampleOrder(2, ['pepperoni', 'peri-peri-fries'], {
    status: 'pending',
    paymentMethod: 'cash',
    paymentStatus: 'pending',
  }),
  sampleOrder(3, ['margherita', 'garlic-bread'], { status: 'pending', paymentStatus: 'failed' }),
  sampleOrder(4, ['bbq-chicken', 'cola'], { status: 'cancelled', paymentStatus: 'simulated_paid' }),
  sampleOrder(5, ['margherita', 'paneer-tikka'], { status: 'delivered' }),
];
