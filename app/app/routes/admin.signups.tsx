import { Download, Mail, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import { Form, Link, useFetcher, useSearchParams } from "react-router";

import type { Route } from "./+types/admin.signups";
import { AppPage } from "~/components/app-page";
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
import { deliver, pendingRegistrationInvites, queueRegistrationInvites } from "~/lib/email/outbox.server";
import { deleteSignup, listSignups, updateSignup } from "~/lib/signups-admin.server";

const MAX_ADMIN_NOTE = 2000;

export async function loader({ request }: Route.LoaderArgs) {
  await requirePermission(request, { kind: "signups.manage" });
  const filters = parseFilters(new URL(request.url).searchParams);
  const [all, clubs, cities, invites] = await Promise.all([
    listSignups(),
    listClubs(),
    listCities(),
    pendingRegistrationInvites(),
  ]);
  const names = new Map(all.map((r) => [r.id, r.name1]));
  const rows = filterSignups(all, filters).map((r) => ({
    ...r,
    pairedName: r.pairedWith != null ? (names.get(r.pairedWith) ?? null) : null,
    cityText: cityLabel(r, cities),
    source: refLabel(r.ref, clubs),
    plays: homeClubLabel(r.homeClub, clubs),
  }));
  // Filter options: every club, plus any other ref that came in.
  const refs = new Map<string, string>(clubs.map((c) => [c.slug, c.name]));
  for (const r of all) if (r.ref && !refs.has(r.ref)) refs.set(r.ref, r.ref);
  const clubOptions = clubs.map((c) => [c.slug, c.name] as [string, string]);
  const cityOptions = cities.map((c) => [c.slug, c.name] as [string, string]);
  return {
    rows,
    counts: countSignups(rows),
    total: all.length,
    refs: [...refs],
    clubOptions,
    cityOptions,
    invitesPending: invites.length,
  };
}

export async function action({ request }: Route.ActionArgs) {
  await requirePermission(request, { kind: "signups.manage" });
  const form = await request.formData();
  // The registration invite to the whole interest list (#20), not the filtered view.
  if (form.get("intent") === "invite") {
    const queued = await queueRegistrationInvites();
    await deliver();
    return { ok: true, queued };
  }
  const id = Number(form.get("id"));
  if (!Number.isInteger(id) || id <= 0) throw new Response("Hibás azonosító.", { status: 400 });

  const intent = form.get("intent");
  if (intent === "delete") {
    await deleteSignup(id);
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
    await updateSignup(id, changes);
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

function Player({ name, email }: { name: string; email: string | null }) {
  return (
    <div>
      <div className="font-medium">{name}</div>
      {email && (
        <a href={`mailto:${email}`} className="text-xs text-muted-foreground underline">
          {email}
        </a>
      )}
    </div>
  );
}

function SignupTableRow({
  row,
}: {
  row: SignupRow & { source: string; plays: string; cityText: string; pairedName: string | null };
}) {
  const fetcher = useFetcher();
  const [note, setNote] = useState(row.adminNote ?? "");
  const saving = fetcher.state !== "idle";
  const deleting = saving && fetcher.formData?.get("intent") === "delete";

  const save = (fields: Record<string, string>) =>
    fetcher.submit({ intent: "update", id: String(row.id), ...fields }, { method: "post" });

  return (
    <TableRow className={deleting ? "opacity-40" : ""}>
      <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
        {formatDateTime(new Date(row.createdAt))}
      </TableCell>
      <TableCell>{row.cityText}</TableCell>
      <TableCell className="min-w-56">
        <div className="grid gap-2">
          <Player name={row.name1} email={row.email1} />
          {row.mode === "pair" && row.name2 ? (
            <Player name={row.name2} email={row.email2} />
          ) : row.pairedName ? (
            <Badge variant="secondary">Párja: {row.pairedName}</Badge>
          ) : (
            <Badge variant="secondary">Egyéni, párt keres</Badge>
          )}
        </div>
      </TableCell>
      <TableCell>{levelLabel(row.level)}</TableCell>
      <TableCell className="max-w-56 text-sm whitespace-normal">{row.note}</TableCell>
      <TableCell className="text-sm">{row.plays}</TableCell>
      <TableCell className="text-sm">{row.source}</TableCell>
      <TableCell>
        <Select defaultValue={row.status} onValueChange={(status) => save({ status })}>
          <SelectTrigger aria-label="Állapot" className="w-36">
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
      <TableCell className="min-w-56">
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
      <TableCell>
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
              <AlertDialogTitle>Meghívók sorban</AlertDialogTitle>
              <AlertDialogDescription>{queued} levél sorban (napi kvóta szerint)</AlertDialogDescription>
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
                kapja meg; a párként megadott társak nem kapnak levelet.
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
  const { rows, counts, total, refs, clubOptions, cityOptions, invitesPending } = loaderData;
  const [params] = useSearchParams();
  const filtered = [...params.keys()].length > 0;

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
          <Button variant="outline" asChild>
            <Link to={`/admin/broadcasts/new?${params.toString()}`}>
              <Mail /> Levél nekik
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <a href={`/admin/export.csv?${params.toString()}`} download>
              <Download /> CSV letöltése
            </a>
          </Button>
        </>
      }
    >

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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Jelentkezett</TableHead>
                <TableHead>Város</TableHead>
                <TableHead>Játékosok</TableHead>
                <TableHead>Szint</TableHead>
                <TableHead>Megjegyzés</TableHead>
                <TableHead>Hol játszik</TableHead>
                <TableHead>Forrás</TableHead>
                <TableHead>Állapot</TableHead>
                <TableHead>Admin jegyzet</TableHead>
                <TableHead>
                  <span className="sr-only">Műveletek</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
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
