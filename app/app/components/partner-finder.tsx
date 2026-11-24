import { Mail, MessageSquare, Phone } from "lucide-react";

import { PairLinkBox } from "~/components/pair-link";
import { PartnerSearchBox, SwitchOnButton } from "~/components/partner-search";
import { contactLinks, FINDER_EMPTY, FINDER_LOCKED, FINDER_PAIRED, FINDER_SHARES, PARTNER_SEARCH_ORGANIZER_ONLY, type FinderEntry } from "~/lib/partner-search";
import type { PartnerFinder } from "~/lib/partner-search.server";

// Párkereső (#398, D177): the body of its section on the league's Ligáim
// card. With a pair, one line. Without one, the league's other seekers
// (contact data only arrives when the viewer is a listed seeker too, so it
// is shown whenever it is there), the viewer's own switch or the button to
// switch it on, and their pair link (`link`: absolute, from the loader).

function SeekerRow({ s }: { s: FinderEntry }) {
  const links = s.contact ? contactLinks(s.contact) : null;
  const link = "inline-flex min-h-10 min-w-0 items-center gap-1.5 no-underline hover:underline";
  const details = [s.level, s.elo === null ? null : `${s.elo} Élő-pont`, s.looking].filter(Boolean).join(" · ");
  return (
    <li className="grid gap-0.5 rounded-lg border bg-background px-3 py-2">
      <span className="font-semibold break-words">{s.name}</span>
      <span className="text-muted-foreground">{details}</span>
      {s.contact && links && (
        <div className="flex min-w-0 flex-wrap items-center gap-x-4">
          {links.tel && s.contact.phone ? (
            <>
              <a href={links.tel} className={link}>
                <Phone aria-hidden className="size-4 shrink-0 text-court" />
                <span className="sr-only">Hívás: </span>
                {s.contact.phone}
              </a>
              <a href={links.sms!} className={link}>
                <MessageSquare aria-hidden className="size-4 shrink-0 text-court" />
                SMS
              </a>
            </>
          ) : (
            <span className="inline-flex min-h-10 items-center text-muted-foreground">Nincs telefonszám</span>
          )}
          <a href={links.mailto} className={link}>
            <Mail aria-hidden className="size-4 shrink-0 text-court" />
            <span className="sr-only">E-mail: </span>
            <span className="min-w-0 [overflow-wrap:anywhere]">{s.contact.email}</span>
          </a>
        </div>
      )}
    </li>
  );
}

export function PartnerFinderView({ finder }: { finder: PartnerFinder }) {
  if (finder.kind === "paired") return <p>{FINDER_PAIRED}</p>;
  const listed = finder.search.listed;
  return (
    <div className="grid gap-4">
      {finder.seekers.length === 0 ? (
        <p>{FINDER_EMPTY}</p>
      ) : (
        <ul aria-label="Párt keresnek" className="grid gap-2">
          {finder.seekers.map((s) => (
            <SeekerRow key={s.id} s={s} />
          ))}
        </ul>
      )}
      {listed ? (
        <PartnerSearchBox leagueId={finder.leagueId} search={finder.search} inline />
      ) : (
        <div className="grid content-start gap-2">
          {finder.seekers.length > 0 && <p>{FINDER_LOCKED}</p>}
          {/* On from before (D177): only the organizer sees it so far. */}
          <p className="text-muted-foreground">{finder.search.seeking ? PARTNER_SEARCH_ORGANIZER_ONLY : FINDER_SHARES}</p>
          <SwitchOnButton leagueId={finder.leagueId} />
        </div>
      )}
      <PairLinkBox url={finder.link} bare />
    </div>
  );
}
