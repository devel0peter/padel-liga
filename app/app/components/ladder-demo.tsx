import { ArrowDown, ArrowUp } from "lucide-react";
import { useEffect, useState } from "react";

// Animated landing illustration: three groups' standings after a phase, then
// the 1st places move up a group and the 4th places move down. Dummy data.

type Pair = { id: string; name: string; wins: number; sets: number };

const PAIRS: Pair[][] = [
  [
    { id: "a1", name: "Szabó – Kiss", wins: 3, sets: 5 },
    { id: "a2", name: "Tóth – Varga", wins: 2, sets: 2 },
    { id: "a3", name: "Horváth – Fekete", wins: 1, sets: -2 },
    { id: "a4", name: "Molnár – Balogh", wins: 0, sets: -5 },
  ],
  [
    { id: "b1", name: "Nagy – Kovács", wins: 2, sets: 3 },
    { id: "b2", name: "Papp – Takács", wins: 2, sets: 1 },
    { id: "b3", name: "Juhász – Lakatos", wins: 1, sets: -1 },
    { id: "b4", name: "Mészáros – Oláh", wins: 1, sets: -3 },
  ],
  [
    { id: "c1", name: "Simon – Rácz", wins: 3, sets: 6 },
    { id: "c2", name: "Fehér – Szilágyi", wins: 2, sets: 1 },
    { id: "c3", name: "Török – Vincze", wins: 1, sets: -2 },
    { id: "c4", name: "Kozma – Hegedűs", wins: 0, sets: -5 },
  ],
];

const GROUPS = PAIRS.length;
const BEFORE = PAIRS.map((g) => g.map((p) => p.id));

// After the phase: 4th of a group swaps with 1st of the group below.
const AFTER = BEFORE.map((g) => [...g]);
for (let i = 0; i < GROUPS - 1; i++) {
  const down = AFTER[i][3];
  AFTER[i][3] = AFTER[i + 1][0];
  AFTER[i + 1][0] = down;
}

const byId = new Map(PAIRS.flat().map((p) => [p.id, p]));

function moveOf(group: number, row: number): "up" | "down" | null {
  if (row === 0 && group > 0) return "up";
  if (row === 3 && group < GROUPS - 1) return "down";
  return null;
}

// Layout in px; rows are absolutely positioned so they can slide between boxes.
const HEADER = 40;
const ROW = 32;
const PAD_B = 10;
const BOX = HEADER + 4 * ROW + PAD_B;
const GAP = 14;

type Stage = "standings" | "moved";

const cols = "grid grid-cols-[1.1rem_1fr_2.2rem_2.6rem_1.25rem] items-center gap-x-2";

export function LadderDemo() {
  const [stage, setStage] = useState<Stage>("standings");
  const [visible, setVisible] = useState(true);
  const [instant, setInstant] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
    const cycle = () => {
      at(3500, () => setStage("moved"));
      at(7500, () => setVisible(false));
      at(8000, () => {
        setInstant(true);
        setStage("standings");
      });
      at(8100, () => {
        setInstant(false);
        setVisible(true);
      });
      at(8100, cycle);
    };
    cycle();
    return () => timers.forEach(clearTimeout);
  }, []);

  const layout = stage === "standings" ? BEFORE : AFTER;
  const positions = new Map<string, { group: number; row: number }>();
  layout.forEach((g, group) => g.forEach((id, row) => positions.set(id, { group, row })));
  const origin = new Map<string, { group: number; row: number }>();
  BEFORE.forEach((g, group) => g.forEach((id, row) => origin.set(id, { group, row })));

  return (
    <figure className="grid gap-3">
      <div
        role="img"
        aria-label="Példa: három csoport tabellája a kör végén. A csoportok első helyezettje feljebb lép, a negyedik lejjebb kerül, és indul a következő kör."
        className={`relative transition-opacity duration-500 ${visible ? "opacity-100" : "opacity-0"}`}
        style={{ height: GROUPS * BOX + (GROUPS - 1) * GAP }}
      >
        <div aria-hidden="true">
          {PAIRS.map((_, g) => (
            <div
              key={g}
              className="absolute inset-x-0 rounded-[10px] border-[3px] border-white bg-court px-3 text-white outline-2 outline-court-deep"
              style={{ top: g * (BOX + GAP), height: BOX }}
            >
              <div className={`${cols} text-xs`} style={{ height: HEADER - 3 }}>
                <span className="font-display col-span-2 text-base font-bold">
                  {g + 1}. csoport
                  {g === 0 && <span className="ml-2 font-medium opacity-75">legerősebb</span>}
                </span>
                <span className="text-right opacity-75">gy.</span>
                <span className="text-right opacity-75">szett</span>
              </div>
            </div>
          ))}

          {PAIRS.flat().map((pair) => {
            const pos = positions.get(pair.id)!;
            const from = origin.get(pair.id)!;
            const move = moveOf(from.group, from.row);
            const moved = stage === "moved";
            const top = pos.group * (BOX + GAP) + HEADER + pos.row * ROW;
            return (
              <div
                key={pair.id}
                className={`absolute inset-x-[3px] px-3 text-white ${instant ? "" : "transition-transform duration-1000 ease-in-out"} ${move ? "z-10" : ""}`}
                style={{ transform: `translateY(${top}px)`, height: ROW }}
              >
                <div
                  className={`${cols} h-full rounded-md px-1 text-[0.95rem] transition-colors duration-700 ${
                    move === "up"
                      ? "bg-ball/20 font-bold text-ball"
                      : move === "down"
                        ? "bg-black/20 text-white/70"
                        : ""
                  }`}
                >
                  <b className="font-semibold tabular-nums opacity-75">{pos.row + 1}</b>
                  <span className="truncate">{pair.name}</span>
                  <span className="text-right tabular-nums">{moved ? "–" : pair.wins}</span>
                  <span className="text-right tabular-nums">
                    {moved ? "–" : pair.sets > 0 ? `+${pair.sets}` : `−${-pair.sets}`}
                  </span>
                  <span className="flex justify-end">
                    {move === "up" && <ArrowUp className="size-4" strokeWidth={3} />}
                    {move === "down" && <ArrowDown className="size-4" strokeWidth={3} />}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <figcaption className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
        <span className="font-semibold text-foreground">
          {stage === "standings" ? "A 3. hét után" : "Indul a következő kör"}
        </span>
        <span className="flex items-center gap-1">
          <ArrowUp className="size-4" strokeWidth={3} /> feljut
        </span>
        <span className="flex items-center gap-1">
          <ArrowDown className="size-4" strokeWidth={3} /> lejjebb kerül
        </span>
      </figcaption>
    </figure>
  );
}
