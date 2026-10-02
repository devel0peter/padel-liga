// Hungarian display formats. Times are stored in UTC and shown in Budapest time.

const TIME_ZONE = "Europe/Budapest";

const dateTime = new Intl.DateTimeFormat("hu-HU", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

// "2026. 10. 01. 14:32"
export function formatDateTime(date: Date): string {
  return dateTime.format(date);
}
