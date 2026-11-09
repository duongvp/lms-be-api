export const calendarSessionEnded = (date: string, timeRange: string, now: Date) => {
  const day = date.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const times = [...timeRange.matchAll(/(\d{2}):(\d{2})/g)];
  if (!day || times.length !== 2) return false;
  const [, d, m, y] = day.map(Number);
  const startMinutes = Number(times[0][1]) * 60 + Number(times[0][2]);
  const endMinutes = Number(times[1][1]) * 60 + Number(times[1][2]);
  if (times.some((time) => Number(time[1]) > 23 || Number(time[2]) > 59)) return false;
  const midnight = Date.UTC(y, m - 1, d);
  const check = new Date(midnight);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return false;
  const end = midnight - 7 * 3600_000 + endMinutes * 60_000 + (endMinutes < startMinutes ? 86400_000 : 0);
  return end <= now.getTime();
};
