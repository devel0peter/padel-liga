import { Bug, Lightbulb } from "lucide-react";
import { useEffect, useState } from "react";
import { Form, useFetcher, useLocation, useNavigation } from "react-router";

import { FieldError, invalid } from "~/components/auth";
import { Turnstile } from "~/components/turnstile";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "~/components/ui/dialog";
import { Label } from "~/components/ui/label";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { Textarea } from "~/components/ui/textarea";
import { FORM_CHOICES, FORM_KINDS, isFormKind, MESSAGE_MAX, RATING_LABELS, RATING_MAX, type FormKind } from "~/lib/feedback";
import { CONTACT_EMAIL } from "~/lib/site";

// Visszajelzés's form (#240, spec 19, D94), shared by the /feedback page and
// the dialog (#444) that opens it in place from the sidebar and the public
// footer. Both post to /feedback's action, so the checks are the same.

/** What /feedback's loader gives the form: where it was sent from and what goes along. */
export type FeedbackFormData = {
  from: string;
  page: string;
  sentAt: string;
  device: string;
  browser: string;
  version: string;
  account: string | null;
  turnstileSiteKey: string | null;
};

export type FeedbackAnswer = { ok: true } | { ok: false; error: string; kind: string; message: string };

// The links' name, the dialog's title (#446, as on Google's Hungarian
// pages), its line and the thank-you.
export const FEEDBACK_LINK = "Visszajelzés";
export const FEEDBACK_TITLE = "Visszajelzés küldése";
export const FEEDBACK_INTRO = "Írd meg röviden, megnézzük.";
export const THANKS_TITLE = "Köszi, megkaptuk!";
export const THANKS_TEXT = "Elolvassuk, és ha kell, javítjuk.";

