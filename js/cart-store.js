// cart-store.js - keeps each customer's cart in THEIR OWN browser (localStorage).
// This replaces the old /cartItems server calls, so the cart works on GitHub Pages
// and every customer gets a separate cart.

const KEY = 'kicks-hub-cart';
let memory = []; // used only if the browser blocks localStorage (e.g. some private modes)

function read() {
  try {
    const items = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(items) ? items : [];
  } catch {
    return memory;
  }
}

function write(items) {
  memory = items;
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // ignore: the cart still works for this visit through `memory`
  }
}

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Same methods the cart code already uses: list, create, update, remove.
export const cartItems = {
  async list() {
    return read();
  },
  async get(id) {
    const item = read().find((i) => i.id === id);
    if (!item) throw new Error('That item is not in your cart.');
    return item;
  },
  async create(data) {
    const item = { ...data, id: newId() };
    write([...read(), item]);
    return item;
  },
  async update(id, changes) {
    let updated = null;
    write(read().map((i) => (i.id === id ? (updated = { ...i, ...changes }) : i)));
    return updated;
  },
  async remove(id) {
    write(read().filter((i) => i.id !== id));
    return null;
  },
};