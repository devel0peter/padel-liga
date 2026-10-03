import { renderSVG } from "uqr";

import type { Route } from "./+types/admin.poster";
import { requireAdmin } from "~/lib/access.server";
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
  await requireAdmin(request);
  const ref = normalizeRef(new URL(request.url).searchParams.get("ref"));
  const club = ref ? await getClub(ref) : undefined;
  const url = ref ? posterUrl(ref) : SITE_URL;
  const city = CITIES.find((c) => c.slug === club?.city)?.name ?? null;
  return { url, qr: renderSVG(url, { border: 0 }), club: club?.name ?? null, ref, city };
}

const POINTS = [
  "Szint szerinti négyes csoportok",
  "Heti egy meccs, amikor nektek jó",
  "Három hetente feljutás és kiesés",
  "Az első szezon ingyenes, csak a pályát fizetitek",
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
      <article className="mx-auto flex aspect-[210/297] w-full max-w-[210mm] flex-col justify-between bg-white p-[12mm] text-[#10233d] print:h-[297mm] print:max-w-none">
        <header className="grid gap-[6mm]">
          <div className="flex items-center gap-[3mm] text-[7mm] font-extrabold [font-stretch:120%]">
            <span className="inline-block size-[6mm] rounded-full bg-[#dceb3c] shadow-[inset_-1.5mm_-1mm_0_rgba(0,0,0,0.12)]" />
            {SITE_NAME}
          </div>
          <h1 className="font-display text-[17mm] leading-[1.02] font-black tracking-tight">
            Ki a legjobb páros a városban?
          </h1>
          <p className="text-[7mm] leading-snug text-[#4a5b70]">
            Padelliga pároknak{city ? ` ${city === "Győr" ? "Győrben" : city}` : ""}. Bármelyik klubban
            játszhattok.
          </p>
        </header>

        <ul className="grid gap-[3.5mm] text-[6.5mm] font-semibold">
          {POINTS.map((p) => (
            <li key={p} className="flex items-center gap-[4mm]">
              <span className="inline-block size-[4mm] shrink-0 rounded-full bg-[#1e5ba8]" />
              {p}
            </li>
          ))}
        </ul>

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
