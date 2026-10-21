import { Link, useRouteLoaderData } from "react-router";

import { CONTACT_EMAIL, FACEBOOK_URL, SITE_NAME } from "~/lib/site";

export function Wrap({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-6xl px-5 ${className}`}>{children}</div>;
}

// The wordmark: one word, as Hungarian spells it (a compound, like
// "teniszpálya"), with "Padel" heavy and "párbaj" light so both parts read at
// a glance. Text stays "Padelpárbaj" for screen readers and copy-paste.
export function Wordmark() {
  return (
    <span className="[font-stretch:120%]">
      <span className="font-extrabold">Padel</span>
      <span className="font-light">párbaj</span>
    </span>
  );
}

// The ball and the wordmark. `size` sets the text size; the ball follows it.
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-[0.45em] ${className}`}>
      <span
        aria-hidden="true"
        className="inline-block size-[0.78em] shrink-0 rounded-full bg-ball shadow-[inset_-0.17em_-0.11em_0_rgba(0,0,0,0.12)]"
      />
      <Wordmark />
    </span>
  );
}

// `cta`: the "Jelentkezem" button (landing and rules). Someone logged in
// gets "Saját oldalam" instead, on every public page.
export function SiteHeader({ cta = true }: { cta?: boolean }) {
  const signedIn = useRouteLoaderData<{ signedIn?: boolean }>("root")?.signedIn ?? false;
  return (
    <header className="py-4">
      <Wrap className="flex items-center justify-between gap-4">
        <Link to="/" className="text-lg no-underline" aria-label={SITE_NAME}>
          <Logo />
        </Link>
        {signedIn ? (
          <Link to="/home" className="rounded-full border-2 border-foreground px-5 py-2 font-bold no-underline">
            Saját oldalam
          </Link>
        ) : (
          cta && (
            <a
              href="/#jelentkezes"
              className="rounded-full border-2 border-foreground px-5 py-2 font-bold no-underline"
            >
              Jelentkezem
            </a>
          )
        )}
      </Wrap>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="py-10 text-sm text-muted-foreground">
      <Wrap className="flex flex-wrap justify-between gap-4">
        <span>{SITE_NAME}</span>
        <span>
          Kapcsolat: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </span>
        <span className="flex gap-4">
          <a href={FACEBOOK_URL}>Facebook</a>
          <Link to="/rules">Szabályzat</Link>
          <Link to="/privacy">Adatkezelési tájékoztató</Link>
        </span>
      </Wrap>
    </footer>
  );
}
