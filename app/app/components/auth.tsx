import { SiteFooter, SiteHeader, Wrap } from "~/components/site";
import { Label } from "~/components/ui/label";

// Shared frame and form bits for the login and account pages.

// A short task on its own (log in, first-login profile, 403): one panel in
// the middle of the window, an optional line under it.
export function AuthPage({
  title,
  intro,
  children,
  below,
}: {
  title: string;
  intro?: React.ReactNode;
  children: React.ReactNode;
  below?: React.ReactNode;
}) {
  return (
    <>
      <SiteHeader cta={false} />
      <main className="grid place-items-center py-10 sm:py-16">
        <Wrap className="grid max-w-md gap-4">
          <div className="grid gap-6 rounded-2xl border bg-card p-6 shadow-[0_1px_2px_rgb(16_35_61/0.06),0_8px_24px_-12px_rgb(16_35_61/0.18)] sm:p-8">
            <div className="grid gap-2">
              <h1 className="font-display text-3xl font-black">{title}</h1>
              {intro && <p className="text-muted-foreground">{intro}</p>}
            </div>
            {children}
          </div>
          {below && <p className="text-center text-sm text-muted-foreground">{below}</p>}
        </Wrap>
      </main>
      <SiteFooter />
    </>
  );
}

export const inputClass = "h-11 bg-background text-base";

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-sm font-semibold text-destructive">
      {message}
    </p>
  );
}

export function Field({
  name,
  label,
  error,
  children,
}: {
  name: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={name} className="font-semibold">
        {label}
      </Label>
      {children}
      <FieldError id={`${name}-error`} message={error} />
    </div>
  );
}

export function invalid(name: string, error?: string) {
  return error ? { "aria-invalid": true, "aria-describedby": `${name}-error` } : {};
}

// The official multicolour "G" (Google's sign-in branding guidelines require
// the mark itself, so this is their asset, not a drawn icon).
export function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="size-5">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
