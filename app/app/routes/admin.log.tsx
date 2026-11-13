import { Link, useSearchParams } from "react-router";

import type { Route } from "./+types/admin.log";
import { AppPage } from "~/components/app-page";
import { PersonLink } from "~/components/person-link";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { hasLogFilters, pageHref, parseLogFilters } from "~/lib/audit-log";
import { auditLogPage, type Option } from "~/lib/audit-log.server";
import { requirePermission } from "~/lib/auth/admin.server";
import { formatDateTime } from "~/lib/format";
import { SITE_NAME } from "~/lib/site";

// "Napló" (#226, D91): the audit log for the Admin, newest first, 50 a page,
// filtered by action, actor, league and dates in the address. Read-only: no
// form or button here changes an entry, and the route has no action.

export function meta({}: Route.MetaArgs) {
  return [{ title: `Napló – ${SITE_NAME}` }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requirePermission(request, { kind: "log.view" });
  const filters = parseLogFilters(new URL(request.url).searchParams);
  return { ...(await auditLogPage(filters)), filters };
}

const ALL = "all";

function FilterSelect({ name, label, options }: { name: string; label: string; options: Option[] }) {
  const [params, setParams] = useSearchParams();
  const current = params.get(name) ?? "";
  return (
    <Select
      value={options.some((o) => o.value === current) ? current : ALL}
      onValueChange={(value) =>
        setParams((prev) => {
          if (value === ALL) prev.delete(name);
          else prev.set(name, value);
          prev.delete("page");
          return prev;
        })
      }
    >
      <SelectTrigger aria-label={label} className="w-full sm:w-56">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{label}: mind</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function DateFilter({ name, label }: { name: "from" | "to"; label: string }) {
  const [params, setParams] = useSearchParams();
  const id = `log-${name}`;
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={id} className="text-sm text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        type="date"
        className="w-40"
        value={params.get(name) ?? ""}
        onChange={(e) =>
          setParams((prev) => {
            if (e.target.value) prev.set(name, e.target.value);
            else prev.delete(name);
            prev.delete("page");
            return prev;
          })
        }
      />
    </div>
  );
}

export default function AdminLog({ loaderData }: Route.ComponentProps) {
  const { rows, total, pages, options, filters } = loaderData;
  const [params] = useSearchParams();
  const filtered = hasLogFilters(filters);
  return (
    <AppPage title="Napló" description={`Ki mit változtatott, a legújabb elöl. ${total} bejegyzés${filtered ? " a szűrőkkel" : ""}.`}>
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect name="action" label="Művelet" options={options.actions} />
        <FilterSelect name="actor" label="Ki" options={options.actors} />
        <FilterSelect name="league" label="Liga" options={options.leagues} />
        <DateFilter name="from" label="Ettől" />
        <DateFilter name="to" label="Eddig" />
        {filtered && (
          <Button variant="ghost" asChild>
            <Link to="/admin/log">Szűrők törlése</Link>
          </Button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
          {filtered ? "Nincs ilyen bejegyzés." : "Még nincs bejegyzés."}
        </p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Időpont</TableHead>
                <TableHead>Ki</TableHead>
                <TableHead>Mit</TableHead>
                <TableHead>Min</TableHead>
                <TableHead>Részletek</TableHead>
                <TableHead>Liga</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap tabular-nums">{formatDateTime(new Date(r.at))}</TableCell>
                  <TableCell>
                    <PersonLink id={r.actorId} name={r.actor} />
                  </TableCell>
                  <TableCell className="font-medium" title={r.action}>
                    {r.actionLabel}
                  </TableCell>
                  <TableCell className="max-w-xs whitespace-normal break-words">
                    <PersonLink id={r.targetUserId} name={r.target} />
                  </TableCell>
                  <TableCell className="max-w-sm text-xs whitespace-normal break-words text-muted-foreground">{r.detail || "–"}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.league ?? "–"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {pages > 1 && (
        <nav className="flex items-center justify-between gap-2" aria-label="Lapozás">
          <Button variant="outline" size="sm" asChild disabled={filters.page <= 1}>
            {filters.page > 1 ? <Link to={pageHref(params, filters.page - 1)}>Újabbak</Link> : <span>Újabbak</span>}
          </Button>
          <span className="text-sm text-muted-foreground">
            {filters.page}. oldal / {pages}
          </span>
          <Button variant="outline" size="sm" asChild disabled={filters.page >= pages}>
            {filters.page < pages ? <Link to={pageHref(params, filters.page + 1)}>Régebbiek</Link> : <span>Régebbiek</span>}
          </Button>
        </nav>
      )}
    </AppPage>
  );
}
