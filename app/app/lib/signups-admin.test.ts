import { describe, expect, it } from "vitest";

import { formatDateTime } from "./format";
import {
  cityLabel,
  countSignups,
  filterSignups,
  NO_REF,
  parseFilters,
  toCsv,
  type SignupRow,
} from "./signups-admin";

function row(over: Partial<SignupRow>): SignupRow {
  return {
    id: 1,
    city: "gyor",
    cityOther: null,
    mode: "pair",
    name1: "Nagy Anna",
    email1: "anna@example.com",
    name2: "Kovács Béla",
    email2: null,
    level: "kezdo",
    note: null,
    ref: null,
    status: "new",
    adminNote: null,
    consentAt: new Date("2026-10-01T12:00:00Z"),
    createdAt: new Date("2026-10-01T12:00:00Z"),
    updatedAt: null,
    ...over,
  };
}

const rows = [
  row({ id: 1 }),
  row({ id: 2, mode: "solo", name1: "Szabó Csaba", email1: "csaba@example.com", name2: null, level: "halado", status: "contacted" }),
  row({ id: 3, city: "other", cityOther: "Szeged", name1: "Tóth Dóra", email1: "dora@example.com", name2: "Varga Éva", ref: "gyp" }),
];

const none = parseFilters(new URLSearchParams());

describe("filterSignups", () => {
  it("returns everything without filters", () => {
    expect(filterSignups(rows, none)).toHaveLength(3);
  });

  it("filters by city, status, level and mode", () => {
    expect(filterSignups(rows, { ...none, city: "other" }).map((r) => r.id)).toEqual([3]);
    expect(filterSignups(rows, { ...none, status: "contacted" }).map((r) => r.id)).toEqual([2]);
    expect(filterSignups(rows, { ...none, level: "halado" }).map((r) => r.id)).toEqual([2]);
    expect(filterSignups(rows, { ...none, mode: "pair" }).map((r) => r.id)).toEqual([1, 3]);
  });

  it("filters by source, including signups without one", () => {
    expect(filterSignups(rows, { ...none, ref: "gyp" }).map((r) => r.id)).toEqual([3]);
    expect(filterSignups(rows, { ...none, ref: NO_REF }).map((r) => r.id)).toEqual([1, 2]);
  });

  it("searches names, emails and the other city, ignoring case and accents", () => {
    expect(filterSignups(rows, { ...none, q: "kovacs" }).map((r) => r.id)).toEqual([1]);
    expect(filterSignups(rows, { ...none, q: "SZEGED" }).map((r) => r.id)).toEqual([3]);
    expect(filterSignups(rows, { ...none, q: "anna@" }).map((r) => r.id)).toEqual([1]);
  });
});

describe("countSignups", () => {
  it("counts pairs, solo signups and players", () => {
    expect(countSignups(rows)).toEqual({ signups: 3, pairs: 2, solo: 1, players: 5 });
  });
});

describe("cityLabel", () => {
  it("names supported and other cities", () => {
    expect(cityLabel(rows[0])).toBe("Győr");
    expect(cityLabel(rows[2])).toBe("Szeged (más város)");
  });
});

describe("toCsv", () => {
  it("writes a BOM, a header and semicolon-separated rows with quoting", () => {
    const csv = toCsv([row({ note: 'hétfő; "este"' })]);
    expect(csv.startsWith("﻿Azonosító;")).toBe(true);
    const line = csv.split("\r\n")[1];
    expect(line).toContain("Győr;Pár;Nagy Anna;anna@example.com;Kovács Béla;;Kezdő;");
    expect(line).toContain('"hétfő; ""este"""');
    expect(line).toContain(";Új;");
  });

  it("writes the source through the given label function", () => {
    const line = toCsv([row({ ref: "gyp" })], (r) => (r === "gyp" ? "Győr Padel" : "")).split("\r\n")[1];
    expect(line).toContain(";Kezdő;;Győr Padel;Új;");
  });
});

describe("formatDateTime", () => {
  it("formats in Budapest time, 24-hour", () => {
    expect(formatDateTime(new Date("2026-10-01T12:05:00Z"))).toBe("2026. 10. 01. 14:05");
    expect(formatDateTime(new Date("2026-12-01T23:30:00Z"))).toBe("2026. 12. 02. 00:30");
  });
});
