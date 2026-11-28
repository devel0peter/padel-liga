import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import type { Route } from "./+types/rankings";
import { OwnTag, Page, PageHeader, SectionLabel, Segmented, formatDelta } from "~/components/blocks";
import { requireUser } from "~/lib/auth/session.server";
import type { RankRow } from "~/lib/rankings";
import { rankingsPage } from "~/lib/rankings.server";
import { SITE_NAME } from "~/lib/site";
import { cn } from "~/lib/utils";

import { TableSwitch } from "./league";

// The Ranglista (D137; direction A, #422, mockup P05): a league's players
// and pairs by Élő-pont, as pill tabs (`?view=pairs`). For logged-in players
// only, inside the app shell; names, pairs, divisions and ratings only. Ties
// share a place. The first 16 rows, then "Még N játékos". On a phone it is
// the Tabella's second view (D183).
export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const page = await rankingsPage(params.league ?? "", user.id);
  if (!page) throw new Response("Nincs ilyen liga.", { status: 404 });
  return page;
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: `Ranglista: ${loaderData?.league.name ?? "liga"} – ${SITE_NAME}` }, { name: "robots", content: "noindex, nofollow" }];
}

const FIRST = 16;
const DOT = { Bronz: "bg-division-bronz", Réz: "bg-division-rez", Rookie: "bg-division-rookie" } as Record<string, string>;
const num = "px-1.5 text-right tabular-nums";
const head = "h-8 px-1.5 text-xs font-normal text-muted-foreground";

