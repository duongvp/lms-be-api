export const CALENDAR_FILTER_FACETS = ['code', 'teacher', 'system_type', 'time_status', 'weekdays'] as const;
export type CalendarFilterFacet = typeof CALENDAR_FILTER_FACETS[number];

// Keep the other draft filters, but let each select offer alternatives to itself.
export const calendarFacetQuery = (query: Record<string, unknown>, facet: CalendarFilterFacet) => {
  const result: Record<string, unknown> = { ...query, page: 1, limit: 25 };
  delete result[facet];
  if (facet === 'code') delete result.code_exact;
  delete result.sort_by;
  delete result.sort_order;
  return result;
};

export const calendarProgress = (row: { start_time: Date; end_time: Date; lesson_status: number | null }, now: Date) => (
  Number(row.lesson_status) === 1 ? 'cancelled'
    : row.start_time > now ? 'upcoming' : row.end_time < now ? 'completed' : 'ongoing'
);

// Calendar dates store Vietnam wall-clock values in UTC-shaped timestamps.
export const calendarWeekday = (date: Date) => ((date.getUTCDay() + 6) % 7) + 1;
