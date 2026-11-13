import { PairNames, PersonLink } from "~/components/person-link";
import { CountLink } from "~/components/round-status";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { PROJECTION_NOTE, projectionIntro, type ProjectionView, type StrikeLine } from "~/lib/deadline-projection";
import { formatDeadline } from "~/lib/format";
import { LIST_ANCHOR } from "~/lib/round-status";

// "Ha most lenne a határidő" on Meccsek (#362, D162): what the deadline
// would decide now for the round's unplayed matches, each count a link to
// the list below filtered to those matches, and the strikes it would give.
// It only shows; the deadline run and the organizer decide.

export const PROJECTION_ANCHOR = "hatarido";

const counts = (s: StrikeLine) => (s.after > s.now ? `${s.now} → ${s.after}` : `${s.now}`);

// `anchor`: the first section only. `linked`: false when another round runs too.
export function DeadlineProjectionSection({
  view,
  deadline,
  title,
  anchor,
  linked = true,
}: {
  view: ProjectionView;
  deadline: Date;
  title: string;
  anchor?: boolean;
  linked?: boolean;
}) {
  const filterLink = (kind: string) => (linked ? `?${new URLSearchParams({ deadline: kind })}#${LIST_ANCHOR}` : null);
  return (
    <Card role="region" aria-label={title} id={anchor ? PROJECTION_ANCHOR : undefined} className="max-w-3xl scroll-mt-6">
      <CardHeader>
        <CardTitle role="heading" aria-level={2} className="font-display text-lg font-bold">
          {title}
        </CardTitle>
        <CardDescription>
          {projectionIntro(formatDeadline(deadline))} {PROJECTION_NOTE}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="grid gap-2 sm:grid-cols-2">
          {view.totals.map((t) => (
            <CountLink key={t.kind} to={filterLink(t.kind)} label={t.label} count={t.count} />
          ))}
        </div>

        <div className="grid gap-3">
          <h3 className="text-sm font-semibold">Fekete pontok</h3>
          <p className="text-sm text-muted-foreground">
            {view.newStrikes === 0 ? "Most senki nem kapna fekete pontot." : `Most ${view.newStrikes} fekete pont járna. A fekete pont a játékosé, nem a páré.`}
          </p>
          <div className="grid gap-1">
            <h4 className="text-sm font-medium">2. fekete pont (figyelmeztető e-mail)</h4>
            {view.warned.length === 0 ? (
              <p className="text-sm text-muted-foreground">Senki.</p>
            ) : (
              <ul className="grid gap-1 text-sm">
                {view.warned.map((w) => (
                  <li key={w.player.id}>
                    <PersonLink id={w.player.id} name={w.player.name} className="font-medium" />{" "}
                    <span className="text-muted-foreground">
                      (<PairNames players={w.pair} />): {counts(w.player)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="grid gap-1">
            <h4 className="text-sm font-medium">Kiesnének a körváltáskor (3. fekete pont)</h4>
            {view.leaving.length === 0 ? (
              <p className="text-sm text-muted-foreground">Senki.</p>
            ) : (
              <ul className="grid gap-1 text-sm">
                {view.leaving.map((l) => (
                  <li key={l.pairId}>
                    <span className="font-medium">
                      <PairNames players={l.pair} />
                    </span>{" "}
                    <span className="text-muted-foreground">({l.players.map((p) => `${p.name}: ${counts(p)}`).join(", ")})</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
