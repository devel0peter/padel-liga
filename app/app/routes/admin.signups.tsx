import { Download, Trash2 } from "lucide-react";
import { useState } from "react";
import { Form, Link, useFetcher, useSearchParams } from "react-router";

import type { Route } from "./+types/admin.signups";
import { Wrap } from "~/components/site";
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
import { requireAdmin } from "~/lib/access.server";
import { CITIES, OTHER_CITY } from "~/lib/cities";
import { formatDateTime } from "~/lib/format";
import { LEVELS } from "~/lib/interest";
import {
  cityLabel,
  countSignups,
  filterSignups,
  isStatus,
  levelLabel,
  parseFilters,
  STATUSES,
  type SignupRow,
} from "~/lib/signups-admin";
import { deleteSignup, listSignups, updateSignup } from "~/lib/signups-admin.server";

const MAX_ADMIN_NOTE = 2000;

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const filters = parseFilters(new URL(request.url).searchParams);
  const all = await listSignups();
  const rows = filterSignups(all, filters);
  return { rows, counts: countSignups(rows), total: all.length };
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request);
  const form = await request.formData();
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

function SignupTableRow({ row }: { row: SignupRow }) {
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
      <TableCell>{cityLabel(row)}</TableCell>
      <TableCell className="min-w-56">
        <div className="grid gap-2">
          <Player name={row.name1} email={row.email1} />
          {row.mode === "pair" && row.name2 ? (
            <Player name={row.name2} email={row.email2} />
          ) : (
            <Badge variant="secondary">Egyéni, párt keres</Badge>
          )}
        </div>
      </TableCell>
      <TableCell>{levelLabel(row.level)}</TableCell>
      <TableCell className="max-w-56 text-sm whitespace-normal">{row.note}</TableCell>
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

export default function AdminSignups({ loaderData }: Route.ComponentProps) {
  const { rows, counts, total } = loaderData;
  const [params] = useSearchParams();
  const filtered = [...params.keys()].length > 0;

  return (
    <Wrap className="grid grid-cols-1 gap-5 [&>*]:min-w-0">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold">Jelentkezők</h1>
          <p className="text-sm text-muted-foreground">
            {counts.signups} jelentkezés{filtered && ` (összesen ${total})`} · {counts.pairs} pár ·{" "}
            {counts.solo} egyéni · {counts.players} játékos
          </p>
        </div>
        <Button variant="outline" asChild>
          <a href={`/admin/export.csv?${params.toString()}`} download>
            <Download /> CSV letöltése
          </a>
        </Button>
      </div>

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
          options={[...CITIES.map((c) => [c.slug, c.name] as [string, string]), [OTHER_CITY, "Más város"]]}
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
        {filtered && (
          <Button variant="ghost" asChild>
            <Link to="/admin">Szűrők törlése</Link>
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
    </Wrap>
  );
}
