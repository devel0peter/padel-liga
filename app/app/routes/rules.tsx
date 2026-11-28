import Markdown, { type Components } from "react-markdown";

import type { Route } from "./+types/rules";
import { ReadingPage, readingHeading, readingLink, readingList, readingTitle } from "~/components/reading";
import { getUser } from "~/lib/auth/session.server";
import { rulesSupplementsFor } from "~/lib/leagues.server";
import { cn } from "~/lib/utils";
import { pageMeta } from "~/lib/site";
// The rules page renders docs/szabalyzat.md directly, so the site and the
// source of truth can't drift apart.
import rules from "../../../docs/szabalyzat.md?raw";

export function meta({}: Route.MetaArgs) {
  return pageMeta({
    title: "Szabályzat – Padelpárbaj",
    description:
      "A Padelpárbaj liga szabályai: csoportok, egyeztetés, meccsformátum, elmaradt meccsek, feljutás és kiesés.",
    path: "/rules",
  });
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getUser(request).catch(() => null);
  return rulesSupplementsFor(user?.id ?? null);
}

const components: Components = {
  h1: ({ children }) => <h1 className={readingTitle}>{children}</h1>,
  // "8. Egyéni Élő-pont" gets id="section-8", the target of the table of contents.
  h2: ({ children }) => {
    const number = /^(\d+)\./.exec(String(children))?.[1];
    return (
      <h2 id={number ? `section-${number}` : undefined} className={cn(readingHeading, "mt-6")}>
        {children}
      </h2>
    );
  },
  p: ({ children }) => <p>{children}</p>,
  ul: ({ children }) => <ul className={cn(readingList, "list-disc")}>{children}</ul>,
  ol: ({ children }) => <ol className={cn(readingList, "list-decimal")}>{children}</ol>,
  li: ({ children }) => <li className="[&>ul]:mt-1.5">{children}</li>,
  em: ({ children }) => <em className="text-muted-foreground">{children}</em>,
  a: ({ children, href }) => (
    <a href={href} className={readingLink}>
      {children}
    </a>
  ),
};

const URL_RE = /(https?:\/\/[^\s<>()]+)/g;

function PlainParagraphs({ text }: { text: string }) {
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim().length > 0);
  return (
    <div className="grid gap-3">
      {paragraphs.map((p, idx) => (
        <p key={idx} className="whitespace-pre-line">
          {p.split(URL_RE).map((part, i) =>
            /^https?:\/\//.test(part) ? (
              <a key={i} href={part} target="_blank" rel="noreferrer" className={readingLink}>
                {part}
              </a>
            ) : (
              part
            ),
          )}
        </p>
      ))}
    </div>
  );
}

export default function Rules({ loaderData }: Route.ComponentProps) {
  const withSupplement = loaderData.leagues.filter((l) => l.localRules || l.contactName || l.contactEmail);
  return (
    <ReadingPage className="gap-4">
      <Markdown components={components}>{rules}</Markdown>
      {withSupplement.map((l) => (
        <section key={l.id} className="mt-6 grid gap-3 border-t border-border pt-6">
          <h2 className={readingHeading}>Helyi kiegészítés: {l.name}</h2>
          <p className="text-sm text-muted-foreground">
            Ez a kiegészítés a helyi tudnivalókat tartalmazza. Eltérés esetén mindig a fenti közös szabályzat az irányadó.
          </p>
          {l.localRules && <PlainParagraphs text={l.localRules} />}
          {(l.contactName || l.contactEmail) && (
            <p className="text-sm text-muted-foreground">
              Kapcsolattartó: <strong className="text-foreground">{l.contactName ?? l.name}</strong>
              {l.contactEmail && (
                <>
                  {" · "}
                  <a href={`mailto:${l.contactEmail}`} className={readingLink}>
                    {l.contactEmail}
                  </a>
                </>
              )}
              {l.contactPhone && <> · {l.contactPhone}</>}
            </p>
          )}
        </section>
      ))}
    </ReadingPage>
  );
}
