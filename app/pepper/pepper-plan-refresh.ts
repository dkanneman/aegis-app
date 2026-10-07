export function scheduledPlanRefreshKey(now: Date, timeZone: string): string | null {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";
  const hour = Number(value("hour"));
  if (hour < 6) return null;
  const slot = hour >= 16 ? 2 : hour >= 12 ? 1 : 0;
  return `${value("year")}-${value("month")}-${value("day")}:${slot}`;
}
