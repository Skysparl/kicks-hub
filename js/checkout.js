// checkout.js - the cart page, the delivery details form and the order confirmation.
import { deliveryZones, orders, products } from './api.js';
import { formatKES, formatDate, setImage } from './ui.js';
import { FREE_DELIVERY_THRESHOLD } from './config.js';

// ---------- Helpers (no page needed, so they are easy to test) ----------

// Accepts 0712345678, 0112345678, +254712345678 or 254712345678 (spaces are ignored).
export function isKenyanPhone(phone) {
  const clean = phone.replace(/\s/g, '');
  return /^(?:\+?254|0)[17]\d{8}$/.test(clean);
}

// Turns any accepted phone format into 2547XXXXXXXX (the format M-Pesa uses).
export function normalisePhone(phone) {
  const clean = phone.replace(/\s/g, '').replace(/^\+/, '');
  return clean.startsWith('0') ? `254${clean.slice(1)}` : clean;
}

// Checks the delivery form. Returns { fieldName: 'message' } (empty object = all good).
export function validateDelivery(values) {
  const errors = {};
  if (values.name.trim().length < 3) errors.name = 'Enter your full name.';
  if (!isKenyanPhone(values.phone)) errors.phone = 'Enter a Kenyan number, e.g. 0712 345 678.';
  if (!values.zoneId) errors.zoneId = 'Choose where we should deliver.';
  if (values.location.trim().length < 5) errors.location = 'Tell the rider where to find you (estate, street, building).';
  if (values.payment !== 'mpesa' && values.payment !== 'cod') errors.payment = 'Choose how you will pay.';
  return errors;
}

// Builds the order that gets saved with POST /orders.
export function buildOrder(items, zone, values, totals) {
  return {
    customer: {
      name: values.name.trim(),
      phone: normalisePhone(values.phone),
      location: values.location.trim(),
      notes: values.notes.trim(),
    },
    zone: { id: zone.id, name: zone.name, fee: zone.fee },
    items: items.map((item) => ({
      productId: item.productId,
      name: item.name,
      colour: item.colour,
      size: item.size,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
    })),
    subtotal: totals.subtotal,
    deliveryFee: totals.deliveryFee,
    total: totals.total,
    payment: values.payment,
    status: values.payment === 'mpesa' ? 'paid' : 'pending',
  };
}

// ---------- Page code ----------

let cart;
let zones = [];

const cartLines = document.getElementById('cart-lines');
const cartMessage = document.getElementById('cart-message');
const cartZone = document.getElementById('cart-zone');
const cartTotals = document.getElementById('cart-totals');
const freeNote = document.getElementById('cart-free-note');
const toCheckout = document.getElementById('to-checkout');

const form = document.getElementById('checkout-form');
const coZone = document.getElementById('co-zone');
const coLines = document.getElementById('co-lines');
const coTotals = document.getElementById('co-totals');
const checkoutError = document.getElementById('checkout-error');
const placeButton = document.getElementById('place-order');

const mpesaDialog = document.getElementById('mpesa-dialog');
const mpesaText = document.getElementById('mpesa-text');

function selectedZone() {
  return zones.find((zone) => zone.id === Number(coZone.value)) || null;
}

// Writes Subtotal / Delivery / Total into a <dl>.
function showTotals(dl, totals, zone) {
  let delivery = 'Choose a zone';
  if (zone) delivery = totals.deliveryFee === 0 ? 'Free' : formatKES(totals.deliveryFee);
  if (totals.subtotal === 0) delivery = '-';

  dl.innerHTML = '';
  [['Subtotal', formatKES(totals.subtotal)], ['Delivery', delivery], ['Total', formatKES(totals.total)]]
    .forEach(([label, value]) => {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      dl.append(dt, dd);
    });
}

// The cart page: one row per item with - / + / Remove.
function renderCart() {
  const items = cart.getItems();
  const zone = selectedZone();
  const totals = cart.getTotals(zone);

  cartLines.innerHTML = '';
  items.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'cart-line';
    li.innerHTML = `
      <img alt="">
      <div>
        <h2 class="line-name"></h2>
        <p class="line-variant"></p>
        <p>${formatKES(item.unitPrice)} each</p>
      </div>
      <div class="qty">
        <button type="button" class="qty-btn" aria-label="One less">−</button>
        <span>${item.quantity}</span>
        <button type="button" class="qty-btn" aria-label="One more">+</button>
      </div>
      <p class="line-total">${formatKES(item.unitPrice * item.quantity)}</p>
      <button type="button" class="link-btn">Remove</button>
    `;
    setImage(li.querySelector('img'), item.image);
    li.querySelector('.line-name').textContent = item.name;
    li.querySelector('.line-variant').textContent = `${item.colour} · UK ${item.size}`;

    const [minus, plus] = li.querySelectorAll('.qty-btn');
    minus.addEventListener('click', () => changeQuantity(item, item.quantity - 1));
    plus.addEventListener('click', () => changeQuantity(item, item.quantity + 1));
    li.querySelector('.link-btn').addEventListener('click', () => changeQuantity(item, 0));

    cartLines.append(li);
  });

  cartMessage.textContent = 'Your cart is empty.';
  cartMessage.hidden = items.length > 0;
  toCheckout.hidden = items.length === 0;

  showTotals(cartTotals, totals, zone);
  if (items.length > 0 && totals.freeDeliveryGap > 0) {
    freeNote.textContent = `Add ${formatKES(totals.freeDeliveryGap)} more for free delivery.`;
  } else if (items.length > 0) {
    freeNote.textContent = `You get free delivery (orders over ${formatKES(FREE_DELIVERY_THRESHOLD)}).`;
  } else {
    freeNote.textContent = '';
  }
}

