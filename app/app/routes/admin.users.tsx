import { Form, useSearchParams } from "react-router";

import type { Route } from "./+types/admin.users";
import { AppPage } from "~/components/app-page";
import { StatusChips } from "~/components/status-chips";
import { Badge } from "~/components/ui/badge";
import { Input } from "~/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { requirePermission } from "~/lib/auth/admin.server";
import { formatDateTime } from "~/lib/format";
import { listUsers } from "~/lib/users-admin.server";

// Every account (Admin only). Roles are shown, not edited: Szervezők are
// appointed on Ligák, the Admin only by the CLI. No phone numbers here.
// "Utolsó belépés" only for the Admin, even if the page is ever opened to
// others.

export async function loader({ request }: Route.LoaderArgs) {
  const actor = await requirePermission(request, { kind: "users.view" });
  const q = new URL(request.url).searchParams.get("q") ?? "";
  const lastLogin = actor.platformRole === "superadmin";
  return { users: await listUsers(q, { withLastLogin: lastLogin }), lastLogin };
}

export default function AdminUsers({ loaderData }: Route.ComponentProps) {
  const { users, lastLogin } = loaderData;
  const [params] = useSearchParams();
  return (
    <AppPage title="Felhasználók" description={`${users.length} fiók${params.get("q") ? " a keresésre" : ""}`}>
      <Form method="get" className="w-full sm:w-72">
        <Input name="q" type="search" defaultValue={params.get("q") ?? ""} placeholder="Keresés név vagy e-mail szerint…" aria-label="Keresés" />
      </Form>
      {users.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
          {params.get("q") ? "Nincs ilyen fiók." : "Még senki nem regisztrált."}
        </p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Név</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead>Szerep</TableHead>
                <TableHead>Állapot</TableHead>
                <TableHead>Belépés</TableHead>
                {lastLogin && <TableHead>Utolsó belépés</TableHead>}
                <TableHead>Regisztrált</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">
                    {u.name || <span className="text-muted-foreground">nincs megadva</span>}
                  </TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell>
                    <Badge variant={u.role === "Játékos" ? "outline" : "secondary"}>{u.role}</Badge>
                    {u.leagues.length > 0 && <span className="ml-2 text-sm text-muted-foreground">{u.leagues.join(", ")}</span>}
                  </TableCell>
                  <TableCell className="min-w-48 whitespace-normal">
                    <StatusChips chips={u.status} />
                  </TableCell>
                  <TableCell>{u.google ? "Google, kód" : "Kód"}</TableCell>
                  {lastLogin && (
                    <TableCell className="text-sm whitespace-nowrap">
                      {u.lastLoginAt ? formatDateTime(new Date(u.lastLoginAt)) : <span className="text-muted-foreground">–</span>}
                    </TableCell>
                  )}
                  <TableCell className="text-sm whitespace-nowrap">{formatDateTime(new Date(u.createdAt))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </AppPage>
  );
}
