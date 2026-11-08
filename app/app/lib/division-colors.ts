import type { Division } from "@padel-liga/rules";

// One colour per division (bronze, verdigris, violet), the same on the Tabella
// and the Ranglista (D138). Full class names, so Tailwind keeps them.
export const DIVISION_DOT: Record<Division, string> = {
  bronz: "bg-amber-700",
  rez: "bg-teal-700",
  rookie: "bg-violet-700",
};

// The Ranglista row's left edge.
export const DIVISION_EDGE: Record<Division, string> = {
  bronz: "border-l-amber-700",
  rez: "border-l-teal-700",
  rookie: "border-l-violet-700",
};
