/** Format a duration in whole minutes, e.g. `45 min`, `1 h 30 min`. */
export function formatDurationMinutes(totalMinutes: number): string {
  if (totalMinutes <= 0) {
    return '0 min';
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) {
    return `${minutes} min`;
  }
  if (minutes === 0) {
    return `${hours} h`;
  }
  return `${hours} h ${minutes} min`;
}

/** Format an ISO timestamp for display, e.g. `Aug 19, 2026, 6:34 PM`. */
export function formatDateTime(isoTimestamp: string): string {
  return new Date(isoTimestamp).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
