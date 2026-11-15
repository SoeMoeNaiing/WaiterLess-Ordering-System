#!/usr/bin/env node
import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { resolve } from 'node:path';

const DB_PATH = resolve(process.env.DB_PATH || './data/restaurant.db');
const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

// Unsplash images sized 400x400, cropped. If any 404, the menu page falls back to placeholder.svg.
const u = (id) => `https://images.unsplash.com/photo-${id}?w=400&h=400&fit=crop&auto=format`;

// ---------- Data to seed ----------

const CATEGORIES = [
  { name: 'Starters', sort_order: 1 },
  { name: 'Mains',    sort_order: 2 },
  { name: 'Drinks',   sort_order: 3 },
  { name: 'Desserts', sort_order: 4 },
];

const ITEMS = [
  // Starters
  { cat: 'Starters', name: 'Spring Rolls',    desc: 'Crispy veggie rolls with sweet chili sauce',   price: 4500,  img: u('1544025162-d76694265947') },
  { cat: 'Starters', name: 'Chicken Wings',   desc: 'Six pieces, choice of buffalo or BBQ',         price: 8000,  img: u('1608039755401-742074f0548d') },
  { cat: 'Starters', name: 'Garlic Bread',    desc: 'Toasted sourdough with garlic butter',         price: 3500,  img: u('1573140247632-f8fd74997d5c') },
  { cat: 'Starters', name: 'Bruschetta',      desc: 'Tomato, basil, olive oil on toasted bread',    price: 5000,  img: u('1572695157366-5e585ab2b69f') },

  // Mains
  { cat: 'Mains',    name: 'Classic Burger',  desc: 'Beef patty, lettuce, tomato, cheddar',         price: 12000, img: u('1568901346375-23c9450c58cd') },
  { cat: 'Mains',    name: 'Pizza Margherita', desc: 'Tomato, mozzarella, fresh basil',             price: 11000, img: u('1513104890138-7c749659a591') },
  { cat: 'Mains',    name: 'Pasta Carbonara', desc: 'Creamy egg sauce, pancetta, parmesan',         price: 13500, img: u('1621996346565-e3dbc646d9a9') },
  { cat: 'Mains',    name: 'Grilled Chicken', desc: 'Herb marinated, roasted vegetables',           price: 15000, img: u('1598103442097-8b74394b95c6') },
  { cat: 'Mains',    name: 'Beef Steak',      desc: '300g ribeye, side salad, fries',               price: 24000, img: u('1546964124-0cce460f38ef') },

  // Drinks
  { cat: 'Drinks',   name: 'Coca Cola',       desc: '330ml can, chilled',                           price: 2000,  img: u('1554866585-cd94860890b7') },
  { cat: 'Drinks',   name: 'Orange Juice',    desc: 'Fresh squeezed, no added sugar',               price: 3500,  img: u('1600271886742-f049cd451bba') },
  { cat: 'Drinks',   name: 'Iced Latte',      desc: 'Double shot espresso, cold milk, ice',         price: 4000,  img: u('1461023058943-07fcbe16d735') },
  { cat: 'Drinks',   name: 'Craft Beer',      desc: 'Local IPA, 330ml',                             price: 5500,  img: u('1608270586620-248524c67de9') },

  // Desserts
  { cat: 'Desserts', name: 'Chocolate Cake',  desc: 'Rich dark chocolate, cream frosting',          price: 6000,  img: u('1578985545062-69928b1d9587') },
  { cat: 'Desserts', name: 'Cheesecake',      desc: 'New York style, berry coulis',                 price: 6500,  img: u('1533132424583-f94c253e0cfc') },
  { cat: 'Desserts', name: 'Ice Cream',       desc: 'Two scoops, choice of flavor',                 price: 4000,  img: u('1567206563064-6f60f40a2b57'), sold_out: true },
];

// Option groups: keyed by item name
const OPTION_GROUPS = {
  'Classic Burger': [
    {
      name: 'Cook', required: true, single: true,
      choices: [
        { name: 'Medium rare' },
        { name: 'Medium', default: true },
        { name: 'Well done' },
      ],
    },
    {
      name: 'Add-ons', required: false, single: false,
      choices: [
        { name: 'Extra cheese' },
        { name: 'Bacon' },
        { name: 'Fried egg' },
      ],
    },
  ],
  'Pizza Margherita': [
    {
      name: 'Size', required: true, single: true,
      choices: [
        { name: '8 inch', default: true },
        { name: '12 inch' },
      ],
    },
    {
      name: 'Extra toppings', required: false, single: false,
      choices: [
        { name: 'Mushrooms' },
        { name: 'Olives' },
        { name: 'Pepperoni' },
      ],
    },
  ],
  'Iced Latte': [
    {
      name: 'Milk', required: true, single: true,
      choices: [
        { name: 'Regular', default: true },
        { name: 'Soy' },
        { name: 'Oat' },
      ],
    },
    {
      name: 'Sugar', required: false, single: true,
      choices: [
        { name: 'None' },
        { name: 'Less', default: true },
        { name: 'Normal' },
      ],
    },
  ],
  'Beef Steak': [
    {
      name: 'Doneness', required: true, single: true,
      choices: [
        { name: 'Rare' },
        { name: 'Medium rare', default: true },
        { name: 'Medium' },
        { name: 'Well done' },
      ],
    },
    {
      name: 'Sauce', required: false, single: true,
      choices: [
        { name: 'Pepper', default: true },
        { name: 'BBQ' },
        { name: 'Mushroom' },
      ],
    },
  ],
  'Spring Rolls': [
    {
      name: 'Dip', required: false, single: true,
      choices: [
        { name: 'Sweet chili', default: true },
        { name: 'Peanut' },
        { name: 'None' },
      ],
    },
  ],
};

