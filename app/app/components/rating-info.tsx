import { Info } from "lucide-react";
import { Link } from "react-router";

import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "~/components/ui/dialog";

// The player's értékszám (Élő rating) with a one-tap explanation (#135):
// rounded; the starting value of the level until `rated`, the first played
// match that is final (#13).
export function RatingInfo({ rating, rated }: { rating: number; rated: boolean }) {
  return (
    <div className="flex items-center gap-2" data-testid="rating">
      <span className="text-sm text-muted-foreground">Értékszámod</span>
      <span className="font-display text-xl font-extrabold">{rating}</span>
      <Dialog>
        <DialogTrigger asChild>
          <Button type="button" variant="ghost" size="icon" className="size-8" aria-label="Mi az értékszám?">
            <Info />
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mi az értékszám?</DialogTitle>
            <DialogDescription className="grid gap-2 text-left">
              <span>
                Az értékszám azt mutatja, mennyire vagy erős a ligában. A szintedből indul: kezdő 1000, középhaladó 1200, haladó 1400,
                versenyző 1600.
              </span>
              <span>
                Minden lejátszott meccs után változik: ha erősebb párt győztök le, sokat kapsz, ha gyengébbet, keveset. Vereségnél
                fordítva.
              </span>
              {!rated && <span>Most még a kezdő értékszámodat látod, az első eredmények után kezd változni.</span>}
            </DialogDescription>
          </DialogHeader>
          <Link to="/rules#section-8" className="text-sm font-semibold underline underline-offset-4">
            Részletek a szabályzatban
          </Link>
        </DialogContent>
      </Dialog>
    </div>
  );
}
