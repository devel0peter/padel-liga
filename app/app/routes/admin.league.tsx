import { CheckCircle2, ChevronRight, Circle, Users } from "lucide-react";
import { data, Form, Link, useNavigation } from "react-router";

import type { Route } from "./+types/admin.league";
import { ActionCard, ListCard, ListRow, Page, PageHeader, RoundProgress, SectionLabel, StatusPill } from "~/components/blocks";
import { Button } from "~/components/ui/button";
import { requirePermission } from "~/lib/auth/admin.server";
import { cityName } from "~/lib/cities";
import { listCities } from "~/lib/cities.server";
import { formatDateTime, formatDeadline } from "~/lib/format";
import { publishedPhases } from "~/lib/groups.server";
import { leagueLaunchChecklist } from "~/lib/launch-checklist.server";
import { getLeague, minEntriesByLeague, setPrivacyAgreement, setRegisterLinkShared } from "~/lib/leagues.server";
import { runningPhases } from "~/lib/match-overview.server";
import { radVarItems, type RadVarItem } from "~/lib/organizer-decisions.server";
import { compactLine } from "~/lib/round-status";
import { entryCounts } from "~/lib/season-entries.server";
import { isWaiting } from "~/lib/seasons";
import { listSeasons } from "~/lib/seasons.server";
import { SITE_NAME } from "~/lib/site";
import { leagueWaitingList } from "~/lib/waiting-list.server";

