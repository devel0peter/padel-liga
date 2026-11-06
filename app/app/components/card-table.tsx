// Below sm each table row is a stacked card (#146, #278): the first cell on
// top, the other cells under it, each with its label. Only max-sm: classes and
// sm:hidden labels, so the desktop table is unchanged. The table needs
// `max-sm:block`, its body too, and its header `max-sm:hidden`.
export const CARD_ROW = "max-sm:flex max-sm:flex-col max-sm:gap-2 max-sm:p-3";
export const CARD_CELL = "max-sm:p-0 max-sm:whitespace-normal max-sm:empty:hidden";

export function CardLabel({ children }: { children: string }) {
  return <span className="text-muted-foreground sm:hidden">{children}: </span>;
}
