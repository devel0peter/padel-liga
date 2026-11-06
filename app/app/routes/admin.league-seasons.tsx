import { budapestDay } from "@padel-liga/rules";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { data, Form, Link, redirect, useNavigation, useSearchParams } from "react-router";

import type { Route } from "./+types/admin.league-seasons";
import { AppPage } from "~/components/app-page";
import { PhaseList } from "~/components/season-calendar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { requirePermission } from "~/lib/auth/admin.server";
import { formatDate, formatShortDate } from "~/lib/format";
import { getLeague, minEntriesByLeague } from "~/lib/leagues.server";
import {
  isWaiting,
  MAX_BREAKS,
  MAX_NAME,
  parseSeason,
  parseWaitingSeason,
  previewPhases,
  seasonActions,
  seasonEnd,
  waitingText,
  type SeasonField,
} from "~/lib/seasons";
import { entryCounts } from "~/lib/season-entries.server";
import {
  createSeason,
  createWaitingSeason,
  deleteSeason,
  getSeason,
  listSeasons,
  seasonInLeague,
  seasonState,
  updateSeason,
  updateWaitingSeason,
} from "~/lib/seasons.server";
import { SITE_NAME } from "~/lib/site";

// A league's seasons for its Szervezők: the list and the "Új szezon" form with
// a live preview of the 4 phases (issue #22). The calendar: packages/rules.
// A league's first season may instead start at the minimum entries (D124,
// #335): no registration deadline or start date, only a name and breaks.