// Organizer Áttekintés (#438, #439, #391, #380, #381):
// - Rád vár · N (oldest item as ActionCard with the page's ONLY yellow primary button)
// - Launch checklist (#391) in Phase A & B (until round 1 is published)
// - A kör állása + per-group progress (Phase C) or Phase A/B/D/E status
// - Mi jön timeline in Budapest time with explicit "Te:" steps (#439)
// - Jelentkezések card linking to Várakozók (#380, #381)
// No player names on this page.

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: `${loaderData?.name ?? "Liga"} – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

async function leagueScope(request: Request, slug: string) {
  const league = await getLeague(slug);
  if (!league) throw data("Nincs ilyen liga.", { status: 404 });
  const actor = await requirePermission(request, { kind: "league.manage", league: league.slug });
  return { league, actor };
}

type TimelineStep = { when: string; text: string; byOrganizer?: boolean };

export async function loader({ request, params }: Route.LoaderArgs) {
  const { league, actor } = await leagueScope(request, params.league);
  const now = new Date();
  const [cities, items, checklist, waiting, running, seasons, pubMap, minimums] = await Promise.all([
    listCities(),
    radVarItems(league.id, league.slug, now),
    leagueLaunchChecklist(league.id),
    leagueWaitingList(league.id, now),
    runningPhases(league.id, now),
    listSeasons(league.id),
    publishedPhases(),
    minEntriesByLeague([league.id]),
  ]);

  const latestSeason = seasons[0] ?? null;
  const counts = latestSeason ? await entryCounts([latestSeason.id]) : new Map<number, number>();
  const latestEntries = latestSeason ? (counts.get(latestSeason.id) ?? 0) : 0;
  const minEntries = minimums.get(league.id) ?? 0;
  const activeRound = running[0] ?? null;

  // Determine league phase (A–E) and "Mi jön" timeline (#439)
  let phaseKind: "A" | "B" | "C" | "D" | "E";
  const timeline: TimelineStep[] = [];

  if (!latestSeason) {
    phaseKind = "A";
    timeline.push({ when: "Következő lépés", text: "Első szezon létrehozása a Szezonok oldalon.", byOrganizer: true });
  } else if (activeRound) {
    phaseKind = "C";
    timeline.push({ when: formatDeadline(activeRound.deadline), text: `${activeRound.phase}. kör határideje.` });
    if (activeRound.phase < 4) {
      timeline.push({
        when: "Határidő után ~10 perccel",
        text: `A rendszer elkészíti a ${activeRound.phase + 1}. kör csoporttervezetét és értesít.`,
      });
      timeline.push({
        when: "Utána",
        text: `Átnézed a ${activeRound.phase + 1}. kör tervezetét és közzéteszed.`,
        byOrganizer: true,
      });
    } else {
      timeline.push({ when: "Kör után", text: "A szezon lezárul, indulhat a következő szezon.", byOrganizer: true });
    }
  } else {
    const pubPhases = pubMap.get(latestSeason.id) ?? [];
    if (pubPhases.length === 0) {
      phaseKind = "B";
      if (isWaiting(latestSeason)) {
        timeline.push({
          when: `${latestEntries} / ${minEntries} pár`,
          text: `Amint összegyűlik ${minEntries} nevezett pár, automatikusan rögzül az 1. kör kezdése.`,
        });
      } else if (latestSeason.registrationClosesAt) {
        timeline.push({ when: formatDeadline(latestSeason.registrationClosesAt), text: "Nevezési határidő vége." });
      }
      timeline.push({ when: "Nevezés után", text: "1. kör csoportjainak elkészítése és közzététele.", byOrganizer: true });
    } else {
      const maxPhase = Math.max(...latestSeason.phases.map((p) => p.number), 4);
      const maxPublished = Math.max(...pubPhases);
      if (maxPublished < maxPhase) {
        phaseKind = "D";
        const nextPhase = maxPublished + 1;
        const nextMeta = latestSeason.phases.find((p) => p.number === nextPhase);
        timeline.push({
          when: nextMeta ? formatDeadline(nextMeta.startsAt) : "Következő kör",
          text: `A ${nextPhase}. kör tervezetének átnézése és közzététele.`,
          byOrganizer: true,
        });
      } else {
        phaseKind = "E";
        timeline.push({ when: "Szezon vége", text: "Új szezon létrehozása a Szezonok oldalon.", byOrganizer: true });
      }
    }
  }

  let roundCard: null | {
    seasonId: number;
    seasonName: string;
    phase: number;
    week: number | null;
    deadline: string;
    daysLeft: number;
    progress: number;
    summaryLine: string;
    stuckCount: number;
    groups: { number: number; played: number; total: number; stuck: number }[];
  } = null;

  if (activeRound) {
    const totalMs = Math.max(1, activeRound.deadline.getTime() - activeRound.phaseStartsAt.getTime());
    const elapsedMs = now.getTime() - activeRound.phaseStartsAt.getTime();
    const daysLeft = Math.max(0, Math.ceil((activeRound.deadline.getTime() - now.getTime()) / 86_400_000));
    const week = Math.min(3, Math.max(1, Math.floor(elapsedMs / (7 * 86_400_000)) + 1));
    roundCard = {
      seasonId: activeRound.seasonId,
      seasonName: activeRound.season,
      phase: activeRound.phase,
      week,
      deadline: formatDeadline(activeRound.deadline),
      daysLeft,
      progress: Math.min(1, Math.max(0, elapsedMs / totalMs)),
      summaryLine: compactLine(activeRound.round),
      stuckCount: activeRound.matches.filter((m) => m.stuck !== null).length,
      groups: activeRound.groups.map((g) => {
        const gm = activeRound.matches.filter((m) => m.groupNumber === g);
        return {
          number: g,
          played: gm.filter((m) => m.status === "final").length,
          total: gm.length,
          stuck: gm.filter((m) => m.stuck !== null).length,
        };
      }),
    };
  }

  return {
    name: league.name,
    slug: league.slug,
    city: cityName(league.city, cities),
    isAdmin: actor.platformRole === "superadmin",
    radVar: items,
    checklist,
    phaseKind,
    latestSeason: latestSeason
      ? {
          id: latestSeason.id,
          name: latestSeason.name,
          waiting: isWaiting(latestSeason),
          entries: latestEntries,
          minEntries,
        }
      : null,
    roundCard,
    timeline,
    waitingCounts: waiting.counts,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const { league, actor } = await leagueScope(request, params.league);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "toggle-register-link") {
    const shared = form.get("shared") === "1";
    await setRegisterLinkShared(league.id, shared, actor.id);
    return { ok: true };
  }
  if (intent === "toggle-privacy") {
    if (actor.platformRole !== "superadmin") {
      throw data("Csak az Admin rögzítheti az adatvédelmi megállapodást.", { status: 403 });
    }
    const userId = String(form.get("userId") ?? "");
    const agreed = form.get("agreed") === "1";
    await setPrivacyAgreement(league.id, userId, agreed, actor.id);
    return { ok: true };
  }
  throw new Response("Ismeretlen művelet.", { status: 400 });
}

function itemCopy(item: RadVarItem): { title: string; description: string; cta: string } {
  if (item.kind === "dispute") {
    return {
      title: `Vitatott eredmény · ${item.groupNumber}. csoport`,
      description: `${item.seasonName}, ${item.phase}. kör · várakozik: ${formatDateTime(new Date(item.waitingSince))}`,
      cta: "Döntés megnyitása",
    };
  }
  if (item.kind === "no_show") {
    return {
      title: `Nem jöttek el bejelentés · ${item.groupNumber}. csoport`,
      description: `${item.seasonName}, ${item.phase}. kör · várakozik: ${formatDateTime(new Date(item.waitingSince))}`,
      cta: "Döntés megnyitása",
    };
  }
  if (item.kind === "partner_change") {
    return {
      title: "Partnercsere jóváhagyásra vár",
      description: `Beérkezett: ${formatDateTime(new Date(item.waitingSince))}`,
      cta: "Döntések megnyitása",
    };
  }
  return {
    title: `${item.phase}. kör csoportjai közzétételre várnak`,
    description: `${item.seasonName} · tervezet kész: ${formatDateTime(new Date(item.waitingSince))}`,
    cta: "Csoportok átnézése",
  };
}

export default function LeagueOverview({ loaderData }: Route.ComponentProps) {
  const { name, slug, city, isAdmin, radVar, checklist, phaseKind, latestSeason, roundCard, timeline, waitingCounts } = loaderData;
  const busy = useNavigation().state !== "idle";
  const base = `/admin/leagues/${slug}`;
  const [firstItem, ...restItems] = radVar;

  return (
    <Page>
      <PageHeader eyebrow={city} title={name} />

      {roundCard && (
        <RoundProgress
          round={roundCard.phase}
          week={roundCard.week}
          deadline={roundCard.deadline}
          daysLeft={roundCard.daysLeft}
          progress={roundCard.progress}
          note={roundCard.summaryLine}
        />
      )}

      {/* Rád vár · N (#438): oldest item has the page's ONLY yellow primary button */}
      <section className="grid gap-3" aria-label="Rád vár">
        <SectionLabel tone={radVar.length > 0 ? "warning" : "muted"}>
          Rád vár{radVar.length > 0 ? ` · ${radVar.length}` : ""}
        </SectionLabel>
        {!firstItem ? (
          <p className="rounded-2xl bg-surface px-4 py-4 text-sm text-muted-foreground">Nincs teendőd.</p>
        ) : (
          <>
            {(() => {
              const copy = itemCopy(firstItem);
              return (
                <ActionCard
                  urgent
                  title={copy.title}
                  description={copy.description}
                  actions={
                    <Button size="xl" asChild>
                      <Link to={firstItem.url}>{copy.cta}</Link>
                    </Button>
                  }
                />
              );
            })()}
            {restItems.length > 0 && (
              <ListCard>
                {restItems.map((item) => {
                  const copy = itemCopy(item);
                  return (
                    <ListRow key={item.id} to={item.url} description={copy.description} chevron>
                      {copy.title}
                    </ListRow>
                  );
                })}
              </ListCard>
            )}
          </>
        )}
      </section>

      {/* Indulási lista (#391): visible in Phase A & B until round 1 is published */}
      {checklist.visible && (
        <section className="grid gap-3" aria-label="Indulási lista">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SectionLabel>Indulási lista</SectionLabel>
            <StatusPill tone={checklist.missingRequired === 0 ? "success" : "warning"}>
              {checklist.missingRequired === 0 ? "Indulásra kész" : `${checklist.missingRequired} kötelező hiányzik`}
            </StatusPill>
          </div>
          <div className="grid gap-2 rounded-2xl bg-surface p-4 text-sm">
            {checklist.items.map((item) => (
              <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 last:border-b-0 last:pb-0">
                <div className="flex items-center gap-2">
                  {item.done ? (
                    <CheckCircle2 className="size-4 shrink-0 text-success" aria-label="Kész" />
                  ) : (
                    <Circle className="size-4 shrink-0 text-muted-foreground" aria-label="Hiányzik" />
                  )}
                  <span className={item.done ? "text-muted-foreground line-through" : "font-medium"}>{item.label}</span>
                </div>
                {item.toggle === "register_link" ? (
                  <Form method="post">
                    <input type="hidden" name="intent" value="toggle-register-link" />
                    <input type="hidden" name="shared" value={item.done ? "0" : "1"} />
                    <Button type="submit" size="sm" variant="outline" disabled={busy}>
                      {item.done ? "Visszavonás" : "Megosztottam"}
                    </Button>
                  </Form>
                ) : item.toggle === "privacy" ? (
                  isAdmin ? (
                    <div className="flex flex-wrap gap-1.5">
                      {checklist.organizers
                        .filter((o) => !o.isSuperadmin)
                        .map((o) => (
                          <Form key={o.userId} method="post">
                            <input type="hidden" name="intent" value="toggle-privacy" />
                            <input type="hidden" name="userId" value={o.userId} />
                            <input type="hidden" name="agreed" value={o.privacyAgreed ? "0" : "1"} />
                            <Button type="submit" size="sm" variant="outline" disabled={busy}>
                              {o.name}: {o.privacyAgreed ? "Rögzítve ✓" : "Rögzítem"}
                            </Button>
                          </Form>
                        ))}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">Admin pipálja</span>
                  )
                ) : !item.done ? (
                  <Link to={item.href} className="text-xs font-semibold underline">
                    Megnyitás
                  </Link>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* A kör állása (Phase C) or Phase A/B/D/E status (#438) */}
      {roundCard ? (
        <section className="grid gap-3" aria-label="A kör állása">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SectionLabel>
              A kör állása · {roundCard.seasonName}, {roundCard.phase}. kör
            </SectionLabel>
            {roundCard.stuckCount > 0 && (
              <Link
                to={`${base}/seasons/${roundCard.seasonId}/rounds/${roundCard.phase}?stuck=1`}
                className="text-xs font-semibold text-destructive underline"
              >
                {roundCard.stuckCount} elakadt meccs
              </Link>
            )}
          </div>
          <ListCard>
            {roundCard.groups.map((g) => (
              <ListRow
                key={g.number}
                to={`${base}/seasons/${roundCard.seasonId}/rounds/${roundCard.phase}?group=${g.number}`}
                description={g.stuck > 0 ? `${g.stuck} elakadt meccs` : "Minden rendben halad"}
                trailing={
                  <span className="text-sm font-semibold tabular-nums">
                    {g.played} / {g.total}
                  </span>
                }
                chevron
              >
                {g.number}. csoport
              </ListRow>
            ))}
          </ListCard>
        </section>
      ) : (
        <section className="grid gap-3" aria-label="Szezon állapota">
          <SectionLabel>Szezon állapota</SectionLabel>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface p-4 text-sm">
            {phaseKind === "A" && <p className="text-muted-foreground">Még nincs létrehozott szezon ebben a ligában.</p>}
            {phaseKind === "B" && latestSeason && (
              <p>
                <strong>{latestSeason.name}</strong>: {latestSeason.entries} nevezett pár
                {latestSeason.waiting ? ` (minimum: ${latestSeason.minEntries} pár)` : ""}.
              </p>
            )}
            {phaseKind === "D" && latestSeason && (
              <p>
                <strong>{latestSeason.name}</strong>: körváltás folyamatban.
              </p>
            )}
            {phaseKind === "E" && latestSeason && (
              <p>
                <strong>{latestSeason.name}</strong> lezárult. Indíthatod a következő szezont.
              </p>
            )}
            <Button variant="outline" size="sm" asChild>
              <Link to={latestSeason ? `${base}/seasons/${latestSeason.id}` : `${base}/seasons`}>
                {latestSeason ? "Szezon megnyitása" : "Szezon létrehozása"}
              </Link>
            </Button>
          </div>
        </section>
      )}

      {/* Mi jön (#439) */}
      <section className="grid gap-3" aria-label="Mi jön">
        <SectionLabel>Mi jön</SectionLabel>
        <ol className="grid gap-2 rounded-2xl bg-surface p-4 text-sm">
          {timeline.map((step, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-xs font-semibold text-muted-foreground">{step.when}:</span>
              <span>
                {step.byOrganizer && <strong className="mr-1 font-bold text-foreground">Te:</strong>}
                {step.text}
              </span>
            </li>
          ))}
        </ol>
      </section>

      {/* Jelentkezések (#380, #381) */}
      <section className="grid gap-3" aria-label="Jelentkezések">
        <SectionLabel>Jelentkezések</SectionLabel>
        <ListCard>
          <ListRow
            to={`${base}/players?tab=waiting`}
            leading={<Users className="size-5 text-muted-foreground" />}
            description={`${waitingCounts.seeking} játékos párt keres, ${waitingCounts.noPair} párja nincs`}
            trailing={
              <span className="inline-flex items-center gap-1 text-sm font-semibold">
                Várakozók
                <ChevronRight className="size-4 text-muted-foreground" />
              </span>
            }
          >
            {waitingCounts.pairs} pár vár beszállásra
          </ListRow>
        </ListCard>
      </section>
    </Page>
  );
}
