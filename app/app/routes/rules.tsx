import Markdown, { type Components } from "react-markdown";

import type { Route } from "./+types/rules";
import { SiteFooter, SiteHeader, Wrap } from "~/components/site";
import { pageMeta } from "~/lib/site";
// The rules page renders docs/szabalyzat.md directly, so the site and the
// source of truth can't drift apart.
import rules from "../../../docs/szabalyzat.md?raw";

export function meta({}: Route.MetaArgs) {
  return pageMeta({
    title: "Szabályzat – Padelpárbaj",
    description:
      "A Padelpárbaj liga szabályai: csoportok, egyeztetés, meccsformátum, elmaradt meccsek, feljutás és kiesés.",
    path: "/szabalyzat",
  });
}

const components: Components = {
  h1: ({ children }) => (
    <h1 className="font-display text-[clamp(2rem,5vw,3rem)] font-black">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="font-display mt-6 text-2xl font-extrabold">{children}</h2>
  ),
  p: ({ children }) => <p>{children}</p>,
  ul: ({ children }) => <ul className="grid list-disc gap-1.5 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="grid list-decimal gap-1.5 pl-5">{children}</ol>,
  li: ({ children }) => <li className="[&>ul]:mt-1.5">{children}</li>,
  em: ({ children }) => <em className="text-muted-foreground">{children}</em>,
  a: ({ children, href }) => (
    <a href={href} className="underline">
      {children}
    </a>
  ),
};

export default function Rules() {
  return (
    <>
      <SiteHeader />
      <main className="py-10 text-[1.0625rem] leading-relaxed">
        <Wrap className="grid max-w-3xl gap-4">
          <Markdown components={components}>{rules}</Markdown>
        </Wrap>
      </main>
      <SiteFooter />
    </>
  );
}
