import { Check, Copy, Share2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useFetcher } from "react-router";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { Turnstile } from "~/components/turnstile";
import { findCity, OTHER_CITY, type City } from "~/lib/cities";
import { LEVELS, type InterestField } from "~/lib/interest";
import { SHARE_REFS, shareLinks, shareText, shareUrl } from "~/lib/share";

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

const shareBtn =
  "inline-flex items-center gap-2 rounded-full border-[1.5px] border-foreground px-4 py-2 text-sm font-bold no-underline";

// After a signup: pass the page on. The phone's share sheet where there is
// one, plus WhatsApp, Facebook and copying the link. `?ref=megosztas` shows
// in /admin/traffic what shares bring in.
function ShareLinks({ text }: { text: string }) {
  const url = shareUrl(SHARE_REFS.page);
  const links = shareLinks(url, text);
  const [canShare, setCanShare] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => setCanShare(typeof navigator.share === "function"), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      window.prompt("Másold ki a linket:", url);
    }
  };

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {canShare && (
        <button
          type="button"
          onClick={() => navigator.share({ text, url }).catch(() => {})}
          className={`${shareBtn} border-ball bg-ball text-ball-foreground`}
        >
          <Share2 className="size-4" /> Megosztom
        </button>
      )}
      <a href={links.whatsapp} target="_blank" rel="noopener noreferrer" className={shareBtn}>
        WhatsApp
      </a>
      <a href={links.facebook} target="_blank" rel="noopener noreferrer" className={shareBtn}>
        Facebook
      </a>
      <button type="button" onClick={copy} className={shareBtn}>
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        {copied ? "Kimásolva" : "Link másolása"}
      </button>
    </div>
  );
}

// The interest signup for a city without a league (#83 sends league cities
// to registration): contact details, level and whether they would organize
// one there, so the Admin can get in touch. Stored as a solo signup of
// "Más város", or of a listed city if the typed name is one (interest.ts).
export function SignupForm({
  signupRef,
  cities,
  cityText,
  onCityTextChange,
  turnstileSiteKey,
}: {
  signupRef?: string | null;
  // Null: no bot check (app/lib/turnstile.server.ts).
  turnstileSiteKey?: string | null;
  // The listed cities (cities.server.ts); one with `league` set takes no
  // signup, so typing its name shows the way to registration instead.
  cities: (Pick<City, "slug" | "name"> & { league?: unknown })[];
  // The typed city is the page's: a city chip above can fill it in.
  cityText: string;
  onCityTextChange: (city: string) => void;
}) {
  const fetcher = useFetcher<SignupActionData>();
  const doneRef = useRef<HTMLDivElement>(null);
  const typed = findCity(cityText, cities);
  const leagueCity = cities.find((c) => c.slug === typed && c.league);

  const data = fetcher.data;
  const errors = data && !data.ok && "errors" in data ? data.errors : {};
  const formError = data && !data.ok && "formError" in data ? data.formError : undefined;
  const submitting = fetcher.state !== "idle";
  const done = data?.ok === true;
  // What they typed, as sent: a listed city comes back without cityOther.
  const [sentCity, setSentCity] = useState("");
  const [organize, setOrganize] = useState(false);

  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);

  if (done) {
    const where = data.cityOther ?? sentCity;
    return (
      <div
        ref={doneRef}
        tabIndex={-1}
        className="grid gap-2 rounded-2xl border-2 border-court p-6 outline-none"
      >
        <h3 className="font-display text-xl font-bold">Megkaptuk</h3>
        <p>
          Köszönjük! Felírtunk{where ? ` (${where})` : ""}, és szólunk, ha nálatok is indul liga.
          {organize && " Azt írtad, szívesen szerveznél: hamarosan írunk."} Addig is küldd el
          az oldalt a többi helyi padelesnek: minél többen vagytok, annál hamarabb lehet nálatok liga.
        </p>
        <ShareLinks text={shareText("solo", where || null)} />
      </div>
    );
  }

  const invalid = (field: InterestField) =>
    errors[field] ? { "aria-invalid": true, "aria-describedby": `${field}-error` } : {};

  return (
    <fetcher.Form
      method="post"
      noValidate
      onSubmit={() => setSentCity(cityText.trim())}
      className="grid gap-5 rounded-2xl border-2 border-foreground bg-background p-6"
    >
      <input type="hidden" name="city" value={OTHER_CITY} />
      <input type="hidden" name="mode" value="solo" />

      <Field name="cityOther" label="Melyik városban játszanál?" error={leagueCity ? undefined : errors.cityOther}>
        <Input
          id="cityOther"
          name="cityOther"
          maxLength={100}
          required
          value={cityText}
          onChange={(e) => onCityTextChange(e.target.value)}
          className={inputClass}
          {...(leagueCity ? {} : invalid("cityOther"))}
        />
      </Field>

      {leagueCity ? (
        // A league city takes no signup: the way to registration instead.
        <div role="status" className="grid gap-3 rounded-xl bg-court/10 p-4">
          <p className="font-semibold">{leagueCity.name}: itt már fut a liga, nem kell felíratkoznod.</p>
          <div>
            <Button
              asChild
              className="h-auto rounded-full bg-ball px-6 py-3 text-base font-bold text-ball-foreground hover:bg-ball/85"
            >
              <Link to="/login">Regisztrálok és nevezek</Link>
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field name="name1" label="Név" error={errors.name1}>
              <Input id="name1" name="name1" autoComplete="name" required className={inputClass} {...invalid("name1")} />
            </Field>
            <Field name="email1" label="E-mail-cím" error={errors.email1}>
              <Input id="email1" name="email1" type="email" autoComplete="email" required className={inputClass} {...invalid("email1")} />
            </Field>
          </div>

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

          <Field name="note" label="Üzenet" hint="nem kötelező, pl. hol játszotok, hányan lennétek" error={errors.note}>
            <Textarea id="note" name="note" maxLength={1000} className="min-h-20 bg-background text-base" {...invalid("note")} />
          </Field>

          <div className="flex items-start gap-3 rounded-xl border-[1.5px] border-dashed p-4">
            <Checkbox
              id="organize"
              name="organize"
              checked={organize}
              onCheckedChange={(v) => setOrganize(v === true)}
              className="mt-0.5 size-5"
            />
            <Label htmlFor="organize" className="block leading-relaxed font-normal">
              <span className="font-semibold">Szívesen szerveznék ligát nálunk.</span>{" "}
              <span className="text-muted-foreground">
                Felvesszük veled a kapcsolatot, és segítünk elindítani.
              </span>
            </Label>
          </div>

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
                kezeljétek, és e-mailben megkeressetek. A hozzájárulás bármikor
                visszavonható. Részletek az{" "}
                <Link to="/privacy" target="_blank" className="underline">
                  adatkezelési tájékoztatóban
                </Link>
                .
              </Label>
            </div>
            <FieldError id="consent-error" message={errors.consent} />
          </div>

          {/* A form error means the server already used up the token. */}
          {turnstileSiteKey && <Turnstile siteKey={turnstileSiteKey} action="signup" resetKey={formError ? data : undefined} />}

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
              {submitting ? "Küldés…" : "Szóljatok, ha indul"}
            </Button>
          </div>
        </>
      )}
    </fetcher.Form>
  );
}
