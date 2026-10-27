import { resolveApiBaseUrl, REQUEST_TIMEOUT_MS } from './config.js';
export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function messageForStatus(status) {
  if (status === 400) return 'The server rejected that request. Check the details and try again.';
  if (status === 404) return 'That item no longer exists. It may have been removed.';
  if (status === 409) return 'That record was changed by someone else. Refresh and try again.';
  if (status >= 500) return 'Our server had a problem. Please try again in a moment.';
  return `Request failed (status ${status}).`;
}

let pending = 0;
const loadingListeners = new Set();

export function onLoadingChange(listener) {
  loadingListeners.add(listener);
  return () => loadingListeners.delete(listener);
}

function setPending(delta) {
  pending = Math.max(0, pending + delta);
  loadingListeners.forEach((fn) => fn(pending > 0, pending));
}

export function buildQuery(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    [].concat(value).forEach((v) => search.append(key, String(v)));
  });
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export async function request(path, options = {}) {
  const {
    method = 'GET',
    body,
    baseUrl = resolveApiBaseUrl(),
    timeout = REQUEST_TIMEOUT_MS,
    retries = method === 'GET' ? 1 : 0,
    retryDelay = 400,
  } = options;

  setPending(1);
  try {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await send(`${baseUrl}${path}`, method, body, timeout);
      } catch (err) {
        if (err.status !== 0 || attempt >= retries) throw err;
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }
  } finally {
    setPending(-1);
  }
}

async function send(url, method, body, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const init = { method, headers: { Accept: 'application/json' }, signal: controller.signal };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(url, init);
  } catch (err) {
    throw new ApiError(
      err?.name === 'AbortError'
        ? 'The server took too long to respond. Check your connection and try again.'
        : 'Could not reach Kicks Hub. Check your internet connection.',
      0,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) throw new ApiError(messageForStatus(response.status), response.status);
  if (response.status === 204) return null;

  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError('The server sent an unreadable response.', response.status);
  }
}

export function createResource(name) {
  const base = `/${name}`;
  const one = (id) => `${base}/${encodeURIComponent(id)}`;
  const now = () => new Date().toISOString();

  return {
    list: (params) => request(`${base}${buildQuery(params)}`),
    get: (id) => request(one(id)),
    create: (data) => request(base, { method: 'POST', body: { ...data, createdAt: now() } }),
    replace: (id, data) => request(one(id), { method: 'PUT', body: { ...data, id: Number(id), updatedAt: now() } }),
    update: (id, changes) => request(one(id), { method: 'PATCH', body: { ...changes, updatedAt: now() } }),
    remove: (id) => request(one(id), { method: 'DELETE' }),
  };
}

const productsResource = createResource('products');

export const products = {
  ...productsResource,
 listActive: (filters = {}) => productsResource.list(filters),
  updatePrice: (id, price, salePrice = null) => productsResource.update(id, { price, salePrice }),
  updateStock: (id, colours) => productsResource.update(id, { colours }),
};

export const cartItems = createResource('cartItems');
export const orders = createResource('orders');
export const deliveryZones = createResource('deliveryZones');