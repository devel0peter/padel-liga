import Markdown, { type Components } from "react-markdown";

import type { Route } from "./+types/rules";
import { ReadingPage, readingHeading, readingLink, readingList, readingTitle } from "~/components/reading";
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

export default function Rules() {
  return (
    <ReadingPage className="gap-4">
      <Markdown components={components}>{rules}</Markdown>
    </ReadingPage>
  );
}
