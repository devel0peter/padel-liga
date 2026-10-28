import { Field, inputClass, invalid } from "~/components/auth";
import { Input } from "~/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { LEVELS } from "~/lib/interest";
import type { ProfileErrors } from "~/lib/auth/rules";

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

export function LevelField({ error, defaultValue }: { error?: string; defaultValue?: string | null }) {
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
      <p className="text-sm text-muted-foreground">Őszintén válassz: innen indul az értékszámod.</p>
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

export function ProfileFields({
  errors,
  values,
}: {
  errors: ProfileErrors;
  values: { name: string; level: string | null; phone: string };
}) {
  return (
    <>
      <NameField error={errors.name} defaultValue={values.name} />
      <LevelField error={errors.level} defaultValue={values.level} />
      <PhoneField error={errors.phone} defaultValue={values.phone} />
    </>
  );
}