// The small order summary next to the delivery form.
function renderCheckoutSummary() {
  const items = cart.getItems();
  const zone = selectedZone();

  coLines.innerHTML = '';
  items.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = `${item.quantity} × ${item.name} (UK ${item.size})`;
    const price = document.createElement('strong');
    price.textContent = formatKES(item.unitPrice * item.quantity);
    li.append(price);
    coLines.append(li);
  });

  showTotals(coTotals, cart.getTotals(zone), zone);
}

async function changeQuantity(item, quantity) {
  try {
    await cart.setQuantity(item.id, quantity); // PATCH or DELETE /cartItems/:id
  } catch (error) {
    alert(error.message);
  }
}

// GET /deliveryZones and fill both zone dropdowns.
async function loadZones() {
  zones = await deliveryZones.list();
  [cartZone, coZone].forEach((select) => {
    select.innerHTML = '<option value="">Choose a delivery zone</option>';
    zones.forEach((zone) => {
      const option = document.createElement('option');
      option.value = zone.id;
      option.textContent = `${zone.name} - ${formatKES(zone.fee)} (${zone.eta})`;
      select.append(option);
    });
  });
}

// Shows each error under its field.
function showFieldErrors(errors) {
  ['name', 'phone', 'zoneId', 'location', 'payment'].forEach((field) => {
    const p = document.getElementById(`co-${field}-error`);
    p.textContent = errors[field] || '';
  });
}

// Pretend M-Pesa STK push: show the "check your phone" box for 3 seconds.
function simulateMpesa(phone, total) {
  mpesaText.textContent = `Enter your M-Pesa PIN on ${phone} to pay ${formatKES(total)} to Kicks Hub.`;
  mpesaDialog.showModal();
  return new Promise((resolve) => {
    setTimeout(() => {
      mpesaDialog.close();
      resolve();
    }, 3000);
  });
}

// Takes the bought pairs off the stock (PATCH /products/:id).
async function reduceStock(items) {
  for (const item of items) {
    const product = await products.get(item.productId);
    const colours = product.colours.map((colour) => {
      if (colour.name !== item.colour) return colour;
      const sizes = { ...colour.sizes };
      sizes[item.size] = Math.max(0, sizes[item.size] - item.quantity);
      return { ...colour, sizes };
    });
    await products.updateStock(product.id, colours);
  }
}

async function placeOrder(event) {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(form));
  values.notes = values.notes || '';

  const errors = validateDelivery(values);
  showFieldErrors(errors);
  if (Object.keys(errors).length > 0) return;

  const items = cart.getItems();
  if (items.length === 0) {
    checkoutError.textContent = 'Your cart is empty.';
    return;
  }

  const zone = selectedZone();
  const totals = cart.getTotals(zone);
  checkoutError.textContent = '';
  placeButton.disabled = true;
  placeButton.textContent = 'Placing order...';

  try {
    if (values.payment === 'mpesa') await simulateMpesa(values.phone, totals.total);
    const order = await orders.create(buildOrder(items, zone, values, totals)); // POST /orders
    await reduceStock(items);
    await cart.clear(); // DELETE /cartItems/:id for each item
    form.reset();
    location.hash = `#/order/${order.id}`;
  } catch (error) {
    checkoutError.textContent = `Could not place your order. ${error.message}`;
  }
  placeButton.disabled = false;
  placeButton.textContent = 'Place order';
}

// GET /orders/:id and show the thank-you message.
export async function showConfirmation(orderId) {
  const text = document.getElementById('confirm-text');
  try {
    const order = await orders.get(orderId);
    const howToPay = order.payment === 'mpesa'
      ? 'Your M-Pesa payment was received.'
      : `Please have ${formatKES(order.total)} ready for the rider.`;
    text.textContent = `Thank you, ${order.customer.name}! Order #${order.id} (${formatDate(order.createdAt)}) `
      + `will be delivered to ${order.customer.location}, ${order.zone.name}. ${howToPay}`;
    showTotals(document.getElementById('confirm-totals'), order, order.zone);
  } catch (error) {
    text.textContent = `Could not load your order. ${error.message}`;
  }
}

export async function setupCheckout(shopCart) {
  cart = shopCart;
  cart.subscribe(() => {
    renderCart();
    renderCheckoutSummary();
  });

  // Keep the zone the same on the cart page and the checkout page.
  cartZone.addEventListener('change', () => {
    coZone.value = cartZone.value;
    renderCart();
    renderCheckoutSummary();
  });
  coZone.addEventListener('change', () => {
    cartZone.value = coZone.value;
    renderCart();
    renderCheckoutSummary();
  });

  form.addEventListener('submit', placeOrder);

  // Hide a field's error as soon as the customer starts fixing it.
  form.addEventListener('input', (event) => {
    const errorText = document.getElementById(`co-${event.target.name}-error`);
    if (errorText) errorText.textContent = '';
  });

  try {
    await loadZones();
  } catch (error) {
    cartMessage.textContent = `Could not load delivery zones. ${error.message}`;
    cartMessage.hidden = false;
  }
  renderCart();
  renderCheckoutSummary();
}