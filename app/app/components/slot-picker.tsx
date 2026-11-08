// The match page's time pickers (D144): chips instead of the browser's
// datetime field, so they work the same on every phone. Days and whole hours
// in Budapest time; the forms send them as Budapest day and hour fields
// (lib/slot-ranges.ts), whatever the browser's time zone.

import { budapestClock, budapestDay, budapestTime, mergeRanges, rangeStarts, type SlotRange } from "@padel-liga/rules";
import { X } from "lucide-react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { useMemo, useState } from "react";

import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { formatClockTime, formatDay, formatWeekdayDate } from "~/lib/format";
import { dayChip, endHours, formatRange, pickerDays, presetRanges, rangeField, startField, type PickerDay } from "~/lib/slot-ranges";
import { cn } from "~/lib/utils";

const CHIP =
  "flex min-h-11 min-w-0 cursor-pointer items-center justify-center rounded-lg border bg-background px-2 py-1.5 text-sm font-medium tabular-nums outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-nav-active data-[state=checked]:bg-nav-active-bg data-[state=checked]:text-foreground";

type ChipOption = { value: string; label: React.ReactNode; name?: string };

// One choice among chips: a radio group, so arrows move and the screen
// reader says "1 of 7". With `name` the choice goes with the form.
function Chips({
  label,
  options,
  value,
  onValueChange,
  name,
  required,
  className,
}: {
  label: string;
  options: ChipOption[];
  value?: string;
  onValueChange?: (v: string) => void;
  name?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <RadioGroupPrimitive.Root
      aria-label={label}
      name={name}
      required={required}
      value={value}
      onValueChange={onValueChange}
      className={cn("grid gap-2", className)}
    >
      {options.map((o) => (
        <RadioGroupPrimitive.Item key={o.value} value={o.value} aria-label={o.name} className={CHIP}>
          {o.label}
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  );
}

// The days from today to the deadline; `marked`: days that already have a range.
function DayChips({
  label,
  days,
  value,
  onValueChange,
  marked,
}: {
  label: string;
  days: PickerDay[];
  value?: string;
  onValueChange: (day: string) => void;
  marked?: Set<string>;
}) {
  return (
    <Chips
      label={label}
      value={value}
      onValueChange={onValueChange}
      className="grid-cols-4 sm:grid-cols-7"
      options={days.map(({ day }) => {
        const { date, weekday } = dayChip(day);
        const has = marked?.has(day);
        return {
          value: day,
          name: `${formatDay(day)}${has ? ", megadva" : ""}`,
          label: (
            <span className="relative grid w-full text-center leading-tight">
              <span>{date}</span>
              <span className="text-xs font-normal text-muted-foreground">{weekday}</span>
              {has && <span aria-hidden className="absolute -top-0.5 right-0 size-1.5 rounded-full bg-nav-active" />}
            </span>
          ),
        };
      })}
    />
  );
}

// "07:00", as the rest of the page writes times.
const hourText = (h: number) => `${String(h).padStart(2, "0")}:00`;

/**
 * The proposal's ranges (D144): a day, then a quick range or one's own from
 * and to; added ranges are listed and can be removed, same-day ranges that
 * overlap or touch are joined. Each range goes with the form as a `range`
 * field. `now`: the page's time, so the server and the browser draw the same.
 */
export function RangePicker({ now, deadline }: { now: Date; deadline: Date }) {
  const days = useMemo(() => pickerDays(now, deadline), [now, deadline]);
  const [day, setDay] = useState<string>();
  const [ranges, setRanges] = useState<SlotRange[]>([]);
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const picked = days.find((d) => d.day === day);
  const marked = new Set(ranges.map((r) => budapestDay(r.start)));

  const add = (d: string, f: number, t: number) => setRanges((rs) => mergeRanges([...rs, { start: budapestTime(d, f, 0), end: budapestTime(d, t, 0) }]));
  const pickDay = (d: string) => {
    setDay(d);
    setFrom("");
    setTo("");
  };
  const ends = picked && from ? endHours(picked, Number(from)) : [];

  if (days.length === 0) return <p className="text-sm text-muted-foreground">A határidőig már nincs választható nap.</p>;

  return (
    <div className="grid gap-4">
      {ranges.map((r) => {
        const s = budapestClock(r.start);
        return <input key={r.start.getTime()} type="hidden" name="range" value={rangeField(s.day, s.minutes / 60, budapestClock(r.end).minutes / 60)} />;
      })}
      <div className="grid gap-2">
        <p className="text-sm font-medium">Melyik nap értek rá?</p>
        <DayChips label="Nap" days={days} value={day} onValueChange={pickDay} marked={marked} />
      </div>

      {picked && (
        <div className="grid gap-3 rounded-lg border bg-muted/40 p-3" role="group" aria-label={`Ráérés: ${formatDay(picked.day)}`}>
          <p className="text-sm font-medium">{formatDay(picked.day)}</p>
          <div className="flex flex-wrap gap-2">
            {presetRanges(picked).map((p) => (
              <Button key={p.label} type="button" variant="outline" className="h-10" onClick={() => add(picked.day, p.from, p.to)}>
                {p.label} {p.from}–{p.to}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-[1fr_1fr] gap-2 sm:grid-cols-[8rem_8rem_auto] sm:items-end">
            <div className="grid gap-1.5">
              <Label htmlFor="range-from">Ettől</Label>
              <Select
                value={from}
                onValueChange={(v) => {
                  setFrom(v);
                  if (to && Number(to) <= Number(v)) setTo("");
                }}
              >
                <SelectTrigger id="range-from" className="h-10 w-full">
                  <SelectValue placeholder="Óra" />
                </SelectTrigger>
                <SelectContent>
                  {picked.hours.map((h) => (
                    <SelectItem key={h} value={String(h)}>
                      {hourText(h)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="range-to">Eddig</Label>
              <Select value={to} onValueChange={setTo} disabled={!from}>
                <SelectTrigger id="range-to" className="h-10 w-full">
                  <SelectValue placeholder="Óra" />
                </SelectTrigger>
                <SelectContent>
                  {ends.map((h) => (
                    <SelectItem key={h} value={String(h)}>
                      {hourText(h)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              variant="secondary"
              className="col-span-2 h-10 sm:col-span-1"
              disabled={!from || !to}
              onClick={() => {
                add(picked.day, Number(from), Number(to));
                setFrom("");
                setTo("");
              }}
            >
              Hozzáadom
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-2">
        <p className="text-sm font-medium">Ráérésetek</p>
        {ranges.length === 0 ? (
          <p className="text-sm text-muted-foreground">Még nincs. Válassz napot, és add meg, mettől meddig értek rá.</p>
        ) : (
          <ul className="grid gap-2" aria-label="Ráérésetek">
            {ranges.map((r) => (
              <li key={r.start.getTime()} className="flex min-h-11 items-center justify-between gap-2 rounded-lg border bg-background py-1 pr-1 pl-3 text-sm">
                <span className="min-w-0 font-medium break-words">{formatRange(r)}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-lg"
                  aria-label={`Törlöm: ${formatRange(r)}`}
                  onClick={() => setRanges((rs) => rs.filter((x) => x !== r))}
                >
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {marked.size === 0 ? "Legalább 2 különböző nap kell." : marked.size === 1 ? "Még legalább 1 másik nap kell." : `${marked.size} nap megadva.`}
        </p>
      </div>
    </div>
  );
}

/**
 * Accepting a proposal (D144): the other pair's open ranges by day, each with
 * its whole-hour starts as chips. The choice goes with the form as `slot`,
 * the start in UTC milliseconds.
 */
export function StartPicker({ ranges }: { ranges: SlotRange[] }) {
  const byDay = new Map<string, SlotRange[]>();
  for (const r of ranges) {
    const d = budapestDay(r.start);
    (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(r);
  }
  return (
    <RadioGroupPrimitive.Root name="slot" required aria-label="Választható kezdések" className="grid gap-4">
      {[...byDay].map(([day, rs]) => (
        <div key={day} className="grid gap-2">
          <p className="text-sm font-medium">{formatWeekdayDate(rs[0]!.start)}</p>
          {rs.map((r) => (
            <div key={r.start.getTime()} className="grid gap-1.5">
              <p className="text-xs text-muted-foreground">
                Ráérnek: {formatClockTime(r.start)}–{formatClockTime(r.end)}
              </p>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                {rangeStarts(r).map((s) => (
                  <RadioGroupPrimitive.Item
                    key={s.getTime()}
                    value={String(s.getTime())}
                    aria-label={`${formatWeekdayDate(s)} ${formatClockTime(s)}`}
                    className={CHIP}
                  >
                    {formatClockTime(s)}
                  </RadioGroupPrimitive.Item>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
    </RadioGroupPrimitive.Root>
  );
}

/**
 * An agreed time (spec 6.3): a day, then a whole-hour start 7:00–22:00, both
 * as chips. The choice goes with the form as `slot`, "2026-11-14|18".
 */
export function DayHourPicker({ now, deadline }: { now: Date; deadline: Date }) {
  const days = useMemo(() => pickerDays(now, deadline), [now, deadline]);
  const [day, setDay] = useState<string>();
  const [hour, setHour] = useState<string>();
  const picked = days.find((d) => d.day === day);
  if (days.length === 0) return <p className="text-sm text-muted-foreground">A határidőig már nincs választható nap.</p>;
  return (
    <div className="grid gap-3">
      {picked && hour && <input type="hidden" name="slot" value={startField(picked.day, Number(hour))} />}
      <div className="grid gap-2">
        <p className="text-sm font-medium">Melyik nap?</p>
        <DayChips
          label="A meccs napja"
          days={days}
          value={day}
          onValueChange={(d) => {
            setDay(d);
            if (hour && !days.find((x) => x.day === d)?.hours.includes(Number(hour))) setHour(undefined);
          }}
        />
      </div>
      {picked && (
        <div className="grid gap-2">
          <p className="text-sm font-medium">Hánykor kezdtek?</p>
          <Chips
            label="Kezdés"
            value={hour}
            onValueChange={setHour}
            className="grid-cols-4 sm:grid-cols-8"
            options={picked.hours.map((h) => ({ value: String(h), label: hourText(h), name: `${formatDay(picked.day)} ${hourText(h)}` }))}
          />
        </div>
      )}
    </div>
  );
}
