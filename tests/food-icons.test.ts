import assert from 'node:assert/strict';
import test from 'node:test';
import { foodIconKind, foodIconPaths } from '../lib/food-icons';
test('food symbols follow category names, including categories added with random IDs', () => {
  const cases = {
    'Veg Pizzas': 'pizza',
    'Value Pizzas': 'pizza',
    Combos: 'combo',
    Burgers: 'burger',
    Pasta: 'pasta',
    'Garlic Breads': 'bread',
    Fries: 'fries',
    Pockets: 'pocket',
    Wraps: 'wrap',
    Rice: 'rice',
    'Pav Bhaji': 'pav',
    Desserts: 'dessert',
    Dips: 'dip',
    Beverages: 'drink',
    Chinese: 'chinese',
    maggi: 'noodles',
    Momos: 'momo',
  };
  for (const [name, expected] of Object.entries(cases).reverse()) {
    const kind = foodIconKind({ id: 'random-category-id', name });
    assert.equal(kind, expected, name);
    assert.ok(foodIconPaths[kind].length);
  }
  assert.equal(foodIconKind({ name: 'Fries & Pizza Puffs' }), 'fries');
  assert.equal(foodIconKind({ name: 'Pizza Combos' }), 'combo');
  assert.equal(foodIconKind({ name: 'New seasonal specials' }), 'menu');
  assert.equal(foodIconKind(), 'menu');
});
