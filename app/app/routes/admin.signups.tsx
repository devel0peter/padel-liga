import { Download, Mail, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import { Form, Link, useFetcher, useSearchParams } from "react-router";

import type { Route } from "./+types/admin.signups";
import { AppPage } from "~/components/app-page";
import { CARD_CELL, CARD_ROW, CardLabel } from "~/components/card-table";
import { StatusChips } from "~/components/status-chips";
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
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { Textarea } from "~/components/ui/textarea";
import { requirePermission } from "~/lib/auth/admin.server";
import { OTHER_CITY } from "~/lib/cities";
import { listCities } from "~/lib/cities.server";
import { formatDateTime } from "~/lib/format";
import { homeClubLabel, OTHER_CLUB, refLabel } from "~/lib/clubs";
import { listClubs } from "~/lib/clubs.server";
import { LEVELS } from "~/lib/interest";
import { listLeagues } from "~/lib/leagues.server";
import { statusChips, type StatusChip } from "~/lib/player-status";
import { playerStatuses } from "~/lib/player-status.server";
import {
  cityLabel,
  countSignups,
  filterSignups,
  isStatus,
  levelLabel,
  NO_REF,
  parseFilters,
  STATUSES,
  type SignupRow,
} from "~/lib/signups-admin";
import { SEND_NOW_MAX } from "~/lib/email/budget";
import { pendingRegistrationInvites, queueRegistrationInvites } from "~/lib/email/outbox.server";
import {
  filterByStage,
  FUNNEL,
  inviteChip,
  NO_MAIL_STAGES,
  parseStage,
  progressContext,
  signupStages,
  stageCounts,
  STAGES,
  type Stage,
} from "~/lib/signup-progress";
import { deleteSignup, listSignups, updateSignup } from "~/lib/signups-admin.server";
import { cn } from "~/lib/utils";

const MAX_ADMIN_NOTE = 2000;

export async function loader({ request }: Route.LoaderArgs) {
  await requirePermission(request, { kind: "signups.manage" });
  const params = new URL(request.url).searchParams;
  const filters = parseFilters(params);
  const stage = parseStage(params);
  const [all, clubs, cities, invites, statuses, leagues] = await Promise.all([
    listSignups(),
    listClubs(),
    listCities(),
    pendingRegistrationInvites(),
    playerStatuses(),
    listLeagues(),
  ]);
  const names = new Map(all.map((r) => [r.id, r.name1]));
  const ctx = progressContext(all, statuses.byEmail, leagues);
  // Each person's account (and invite while they have none), pair and entry
  // in the leagues of the signup's city.
  const chips = (email: string | null, city: string, at: Stage | undefined): StatusChip[] => {
    if (!email) return [];
    const ids = ctx.leagueIds(city);
    const [account, ...rest] = statusChips(ctx.status(email), ids, ids.length > 1);
    const invite = at && inviteChip(at);
    return invite ? [account, invite, ...rest] : [account, ...rest];
  };
  // The "Hol tart" counts follow the other filters, not the stage itself.
  const filtered = filterSignups(all, filters);
  const rows = filterByStage(filtered, stage, ctx).map((r) => {
    const [stage1, stage2] = signupStages(r, ctx);
    return {
      ...r,
      pairedName: r.pairedWith != null ? (names.get(r.pairedWith) ?? null) : null,
      cityText: cityLabel(r, cities),
      source: refLabel(r.ref, clubs),
      plays: homeClubLabel(r.homeClub, clubs),
      status1: chips(r.email1, r.city, stage1),
      status2: r.mode === "pair" ? chips(r.email2, r.city, stage2) : [],
    };
  });
  // Filter options: every club, plus any other ref that came in.
  const refs = new Map<string, string>(clubs.map((c) => [c.slug, c.name]));
  for (const r of all) if (r.ref && !refs.has(r.ref)) refs.set(r.ref, r.ref);
  const clubOptions = clubs.map((c) => [c.slug, c.name] as [string, string]);
  const cityOptions = cities.map((c) => [c.slug, c.name] as [string, string]);
  return {
    rows,
    counts: countSignups(rows),
    stages: stageCounts(filtered, ctx),
    total: all.length,
    refs: [...refs],
    clubOptions,
    cityOptions,
    invitesPending: invites.length,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const actor = await requirePermission(request, { kind: "signups.manage" });
  const form = await request.formData();
  // The registration invite to the whole interest list (#20), not the filtered view.
  if (form.get("intent") === "invite") {
    // Queued and sent right away, within the daily limit (#112).
    const queued = await queueRegistrationInvites(new Date(), undefined, actor.id);
    return { ok: true, queued };
  }
  const id = Number(form.get("id"));
  if (!Number.isInteger(id) || id <= 0) throw new Response("Hibás azonosító.", { status: 400 });

  const intent = form.get("intent");
  if (intent === "delete") {
    await deleteSignup(id, actor.id);
    return { ok: true };
  }
  if (intent === "update") {
    const status = form.get("status");
    const note = form.get("adminNote");
    const changes: Parameters<typeof updateSignup>[1] = {};
    if (typeof status === "string") {
      if (!isStatus(status)) throw new Response("Ismeretlen állapot.", { status: 400 });
      changes.status = status;
    }
    if (typeof note === "string") changes.adminNote = note.trim().slice(0, MAX_ADMIN_NOTE) || null;
    await updateSignup(id, changes, actor.id);
    return { ok: true };
  }
  throw new Response("Ismeretlen művelet.", { status: 400 });
}

const ALL = "all";

function FilterSelect({
  name,
  label,
  options,
}: {
  name: string;
  label: string;
  options: [string, string][];
}) {
  const [params, setParams] = useSearchParams();
  return (
    <Select
      value={params.get(name) || ALL}
      onValueChange={(value) =>
        setParams((prev) => {
          if (value === ALL) prev.delete(name);
          else prev.set(name, value);
          return prev;
        })
      }
    >
      <SelectTrigger aria-label={label} className="w-full sm:w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{label}: mind</SelectItem>
        {options.map(([value, text]) => (
          <SelectItem key={value} value={value}>
            {text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Player({ name, email, status }: { name: string; email: string | null; status: StatusChip[] }) {
  return (
    <div className="grid gap-1">
      <div>
        <div className="font-medium">{name}</div>
        {email && (
          <a href={`mailto:${email}`} className="text-xs break-all text-muted-foreground underline">
            {email}
          </a>
        )}
      </div>
      <StatusChips chips={status} />
    </div>
  );
}

function SignupTableRow({
  row,
}: {
  row: SignupRow & {
    source: string;
    plays: string;
    cityText: string;
    pairedName: string | null;
    status1: StatusChip[];
    status2: StatusChip[];
  };
}) {
  const fetcher = useFetcher();
  const [note, setNote] = useState(row.adminNote ?? "");
  const saving = fetcher.state !== "idle";
  const deleting = saving && fetcher.formData?.get("intent") === "delete";

  const save = (fields: Record<string, string>) =>
    fetcher.submit({ intent: "update", id: String(row.id), ...fields }, { method: "post" });

  return (
    <TableRow className={cn(CARD_ROW, deleting && "opacity-40")}>
      <TableCell className={cn("text-xs text-muted-foreground", CARD_CELL, "sm:whitespace-normal max-sm:grid max-sm:gap-2 max-sm:text-xs")}>
        <div>
          <CardLabel>Jelentkezett</CardLabel>
          {formatDateTime(new Date(row.createdAt))}
        </div>
        <div className="max-sm:text-foreground">
          <CardLabel>Város</CardLabel>
          {row.cityText}
        </div>
      </TableCell>
      <TableCell className={cn("whitespace-normal max-sm:order-first", CARD_CELL)}>
        {/* A long name wraps inside its badge (the table has fixed column widths). */}
        <div className="grid gap-2 [&_[data-slot=badge]]:h-auto [&_[data-slot=badge]]:max-w-full [&_[data-slot=badge]]:whitespace-normal">
          <Player name={row.name1} email={row.email1} status={row.status1} />
          {row.mode === "pair" && row.name2 ? (
            <Player name={row.name2} email={row.email2} status={row.status2} />
          ) : row.pairedName ? (
            <Badge variant="secondary">Párja: {row.pairedName}</Badge>
          ) : row.cityOther == null ? (
            <Badge variant="secondary">Egyéni, párt keres</Badge>
          ) : null}
          {row.wantsToOrganize && <Badge>Szervezne ligát</Badge>}
        </div>
      </TableCell>
      <TableCell className={cn("break-words whitespace-normal", CARD_CELL, "max-sm:grid max-sm:gap-2")}>
        <div>
          <CardLabel>Szint</CardLabel>
          {levelLabel(row.level)}
        </div>
        {row.note && (
          <div className="text-sm">
            <CardLabel>Megjegyzés</CardLabel>
            {row.note}
          </div>
        )}
      </TableCell>
      <TableCell className={cn("text-sm break-words whitespace-normal", CARD_CELL, "max-sm:grid max-sm:gap-2")}>
        {row.plays && (
          <div>
            <CardLabel>Hol játszik</CardLabel>
            {row.plays}
          </div>
        )}
        {row.source && (
          <div className="text-xs text-muted-foreground max-sm:text-sm max-sm:text-foreground">
            <span className="max-sm:hidden">Forrás: </span>
            <CardLabel>Forrás</CardLabel>
            {row.source}
          </div>
        )}
      </TableCell>
      <TableCell className={CARD_CELL}>
        <Select defaultValue={row.status} onValueChange={(status) => save({ status })}>
          <SelectTrigger aria-label="Állapot" className="w-36 sm:w-full sm:max-w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(STATUSES).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className={cn(CARD_CELL)}>
        <Textarea
          aria-label="Admin jegyzet"
          value={note}
          maxLength={MAX_ADMIN_NOTE}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => {
            if (note.trim() !== (row.adminNote ?? "")) save({ adminNote: note });
          }}
          placeholder="Csak te látod"
          className="min-h-9 text-sm"
        />
      </TableCell>
      <TableCell className={CARD_CELL}>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Törlés" disabled={deleting}>
              <Trash2 />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Törlöd a jelentkezést?</AlertDialogTitle>
              <AlertDialogDescription>
                {row.name1}
                {row.name2 ? ` és ${row.name2}` : ""} adatai véglegesen törlődnek. Ezt nem
                lehet visszavonni.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Mégse</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() =>
                  fetcher.submit({ intent: "delete", id: String(row.id) }, { method: "post" })
                }
              >
                Törlés
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </TableCell>
    </TableRow>
  );
}

// "Hol tartanak": people per stage (signup-progress.ts), each a link that
// filters the list to the signups with someone at that stage.
function StageSummary({ counts }: { counts: Record<Stage, number> }) {
  const [params] = useSearchParams();
  const current = params.get("stage");
  const link = (stage: Stage) => {
    const next = new URLSearchParams(params);
    if (current === stage) next.delete("stage");
    else next.set("stage", stage);
    return `?${next.toString()}`;
  };
  const shown = (Object.keys(STAGES) as Stage[]).filter((s) => FUNNEL.includes(s) || counts[s] > 0);
  return (
    <section aria-label="Hol tartanak" className="grid gap-2">
      <h2 className="text-sm font-medium text-muted-foreground">Hol tartanak (fő)</h2>
      <div className="flex flex-wrap gap-2">
        {shown.map((s) => (
          <Button key={s} asChild size="sm" variant={current === s ? "default" : "outline"}>
            <Link to={link(s)} aria-pressed={current === s} preventScrollReset>
              {STAGES[s]}: <span className="font-semibold tabular-nums">{counts[s]}</span>
            </Link>
          </Button>
        ))}
      </div>
    </section>
  );
}

// Registration invite (#20): everyone pending on the interest list, once.
function InviteButton({ pending }: { pending: number }) {
  // A new fetcher each time the dialog opens, so an earlier result doesn't stick.
  const [round, setRound] = useState(0);
  const fetcher = useFetcher<{ queued?: number }>({ key: `registration-invite-${round}` });
  const [open, setOpen] = useState(false);
  const sending = fetcher.state !== "idle";
  const queued = fetcher.state === "idle" ? fetcher.data?.queued : undefined;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (sending) return;
        if (next) setRound((r) => r + 1);
        setOpen(next);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="outline" disabled={pending === 0}>
          <Send /> Regisztrációs meghívó ({pending} cím)
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        {queued !== undefined ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Meghívók elindultak</AlertDialogTitle>
              <AlertDialogDescription>
                {queued <= SEND_NOW_MAX
                  ? `${queued} levél a háttérben megy ki, a napi limit szerint; ami ma nem fér bele, holnap.`
                  : `${queued} levél a háttérben indul: az első ${SEND_NOW_MAX} most, a többi tízpercenként, a napi limit szerint.`}{" "}
                Hogy hol tart, a{" "}
                <Link to="/admin/outbox" className="underline">
                  Kimenő levelek
                </Link>{" "}
                oldalon látod.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogAction>Rendben</AlertDialogAction>
            </AlertDialogFooter>
          </>
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Küldöd a regisztrációs meghívót?</AlertDialogTitle>
              <AlertDialogDescription>
                {pending} cím kap egy levelet a belépés linkjével, kitöltött e-mail-címmel. Mindenki csak egyszer
                kapja meg: a párok mindkét tagja és az egyedül jelentkezők is (aki még párt vár, saját szöveggel).
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={sending}>Mégse</AlertDialogCancel>
              <Button
                disabled={sending}
                onClick={() => fetcher.submit({ intent: "invite" }, { method: "post" })}
              >
                {sending ? "Küldés…" : "Küldés"}
              </Button>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function AdminSignups({ loaderData }: Route.ComponentProps) {
  const { rows, counts, stages, total, refs, clubOptions, cityOptions, invitesPending } = loaderData;
  const [params] = useSearchParams();
  const filtered = [...params.keys()].length > 0;
  // With "Hol tart", the mail goes to the people at that stage (D58); never
  // to the withdrawn.
  const noMail = NO_MAIL_STAGES.some((s) => params.get("stage") === s);

  return (
    <AppPage
      title="Jelentkezők"
      description={
        <>
          {counts.signups} jelentkezés{filtered && ` (összesen ${total})`} · {counts.pairs} pár ·{" "}
          {counts.solo} egyéni · {counts.players} játékos
        </>
      }
      actions={
        <>
          <InviteButton pending={invitesPending} />
          {noMail ? (
            <Button variant="outline" disabled title="Aki visszalépett, nem kap levelet.">
              <Mail /> Levél nekik
            </Button>
          ) : (
            <Button variant="outline" asChild>
              <Link to={`/admin/broadcasts/new?${params.toString()}`}>
                <Mail /> Levél nekik
              </Link>
            </Button>
          )}
          <Button variant="outline" asChild>
            <a href={`/admin/export.csv?${params.toString()}`} download>
              <Download /> CSV letöltése
            </a>
          </Button>
        </>
      }
    >
      <StageSummary counts={stages} />

      <div className="flex flex-wrap gap-2">
        <Form method="get" className="w-full sm:w-64">
          {[...params.entries()]
            .filter(([k]) => k !== "q")
            .map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
          <Input
            type="search"
            name="q"
            defaultValue={params.get("q") ?? ""}
            placeholder="Keresés név, e-mail, város…"
            aria-label="Keresés"
          />
        </Form>
        <FilterSelect
          name="city"
          label="Város"
          options={[...cityOptions, [OTHER_CITY, "Más város"]]}
        />
        <FilterSelect name="status" label="Állapot" options={Object.entries(STATUSES)} />
        <FilterSelect
          name="level"
          label="Szint"
          options={Object.keys(LEVELS).map((l) => [l, levelLabel(l)] as [string, string])}
        />
        <FilterSelect
          name="mode"
          label="Mód"
          options={[
            ["pair", "Pár"],
            ["solo", "Egyéni"],
          ]}
        />
        <FilterSelect
          name="club"
          label="Hol játszik"
          options={[...clubOptions, [OTHER_CLUB, "Máshol / vegyesen"], [NO_REF, "Nem adta meg"]]}
        />
        <FilterSelect name="ref" label="Forrás" options={[...refs, [NO_REF, "Forrás nélkül"]]} />
        {filtered && (
          <Button variant="ghost" asChild>
            <Link to="/admin/signups">Szűrők törlése</Link>
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="py-10 text-center text-muted-foreground">
          {total === 0 ? "Még nincs jelentkező." : "Nincs a szűrésnek megfelelő jelentkező."}
        </p>
      ) : (
        <div className="rounded-lg border">
          <Table aria-label="Jelentkezők listája" className="max-sm:block sm:min-w-[900px] sm:table-fixed">
            <TableHeader className="max-sm:hidden">
              <TableRow>
                <TableHead className="whitespace-normal w-[12%]">Jelentkezett, város</TableHead>
                <TableHead className="whitespace-normal w-[24%]">Játékosok</TableHead>
                <TableHead className="whitespace-normal w-[11%]">Szint, megjegyzés</TableHead>
                <TableHead className="whitespace-normal w-[14%]">Hol játszik, forrás</TableHead>
                <TableHead className="whitespace-normal w-[15%]">Állapot</TableHead>
                <TableHead className="whitespace-normal w-[18%]">Admin jegyzet</TableHead>
                <TableHead className="w-[6%]">
                  <span className="sr-only">Műveletek</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="max-sm:block">
              {rows.map((row) => (
                <SignupTableRow key={row.id} row={row} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </AppPage>
  );
}
