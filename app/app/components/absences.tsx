import { PersonLink } from "~/components/person-link";
import { absenceTail } from "~/lib/substitutes";

// The players marked as not playing a match (#400, D175): a temporary
// substitute plays (or played) instead. The organizer's match and decision
// pages show them as the four players see them on the match page.
export function OrganizerAbsences({ absent }: { absent: { id: string; name: string; played: boolean }[] }) {
  if (absent.length === 0) return null;
  return (
    <>
      {absent.map((a) => (
        <p key={a.id} className="break-words">
          <PersonLink id={a.id} name={a.name} /> {absenceTail(a.played)}.
        </p>
      ))}
    </>
  );
}
