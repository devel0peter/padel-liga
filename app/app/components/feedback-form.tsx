import { useEffect, useState } from "react";
import { Form, useFetcher, useNavigation } from "react-router";

import { FieldError, invalid } from "~/components/auth";
import { Turnstile } from "~/components/turnstile";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "~/components/ui/dialog";
import { Label } from "~/components/ui/label";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { Textarea } from "~/components/ui/textarea";
import { FORM_KINDS, KIND_LABELS, MESSAGE_MAX } from "~/lib/feedback";
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

export const FEEDBACK_INTRO = "Valami nem működik, vagy van egy ötleted? Írd meg nekünk.";
export const THANKS_TITLE = "Köszi, megkaptuk!";
export const THANKS_TEXT = "Elolvassuk, és ha kell, javítjuk.";

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
  const blocked = Boolean(data.turnstileSiteKey) && !botOk;
  const context = [
    ["Oldal", data.page || "–"],
    ["Időpont", data.sentAt],
    ["Eszköz", data.device],
    ["Böngésző", data.browser],
    ["Verzió", data.version],
    ...(data.account ? [["Fiók", data.account]] : []),
  ];
  return (
    <FormTag method="post" action="/feedback" className="grid gap-5">
      <input type="hidden" name="from" value={data.from} />
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-semibold">Miről szól?</legend>
        <RadioGroup name="kind" required defaultValue={failed?.kind || undefined} className="flex flex-wrap gap-x-6 gap-y-1">
          {FORM_KINDS.map((kind) => (
            <div key={kind} className="flex min-h-11 items-center gap-2">
              <RadioGroupItem id={`kind-${kind}`} value={kind} className="size-5" />
              <Label htmlFor={`kind-${kind}`} className="text-base font-normal">
                {KIND_LABELS[kind]}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </fieldset>
      <div className="grid gap-1.5">
        <Label htmlFor="message" className="font-semibold">
          Üzenet
        </Label>
        <Textarea
          id="message"
          name="message"
          required
          maxLength={MESSAGE_MAX}
          rows={5}
          defaultValue={failed?.message}
          className="bg-background text-base"
          {...invalid("message", failed?.error)}
        />
        <p className="text-sm text-muted-foreground">Ne írj bele jelszót, és mások személyes adatait se.</p>
      </div>
      <div className="grid gap-1.5 rounded-xl bg-surface-2 px-3.5 py-3 text-sm">
        <p className="font-semibold">Ezt küldjük el veled:</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-muted-foreground">
          {context.map(([label, value]) => (
            <div key={label} className="contents">
              <dt>{label}</dt>
              <dd className="min-w-0 break-words text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      {data.turnstileSiteKey && <Turnstile siteKey={data.turnstileSiteKey} action="feedback" resetKey={answer} onReady={setBotOk} />}
      <FieldError id="message-error" message={failed?.error} />
      <Button type="submit" size="xl" disabled={busy || blocked}>
        {busy ? "Küldés…" : "Küldés"}
      </Button>
      <p className="text-sm text-muted-foreground">
        E-mailben nem válaszolunk. Ha választ szeretnél, írj ide:{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
          {CONTACT_EMAIL}
        </a>
        .
      </p>
    </FormTag>
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
              <DialogTitle className="type-display text-[28px]">Visszajelzés</DialogTitle>
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
