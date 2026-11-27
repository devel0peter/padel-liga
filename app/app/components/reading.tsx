import { SiteFooter, SiteHeader, Wrap } from "~/components/site";
import { cn } from "~/lib/utils";

// A long text to read (Szabályzat, Adatkezelési tájékoztató) in direction A
// (D181, #425): one column on the dark ground, lines of about 70 characters,
// the headings in the display type. Every text colour here is `foreground` or
// `muted-foreground` on the ground, both above 4.5:1 (app.css).
export function ReadingPage({ cta, className, children }: { cta?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <>
      <SiteHeader cta={cta} />
      <main className="py-8 text-[1.0625rem] leading-relaxed sm:py-12">
        {/* 55ch (the width of "0") holds about 70 letters of running text. */}
        <Wrap className={cn("grid max-w-[calc(55ch+2.5rem)]", className)}>{children}</Wrap>
      </main>
      <SiteFooter />
    </>
  );
}

// The page title, a section heading, a list, and a link inside the text.
export const readingTitle = "type-display m-0 text-[34px] break-words md:text-5xl";
export const readingHeading = "type-display m-0 scroll-mt-6 text-2xl break-words md:text-[28px]";
export const readingList = "grid gap-1.5 pl-5 marker:text-muted-foreground";
export const readingLink = "underline underline-offset-2 hover:text-ball";
