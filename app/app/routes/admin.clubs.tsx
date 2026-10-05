import { Pencil, Printer, Trash2 } from "lucide-react";
import { Form, Link, redirect, useNavigation, useSearchParams } from "react-router";

import type { Route } from "./+types/admin.clubs";
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
import { requirePermission } from "~/lib/auth/admin.server";
import { CITIES } from "~/lib/cities";
import { countBy, OTHER_CLUB, parseClub, posterUrl, type Club, type ClubField } from "~/lib/clubs";
import { createClub, deleteClub, listClubs, slugTaken, updateClub } from "~/lib/clubs.server";
import { cityLabel, NO_REF } from "~/lib/signups-admin";
import { listSignups } from "~/lib/signups-admin.server";

export async function loader({ request }: Route.LoaderArgs) {
  await requirePermission(request, { kind: "clubs.manage" });
  const [clubs, signups] = await Promise.all([listClubs(), listSignups()]);
  const refs = countBy(signups, "ref");
  const plays = countBy(signups, "homeClub");
  const clubSlugs = new Set(clubs.map((c) => c.slug));
  // Refs that aren't a club, e.g. a tournament flyer's "?ref=verseny".
  const otherRefs = Object.entries(refs).filter(([ref]) => ref !== "" && !clubSlugs.has(ref));
  return {
    clubs,
    refs,
    plays,
    otherRefs,
    noRef: refs[""] ?? 0,
    playsOther: plays[OTHER_CLUB] ?? 0,
    playsUnknown: plays[""] ?? 0,
  };
}

type ActionData = { errors: Partial<Record<ClubField, string>> };

export async function action({ request }: Route.ActionArgs): Promise<ActionData | Response> {
  await requirePermission(request, { kind: "clubs.manage" });
  const form = await request.formData();
  const id = Number(form.get("id") || 0);
  if (!Number.isInteger(id) || id < 0) throw new Response("Hibás azonosító.", { status: 400 });

  if (form.get("intent") === "delete") {
    await deleteClub(id);
    return redirect("/admin/clubs");
  }

  const result = parseClub(form);
  if (!result.ok) return { errors: result.errors };
  if (await slugTaken(result.data.slug, id || undefined))
    return { errors: { slug: "Ez az azonosító már egy másik klubé." } };
  if (id) await updateClub(id, result.data);
  else await createClub(result.data);
  return redirect("/admin/clubs");
}

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

function ClubForm({ club, errors }: { club?: Club; errors: Partial<Record<ClubField, string>> }) {
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
          label="Azonosító (a plakát QR-kódjában)"
          hint={
            club
              ? "Ha a plakát már kint van, ne változtasd: a régi QR-kód erre mutat."
              : "Üresen hagyva a névből készül, pl. gyor-padel-klub."
          }
          error={errors.slug}
        >
          <Input id="slug" name="slug" defaultValue={club?.slug} maxLength={40} />
        </Field>
        <Field name="city" label="Város" error={errors.city}>
          <Select name="city" defaultValue={club?.city ?? CITIES[0].slug}>
            <SelectTrigger id="city" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CITIES.map((c) => (
                <SelectItem key={c.slug} value={c.slug}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
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
            <Link to="/admin/clubs">Mégse</Link>
          </Button>
        )}
      </div>
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
            {club.name} lekerül a listáról és a jelentkezési űrlapról. A jelentkezések
            megmaradnak, ahol ez a klub szerepel, ott „{club.slug}” lesz.
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

export default function AdminClubs({ loaderData, actionData }: Route.ComponentProps) {
  const { clubs, refs, plays, otherRefs, noRef, playsOther, playsUnknown } = loaderData;
  const [params] = useSearchParams();
  const editing = clubs.find((c) => c.slug === params.get("edit"));

  return (
    <Wrap className="grid grid-cols-1 gap-5 [&>*]:min-w-0">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold">Klubok</h1>
          <p className="text-sm text-muted-foreground">
            Csak te látod. A jelentkezési űrlapon a város klubjai közül választhatnak, hol
            játszanak a legtöbbet; a plakát QR-kódja pedig a klub azonosítójával viszi a
            főoldalra, így látszik, hány jelentkezést hozott.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/admin/poster" target="_blank">
            <Printer /> Általános plakát
          </Link>
        </Button>
      </div>

      {clubs.length === 0 ? (
        <p className="py-6 text-center text-muted-foreground">Még nincs klub.</p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Klub</TableHead>
                <TableHead>Város</TableHead>
                <TableHead>Itt játszik</TableHead>
                <TableHead>Plakátról jött</TableHead>
                <TableHead>Jegyzet</TableHead>
                <TableHead>
                  <span className="sr-only">Műveletek</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clubs.map((club) => (
                <TableRow key={club.id}>
                  <TableCell>
                    <div className="font-medium">{club.name}</div>
                    <div className="text-xs text-muted-foreground">{posterUrl(club.slug)}</div>
                  </TableCell>
                  <TableCell>{cityLabel({ city: club.city, cityOther: null })}</TableCell>
                  <TableCell>
                    <Link to={`/admin/signups?club=${club.slug}`} className="underline">
                      {plays[club.slug] ?? 0}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link to={`/admin/signups?ref=${club.slug}`} className="underline">
                      {refs[club.slug] ?? 0}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-56 text-sm whitespace-normal">{club.adminNote}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Button variant="ghost" size="icon" aria-label="Plakát" asChild>
                      <Link to={`/admin/poster?ref=${club.slug}`} target="_blank">
                        <Printer />
                      </Link>
                    </Button>
                    <Button variant="ghost" size="icon" aria-label="Szerkesztés" asChild>
                      <Link to={`?edit=${club.slug}`}>
                        <Pencil />
                      </Link>
                    </Button>
                    <DeleteClub club={club} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        Máshol / vegyesen játszik:{" "}
        <Link to={`/admin/signups?club=${OTHER_CLUB}`} className="underline">
          {playsOther}
        </Link>
        {" · "}Nem adta meg:{" "}
        <Link to={`/admin/signups?club=${NO_REF}`} className="underline">
          {playsUnknown}
        </Link>
      </p>
      <p className="text-sm text-muted-foreground">
        Forrás nélkül:{" "}
        <Link to={`/admin/signups?ref=${NO_REF}`} className="underline">
          {noRef}
        </Link>
        {otherRefs.map(([ref, n]) => (
          <span key={ref}>
            {" · "}
            {ref}:{" "}
            <Link to={`/admin/signups?ref=${ref}`} className="underline">
              {n}
            </Link>
          </span>
        ))}
      </p>

      <ClubForm club={editing} errors={actionData?.errors ?? {}} />
    </Wrap>
  );
}
