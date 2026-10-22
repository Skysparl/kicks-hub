import { cartItems as cartApi } from './api.js';
import { MAX_QTY_PER_LINE, FREE_DELIVERY_THRESHOLD } from './config.js';
import { formatSize } from './ui.js';

export class CartError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CartError';
    }
}

export function getUnitPrice(product) {
  const { price, salePrice } = product;
  return Number.isFinite(salePrice) && salePrice > 0 && salePrice < price ? salePrice : price;
}

export function getVariant(product, colourName) {
  const wanted = String(colourName ?? '').toLowerCase();
  return product.colours?.find((c) => c.name.toLowerCase() === wanted) ?? null;
}

export function getAvailableStock(product, colourName, size) {
  const variant = getVariant(product, colourName);
  return Number(variant?.sizes?.[String(size)] ?? 0);
}

export function getSizesInStock(product, colourName) {
  const variant = getVariant(product, colourName);
  if (!variant) return [];
  return Object.entries(variant.sizes)
    .filter(([, qty]) => qty > 0)
    .map(([size]) => size)
    .sort((a, b) => Number(a) - Number(b));
}

export function findLine(items, { productId, colour, size }) {
  return items.find(
    (i) => i.productId === productId && i.colour === colour && String(i.size) === String(size),
  ) ?? null;
}

export const lineTotal = (item) => item.unitPrice * item.quantity;

export const countItems = (items) => items.reduce((sum, i) => sum + i.quantity, 0);

export const calculateSubtotal = (items) => items.reduce((sum, i) => sum + lineTotal(i), 0);

export function calculateDeliveryFee(subtotal, zone) {
  if (!zone || subtotal <= 0) return 0;
  return subtotal >= FREE_DELIVERY_THRESHOLD ? 0 : zone.fee;
}

export function calculateTotals(items, zone = null) {
  const subtotal = calculateSubtotal(items);
  const deliveryFee = calculateDeliveryFee(subtotal, zone);
  return {
    itemCount: countItems(items),
    subtotal,
    deliveryFee,
    total: subtotal + deliveryFee,
    freeDeliveryGap: subtotal > 0 ? Math.max(0, FREE_DELIVERY_THRESHOLD - subtotal) : 0,
  };
}

export function validateQuantity(product, colour, size, quantity) {
  if (!Number.isInteger(quantity) || quantity < 1) return 'Choose a quantity of at least 1.';
  if (quantity > MAX_QTY_PER_LINE) return `You can buy up to ${MAX_QTY_PER_LINE} pairs of one size at a time.`;
  const stock = getAvailableStock(product, colour, size);
  if (stock === 0) return `${product.name} in ${colour}, ${formatSize(size)} is sold out.`;
  if (quantity > stock) return `Only ${stock} ${stock === 1 ? 'pair' : 'pairs'} left in ${formatSize(size)}.`;
  return null;
}

export function validateAddToCart(product, { colour, size, quantity = 1 }, items = []) {
  if (!product || product.active === false) return 'This shoe is no longer available.';
  if (!getVariant(product, colour)) return 'Choose a colour.';
  if (size === undefined || size === null || size === '') return 'Choose your UK size.';
  const existing = findLine(items, { productId: product.id, colour, size });
  return validateQuantity(product, colour, size, (existing?.quantity ?? 0) + quantity);
}

export function buildLine(product, { colour, size, quantity = 1 }) {
  const variant = getVariant(product, colour);
  return {
    productId: product.id,
    name: product.name,
    brand: product.brand,
    image: variant.image,
    colour: variant.name,
    size: String(size),
    quantity,
    unitPrice: getUnitPrice(product),
  };
}

export function reconcileCart(items, productList) {
  const byId = new Map(productList.map((p) => [p.id, p]));
  const issues = [];
  const updated = items.map((item) => {
    const product = byId.get(item.productId);
    if (!product || product.active === false) {
      issues.push({ lineId: item.id, message: `${item.name} is no longer available. Remove it to continue.` });
      return item;
    }
    const stockError = validateQuantity(product, item.colour, item.size, item.quantity);
    if (stockError) issues.push({ lineId: item.id, message: stockError });

    const current = getUnitPrice(product);
    if (current !== item.unitPrice) {
      issues.push({ lineId: item.id, message: `The price of ${item.name} changed to KES ${current.toLocaleString('en-KE')}.` });
      return { ...item, unitPrice: current };
    }
    return item;
  });
  return { items: updated, issues };
}

export function createCart({ api = cartApi } = {}) {
  let items = [];
  const listeners = new Set();

  const snapshot = () => items.map((i) => ({ ...i }));
  const emit = () => listeners.forEach((fn) => fn(snapshot()));
  const setItems = (next) => { items = next; emit(); };

  async function optimistic(next, serverCall) {
    const previous = items;
    setItems(next);
    try {
      return await serverCall();
    } catch (err) {
      setItems(previous);
      throw err;
    }
  }

  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    getItems: snapshot,

    getTotals: (zone) => calculateTotals(items, zone),

    async load() {
      setItems(await api.list());
      return snapshot();
    },

    async add(product, selection) {
      const quantity = selection.quantity ?? 1;
      const error = validateAddToCart(product, { ...selection, quantity }, items);
      if (error) throw new CartError(error);

      const existing = findLine(items, { productId: product.id, colour: selection.colour, size: selection.size });
      if (existing) return this.setQuantity(existing.id, existing.quantity + quantity, product);

      const created = await api.create(buildLine(product, { ...selection, quantity }));
      setItems([...items, created]);
      return created;
    },

    async setQuantity(lineId, quantity, product = null) {
      const line = items.find((i) => i.id === lineId);
      if (!line) throw new CartError('That item is no longer in your cart.');
      if (quantity === 0) return this.remove(lineId);

      const error = product
        ? validateQuantity(product, line.colour, line.size, quantity)
        : (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY_PER_LINE
          ? `Choose between 1 and ${MAX_QTY_PER_LINE} pairs.` : null);
      if (error) throw new CartError(error);

      const next = items.map((i) => (i.id === lineId ? { ...i, quantity } : i));
      return optimistic(next, () => api.update(lineId, { quantity }));
    },

    async remove(lineId) {
      if (!items.some((i) => i.id === lineId)) return null;
      return optimistic(items.filter((i) => i.id !== lineId), () => api.remove(lineId));
    },

    async clear() {
      const ids = items.map((i) => i.id);
      return optimistic([], () => Promise.all(ids.map((id) => api.remove(id))));
    },

    async applyReconciled(updatedItems) {
      const changed = updatedItems.filter((u) => {
        const old = items.find((i) => i.id === u.id);
        return old && old.unitPrice !== u.unitPrice;
      });
      return optimistic(updatedItems, () => Promise.all(changed.map((c) => api.update(c.id, { unitPrice: c.unitPrice }))));
    },
  };
}