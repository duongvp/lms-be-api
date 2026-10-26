/** Calendar stores Vietnam wall-clock components in UTC, rather than instants. */
export const swapTimeValue = (value: unknown, fallback: Date, label: string): Date => {
  if (value === undefined || value === null || value === '') return new Date(fallback);
  const text = String(value).trim();
  // Older swap modals send no timezone. Pin those components to UTC so the
  // server's timezone cannot turn a 19:00 lesson into 12:00 in the database.
  const withoutTimezone = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(text);
  const parsed = new Date(withoutTimezone ? `${text}Z` : text);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} không hợp lệ`);
  return parsed;
};
