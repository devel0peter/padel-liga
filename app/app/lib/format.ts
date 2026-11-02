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

const dayOnly = new Intl.DateTimeFormat("hu-HU", { timeZone: "UTC", month: "short", day: "numeric" });

// "2026-11-30" -> "nov. 30."
export function formatShortDay(day: string): string {
  return dayOnly.format(new Date(`${day}T00:00:00Z`));
}

// "2026-10-05" -> "okt. 5., hétfő"
export function formatDay(day: string): string {
  return shortDay.format(new Date(`${day}T00:00:00Z`));
}

const slotDay = new Intl.DateTimeFormat("hu-HU", { timeZone: TIME_ZONE, month: "short", day: "numeric", weekday: "long" });
const slotTime = new Intl.DateTimeFormat("hu-HU", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false });

// "nov. 10., kedd 18:30" (24-hour, Budapest time)
export function formatSlot(date: Date): string {
  return `${slotDay.format(date)} ${slotTime.format(date)}`;
}

const shortDate = new Intl.DateTimeFormat("hu-HU", { timeZone: TIME_ZONE, month: "short", day: "numeric" });

// "okt. 1."
export function formatShortDate(date: Date): string {
  return shortDate.format(date);
}

const monthName = new Intl.DateTimeFormat("hu-HU", { timeZone: TIME_ZONE, month: "long" });
const dayOfMonth = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, day: "numeric" });

// The ending of "9-én", "1-jén", "3-án": it follows the spoken ordinal
// ("elsején", "másodikán", "tizenkettedikén", "huszadikán", ...).
function onDayEnding(day: number): string {
  if (day === 1) return "jén";
  if (day === 2) return "án";
  if (day % 10 === 0) return day === 10 ? "én" : "án";
  return ["", "én", "én", "án", "én", "én", "án", "én", "án", "én"][day % 10]!;
}

// On which day, in a sentence: "november 9-én"
export function formatOnDate(date: Date): string {
  const day = Number(dayOfMonth.format(date));
  return `${monthName.format(date)} ${day}-${onDayEnding(day)}`;
}

// Until which day, in a sentence: "november 6-ig" ("elsejéig": "1-jéig")
export function formatUntilDate(date: Date): string {
  const day = Number(dayOfMonth.format(date));
  return `${monthName.format(date)} ${day}-${day === 1 ? "jéig" : "ig"}`;
}

const fullDate = new Intl.DateTimeFormat("hu-HU", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

// "2026. 10. 01."
export function formatDate(date: Date): string {
  return fullDate.format(date);
}

const dayAndTime = new Intl.DateTimeFormat("hu-HU", {
  timeZone: TIME_ZONE,
  month: "short",
  day: "numeric",
  weekday: "long",
  hour: "2-digit",
  minute: "2-digit",
  // Not hour12: false, which some engines render as "24:00" at midnight.
  hourCycle: "h23",
});

// A deadline: "nov. 29., vasárnap 23:59"
export function formatDeadline(date: Date): string {
  return dayAndTime.format(date);
}
