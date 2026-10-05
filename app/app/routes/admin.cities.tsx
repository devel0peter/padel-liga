import { Trash2 } from "lucide-react";
import { Form, redirect, useNavigation } from "react-router";

import type { Route } from "./+types/admin.cities";
import { AppPage } from "~/components/app-page";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { requirePermission } from "~/lib/auth/admin.server";
import { parseCity, type CityField } from "~/lib/cities";
import { cityUsage, createCity, deleteCity, getCity, listCities, updateCity } from "~/lib/cities.server";

// Cities (Admin only). A city can have clubs and leagues; "listed" puts it on
// the public signup form and the landing page (spec section 4: only cities
// with an organizer).

export async function loader({ request }: Route.LoaderArgs) {
  await requirePermission(request, { kind: "cities.manage" });
  const [cities, usage] = await Promise.all([listCities(), cityUsage()]);
  return {
    cities: cities.map((c) => ({ ...c, usage: usage.get(c.slug) ?? { signups: 0, clubs: 0, leagues: 0 } })),
  };
}

type ActionData =
  | { intent: "create"; errors?: Partial<Record<CityField, string>>; message?: string }
  | { intent: "update" | "delete"; slug: string; error: string };

export async function action({ request }: Route.ActionArgs): Promise<ActionData | Response> {
  const actor = await requirePermission(request, { kind: "cities.manage" });
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "create") {
    const result = parseCity(form);
    if (!result.ok) return { intent, errors: result.errors };
    if (await getCity(result.data.slug)) return { intent, errors: { slug: "Ez az azonosító már egy másik városé." } };
    const moved = await createCity(result.data, actor.id);
    return {
      intent,
      message: moved
        ? `${result.data.name} hozzáadva. ${moved} „más város” jelentkezés, aki ezt a várost írta, átkerült ide.`
        : `${result.data.name} hozzáadva.`,
    };
  }

  const slug = String(form.get("slug") ?? "");
  const city = await getCity(slug);
  if (!city) throw new Response("Nincs ilyen város.", { status: 404 });

  if (intent === "update") {
    const name = String(form.get("name") ?? "").trim().replace(/\s+/g, " ");
    if (name.length < 2 || name.length > 60) return { intent, slug, error: "A név 2–60 karakter." };
    await updateCity(slug, { name, listed: form.get("listed") === "on" }, actor.id);
  }
  if (intent === "delete" && !(await deleteCity(slug, actor.id)))
    return { intent, slug, error: "Ezt a várost már használja egy jelentkezés, klub vagy liga, ezért nem törölhető." };
  return redirect("/admin/cities");
}

export default function AdminCities({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state === "submitting";
  const create = actionData?.intent === "create" ? actionData : null;
  return (
    <AppPage
      title="Városok"
      description="Egy városnak lehetnek klubjai és ligái. Ami „látszik”, az megjelenik a jelentkezési űrlapon és a főoldalon; a többiekre a „Más város” mezőben lehet jelentkezni."
    >
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Név</TableHead>
              <TableHead>Látszik</TableHead>
              <TableHead>Jelentkezés</TableHead>
              <TableHead>Klub</TableHead>
              <TableHead>Liga</TableHead>
              <TableHead>
                <span className="sr-only">Műveletek</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loaderData.cities.map((city) => {
              const error = actionData && "slug" in actionData && actionData.slug === city.slug ? actionData.error : null;
              const unused = city.usage.signups + city.usage.clubs + city.usage.leagues === 0;
              const formId = `city-${city.slug}`;
              return (
                <TableRow key={city.slug}>
                  <TableCell>
                    <Form id={formId} method="post" className="flex items-center gap-2">
                      <input type="hidden" name="intent" value="update" />
                      <input type="hidden" name="slug" value={city.slug} />
                      <Input name="name" defaultValue={city.name} aria-label="Név" maxLength={60} className="w-48" />
                      <span className="text-xs text-muted-foreground">/{city.slug}</span>
                    </Form>
                    {error && <p className="mt-1 text-sm font-semibold text-destructive">{error}</p>}
                  </TableCell>
                  <TableCell>
                    {/* Native: it belongs to the row's form through form={…}, across cells. */}
                    <input
                      type="checkbox"
                      form={formId}
                      name="listed"
                      defaultChecked={city.listed}
                      aria-label="Látszik a jelentkezésnél"
                      className="size-4 accent-primary"
                    />
                  </TableCell>
                  <TableCell>{city.usage.signups}</TableCell>
                  <TableCell>{city.usage.clubs}</TableCell>
                  <TableCell>{city.usage.leagues}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    <Button type="submit" form={formId} variant="outline" size="sm" disabled={busy}>
                      Mentés
                    </Button>
                    {unused && (
                      <Form method="post" className="inline">
                        <input type="hidden" name="intent" value="delete" />
                        <input type="hidden" name="slug" value={city.slug} />
                        <Button type="submit" variant="ghost" size="icon" aria-label="Törlés" title="Törlés" disabled={busy}>
                          <Trash2 />
                        </Button>
                      </Form>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Form method="post" className="grid max-w-3xl gap-4 rounded-lg border p-4">
        <input type="hidden" name="intent" value="create" />
        <h2 className="font-display text-lg font-bold">Új város</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid content-start gap-1.5">
            <Label htmlFor="name">Név</Label>
            <Input id="name" name="name" placeholder="Debrecen" maxLength={60} required />
            {create?.errors?.name && <p className="text-sm font-semibold text-destructive">{create.errors.name}</p>}
          </div>
          <div className="grid content-start gap-1.5">
            <Label htmlFor="slug">Azonosító</Label>
            <Input id="slug" name="slug" placeholder="debrecen" maxLength={40} />
            <p className="text-xs text-muted-foreground">Üresen hagyva a névből készül. Később ne változtasd.</p>
            {create?.errors?.slug && <p className="text-sm font-semibold text-destructive">{create.errors.slug}</p>}
          </div>
        </div>
        <div className="flex items-start gap-3">
          <Checkbox id="listed" name="listed" className="mt-0.5" />
          <Label htmlFor="listed" className="block font-normal leading-relaxed">
            Látszik a jelentkezési űrlapon és a főoldalon. Csak akkor kapcsold be, ha van szervezője.
          </Label>
        </div>
        <div>
          <Button type="submit" disabled={busy}>
            Város hozzáadása
          </Button>
        </div>
        {create?.message && <p className="text-sm">{create.message}</p>}
      </Form>
    </AppPage>
  );
}
