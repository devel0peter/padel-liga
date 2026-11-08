import type { Division } from "@padel-liga/rules";

// One colour per division (bronze, verdigris, violet), marked by a dot on the
// Tabella's group cards. Full class names, so Tailwind keeps them.
export const DIVISION_DOT: Record<Division, string> = {
  bronz: "bg-amber-700",
  rez: "bg-teal-700",
  rookie: "bg-violet-700",
};
