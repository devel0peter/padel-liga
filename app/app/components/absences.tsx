import { PersonLink } from "~/components/person-link";

// The players marked as not playing a match (#400, D175): a temporary
// substitute played instead. The organizer's match and decision pages show
// them as the four players see them on the match page.
export function OrganizerAbsences({ absent }: { absent: { id: string; name: string; afterMatch: boolean }[] }) {
  if (absent.length === 0) return null;
  return (
    <>
      {absent.map((a) => (
        <p key={a.id} className="break-words">
          <span className="font-medium">Helyettes:</span> <PersonLink id={a.id} name={a.name} /> helyett{" "}
          {a.afterMatch ? "helyettes játszott (az eredménnyel jelölték)" : "helyettes játszik (a meccs előtt jelölték)"}.
        </p>
      ))}
    </>
  );
}