const TABLES = [
  { number: 'T1', label: 'Window' },
  { number: 'T2', label: 'Window' },
  { number: 'T3', label: 'Center' },
  { number: 'T4', label: 'Center' },
  { number: 'T5', label: 'Patio' },
  { number: 'T6', label: 'Patio' },
  { number: 'T7', label: 'Bar 1' },
  { number: 'T8', label: 'Bar 2' },
];

// ---------- Seed logic (idempotent) ----------

const stats = { categories: 0, items: 0, groups: 0, choices: 0, tables: 0 };

function seedCategories() {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO categories (name, sort_order) VALUES (?, ?)'
  );
  for (const c of CATEGORIES) {
    const r = insert.run(c.name, c.sort_order);
    if (r.changes > 0) stats.categories++;
  }
}

function seedTables() {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO tables (table_number, label, qr_token) VALUES (?, ?, ?)'
  );
  for (const t of TABLES) {
    const r = insert.run(t.number, t.label, nanoid(12));
    if (r.changes > 0) stats.tables++;
  }
}

function seedItems() {
  const getCat = db.prepare('SELECT id FROM categories WHERE name = ?');
  const getItem = db.prepare('SELECT id FROM menu_items WHERE name = ?');
  const insert = db.prepare(
    `INSERT INTO menu_items
       (category_id, name, description, price, image_path, is_available)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  for (const it of ITEMS) {
    const exists = getItem.get(it.name);
    if (exists) continue;

    const catRow = getCat.get(it.cat);
    if (!catRow) {
      console.warn(`[seed] category "${it.cat}" missing, skipping item ${it.name}`);
      continue;
    }

    insert.run(
      catRow.id,
      it.name,
      it.desc,
      it.price,
      it.img,
      it.sold_out ? 0 : 1
    );
    stats.items++;
  }
}

function seedOptions() {
  const getItem = db.prepare('SELECT id FROM menu_items WHERE name = ?');
  const delGroups = db.prepare('DELETE FROM menu_item_option_groups WHERE menu_item_id = ?');
  const insertGroup = db.prepare(
    `INSERT INTO menu_item_option_groups
       (menu_item_id, name, is_required, is_single_choice, sort_order)
     VALUES (?, ?, ?, ?, ?)`
  );
  const insertChoice = db.prepare(
    `INSERT INTO menu_item_option_choices
       (group_id, name, is_default, sort_order)
     VALUES (?, ?, ?, ?)`
  );

  for (const [itemName, groups] of Object.entries(OPTION_GROUPS)) {
    const item = getItem.get(itemName);
    if (!item) continue;

    // Idempotent: if this item already has groups, skip
    const existing = db.prepare(
      'SELECT COUNT(*) AS c FROM menu_item_option_groups WHERE menu_item_id = ?'
    ).get(item.id).c;
    if (existing > 0) continue;

    groups.forEach((g, gi) => {
      const r = insertGroup.run(
        item.id,
        g.name,
        g.required ? 1 : 0,
        g.single ? 1 : 0,
        gi
      );
      stats.groups++;
      const groupId = r.lastInsertRowid;

      g.choices.forEach((c, ci) => {
        insertChoice.run(groupId, c.name, c.default ? 1 : 0, ci);
        stats.choices++;
      });
    });
  }
}

// ---------- Run ----------

console.log(`[seed] database: ${DB_PATH}`);

const tx = db.transaction(() => {
  seedCategories();
  seedTables();
  seedItems();
  seedOptions();
});
tx();

console.log('[seed] done');
console.log(`  categories added: ${stats.categories}`);
console.log(`  items added:      ${stats.items}`);
console.log(`  option groups:    ${stats.groups}`);
console.log(`  option choices:   ${stats.choices}`);
console.log(`  tables added:     ${stats.tables}`);
console.log('');

if (stats.categories + stats.items + stats.tables === 0) {
  console.log('[seed] nothing to do — everything already exists.');
  console.log('[seed] to force reseed, delete data/restaurant.db and run npm start first, then npm run seed.');
} else {
  console.log('[seed] open admin at /admin/ to see the data.');
  console.log('[seed] open any table QR to see the menu with images.');
}

db.close();