function Ranking({ rows, label, players }: { rows: RankRow[]; label: string; players: boolean }) {
  const [all, setAll] = useState(false);
  if (rows.length === 0) return <p className="m-0 text-muted-foreground">Még nincs kit rangsorolni.</p>;
  const shown = all ? rows : rows.slice(0, FIRST);
  const more = rows.length - shown.length;
  return (
    <div className="flex flex-col rounded-2xl bg-surface p-2 md:p-2.5">
      <table aria-label={label} className="w-full table-fixed border-separate border-spacing-0 text-body">
        <thead>
          <tr>
            <th scope="col" className={cn(head, "w-10 pl-2.5 text-left")}>
              #
            </th>
            <th scope="col" className={cn(head, "text-left")}>
              {players ? "Játékos" : "Pár"}
            </th>
            {players && (
              <th scope="col" className={cn(head, "hidden text-left lg:table-cell")}>
                Pár
              </th>
            )}
            <th scope="col" className={cn(head, "hidden w-24 text-left lg:table-cell")}>
              Divízió
            </th>
            <th scope="col" className={cn(head, num, "w-24")}>
              Élő-pont
            </th>
            {players && (
              <th scope="col" className={cn(head, num, "w-14 pr-2.5")} title="Értékelt meccsek">
                Meccs
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.key} className={cn("[&>td]:h-9", r.mine && "font-bold [&>td]:bg-ball-tint [&>td:first-child]:rounded-l-[10px] [&>td:last-child]:rounded-r-[10px]")}>
              <td className={cn("pl-2.5 tabular-nums", r.mine ? "text-ball" : "text-muted-foreground")}>{r.place}.</td>
              <td className="px-1.5">
                <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5">
                  {r.href ? (
                    <Link to={r.href} className="break-words text-inherit no-underline hover:underline">
                      {r.name}
                    </Link>
                  ) : (
                    r.name
                  )}
                  {r.mine && (
                    <>
                      <span aria-hidden className="[&>span]:px-1.5 [&>span]:py-0.5">
                        <OwnTag tag={players ? "TE" : "TI"} />
                      </span>
                      <span className="sr-only"> ({players ? "te" : "ti"})</span>
                    </>
                  )}
                </span>
              </td>
              {players && <td className="hidden truncate px-1.5 font-normal text-muted-foreground lg:table-cell">{r.pair ?? ""}</td>}
              <td className="hidden px-1.5 font-normal text-soft-foreground lg:table-cell">
                {r.division && (
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden className={cn("size-2 rounded-full", DOT[r.division])} />
                    {r.division}
                  </span>
                )}
              </td>
              <td className={cn(num, "font-extrabold")}>
                {r.elo}
                {r.mine && r.delta != null && <span className={cn("ml-1 text-xs", r.delta >= 0 ? "text-success" : "text-danger")}>{formatDelta(r.delta)}</span>}
              </td>
              {players && <td className={cn(num, "pr-2.5 font-normal text-muted-foreground")}>{r.matches}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {more > 0 && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="mt-1 min-h-11 cursor-pointer border-t border-hairline text-sm font-bold text-ball hover:underline"
        >
          Még {more} {players ? "játékos" : "pár"}
        </button>
      )}
    </div>
  );
}

const RULES = "/rules#section-8";

export default function Rankings({ loaderData: d }: Route.ComponentProps) {
  const slug = useParams().league ?? "";
  const [params] = useSearchParams();
  const view = params.get("view") === "pairs" ? "pairs" : "players";
  const me = d.players.find((r) => r.mine) ?? null;
  const tabs = (
    <Segmented
      variant="pills"
      label="Kit mutasson"
      value={view}
      options={[
        { value: "players", label: "Játékosok", to: `/league/${slug}/rankings` },
        { value: "pairs", label: "Párok", to: `/league/${slug}/rankings?view=pairs` },
      ]}
    />
  );
  return (
    <Page>
      <PageHeader
        eyebrow={`${d.league.name} · Élő-pont szerint`}
        title={
          <>
            <span className="md:hidden">Tabella</span>
            <span className="hidden md:inline">Ranglista</span>
          </>
        }
        aside={d.started && <div className="hidden md:block">{tabs}</div>}
      />
      <TableSwitch slug={slug} value="rankings" />
      {!d.started ? (
        <p className="m-0 text-muted-foreground">Az Élő-pontok a liga indulása után látszanak itt.</p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_308px] lg:items-start lg:gap-6">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3 md:hidden">
              {tabs}
              <Link to={RULES} className="flex min-h-11 items-center text-sm font-bold text-ball no-underline hover:underline">
                Mi az Élő-pont?
              </Link>
            </div>
            {view === "players" ? (
              <Ranking rows={d.players} label="Játékosok Élő-pont szerint" players />
            ) : (
              <Ranking rows={d.pairs} label="Párok Élő-pont szerint" players={false} />
            )}
            <p className="m-0 text-caption text-muted-foreground lg:hidden">
              Azonos Élő-pontnál közös a hely. {view === "players" ? "Meccs: ami változtatott az Élő-ponton." : "A pár Élő-pontja a két játékos átlaga."}
            </p>
          </div>
          <aside className="hidden flex-col gap-5 lg:flex">
            {me && (
              <section aria-labelledby="elo-pontod" className="flex flex-col gap-2 rounded-2xl bg-surface p-5">
                <SectionLabel id="elo-pontod">Élő-pontod</SectionLabel>
                <span className="type-display text-[64px] leading-[0.85] text-ball">{me.elo}</span>
                <span className="text-sm text-muted-foreground">
                  <strong className="text-foreground">{me.place}. hely</strong> a ligában
                  {me.delta != null && (
                    <>
                      {" · "}
                      <span className={me.delta >= 0 ? "text-success" : "text-danger"}>{formatDelta(me.delta)}</span> az utolsó meccsen
                    </>
                  )}
                </span>
              </section>
            )}
            <section aria-labelledby="mi-az-elo" className="flex flex-col gap-2 rounded-2xl bg-surface p-5">
              <h2 id="mi-az-elo" className="m-0 text-[17px] font-bold">
                Mi az Élő-pont?
              </h2>
              <p className="m-0 text-sm text-soft-foreground">
                Minden lejátszott meccs után változik. Erősebb ellenfél legyőzése többet ér, gyengébbtől kikapni többe kerül.
              </p>
              <Link to={RULES} className="flex min-h-11 w-fit items-center text-sm font-bold text-ball no-underline hover:underline">
                Részletek a szabályzatban
              </Link>
            </section>
            <p className="m-0 text-caption text-muted-foreground">
              Azonos Élő-pontnál közös a hely. {view === "players" ? "Meccs: ami változtatott az Élő-ponton." : "A pár Élő-pontja a két játékos átlaga."}
            </p>
          </aside>
        </div>
      )}
    </Page>
  );
}