export function meta({}: Route.MetaArgs) {
  return [{ title: `Szezonok – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

async function leagueScope(request: Request, slug: string) {
  const league = await getLeague(slug);
  if (!league) throw data("Nincs ilyen liga.", { status: 404 });
  const actor = await requirePermission(request, { kind: "league.manage", league: league.slug });
  return { league, actor, base: `/admin/leagues/${league.slug}/seasons` };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { league } = await leagueScope(request, params.league);
  const seasons = await listSeasons(league.id);
  const [counts, minimums] = await Promise.all([entryCounts(seasons.map((s) => s.id)), minEntriesByLeague([league.id])]);
  return {
    league: { name: league.name, minEntries: minimums.get(league.id) ?? 0 },
    seasons: await Promise.all(
      seasons.map(async (s) => ({
        ...s,
        ...seasonActions(await seasonState(s.id)),
        waiting: isWaiting(s),
        entries: counts.get(s.id)!,
        // The form's days, as the organizer typed them.
        registrationOpens: budapestDay(s.registrationOpensAt),
        registrationCloses: s.registrationClosesAt ? budapestDay(s.registrationClosesAt) : "",
      })),
    ),
  };
}

type ActionData = { errors: Partial<Record<SeasonField, string>> };

export async function action({ request, params }: Route.ActionArgs): Promise<ActionData | Response> {
  const { league, actor, base } = await leagueScope(request, params.league);
  const form = await request.formData();
  const id = Number(form.get("id") || 0);
  if (!Number.isInteger(id) || id < 0) throw new Response("Hibás azonosító.", { status: 400 });
  // Another league's season can't be touched by posting its id.
  if (id && !(await seasonInLeague(id, league.id))) throw data("Nincs ilyen szezon.", { status: 404 });
  const allowed = id ? seasonActions(await seasonState(id)) : null;

  if (form.get("intent") === "delete") {
    if (!id) throw new Response("Hibás azonosító.", { status: 400 });
    if (!allowed?.canDelete) throw data("Ezt a szezont már nem lehet törölni: van nevezés, vagy kint vannak a csoportok.", { status: 409 });
    if (!(await deleteSeason(id, actor.id))) throw data("Ezt a szezont már nem lehet törölni: van nevezés, vagy kint vannak a csoportok.", { status: 409 });
    return redirect(base);
  }

  if (allowed && !allowed.canEdit)
    throw data("Ezt a szezont már nem lehet módosítani: az első kör csoportjai kint vannak.", { status: 409 });

  // A first season that starts at the minimum entries (D124): a new one
  // ("start" = "minimum"), or one still waiting.
  const stored = id ? await getSeason(id) : undefined;
  if (stored ? isWaiting(stored) : form.get("start") === "minimum") {
    const result = parseWaitingSeason(form);
    if (!result.ok) return { errors: result.errors };
    if (id) {
      if (!(await updateWaitingSeason(id, result.data, actor.id)))
        throw data("Közben kiderült a szezon kezdése. Frissítsd az oldalt.", { status: 409 });
    } else if (!(await createWaitingSeason(league.id, result.data, actor.id))) {
      return { errors: { start: FIRST_ONLY } };
    }
    return redirect(base);
  }

  const result = parseSeason(form);
  if (!result.ok) return { errors: result.errors };
  if (id) await updateSeason(id, result.data, result.phases, actor.id);
  else {
    // While the first season waits, it is the league's only one.
    if ((await listSeasons(league.id)).some(isWaiting)) return { errors: { start: WAITING_FIRST } };
    await createSeason(league.id, result.data, result.phases, actor.id);
  }
  return redirect(base);
}

const FIRST_ONLY = "Csak a liga első szezonja indulhat a minimum nevezéssel.";
const WAITING_FIRST = "Amíg az első szezon a nevezésekre vár, nem hozhatsz létre újat.";

type SeasonRow = Route.ComponentProps["loaderData"]["seasons"][number];

function Field({ name, label, hint, error, children }: { name: string; label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
    </div>
  );
}

type BreakRow = { key: number; start: string; end: string };

function SeasonForm({
  season,
  errors,
  base,
  firstSeason,
  minEntries,
}: {
  season?: SeasonRow;
  errors: Partial<Record<SeasonField, string>>;
  base: string;
  // The league has no season yet: it may start at the minimum entries.
  firstSeason: boolean;
  minEntries: number;
}) {
  const busy = useNavigation().state === "submitting";
  const [start, setStart] = useState(season?.waiting ? "minimum" : "dates");
  const atMinimum = start === "minimum";
  const [first, setFirst] = useState(season?.firstPhaseStart ?? "");
  const [breaks, setBreaks] = useState<BreakRow[]>(() => (season?.breaks ?? []).map((b, key) => ({ key, ...b })));
  const [nextKey, setNextKey] = useState(breaks.length);
  const setBreak = (key: number, patch: Partial<BreakRow>) =>
    setBreaks((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const preview = previewPhases(first, breaks);

  return (
    <Form method="post" className="grid gap-4 rounded-lg border p-4">
      <h2 className="font-display text-lg font-bold">{season ? `${season.name} szerkesztése` : "Új szezon"}</h2>
      {season && <input type="hidden" name="id" value={season.id} />}
      {!season && firstSeason && (
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">Kezdés</legend>
          <RadioGroup name="start" value={start} onValueChange={setStart}>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="dates" id="start-dates" />
              <Label htmlFor="start-dates" className="font-normal">
                Dátumokkal: nevezési időszak és az első kör hétfője
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="minimum" id="start-minimum" />
              <Label htmlFor="start-minimum" className="font-normal">
                Első szezon: akkor indul, ha összegyűlik a minimum nevezés ({minEntries} pár)
              </Label>
            </div>
          </RadioGroup>
          {errors.start && <p className="text-sm font-semibold text-destructive">{errors.start}</p>}
        </fieldset>
      )}
      {!season && !firstSeason && errors.start && <p className="text-sm font-semibold text-destructive">{errors.start}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field name="name" label="Név" hint="Pl. 2026/27 tél" error={errors.name}>
            <Input id="name" name="name" defaultValue={season?.name} maxLength={MAX_NAME} required />
          </Field>
        </div>
        {!atMinimum && (
          <>
            <Field name="registrationOpens" label="Nevezés kezdete" error={errors.registrationOpens}>
              <Input id="registrationOpens" name="registrationOpens" type="date" defaultValue={season?.registrationOpens} required />
            </Field>
            <Field
              name="registrationCloses"
              label="Nevezés vége"
              hint="Ezen a napon 23:59-ig lehet nevezni. Az első kör előtt kell zárulnia."
              error={errors.registrationCloses}
            >
              <Input id="registrationCloses" name="registrationCloses" type="date" defaultValue={season?.registrationCloses} required />
            </Field>
            <Field
              name="firstPhaseStart"
              label="Első kör hétfője"
              hint="Egy kör 3 hét, a határidő az utolsó vasárnap 23:59."
              error={errors.firstPhaseStart}
            >
              <Input id="firstPhaseStart" name="firstPhaseStart" type="date" value={first} onChange={(e) => setFirst(e.target.value)} required />
            </Field>
          </>
        )}
      </div>

      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">Szünetek</legend>
        <p className="text-xs text-muted-foreground">
          Szünet alatt nem fut kör: ha egy kör beleérne, a szünet utáni hétfőn kezdődik.
        </p>
        {breaks.map((b, i) => (
          <div key={b.key} className="flex flex-wrap items-center gap-2">
            <Input
              name="breakStart"
              type="date"
              aria-label={`${i + 1}. szünet kezdete`}
              value={b.start}
              onChange={(e) => setBreak(b.key, { start: e.target.value })}
              className="w-auto"
            />
            <span aria-hidden>–</span>
            <Input
              name="breakEnd"
              type="date"
              aria-label={`${i + 1}. szünet vége`}
              value={b.end}
              onChange={(e) => setBreak(b.key, { end: e.target.value })}
              className="w-auto"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`${i + 1}. szünet törlése`}
              onClick={() => setBreaks((rows) => rows.filter((r) => r.key !== b.key))}
            >
              <X />
            </Button>
          </div>
        ))}
        {errors.breaks && <p className="text-sm font-semibold text-destructive">{errors.breaks}</p>}
        {breaks.length < MAX_BREAKS && (
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            onClick={() => {
              setBreaks((rows) => [...rows, { key: nextKey, start: "", end: "" }]);
              setNextKey((k) => k + 1);
            }}
          >
            <Plus /> Szünet hozzáadása
          </Button>
        )}
      </fieldset>

      <section className="grid gap-2 rounded-md bg-muted/50 p-3 text-sm" aria-live="polite">
        <h3 className="font-semibold">Előnézet</h3>
        {atMinimum ? (
          <p className="text-muted-foreground">
            A nevezés azonnal nyílik. Amikor összegyűlik {minEntries} nevezés, az 1. kör a legalább 7 nappal későbbi első
            hétfőn indul (ha szünet esik rá, a szünet után), és minden nevezett játékos e-mailt kap róla. A minimumot az
            Áttekintés oldalon módosíthatod.
          </p>
        ) : preview ? (
          <PhaseList phases={preview} />
        ) : (
          <p className="text-muted-foreground">
            {first ? "Az első kör csak hétfőn kezdődhet." : "Add meg az első kör hétfőjét, és itt látod a 4 kört."}
          </p>
        )}
      </section>

      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {season ? "Mentés" : "Létrehozás"}
        </Button>
        {season && (
          <Button variant="ghost" asChild>
            <Link to={base}>Mégse</Link>
          </Button>
        )}
      </div>
    </Form>
  );
}

function DeleteSeason({ season }: { season: SeasonRow }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Törlés">
          <Trash2 />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Törlöd a szezont?</AlertDialogTitle>
          <AlertDialogDescription>„{season.name}” és a körei törlődnek.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Mégse</AlertDialogCancel>
          <Form method="post">
            <input type="hidden" name="intent" value="delete" />
            <input type="hidden" name="id" value={season.id} />
            <AlertDialogAction variant="destructive" type="submit">
              Törlés
            </AlertDialogAction>
          </Form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function LeagueSeasons({ loaderData, actionData, params }: Route.ComponentProps) {
  const { league, seasons } = loaderData;
  const base = `/admin/leagues/${params.league}/seasons`;
  const [search] = useSearchParams();
  const editing = seasons.find((s) => String(s.id) === search.get("edit") && s.canEdit);

  return (
    <AppPage title="Szezonok" description={<>{league.name}: egy szezon 4 körből áll, egy kör 3 hét.</>}>
      {seasons.length === 0 ? (
        <p className="py-6 text-center text-muted-foreground">Még nincs szezon.</p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Szezon</TableHead>
                <TableHead>Nevezés</TableHead>
                <TableHead>Körök</TableHead>
                <TableHead>Vége</TableHead>
                <TableHead>Nevezések</TableHead>
                <TableHead>1. kör</TableHead>
                <TableHead>
                  <span className="sr-only">Műveletek</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {seasons.map((s) => {
                const end = seasonEnd(s);
                return (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell>
                      {s.registrationClosesAt
                        ? `${formatShortDate(s.registrationOpensAt)} – ${formatShortDate(s.registrationClosesAt)}`
                        : `${formatShortDate(s.registrationOpensAt)} óta nyitva`}
                    </TableCell>
                    <TableCell>
                      {s.waiting ? (
                        <span className="text-muted-foreground">{waitingText(s.entries, league.minEntries)}</span>
                      ) : (
                        <PhaseList phases={s.phases} compact />
                      )}
                    </TableCell>
                    <TableCell>{end && formatDate(end)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Link to={`${base}/${s.id}/entries`} className="underline">
                        {s.entries} nevezett
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Link to={`${base}/${s.id}/groups`} className="underline">
                        {s.canEdit ? "Csoportok" : "Közzétéve"}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {s.canEdit && (
                        <Button variant="ghost" size="icon" aria-label="Szerkesztés" asChild>
                          <Link to={`?edit=${s.id}`}>
                            <Pencil />
                          </Link>
                        </Button>
                      )}
                      {s.canDelete && <DeleteSeason season={s} />}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Keyed by season (and a new one by the count), so switching seasons or saving resets the fields. */}
      <SeasonForm
        key={editing?.id ?? `new-${seasons.length}`}
        season={editing}
        errors={actionData?.errors ?? {}}
        base={base}
        firstSeason={seasons.length === 0}
        minEntries={league.minEntries}
      />
    </AppPage>
  );
}
