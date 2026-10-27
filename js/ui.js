/** 8500 → "KES 8,500". Rounds to whole shillings. */
export function formatKES(amount) {
  const value = Math.round(Number(amount) || 0);
  return `KES ${value.toLocaleString('en-KE')}`;
}

/** "8" → "UK 8" */
export const formatSize = (size) => `UK ${size}`;

/** ISO date → "15 Oct 2026, 15:30" (Nairobi time). Returns "" for missing/invalid dates. */
export function formatDate(iso) {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Nairobi',
  });
}

/** Fallback shown when a shoe photo cannot be loaded. */
export const FALLBACK_IMAGE = 'assets/kicks-hub-logo.jpeg';

/**
 * Makes an image path from the API work wherever the site is hosted.
 * "/assets/shoe1.webp" and "assets/shoe1.webp" both become a URL under the page's own folder
 * (needed on GitHub Pages project sites like /kicks-hub/). Full http(s)/data URLs are left alone.
 */
export function resolveImage(path) {
  const value = String(path ?? '').trim();
  if (!value) return FALLBACK_IMAGE;
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value)) return value;
  const base = globalThis.document?.baseURI;
  const relative = value.replace(/^\.?\/+/, '');
  return base ? new URL(relative, base).href : relative;
}

/** Sets an <img> source and swaps in the logo once (no loop) if the photo is missing. */
export function setImage(img, path) {
  img.addEventListener('error', () => {
    const fallback = resolveImage(FALLBACK_IMAGE);
    if (img.src !== fallback) img.src = fallback;
  }, { once: true });
  img.src = resolveImage(path);
}
