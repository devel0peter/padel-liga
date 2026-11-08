import { Field, FieldError, inputClass, invalid } from "~/components/auth";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { LEVELS } from "~/lib/interest";
import { LEVEL_LOCKED_NOTE } from "~/lib/profile-level";
import { SEXES, type ProfileErrors } from "~/lib/auth/rules";

// The name, level and phone fields shared by the first-login page (welcome)
// and the profile page, so both ask the same way.

export function NameField({ error, defaultValue }: { error?: string; defaultValue: string }) {
  return (
    <Field name="name" label="Neved" error={error}>
      <Input
        id="name"
        name="name"
        autoComplete="name"
        required
        maxLength={80}
        defaultValue={defaultValue}
        className={inputClass}
        {...invalid("name", error)}
      />
    </Field>
  );
}

export function LevelField({
  error,
  defaultValue,
  locked = false,
}: {
  error?: string;
  defaultValue?: string | null;
  // Taken part in a season (#135): shown, not editable, and not in the form.
  locked?: boolean;
}) {
  if (locked) {
    const label = defaultValue && Object.hasOwn(LEVELS, defaultValue) ? LEVELS[defaultValue as keyof typeof LEVELS] : "";
    return (
      <div className="grid content-start gap-1.5" data-testid="level-locked">
        <p className="text-sm font-semibold">Szinted</p>
        <p className="flex h-11 items-center rounded-md border bg-muted px-3 text-base">{label}</p>
        <p className="text-sm text-muted-foreground">{LEVEL_LOCKED_NOTE}</p>
        <FieldError id="level-error" message={error} />
      </div>
    );
  }
  return (
    <Field name="level" label="Szinted" error={error}>
      <Select name="level" required defaultValue={defaultValue ?? undefined}>
        <SelectTrigger id="level" className="h-11! w-full bg-background text-base" {...invalid("level", error)}>
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
      <p className="text-sm text-muted-foreground">Őszintén válassz: innen indul az Élő-pontod.</p>
    </Field>
  );
}

export function PhoneField({ error, defaultValue }: { error?: string; defaultValue: string }) {
  return (
    <Field name="phone" label="Telefonszám" error={error}>
      <Input
        id="phone"
        name="phone"
        type="tel"
        autoComplete="tel"
        inputMode="tel"
        required
        maxLength={30}
        placeholder="+36 30 123 4567"
        defaultValue={defaultValue}
        className={inputClass}
        {...invalid("phone", error)}
      />
      <p className="text-sm text-muted-foreground">
        Csak az aktuális ellenfeleid látják, a meccs egyeztetéséhez. Nyilvános oldalon sosem jelenik meg.
      </p>
    </Field>
  );
}

// Férfi or Nő (#133), required; never prefilled from a name.
export function SexField({ error, defaultValue }: { error?: string; defaultValue?: string | null }) {
  return (
    <div className="grid content-start gap-1.5">
      <p id="sex-label" className="text-sm font-semibold">
        Férfi vagy nő?
      </p>
      <RadioGroup
        name="sex"
        aria-required
        aria-labelledby="sex-label"
        defaultValue={defaultValue ?? undefined}
        className="flex gap-6"
        {...invalid("sex", error)}
      >
        {Object.entries(SEXES).map(([value, label]) => (
          <div key={value} className="flex items-center gap-2">
            <RadioGroupItem id={`sex-${value}`} value={value} className="size-5" />
            <Label htmlFor={`sex-${value}`} className="text-base font-normal">
              {label}
            </Label>
          </div>
        ))}
      </RadioGroup>
      <p className="text-sm text-muted-foreground">Nem nyilvános. Csak azért kérdezzük, hogy célzottan írhassunk, pl. női eseményről.</p>
      <FieldError id="sex-error" message={error} />
    </div>
  );
}

export function ProfileFields({
  errors,
  values,
  levelLocked = false,
}: {
  errors: ProfileErrors;
  values: { name: string; level: string | null; phone: string; sex: string | null };
  levelLocked?: boolean;
}) {
  return (
    <>
      <NameField error={errors.name} defaultValue={values.name} />
      <LevelField error={errors.level} defaultValue={values.level} locked={levelLocked} />
      <PhoneField error={errors.phone} defaultValue={values.phone} />
      <SexField error={errors.sex} defaultValue={values.sex} />
    </>
  );
}
