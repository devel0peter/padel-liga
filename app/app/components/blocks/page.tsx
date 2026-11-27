import { cn } from "~/lib/utils";

// The frame of a player page in direction A (D181): the page's padding and
// the gap between its parts. The first child is the page's PageHeader.
export function Page({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("mx-auto flex w-full max-w-[1200px] flex-col gap-5 px-4 pt-3 pb-6 md:gap-7 md:px-11 md:pt-9 md:pb-10 [&>*]:min-w-0", className)}>
      {children}
    </div>
  );
}
