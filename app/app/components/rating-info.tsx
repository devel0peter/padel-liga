import { Info } from "lucide-react";
import { Link } from "react-router";

import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "~/components/ui/dialog";
import { ratingExplanation } from "~/lib/rating-info";

// The player's Élő-pont (Élő rating) with a one-tap explanation (#135):
// rounded; the starting value of the level until `rated`, the first played
// match that is final (#13). `compact`: only the explanation button, next
// to a number shown elsewhere (the profile's summary, D136).
export function RatingInfo({ rating, rated, compact = false }: { rating: number; rated: boolean; compact?: boolean }) {
  const explain = (
    <Dialog>
        <DialogTrigger asChild>
          <Button type="button" variant="ghost" size="icon" className={compact ? "-my-1.5 size-7" : "size-8"} aria-label="Mi az Élő-pont?">
            <Info />
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mi az Élő-pont?</DialogTitle>
            <DialogDescription className="grid gap-2 text-left">
              {ratingExplanation(rated).map((sentence) => (
                <span key={sentence}>{sentence}</span>
              ))}
            </DialogDescription>
          </DialogHeader>
          <Link to="/rules#section-8" className="text-sm font-semibold underline underline-offset-4">
            Részletek a szabályzatban
          </Link>
        </DialogContent>
      </Dialog>
  );
  if (compact) return explain;
  return (
    <div className="flex items-center gap-2" data-testid="rating">
      <span className="text-sm text-muted-foreground">Élő-pontod</span>
      <span className="font-display text-xl font-extrabold">{rating}</span>
      {explain}
    </div>
  );
}