// The form (#446): what it is about as two large choices, one box whose
// hint says what to write, the contact line. What we store with it (page,
// device, browser, version, account) isn't listed on the form any more.
export function FeedbackFields({
  data,
  failed,
  busy,
  answer,
  FormTag = Form,
}: {
  data: FeedbackFormData;
  failed: Extract<FeedbackAnswer, { ok: false }> | null;
  busy: boolean;
  // Changes after every answer, so the bot check runs again.
  answer?: unknown;
  // The page's Form or a fetcher's.
  FormTag?: typeof Form;
}) {
  const [botOk, setBotOk] = useState(false);
  const [kind, setKind] = useState<FormKind>(isFormKind(failed?.kind) ? failed.kind : "bug");
  const blocked = Boolean(data.turnstileSiteKey) && !botOk;
  return (
    <FormTag method="post" action="/feedback" className="grid gap-4">
      <input type="hidden" name="from" value={data.from} />
      <RadioGroup name="kind" value={kind} onValueChange={(v) => isFormKind(v) && setKind(v)} aria-label="Miről szól?" className="grid grid-cols-2 gap-2">
        {FORM_KINDS.map((k) => (
          <Label
            key={k}
            htmlFor={`kind-${k}`}
            className="relative flex min-h-14 cursor-pointer items-center gap-2.5 rounded-xl bg-surface-3 px-3.5 py-3 text-[15px] font-semibold has-[[data-state=checked]]:bg-ball-tint has-[[data-state=checked]]:text-ball has-[[data-state=checked]]:inset-ring-2 has-[[data-state=checked]]:inset-ring-ball"
          >
            {/* The whole card is the radio: an invisible button over it. */}
            <RadioGroupItem id={`kind-${k}`} value={k} className="absolute inset-0 size-full rounded-xl border-0 opacity-0" />
            {k === "bug" ? <Bug aria-hidden className="size-5 shrink-0" /> : <Lightbulb aria-hidden className="size-5 shrink-0" />}
            {FORM_CHOICES[k].label}
          </Label>
        ))}
      </RadioGroup>
      <div className="grid gap-1.5">
        <Label htmlFor="message" className="sr-only">
          Üzenet
        </Label>
        <Textarea
          id="message"
          name="message"
          required
          maxLength={MESSAGE_MAX}
          rows={5}
          placeholder={FORM_CHOICES[kind].placeholder}
          defaultValue={failed?.message}
          className="bg-background text-base"
          {...invalid("message", failed?.error)}
        />
      </div>
      {data.turnstileSiteKey && <Turnstile siteKey={data.turnstileSiteKey} action="feedback" resetKey={answer} onReady={setBotOk} />}
      <FieldError id="message-error" message={failed?.error} />
      <Button type="submit" size="xl" disabled={busy || blocked}>
        {busy ? "Küldés…" : "Küldés"}
      </Button>
      <p className="m-0 text-caption text-muted-foreground">
        Választ vársz?{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
          {CONTACT_EMAIL}
        </a>
      </p>
    </FormTag>
  );
}

// A tennis ball (#446): the rating's mark, filled when chosen.
function Ball({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className="size-10">
      <circle cx="16" cy="16" r="14" className={on ? "fill-ball" : "fill-surface-3"} />
      <path d="M5 8.5c5 2.5 7 6.5 7 7.5s-2 5-7 7.5M27 8.5c-5 2.5-7 6.5-7 7.5s2 5 7 7.5" fill="none" strokeWidth="1.8" className={on ? "stroke-ball-foreground/40" : "stroke-surface-4"} />
    </svg>
  );
}

/**
 * "Hogy tetszik a Padelpárbaj?" (#446): 1–5 tennis balls and an optional
 * comment, stored as a rating. For logged-in players only (Kezdőlap's tip
 * card, Profil). `onSent`: the card hides itself.
 */
export function RatingDialog({
  children,
  onSent,
  onDismiss,
}: {
  children: React.ReactNode;
  onSent?: () => void;
  // Closed without sending (the tip card counts it as "Most nem", #446).
  onDismiss?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [round, setRound] = useState(0);
  const [rating, setRating] = useState(0);
  const location = useLocation();
  const sender = useFetcher<FeedbackAnswer>({ key: `rating-${round}` });
  const sent = sender.data?.ok === true && sender.state === "idle";
  const failed = sender.data && !sender.data.ok ? sender.data.error : null;
  useEffect(() => {
    if (sent) onSent?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sent]);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next && sent) {
          setRound((r) => r + 1);
          setRating(0);
        }
        if (!next && !sent) onDismiss?.();
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        {sent ? (
          <>
            <DialogHeader>
              <DialogTitle className="type-display text-[28px]">{THANKS_TITLE}</DialogTitle>
              <DialogDescription>Köszi, hogy szántál rá egy percet.</DialogDescription>
            </DialogHeader>
            <Button size="xl" onClick={() => setOpen(false)}>
              Bezárom
            </Button>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="type-display text-[28px]">Hogy tetszik a Padelpárbaj?</DialogTitle>
              <DialogDescription>Egytől öt labdáig.</DialogDescription>
            </DialogHeader>
            <sender.Form method="post" action="/feedback" className="grid gap-4">
              <input type="hidden" name="kind" value="rating" />
              <input type="hidden" name="from" value={location.pathname + location.search} />
              <RadioGroup
                name="rating"
                value={rating ? String(rating) : ""}
                onValueChange={(v) => setRating(Number(v))}
                aria-label="Értékelés"
                className="flex flex-wrap items-center gap-1"
              >
                {Array.from({ length: RATING_MAX }, (_, i) => i + 1).map((n) => (
                  <Label key={n} htmlFor={`rating-${n}`} className="relative cursor-pointer rounded-full p-0.5 has-focus-visible:outline-2 has-focus-visible:outline-ring">
                    <RadioGroupItem id={`rating-${n}`} value={String(n)} aria-label={`${n} labda: ${RATING_LABELS[n]}`} className="absolute inset-0 size-full rounded-full border-0 opacity-0" />
                    <Ball on={n <= rating} />
                  </Label>
                ))}
              </RadioGroup>
              <p className="m-0 min-h-5 text-sm font-semibold text-ball">{rating ? RATING_LABELS[rating] : ""}</p>
              <Label htmlFor="rating-message" className="sr-only">
                Mit javítanál?
              </Label>
              <Textarea id="rating-message" name="message" maxLength={MESSAGE_MAX} rows={3} placeholder="Mit javítanál? (nem kötelező)" className="bg-background text-base" />
              {failed && (
                <p role="alert" className="m-0 text-sm font-semibold text-danger">
                  {failed}
                </p>
              )}
              <Button type="submit" size="xl" disabled={!rating || sender.state !== "idle"}>
                Küldés
              </Button>
            </sender.Form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Visszajelzés in a dialog (#444): `children` is the trigger (a link-styled
 * button); `from` the page it is sent from (path and query). The form's data
 * comes from /feedback's loader when the dialog opens.
 */
export function FeedbackDialog({ from, children }: { from: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  // A sent message and its thank-you are gone on the next opening: a new round, a new fetcher.
  const [round, setRound] = useState(0);
  const loader = useFetcher<FeedbackFormData>();
  const sender = useFetcher<FeedbackAnswer>({ key: `feedback-${round}` });
  const navigation = useNavigation();
  useEffect(() => {
    if (open) loader.load(`/feedback?from=${encodeURIComponent(from)}`);
    // Only on opening: a page change while it is closed needs nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const answer = sender.data;
  const sent = answer?.ok === true && sender.state === "idle";
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next && sent) setRound((r) => r + 1);
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        {sent ? (
          <>
            <DialogHeader>
              <DialogTitle className="type-display text-[28px]">{THANKS_TITLE}</DialogTitle>
              <DialogDescription>{THANKS_TEXT}</DialogDescription>
            </DialogHeader>
            <Button size="xl" onClick={() => setOpen(false)}>
              Bezárom
            </Button>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="type-display text-[28px]">{FEEDBACK_TITLE}</DialogTitle>
              <DialogDescription>{FEEDBACK_INTRO}</DialogDescription>
            </DialogHeader>
            {loader.data ? (
              <FeedbackFields
                key={round}
                data={loader.data}
                failed={answer && !answer.ok ? answer : null}
                busy={sender.state !== "idle" || navigation.state === "submitting"}
                answer={answer}
                FormTag={sender.Form as typeof Form}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Betöltés…</p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
