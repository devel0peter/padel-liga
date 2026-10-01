import { Link } from "react-router";

import { CONTACT_EMAIL, SITE_NAME } from "~/lib/site";

export function Wrap({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-6xl px-5 ${className}`}>{children}</div>;
}

export function SiteHeader({ cta = true }: { cta?: boolean }) {
  return (
    <header className="py-4">
      <Wrap className="flex items-center justify-between gap-4">
        <Link
          to="/"
          className="flex items-center gap-2 text-lg font-extrabold no-underline [font-stretch:120%]"
        >
          <span
            aria-hidden="true"
            className="inline-block size-3.5 rounded-full bg-ball shadow-[inset_-3px_-2px_0_rgba(0,0,0,0.12)]"
          />
          {SITE_NAME}
        </Link>
        {cta && (
          <a
            href="/#jelentkezes"
            className="rounded-full border-2 border-foreground px-5 py-2 font-bold no-underline"
          >
            Jelentkezem
          </a>
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
        <Link to="/adatkezeles">Adatkezelési tájékoztató</Link>
      </Wrap>
    </footer>
  );
}
