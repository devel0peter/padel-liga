import { Form, Link, useSearchParams } from "react-router";

import type { Route } from "./+types/admin.users";
import { AppPage } from "~/components/app-page";
import { StatusChips } from "~/components/status-chips";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { requirePermission } from "~/lib/auth/admin.server";
import { formatDateTime } from "~/lib/format";
import { listUsers } from "~/lib/users-admin.server";
import {
  FILTER_KEYS,
  filterCounts,
  filterUsers,
  hasUserFilters,
  parseUserFilters,
  USER_FILTERS,
  type FilterKey,
} from "~/lib/users-filter";

// Every account (Admin only). Roles are shown, not edited: Szervezők are
// appointed on Ligák, the Admin only by the CLI. No phone numbers here.
// "Utolsó belépés" only for the Admin, even if the page is ever opened to
// others.

export async function loader({ request }: Route.LoaderArgs) {
  const actor = await requirePermission(request, { kind: "users.view" });
  const filters = parseUserFilters(new URL(request.url).searchParams);
  const lastLogin = actor.platformRole === "superadmin";
  const all = await listUsers({ withLastLogin: lastLogin });
  return { users: filterUsers(all, filters), total: all.length, counts: filterCounts(all, filters), lastLogin };
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
  const { users, total, counts, lastLogin } = loaderData;
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
                <TableHead className="hidden sm:table-cell">Szerep</TableHead>
                <TableHead>Állapot</TableHead>
                <TableHead className="hidden sm:table-cell">Belépés</TableHead>
                {lastLogin && <TableHead className="hidden sm:table-cell">Utolsó belépés</TableHead>}
                <TableHead className="hidden sm:table-cell">Regisztrált</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium whitespace-normal">
                    {u.name || <span className="text-muted-foreground">nincs megadva</span>}
                    {/* The columns that don't fit a phone fold under the name (#146). */}
                    <div className="grid gap-0.5 text-sm font-normal break-all text-muted-foreground sm:hidden">
                      <span>{u.email}</span>
                      <span>{u.role}</span>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{u.email}</TableCell>
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
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </AppPage>
  );
}
