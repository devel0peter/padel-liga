import { Form, Link, useFetcher, useSearchParams } from "react-router";

import type { Route } from "./+types/admin.users";
import { AppPage } from "~/components/app-page";
import { PersonLink } from "~/components/person-link";
import { PhoneLink } from "~/components/phone-link";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { DELETED, DELETION_EFFECTS } from "~/lib/account-deletion";
import { deleteAccount } from "~/lib/account-deletion.server";
import { requirePermission } from "~/lib/auth/admin.server";
import { can } from "~/lib/auth/permissions";
import { formatDateTime } from "~/lib/format";
import { listUsers, type UserRow } from "~/lib/users-admin.server";
import {
  FILTER_KEYS,
  filterCounts,
  filterUsers,
  hasUserFilters,
  parseUserFilters,
  USER_FILTERS,
  type FilterKey,
} from "~/lib/users-filter";

// Every account (Admin only); a name opens the player's profile (#301).
// Roles are shown, not edited: Szervezők are
// appointed on Ligák, the Admin only by the CLI. Phone numbers tap to call
// (D126).
// "Utolsó belépés" and "Törlés" (#152) only for the Admin, even if the page
// is ever opened to others.

export async function loader({ request }: Route.LoaderArgs) {
  const actor = await requirePermission(request, { kind: "users.view" });
  const filters = parseUserFilters(new URL(request.url).searchParams);
  const lastLogin = actor.platformRole === "superadmin";
  const deleteAs = can(actor, { kind: "users.delete" }) ? actor.id : null;
  const all = await listUsers({ withLastLogin: lastLogin, deleteAs });
  return {
    users: filterUsers(all, filters),
    total: all.length,
    counts: filterCounts(all, filters),
    lastLogin,
    canDelete: !!deleteAs,
  };
}

// "Törlés": removes the account, or anonymizes it when it has history
// (account-deletion.ts). No email goes out.
export async function action({ request }: Route.ActionArgs) {
  const actor = await requirePermission(request, { kind: "users.delete" });
  const form = await request.formData();
  const userId = String(form.get("user") ?? "");
  if (form.get("intent") !== "delete" || !userId) throw new Response("Hibás kérés.", { status: 400 });
  const result = await deleteAccount(actor.id, userId);
  return result.ok ? { ok: true as const, message: DELETED[result.mode] } : { error: result.error };
}

// One fetcher for every row, so the result stays on the page after the row
// is gone.
const DELETE_FETCHER = "account-delete";

