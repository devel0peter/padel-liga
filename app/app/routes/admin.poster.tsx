import { renderSVG } from "uqr";

import type { Route } from "./+types/admin.poster";
import { requirePermission } from "~/lib/auth/admin.server";
import { CITIES } from "~/lib/cities";
import { normalizeRef, posterUrl } from "~/lib/clubs";
import { getClub } from "~/lib/clubs.server";
import { SITE_NAME, SITE_URL } from "~/lib/site";

// Printable A4 poster with a QR code to the landing page. With `?ref=<club>`
// the QR code carries the club's slug, so its signups can be counted.
export function meta({}: Route.MetaArgs) {
  return [{ title: `Plakát – ${SITE_NAME}` }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const ref = normalizeRef(new URL(request.url).searchParams.get("ref"));
  const club = ref ? await getClub(ref) : undefined;
  // A club's poster: whoever manages that city's clubs. The general poster
  // (or a ref that isn't a club): the Admin.
  await requirePermission(request, club ? { kind: "clubs.manage", city: club.city } : { kind: "clubs.manage" });
  const url = ref ? posterUrl(ref) : SITE_URL;
  // The general poster is for the first (so far only) city.
  const city = (CITIES.find((c) => c.slug === club?.city) ?? CITIES[0]).name;
  return { url, qr: renderSVG(url, { border: 0 }), club: club?.name ?? null, ref, city };
}

// Same steps as the landing page's "Hogyan működik?", in short.
const STEPS = [
  ["Négyes csoportok", "Szint szerint, kiegyenlített meccsekkel."],
  ["Heti egy meccs", "Akkor és ott, amikor nektek jó."],
  ["Feljutás, kiesés", "Három hetente új kör, új ellenfelek."],
];

export default function Poster({ loaderData }: Route.ComponentProps) {
  const { url, qr, club, ref, city } = loaderData;
  return (
    <>
      <style>{`
        @page { size: A4; margin: 0; }
        @media print { .no-print { display: none !important; } body { background: white; } }
        .poster-qr svg { width: 100%; height: auto; display: block; }
      `}</style>

      <div className="no-print flex flex-wrap items-center justify-between gap-3 border-b p-4 text-sm">
        <span>
          {club ? `${club} plakátja` : ref ? `Plakát (forrás: ${ref})` : "Általános plakát, forrás nélkül"} ·
          QR: {url}
        </span>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-full bg-[#1e5ba8] px-5 py-2 font-bold text-white"
        >
          Nyomtatás
        </button>
      </div>

      {/* Fixed light colours: the poster prints the same in dark mode. */}
      <article className="mx-auto flex aspect-[210/297] w-full max-w-[210mm] flex-col justify-between bg-white p-[14mm] text-[#10233d] print:h-[297mm] print:max-w-none">
        <header className="grid gap-[9mm]">
          {/* Brand: the league is "Padelpárbaj <city>". */}
          <div className="flex items-baseline gap-[3mm] text-[8mm] font-extrabold [font-stretch:120%]">
            <span className="inline-block size-[6.5mm] self-center rounded-full bg-[#dceb3c] shadow-[inset_-1.5mm_-1mm_0_rgba(0,0,0,0.12)]" />
            {SITE_NAME}
            <span className="text-[#1e5ba8]">{city}</span>
          </div>
          <h1 className="font-display text-[16.5mm] leading-[1.02] font-black tracking-tight">
            Ki a legjobb páros a városban?
          </h1>
          <p className="max-w-[160mm] text-[7.5mm] leading-snug">
            <strong>Unod már, hogy mindig ugyanazokkal játszol? Nehéz hétről hétre meccset
            szervezni?</strong>{" "}
            <span className="text-[#4a5b70]">A {SITE_NAME}ban minden héten új ellenfelet kapsz.</span>
          </p>
        </header>

        <ol className="grid grid-cols-3 gap-[6mm]">
          {STEPS.map(([title, text], i) => (
            <li key={title} className="grid content-start gap-[2mm] border-t-[1.2mm] border-[#1e5ba8] pt-[4mm]">
              <span className="font-display text-[13mm] leading-none font-black text-[#1e5ba8] [font-stretch:125%]">
                {i + 1}
              </span>
              <span className="text-[6.5mm] leading-tight font-bold">{title}</span>
              <span className="text-[5mm] leading-snug text-[#4a5b70]">{text}</span>
            </li>
          ))}
        </ol>

        <footer className="grid grid-cols-[1fr_62mm] items-end gap-[8mm] rounded-[6mm] bg-[#dceb3c] p-[8mm]">
          <div className="grid gap-[3mm]">
            <p className="font-display text-[11mm] leading-none font-black">Jelentkezz!</p>
            <p className="text-[5.5mm] leading-snug">
              Novemberben indulunk, ha összegyűlik legalább 12 pár. A jelentkezés nem kötelez
              semmire.
            </p>
            <p className="text-[6.5mm] font-extrabold">padelparbaj.hu</p>
          </div>
          <div className="poster-qr rounded-[3mm] bg-white p-[4mm]" dangerouslySetInnerHTML={{ __html: qr }} />
        </footer>
      </article>
    </>
  );
}
