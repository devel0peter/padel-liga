// Landing page traffic per source, for the admin funnel (/admin/traffic).
// Pure (no I/O); the D1 access lives in traffic.server.ts.
//
// A landing is counted per Budapest day and source, nothing else: no IP, no
// browser details, no identifier, so no cookie consent is needed.

import { normalizeRef } from "./clubs";

const TIME_ZONE = "Europe/Budapest";

// The source of a landing: `?ref=`, or else `?utm_source=` (ad tools add that
// one by default), with the same rules as a signup's ref (clubs.ts). Without
// either, a known referrer, or Facebook's click id (its in-app browser often
// sends no referrer), so a link that lost its tag still counts as "facebook".
export function landingSource(params: URLSearchParams, referrer?: string | null): string | null {
  return (
    normalizeRef(params.get("ref")) ??
    normalizeRef(params.get("utm_source")) ??
    referrerSource(referrer) ??
    (params.has("fbclid") ? "facebook" : null)
  );
}

// Referrer domains worth a source of their own; anything else is no source.
const REFERRERS: [RegExp, string][] = [
  [/(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com)$/, "facebook"],
  [/(^|\.)instagram\.com$/, "instagram"],
  [/(^|\.)google\.[a-z.]+$/, "google"],
];

// The source of a referrer URL (the Referer header or document.referrer).
export function referrerSource(referrer: string | null | undefined): string | null {
  let host: string;
  try {
    host = new URL(referrer ?? "").hostname.toLowerCase();
  } catch {
    return null;
  }
  return REFERRERS.find(([re]) => re.test(host))?.[1] ?? null;
}

// Whether a page load is a new landing: a reload or going back and forward
// to the page is the same visit again (the Navigation Timing entry's type).
export function isNewLanding(navigationType: string | undefined): boolean {
  return navigationType !== "reload" && navigationType !== "back_forward";
}

// Tracking parameters to drop from the address bar once the landing is
// counted: our source tag, ad tags and Facebook's click id. The page keeps
// the source it read on load, so nothing is lost; a copied link is just clean.
const TRACKING = /^(ref|utm_[a-z_]+|fbclid|gclid)$/i;

// The query string without tracking parameters ("" if nothing is left).
export function withoutTracking(search: string): string {
  const params = new URLSearchParams(search);
  for (const key of [...params.keys()]) if (TRACKING.test(key)) params.delete(key);
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}

const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// The Budapest calendar day of an instant, as "2026-10-05".
export function budapestDay(date: Date): string {
  return dayFormat.format(date);
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function isDay(value: string | null): value is string {
  return !!value && DAY_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const DEFAULT_DAYS = 30;

export type Period = { from: string; to: string };

// The admin's `?from=&to=` (inclusive days); defaults to the last 30 days
// ending today. A reversed range is swapped.
export function parsePeriod(params: URLSearchParams, now: Date): Period {
  const today = budapestDay(now);
  const to = isDay(params.get("to")) ? params.get("to")! : today;
  const from = isDay(params.get("from")) ? params.get("from")! : addDays(to, -(DEFAULT_DAYS - 1));
  return from <= to ? { from, to } : { from: to, to: from };
}

// Every day of the period, oldest first.
export function daysOf({ from, to }: Period): string[] {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
}

export type LandingCount = { day: string; ref: string | null; count: number };
export type SignupStamp = { createdAt: Date; ref: string | null };

export type FunnelRow = {
  ref: string | null; // null: no source
  landings: number;
  signups: number;
  conversion: number | null; // signups / landings, null without landings
};

export type DayRow = { day: string; landings: number; signups: number };

export type Funnel = {
  sources: FunnelRow[];
  total: FunnelRow;
  days: DayRow[];
};

function conversion(signups: number, landings: number): number | null {
  return landings > 0 ? signups / landings : null;
}

// Landings and signups per source and per day within the period. Sources are
// sorted by landings, then signups; "no source" is always listed last.
export function buildFunnel(
  landings: readonly LandingCount[],
  signups: readonly SignupStamp[],
  period: Period,
): Funnel {
  const inPeriod = (day: string) => day >= period.from && day <= period.to;
  const bySource = new Map<string, { landings: number; signups: number }>();
  const byDay = new Map<string, DayRow>(daysOf(period).map((day) => [day, { day, landings: 0, signups: 0 }]));
  const source = (ref: string | null) => {
    const key = ref ?? "";
    let row = bySource.get(key);
    if (!row) bySource.set(key, (row = { landings: 0, signups: 0 }));
    return row;
  };

  for (const l of landings) {
    if (!inPeriod(l.day)) continue;
    source(l.ref).landings += l.count;
    byDay.get(l.day)!.landings += l.count;
  }
  for (const s of signups) {
    const day = budapestDay(s.createdAt);
    if (!inPeriod(day)) continue;
    source(s.ref).signups += 1;
    byDay.get(day)!.signups += 1;
  }

  const sources = [...bySource]
    .map(([key, c]) => ({ ref: key || null, ...c, conversion: conversion(c.signups, c.landings) }))
    .sort(
      (a, b) =>
        Number(a.ref === null) - Number(b.ref === null) ||
        b.landings - a.landings ||
        b.signups - a.signups ||
        (a.ref ?? "").localeCompare(b.ref ?? ""),
    );
  const totalLandings = sources.reduce((n, r) => n + r.landings, 0);
  const totalSignups = sources.reduce((n, r) => n + r.signups, 0);
  return {
    sources,
    total: {
      ref: null,
      landings: totalLandings,
      signups: totalSignups,
      conversion: conversion(totalSignups, totalLandings),
    },
    days: [...byDay.values()],
  };
}
