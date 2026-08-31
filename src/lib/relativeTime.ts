const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

export function relativeTimeFor(startedAt: number, now: number = Date.now()): string {
  const elapsed = Math.max(0, now - startedAt);

  if (elapsed < MINUTE_MS) {
    return "Just now";
  }
  if (elapsed < HOUR_MS) {
    const minutes = Math.floor(elapsed / MINUTE_MS);
    return `${minutes}m ago`;
  }
  if (elapsed < DAY_MS) {
    const hours = Math.floor(elapsed / HOUR_MS);
    return `${hours}h ago`;
  }
  if (elapsed < WEEK_MS) {
    const days = Math.floor(elapsed / DAY_MS);
    return `${days}d ago`;
  }

  return new Date(startedAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
