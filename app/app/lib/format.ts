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

const percent = new Intl.NumberFormat("hu-HU", { style: "percent", maximumFractionDigits: 1 });

// 0.125 -> "12,5%"
export function formatPercent(ratio: number): string {
  return percent.format(ratio);
}

const shortDay = new Intl.DateTimeFormat("hu-HU", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  weekday: "long",
});

// "2026-10-05" -> "okt. 5., hétfő"
export function formatDay(day: string): string {
  return shortDay.format(new Date(`${day}T00:00:00Z`));
}

const shortDate = new Intl.DateTimeFormat("hu-HU", { timeZone: TIME_ZONE, month: "short", day: "numeric" });

// "okt. 1."
export function formatShortDate(date: Date): string {
  return shortDate.format(date);
}
