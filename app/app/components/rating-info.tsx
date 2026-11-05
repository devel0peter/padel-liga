import { Info } from "lucide-react";
import { Link } from "react-router";

import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "~/components/ui/dialog";
import { ratingExplanation } from "~/lib/rating-info";

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
    </div>
  );
}
