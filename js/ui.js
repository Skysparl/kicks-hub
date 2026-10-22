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