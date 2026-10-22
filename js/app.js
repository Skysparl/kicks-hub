// app.js - loads the shoes from JSON Server and shows them on the shop page.
import { products as productsApi } from './api.js';
import { createCart } from './cart.js';
import { formatKES } from './ui.js';
import { setupCheckout, showConfirmation } from './checkout.js';

// Elements from index.html
const grid = document.getElementById('product-grid');
const message = document.getElementById('shop-message');
const cartLink = document.getElementById('cart-link');
const searchInput = document.getElementById('search');
const filterForm = document.getElementById('filter-form');
const brandSelect = document.getElementById('filter-brand');
const priceOutput = document.getElementById('price-output');
const sortSelect = document.getElementById('sort');
const resultsCount = document.getElementById('results-count');
const clearButton = document.getElementById('clear-filters');

let allShoes = [];
const cart = createCart();

// Builds one shoe card (same classes as my old hard-coded cards).
function makeCard(shoe) {
  const colour = shoe.colours[0];

  const li = document.createElement('li');
  li.className = 'product-card';
  li.dataset.category = shoe.category;

  const img = document.createElement('img');
  img.src = colour.image;
  img.alt = shoe.name;
  img.className = 'product-img';

  const title = document.createElement('h3');
  title.textContent = shoe.name;

  const price = document.createElement('p');
  price.className = 'price';
  price.textContent = formatKES(shoe.price);

  // Size dropdown - only sizes that still have pairs in stock.
  const sizeSelect = document.createElement('select');
  sizeSelect.className = 'size-select';
  sizeSelect.setAttribute('aria-label', `UK size for ${shoe.name}`);
  Object.keys(colour.sizes).forEach((size) => {
    if (colour.sizes[size] > 0) {
      const option = document.createElement('option');
      option.value = size;
      option.textContent = `UK ${size}`;
      sizeSelect.append(option);
    }
  });

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn-add';
  button.textContent = 'Add to Cart';
  button.addEventListener('click', () => addToCart(shoe, sizeSelect.value, button));

  if (sizeSelect.options.length === 0) {
    sizeSelect.disabled = true;
    button.disabled = true;
    button.textContent = 'Sold out';
  }

  li.append(img, title, price, sizeSelect, button);
  return li;
}

// Puts a list of shoes in the grid.
function showShoes(shoes) {
  grid.innerHTML = '';
  shoes.forEach((shoe) => grid.append(makeCard(shoe)));

  resultsCount.textContent = `${shoes.length} shoes`;
  message.textContent = 'No shoes match your filters.';
  message.hidden = shoes.length > 0;
}

// Fills the brand dropdown from the shoes we got back.
function fillBrands() {
  const brands = [];
  allShoes.forEach((shoe) => {
    if (!brands.includes(shoe.brand)) brands.push(shoe.brand);
  });
  brands.sort().forEach((brand) => {
    const option = document.createElement('option');
    option.value = brand;
    option.textContent = brand;
    brandSelect.append(option);
  });
}

// Reads every filter, then shows the matching shoes.
function applyFilters() {
  const gender = location.hash.split('/')[2] || ''; // "#/shop/men" -> "men"
  const category = filterForm.elements.category.value;
  const brand = brandSelect.value;
  const maxPrice = Number(filterForm.elements.maxPrice.value);
  const search = searchInput.value.trim().toLowerCase();

  priceOutput.textContent = `Up to ${formatKES(maxPrice)}`;

  const result = allShoes.filter((shoe) => {
    if (gender === 'sale' && shoe.salePrice === null) return false;
    if ((gender === 'men' || gender === 'women') && shoe.gender !== gender && shoe.gender !== 'unisex') return false;
    if (gender === 'unisex' && shoe.gender !== 'unisex') return false;
    if (category && shoe.category !== category) return false;
    if (brand && shoe.brand !== brand) return false;
    if (shoe.price > maxPrice) return false;
    const text = `${shoe.name} ${shoe.brand}`.toLowerCase();
    return text.includes(search);
  });

  const sort = sortSelect.value;
  if (sort === 'price-asc') result.sort((a, b) => a.price - b.price);
  if (sort === 'price-desc') result.sort((a, b) => b.price - a.price);
  if (sort === 'name') result.sort((a, b) => a.name.localeCompare(b.name));
  if (sort === 'newest') result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  showShoes(result);
}

// Adds one pair of the chosen UK size to the cart.
async function addToCart(shoe, size, button) {
  const colour = shoe.colours[0];

  button.disabled = true;
  try {
    await cart.add(shoe, { colour: colour.name, size }); // POST or PATCH /cartItems
    button.textContent = 'Added ✓';
  } catch (error) {
    alert(error.message); // e.g. "Only 1 pair left in UK 4."
  }
  button.disabled = false;
  setTimeout(() => { button.textContent = 'Add to Cart'; }, 1500);
}

// Shows how many pairs are in the cart (a bag icon with a red number).
function updateCartCount(items) {
  let count = 0;
  items.forEach((item) => { count += item.quantity; });
  cartLink.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h12l-1 13H7L6 7z"/><path d="M9 7a3 3 0 0 1 6 0"/></svg>
    <span class="cart-count">${count}</span>`;
  cartLink.setAttribute('aria-label', `Cart, ${count} items`);
}

// Fills the Men / Women / Unisex boxes in the hero with how many shoes there are.
function showGenderCounts() {
  ['men', 'women', 'unisex'].forEach((gender) => {
    const total = allShoes.filter((shoe) => shoe.gender === gender || (gender !== 'unisex' && shoe.gender === 'unisex')).length;
    document.getElementById(`count-${gender}`).textContent = `${total} styles`;
  });
}

// Shows one page section at a time, based on the address bar:
// #/cart -> cart, #/checkout -> delivery form, #/order/5 -> confirmation, anything else -> shop.
async function showPage() {
  const hash = location.hash;
  let page = 'view-shop';
  if (hash === '#/cart') page = 'view-cart';
  if (hash === '#/checkout') page = cart.getItems().length > 0 ? 'view-checkout' : 'view-cart';
  if (hash.startsWith('#/order/')) {
    page = 'view-confirmation';
    showConfirmation(hash.split('/')[2]);
  }

  document.querySelectorAll('main > .view').forEach((section) => {
    section.hidden = section.id !== page;
  });

  if (page === 'view-shop') {
    // Get the shoes again so stock is up to date after someone orders.
    try {
      allShoes = await productsApi.list({ active: true });
    } catch (error) {
      console.error('Could not refresh shoes:', error);
    }
    applyFilters();
    if (hash.startsWith('#/shop/')) document.getElementById('catalogue').scrollIntoView();
  } else {
    window.scrollTo(0, 0);
  }
}

export async function createShopApp() {
  cart.subscribe(updateCartCount);
  filterForm.addEventListener('input', applyFilters);
  sortSelect.addEventListener('change', applyFilters);
  searchInput.addEventListener('input', applyFilters);
  clearButton.addEventListener('click', () => {
    filterForm.reset();
    searchInput.value = '';
    applyFilters();
  });

  message.textContent = 'Loading shoes...';
  message.hidden = false;

  try {
    allShoes = await productsApi.list({ active: true }); // GET /products?active=true
    fillBrands();
    showGenderCounts();
  } catch (error) {
    message.textContent = `Could not load the shoes. Is JSON Server running? (${error.message})`;
    return;
  }

  try {
    await cart.load(); // GET /cartItems
  } catch (error) {
    console.error('Cart did not load:', error);
  }

  await setupCheckout(cart);
  window.addEventListener('hashchange', showPage);
  showPage();
}