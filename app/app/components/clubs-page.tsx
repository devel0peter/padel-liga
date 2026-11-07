import { Pencil, Trash2 } from "lucide-react";
import { Form, Link, useNavigation, useSearchParams } from "react-router";

import { AppPage } from "~/components/app-page";
import { Badge } from "~/components/ui/badge";
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
import { cityName, type City } from "~/lib/cities";
import type { Club, ClubField } from "~/lib/clubs";

// The clubs page, shared by /admin/clubs (Admin, every city) and
// /admin/leagues/:league/clubs (a Szervező: their league's city only). Data and
// checks: app/lib/clubs-page.server.ts.

export type ClubsScope = {
  // Fixed city (a league's), or null for every city (Admin).
  city: string | null;
  cityName: string | null;
  // This page's path, for "Mégse" after editing.
  base: string;
};

// No signup counts or posters any more: they came from the interest list
// (#333, D129).
export type ClubsData = {
  scope: ClubsScope;
  cities: Pick<City, "slug" | "name">[];
  clubs: Club[];
};

export type ClubsActionData = { errors: Partial<Record<ClubField, string>> };

function Field({
  name,
  label,
  hint,
  error,
  children,
}: {
  name: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
    </div>
  );
}

function ClubForm({
  club,
  errors,
  scope,
  cities,
}: {
  club?: Club;
  errors: Partial<Record<ClubField, string>>;
  scope: ClubsScope;
  cities: Pick<City, "slug" | "name">[];
}) {
  const busy = useNavigation().state === "submitting";
  return (
    // Keyed by club, so switching between clubs resets the fields.
    <Form key={club?.id ?? "new"} method="post" className="grid gap-4 rounded-lg border p-4">
      <h2 className="font-display text-lg font-bold">{club ? `${club.name} szerkesztése` : "Új klub"}</h2>
      {club && <input type="hidden" name="id" value={club.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="name" label="Név" error={errors.name}>
          <Input id="name" name="name" defaultValue={club?.name} maxLength={100} required />
        </Field>
        <Field
          name="slug"
          label="Azonosító"
          hint={
            club
              ? "Ha a plakát már kint van, ne változtasd: a régi QR-kód erre mutat."
              : "Üresen hagyva a névből készül, pl. gyor-padel-klub."
          }
          error={errors.slug}
        >
          <Input id="slug" name="slug" defaultValue={club?.slug} maxLength={40} />
        </Field>
        {scope.city ? (
          <input type="hidden" name="city" value={scope.city} />
        ) : (
        <Field name="city" label="Város" error={errors.city}>
          <Select name="city" defaultValue={club?.city ?? cities[0]?.slug}>
            <SelectTrigger id="city" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {cities.map((c) => (
                <SelectItem key={c.slug} value={c.slug}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        )}
        <Field name="adminNote" label="Jegyzet" hint="Pl. kint van-e a plakát, mióta." error={errors.adminNote}>
          <Textarea id="adminNote" name="adminNote" defaultValue={club?.adminNote ?? ""} maxLength={2000} className="min-h-9" />
        </Field>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {club ? "Mentés" : "Hozzáadás"}
        </Button>
        {club && (
          <Button variant="ghost" asChild>
            <Link to={scope.base}>Mégse</Link>
          </Button>
        )}
      </div>
    </Form>
  );
}

// Reversible, so no confirmation. Inactive clubs stay on old records.
function ToggleActive({ club }: { club: Club }) {
  const busy = useNavigation().state === "submitting";
  return (
    <Form method="post" className="inline">
      <input type="hidden" name="intent" value={club.active ? "deactivate" : "activate"} />
      <input type="hidden" name="id" value={club.id} />
      <Button type="submit" variant="ghost" size="sm" disabled={busy}>
        {club.active ? "Inaktiválás" : "Aktiválás"}
      </Button>
    </Form>
  );
}

function DeleteClub({ club }: { club: Club }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Törlés">
          <Trash2 />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Törlöd a klubot?</AlertDialogTitle>
          <AlertDialogDescription>
            {club.name} lekerül a listáról. Ha csak nem akarod többé
            felkínálni, inkább inaktiváld.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Mégse</AlertDialogCancel>
          <Form method="post">
            <input type="hidden" name="intent" value="delete" />
            <input type="hidden" name="id" value={club.id} />
            <AlertDialogAction variant="destructive" type="submit">
              Törlés
            </AlertDialogAction>
          </Form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ClubsPage({ data, actionData }: { data: ClubsData; actionData?: ClubsActionData }) {
  const { scope, cities, clubs } = data;
  const [params] = useSearchParams();
  const editing = clubs.find((c) => c.slug === params.get("edit"));

  return (
    <AppPage
      title={scope.cityName ? `Klubok: ${scope.cityName}` : "Klubok"}
      description="Csak a szervezők látják. A meccsek helyszínét ezek közül választják a játékosok. Az inaktív klubot nem kínáljuk fel újonnan, a régi adatokon megmarad."
    >
      {clubs.length === 0 ? (
        <p className="py-6 text-center text-muted-foreground">Még nincs klub.</p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Klub</TableHead>
                {!scope.city && <TableHead>Város</TableHead>}
                <TableHead>Jegyzet</TableHead>
                <TableHead>
                  <span className="sr-only">Műveletek</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clubs.map((club) => (
                <TableRow key={club.id} className={club.active ? undefined : "text-muted-foreground"}>
                  <TableCell>
                    <div className="flex items-center gap-2 font-medium">
                      {club.name}
                      {!club.active && <Badge variant="secondary">inaktív</Badge>}
                    </div>
                  </TableCell>
                  {!scope.city && <TableCell>{cityName(club.city, cities)}</TableCell>}
                  <TableCell className="max-w-56 text-sm whitespace-normal">{club.adminNote}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Button variant="ghost" size="icon" aria-label="Szerkesztés" asChild>
                      <Link to={`?edit=${club.slug}`}>
                        <Pencil />
                      </Link>
                    </Button>
                    <ToggleActive club={club} />
                    <DeleteClub club={club} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ClubForm club={editing} errors={actionData?.errors ?? {}} scope={scope} cities={cities} />
    </AppPage>
  );
}
