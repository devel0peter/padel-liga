import { Form, useFetcher, useSearchParams } from "react-router";

import type { Route } from "./+types/admin.users";
import { AppPage } from "~/components/app-page";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { DELETED, DELETION_EFFECTS } from "~/lib/account-deletion";
import { deleteAccount } from "~/lib/account-deletion.server";
import { requirePermission } from "~/lib/auth/admin.server";
import { can } from "~/lib/auth/permissions";
import { formatDateTime } from "~/lib/format";
import { listUsers, type UserRow } from "~/lib/users-admin.server";

// Every account (Admin only). Roles are shown, not edited: Szervezők are
// appointed on Ligák, the Admin only by the CLI. No phone numbers here.
// "Utolsó belépés" and "Törlés" (#152) only for the Admin, even if the page
// is ever opened to others.

export async function loader({ request }: Route.LoaderArgs) {
  const actor = await requirePermission(request, { kind: "users.view" });
  const q = new URL(request.url).searchParams.get("q") ?? "";
  const lastLogin = actor.platformRole === "superadmin";
  const deleteAs = can(actor, { kind: "users.delete" }) ? actor.id : null;
  return { users: await listUsers(q, { withLastLogin: lastLogin, deleteAs }), lastLogin, canDelete: !!deleteAs };
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

export default function AdminUsers({ loaderData }: Route.ComponentProps) {
  const { users, lastLogin, canDelete } = loaderData;
  const [params] = useSearchParams();
  return (
    <AppPage title="Felhasználók" description={`${users.length} fiók${params.get("q") ? " a keresésre" : ""}`}>
      <Form method="get" className="w-full sm:w-72">
        <Input name="q" type="search" defaultValue={params.get("q") ?? ""} placeholder="Keresés név vagy e-mail szerint…" aria-label="Keresés" />
      </Form>
      {canDelete && <DeleteResult />}
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
