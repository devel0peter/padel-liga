import { useEffect, useLayoutEffect, useRef } from "react";

// The Tabella's groups one under the other in a list of their own (D143):
// the page keeps the screen's height and only the list scrolls. The group in
// the middle of the list is shown full size; the ones above and below shrink
// and fade with their distance from it, so the ladder reads as a column you
// move along. On load the viewer's own group (`focus`) is in the middle.
//
// Everything is placed by measurement after hydration: before it (and without
// JavaScript) the list is a plain scrolling column at 70% of the screen.

const MIN_SCALE = 0.86;
const MIN_OPACITY = 0.45;
// Never shorter than this, so a short or landscape phone still shows a card.
const MIN_HEIGHT = 320;

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function LadderScroller({ items, focus, label }: { items: { key: string | number; node: React.ReactNode }[]; focus: number; label: string }) {
  const list = useRef<HTMLDivElement>(null);
  const cards = useRef<(HTMLDivElement | null)[]>([]);

  useIsoLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // The list takes what the screen has left: everything below it (the
    // page's own padding, the phone's bottom bar space) stays as it is.
    const fit = () => {
      el.style.height = "";
      const rect = el.getBoundingClientRect();
      const top = rect.top + window.scrollY;
      const below = document.documentElement.scrollHeight - (top + rect.height);
      el.style.height = `${Math.max(MIN_HEIGHT, window.innerHeight - top - below)}px`;
      // Room above the first and below the last card, so either can reach the middle.
      el.style.setProperty("--edge", `${Math.round(el.clientHeight * 0.3)}px`);
    };

    // Each card by its distance from the list's middle.
    let frame = 0;
    const paint = () => {
      frame = 0;
      const box = el.getBoundingClientRect();
      const middle = box.top + box.height / 2;
      for (const card of cards.current) {
        if (!card) continue;
        const r = card.getBoundingClientRect();
        const t = Math.min(1, Math.abs(r.top + r.height / 2 - middle) / (box.height / 2));
        card.style.transform = `scale(${1 - (1 - MIN_SCALE) * t})`;
        card.style.opacity = String(1 - (1 - MIN_OPACITY) * t);
        card.dataset.focused = t < 0.25 ? "true" : "false";
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };

    fit();
    const target = cards.current[focus];
    if (target) el.scrollTop = target.offsetTop + target.offsetHeight / 2 - el.clientHeight / 2;
    paint();
    if (!reduce) el.style.scrollBehavior = "smooth";

    const resize = () => {
      fit();
      schedule();
    };
    el.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", resize);
    return () => {
      el.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", resize);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [focus, items.length]);

  return (
    <div
      ref={list}
      role="group"
      aria-label={label}
      // Focusable, so the keyboard can scroll it.
      tabIndex={0}
      className="-mx-4 h-[70dvh] snap-y snap-proximity overflow-y-auto overscroll-contain rounded-xl px-4 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:-mx-6 sm:px-6"
    >
      <div className="mx-auto grid max-w-3xl gap-4 py-[var(--edge,0px)]">
        {items.map((item, i) => (
          <div
            key={item.key}
            ref={(node) => {
              cards.current[i] = node;
            }}
            className="origin-center snap-center transition-[transform,opacity] duration-150 ease-out motion-reduce:transition-none"
          >
            {item.node}
          </div>
        ))}
      </div>
    </div>
  );
}
