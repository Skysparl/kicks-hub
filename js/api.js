/**
 * App-wide configuration. Replace DEPLOYED_API_URL after deploying the JSON Server backend.
 */
export const LOCAL_API_URL = 'http://localhost:3000';
export const DEPLOYED_API_URL = 'https://kicks-hub-api.onrender.com';

/** Picks the local API on localhost/file://, the deployed API everywhere else. */
export function resolveApiBaseUrl(location = globalThis.location ?? {}) {
  const { hostname = '', protocol = '' } = location;
  const isLocal = protocol === 'file:' || ['localhost', '127.0.0.1', ''].includes(hostname);
  return isLocal ? LOCAL_API_URL : DEPLOYED_API_URL;
}

export const REQUEST_TIMEOUT_MS = 10000;

/** UK / Kenyan shoe sizes the shop stocks. */
export const UK_SIZES = ['3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

export const CATEGORIES = {
  sneakers: 'Sneakers',
  official: 'Official / Corporate',
  classy: 'Classy Sneakers',
};

export const GENDERS = { men: 'Men', women: 'Women', unisex: 'Unisex' };

/** Pre-delivery payment options only — no cards. */
export const PAYMENT_METHODS = { mpesa: 'M-Pesa', cod: 'Cash on Delivery' };

export const MAX_QTY_PER_LINE = 10;
export const FREE_DELIVERY_THRESHOLD = 10000; // KES