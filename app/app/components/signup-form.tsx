import { useEffect, useRef, useState } from "react";
import { Link, useFetcher } from "react-router";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { CITIES, OTHER_CITY } from "~/lib/cities";
import { OTHER_CLUB, type ClubOption } from "~/lib/clubs";
import { LEVELS, type InterestField, type Mode } from "~/lib/interest";
import { CONTACT_EMAIL } from "~/lib/site";

export type SignupActionData =
  | { ok: true; cityOther?: string | null }
  | { ok: false; errors: Partial<Record<InterestField, string>> }
  | { ok: false; formError: string };

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-sm font-semibold text-destructive">
      {message}
    </p>
  );
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
      <Label htmlFor={name} className="font-semibold">
        {label}
        {hint && <span className="font-normal text-muted-foreground">{hint}</span>}
      </Label>
      {children}
      <FieldError id={`${name}-error`} message={error} />
    </div>
  );
}

const inputClass = "h-11 bg-background text-base";

export function SignupForm({
  signupRef,
  clubs = [],
}: {
  signupRef?: string | null;
  clubs?: ClubOption[];
}) {
  const fetcher = useFetcher<SignupActionData>();
  const [mode, setMode] = useState<Mode>("pair");
  const [city, setCity] = useState<string>(CITIES[0].slug);
  const otherCity = city === OTHER_CITY;
  const cityClubs = clubs.filter((c) => c.city === city);
  const doneRef = useRef<HTMLDivElement>(null);

  const data = fetcher.data;
  const errors = data && !data.ok && "errors" in data ? data.errors : {};
  const formError = data && !data.ok && "formError" in data ? data.formError : undefined;
  const submitting = fetcher.state !== "idle";
  const done = data?.ok === true;

  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);

  if (done) {
    return (
      <div
        ref={doneRef}
        tabIndex={-1}
        className="grid gap-2 rounded-2xl border-2 border-court p-6 outline-none"
      >
        <h3 className="font-display text-xl font-bold">Jelentkezés elküldve</h3>
        {data.cityOther ? (
          <p>
            Köszönjük! Felírtunk ({data.cityOther}), és szólunk, ha nálatok is
            indul liga. Addig is küldd el az oldalt a többi helyi padelesnek: minél
            többen jelentkeztek, annál hamarabb indulhat.
          </p>
        ) : (
          <p>
            Köszönjük! Írunk, amint elég pár összegyűlik. Addig is küldd el az
            oldalt annak, akivel szívesen játszanál.
          </p>
        )}
      </div>
    );
  }

  const invalid = (field: InterestField) =>
    errors[field] ? { "aria-invalid": true, "aria-describedby": `${field}-error` } : {};

  return (
    <fetcher.Form
      method="post"
      noValidate
      className="grid gap-5 rounded-2xl border-2 border-foreground bg-background p-6"
    >
      <Field name="city" label="Város" error={errors.city}>
        <Select name="city" value={city} onValueChange={setCity}>
          <SelectTrigger id="city" className="h-11! w-full bg-background text-base" {...invalid("city")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CITIES.map((c) => (
              <SelectItem key={c.slug} value={c.slug}>
                {c.name}
              </SelectItem>
            ))}
            <SelectItem value={OTHER_CITY}>Más város</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      {otherCity && (
        <Field name="cityOther" label="Melyik városban játszanál?" error={errors.cityOther}>
          <Input id="cityOther" name="cityOther" maxLength={100} required className={inputClass} {...invalid("cityOther")} />
          <p className="text-sm text-muted-foreground">
            Ott még nincs liga. Felírunk, és szólunk, ha indul. Ha szívesen
            szerveznéd, írj a{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
              {CONTACT_EMAIL}
            </a>{" "}
            címre.
          </p>
        </Field>
      )}

      <fieldset className="grid gap-3">
        <legend className="mb-2 font-bold">Hogyan jelentkezel?</legend>
        <RadioGroup
          name="mode"
          value={mode}
          onValueChange={(v) => setMode(v as Mode)}
          className="flex flex-wrap gap-2"
        >
          {(
            [
              ["pair", "Párral"],
              ["solo", "Egyedül, párt keresek"],
            ] as const
          ).map(([value, label]) => (
            <Label
              key={value}
              htmlFor={`mode-${value}`}
              className="cursor-pointer rounded-full border-[1.5px] border-input px-4 py-2 font-semibold has-data-checked:border-court has-data-checked:bg-court/10"
            >
              <RadioGroupItem id={`mode-${value}`} value={value} />
              {label}
            </Label>
          ))}
        </RadioGroup>
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="mb-2 font-bold">Te</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field name="name1" label="Név" error={errors.name1}>
            <Input id="name1" name="name1" autoComplete="name" required className={inputClass} {...invalid("name1")} />
          </Field>
          <Field name="email1" label="E-mail-cím" error={errors.email1}>
            <Input id="email1" name="email1" type="email" autoComplete="email" required className={inputClass} {...invalid("email1")} />
          </Field>
        </div>
      </fieldset>

      {mode === "pair" && (
        <fieldset className="grid gap-3">
          <legend className="mb-2 font-bold">A párod</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field name="name2" label="Név" error={errors.name2}>
              <Input id="name2" name="name2" required className={inputClass} {...invalid("name2")} />
            </Field>
            <Field name="email2" label="E-mail-cím" hint="nem kötelező" error={errors.email2}>
              <Input id="email2" name="email2" type="email" className={inputClass} {...invalid("email2")} />
            </Field>
          </div>
          <p className="text-sm text-muted-foreground">
            Ha megadod a párod e-mail-címét, egyszer írunk neki, hogy tudjon a
            jelentkezésről.
          </p>
        </fieldset>
      )}

      <Field name="level" label="Szint" error={errors.level}>
        <Select name="level">
          <SelectTrigger id="level" className="h-11! w-full bg-background text-base" {...invalid("level")}>
            <SelectValue placeholder="Válassz…" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(LEVELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {cityClubs.length > 0 && (
        <Field name="homeClub" label="Hol játszol a legtöbbet?" hint="nem kötelező">
          {/* Keyed by city, so a club from another city isn't kept. */}
          <Select key={city} name="homeClub">
            <SelectTrigger id="homeClub" className="h-11! w-full bg-background text-base">
              <SelectValue placeholder="Válassz…" />
            </SelectTrigger>
            <SelectContent>
              {cityClubs.map((c) => (
                <SelectItem key={c.slug} value={c.slug}>
                  {c.name}
                </SelectItem>
              ))}
              <SelectItem value={OTHER_CLUB}>Máshol / vegyesen</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      )}

      <Field
        name="note"
        label="Megjegyzés"
        hint="nem kötelező, pl. melyik napok jók nektek"
        error={errors.note}
      >
        <Textarea id="note" name="note" maxLength={1000} className="min-h-20 bg-background text-base" {...invalid("note")} />
      </Field>

      {signupRef && <input type="hidden" name="ref" value={signupRef} />}

      {/* Honeypot for bots; hidden from people and screen readers. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 overflow-hidden">
        <label>
          Weboldal
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <div className="grid gap-1.5">
        <div className="flex items-start gap-3">
          <Checkbox id="consent" name="consent" className="mt-0.5 size-5" {...invalid("consent")} />
          <Label htmlFor="consent" className="block text-sm leading-relaxed font-normal text-muted-foreground">
            Hozzájárulok, hogy a megadott adatokat a liga szervezése céljából
            kezeljétek, és e-mailben értesítsetek az indulásról. A hozzájárulás
            bármikor visszavonható. Részletek az{" "}
            <Link to="/adatkezeles" target="_blank" className="underline">
              adatkezelési tájékoztatóban
            </Link>
            .
          </Label>
        </div>
        <FieldError id="consent-error" message={errors.consent} />
      </div>

      {formError && (
        <p role="alert" className="font-semibold text-destructive">
          {formError}
        </p>
      )}
      {Object.keys(errors).length > 0 && (
        <p role="alert" className="font-semibold text-destructive">
          Nézd át a pirossal jelölt mezőket.
        </p>
      )}

      <div>
        <Button
          type="submit"
          disabled={submitting}
          className="h-auto rounded-full bg-ball px-6 py-3 text-base font-bold text-ball-foreground hover:bg-ball/85"
        >
          {submitting ? "Küldés…" : "Jelentkezem"}
        </Button>
      </div>
    </fetcher.Form>
  );
}
