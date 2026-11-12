import { Link } from "react-router";

import type { Route } from "./+types/admin.feedback";
import { AppPage } from "~/components/app-page";
import { PersonLink } from "~/components/person-link";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { requirePermission } from "~/lib/auth/admin.server";
import { excerpt, FEEDBACK_KINDS, filterHref, KIND_LABELS, parseFeedbackFilters, STATE_LABELS, VISITOR_NAME, type FeedbackFilters } from "~/lib/feedback";
import { feedbackPage } from "~/lib/feedback.server";
import { formatDateTime } from "~/lib/format";
import { SITE_NAME } from "~/lib/site";
import { cn } from "~/lib/utils";

// Visszajelzések (#241, spec 19, D94): every feedback message for the Admin,
// newest first, filtered by type and by open or done in the address, 50 a
// page. The sender by name only, never an email or phone number. Read-only:
// marking done is on a message's own page.

export function meta({}: Route.MetaArgs) {
  return [{ title: `Visszajelzések – ${SITE_NAME}` }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requirePermission(request, { kind: "feedback.view" });
  const filters = parseFeedbackFilters(new URL(request.url).searchParams);
  return { ...(await feedbackPage(filters)), filters };
}

function FilterLink({ to, active, label, count }: { to: string; active: boolean; label: string; count: number }) {
  return (
    <Button asChild size="sm" variant={active ? "default" : "outline"}>
      <Link to={to} aria-current={active ? "page" : undefined} className="no-underline">
        {label}
        <span className={cn("tabular-nums", active ? "opacity-80" : "text-muted-foreground")}>{count}</span>
      </Link>
    </Button>
  );
}

function Filters({ filters, counts }: { filters: FeedbackFilters; counts: Route.ComponentProps["loaderData"]["counts"] }) {
  const allKinds = Object.values(counts.kinds).reduce((a, b) => a + b, 0);
  const allStates = counts.states.open + counts.states.done;
  return (
    <div className="grid gap-2">
      <nav aria-label="Típus" className="flex flex-wrap gap-2">
        <FilterLink to={filterHref(filters, { kind: null })} active={!filters.kind} label="Mind" count={allKinds} />
        {FEEDBACK_KINDS.map((kind) => (
          <FilterLink key={kind} to={filterHref(filters, { kind })} active={filters.kind === kind} label={KIND_LABELS[kind]} count={counts.kinds[kind]} />
        ))}
      </nav>
      <nav aria-label="Állapot" className="flex flex-wrap gap-2">
        <FilterLink to={filterHref(filters, { state: null })} active={!filters.state} label="Mind" count={allStates} />
        {(["open", "done"] as const).map((state) => (
          <FilterLink key={state} to={filterHref(filters, { state })} active={filters.state === state} label={STATE_LABELS[state]} count={counts.states[state]} />
        ))}
      </nav>
    </div>
  );
}

export default function AdminFeedback({ loaderData }: Route.ComponentProps) {
  const { rows, total, pages, counts, filters } = loaderData;
  const filtered = Boolean(filters.kind || filters.state);
  return (
    <AppPage title="Visszajelzések" description={`Amit a játékosok és a vendégek írtak, a legújabb elöl. ${total} üzenet${filtered ? " a szűrőkkel" : ""}.`}>
      <Filters filters={filters} counts={counts} />
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
          {filtered ? "Nincs ilyen üzenet." : "Még nem jött visszajelzés."}
        </p>
      ) : (
        <ul aria-label="Visszajelzések listája" className="divide-y rounded-lg border">
          {rows.map((r) => (
            <li key={r.id} className="grid gap-1 p-3 sm:px-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant={r.kind === "bug" ? "destructive" : "secondary"}>{KIND_LABELS[r.kind]}</Badge>
                {r.done && <Badge variant="outline">Kész</Badge>}
                <span className="text-muted-foreground tabular-nums">{formatDateTime(new Date(r.createdAt))}</span>
              </div>
              <Link to={`/admin/feedback/${r.id}`} className="font-medium break-words">
                {r.kind === "rating" && <span aria-label={`${r.rating} csillag`}>{"★".repeat(r.rating ?? 0)} </span>}
                {excerpt(r.message) || "(nincs megjegyzés)"}
              </Link>
              <span className="text-sm text-muted-foreground">{r.sender ? <PersonLink id={r.sender.id} name={r.sender.name} /> : VISITOR_NAME}</span>
            </li>
          ))}
        </ul>
      )}
      {pages > 1 && (
        <nav className="flex items-center justify-between gap-2" aria-label="Lapozás">
          <Button variant="outline" size="sm" asChild disabled={filters.page <= 1}>
            {filters.page > 1 ? <Link to={filterHref(filters, { page: filters.page - 1 })}>Újabbak</Link> : <span>Újabbak</span>}
          </Button>
          <span className="text-sm text-muted-foreground">
            {filters.page}. oldal / {pages}
          </span>
          <Button variant="outline" size="sm" asChild disabled={filters.page >= pages}>
            {filters.page < pages ? <Link to={filterHref(filters, { page: filters.page + 1 })}>Régebbiek</Link> : <span>Régebbiek</span>}
          </Button>
        </nav>
      )}
    </AppPage>
  );
}