function DeleteDialog({ user }: { user: UserRow }) {
  const fetcher = useFetcher<typeof action>({ key: DELETE_FETCHER });
  const deletion = user.deletion;
  if (!deletion) return null;
  const who = user.name || user.email;
  const refused = "refused" in deletion ? deletion.refused : null;
  const effect = "mode" in deletion ? DELETION_EFFECTS[deletion.mode] : "";
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-destructive" disabled={fetcher.state !== "idle"}>
          Törlés
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{refused ? `${who} fiókja nem törölhető` : `Törlöd ${who} fiókját?`}</AlertDialogTitle>
          <AlertDialogDescription>
            {refused ?? `${user.email}. ${effect} Nem vonható vissza.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{refused ? "Rendben" : "Mégse"}</AlertDialogCancel>
          {!refused && (
            <AlertDialogAction
              variant="destructive"
              onClick={() => fetcher.submit({ intent: "delete", user: user.id }, { method: "post" })}
            >
              Törlés
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DeleteResult() {
  const fetcher = useFetcher<typeof action>({ key: DELETE_FETCHER });
  const result = fetcher.data;
  if (!result || fetcher.state !== "idle") return null;
  return "error" in result ? (
    <p role="alert" className="text-sm font-semibold text-destructive">
      {result.error}
    </p>
  ) : (
    <p role="status" className="text-sm text-muted-foreground">
      {result.message}
    </p>
  );
}

const ALL = "all";

// One filter group as a select; each option shows how many accounts it
// matches with the other filters and the search applied.
function FilterSelect({ name, counts }: { name: FilterKey; counts: Record<string, number> }) {
  const [params, setParams] = useSearchParams();
  const { label, options } = USER_FILTERS[name];
  const current = params.get(name) ?? "";
  return (
    <Select
      value={Object.hasOwn(options, current) ? current : ALL}
      onValueChange={(value) =>
        setParams((prev) => {
          if (value === ALL) prev.delete(name);
          else prev.set(name, value);
          return prev;
        })
      }
    >
      <SelectTrigger aria-label={label} className="w-full sm:w-56">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{label}: mind</SelectItem>
        {Object.entries(options).map(([value, o]) => (
          <SelectItem key={value} value={value}>
            {o.label} ({counts[value]})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function AdminUsers({ loaderData }: Route.ComponentProps) {
  const { users, total, counts, lastLogin, canDelete } = loaderData;
  const [params] = useSearchParams();
  const filtered = hasUserFilters(parseUserFilters(params));
  return (
    <AppPage title="Felhasználók" description={`${users.length} fiók${filtered ? ` (összesen ${total})` : ""}`}>
      <div className="flex flex-wrap gap-2">
        <Form method="get" className="w-full sm:w-72">
          {[...params.entries()]
            .filter(([k]) => k !== "q")
            .map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
          <Input
            key={params.get("q") ?? ""}
            name="q"
            type="search"
            defaultValue={params.get("q") ?? ""}
            placeholder="Keresés név vagy e-mail szerint…"
            aria-label="Keresés"
          />
        </Form>
        {FILTER_KEYS.map((key) => (
          <FilterSelect key={key} name={key} counts={counts[key]} />
        ))}
        {filtered && (
          <Button variant="ghost" asChild>
            <Link to="/admin/users">Szűrők törlése</Link>
          </Button>
        )}
      </div>
      {canDelete && <DeleteResult />}
      {users.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
          {filtered ? "Nincs ilyen fiók." : "Még senki nem regisztrált."}
        </p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Név</TableHead>
                <TableHead className="hidden sm:table-cell">E-mail</TableHead>
                <TableHead className="hidden sm:table-cell">Telefon</TableHead>
                <TableHead className="hidden sm:table-cell">Szerep</TableHead>
                <TableHead>Állapot</TableHead>
                <TableHead className="hidden sm:table-cell">Belépés</TableHead>
                {lastLogin && <TableHead className="hidden sm:table-cell">Utolsó belépés</TableHead>}
                <TableHead className="hidden sm:table-cell">Regisztrált</TableHead>
                {canDelete && (
                  <TableHead>
                    <span className="sr-only">Műveletek</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium whitespace-normal">
                    <PersonLink id={u.id} name={u.name || "Névtelen"} />
                    {/* The columns that don't fit a phone fold under the name (#146). */}
                    <div className="grid gap-0.5 text-sm font-normal break-all text-muted-foreground sm:hidden">
                      <span>{u.email}</span>
                      <PhoneLink phone={u.phone} />
                      <span>{u.role}</span>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{u.email}</TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {u.phone ? <PhoneLink phone={u.phone} /> : <span className="text-muted-foreground">–</span>}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Badge variant={u.role === "Játékos" ? "outline" : "secondary"}>{u.role}</Badge>
                    {u.leagues.length > 0 && <span className="ml-2 text-sm text-muted-foreground">{u.leagues.join(", ")}</span>}
                  </TableCell>
                  <TableCell className="min-w-48 whitespace-normal">
                    <StatusChips chips={u.status} />
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{u.google ? "Google, kód" : "Kód"}</TableCell>
                  {lastLogin && (
                    <TableCell className="hidden text-sm whitespace-nowrap sm:table-cell">
                      {u.lastLoginAt ? formatDateTime(new Date(u.lastLoginAt)) : <span className="text-muted-foreground">–</span>}
                    </TableCell>
                  )}
                  <TableCell className="hidden text-sm whitespace-nowrap sm:table-cell">{formatDateTime(new Date(u.createdAt))}</TableCell>
                  {canDelete && (
                    <TableCell className="text-right">
                      <DeleteDialog user={u} />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </AppPage>
  );
}
