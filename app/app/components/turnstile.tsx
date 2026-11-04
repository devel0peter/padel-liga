import { useEffect, useRef, useState } from "react";

import { TURNSTILE_HINT } from "~/lib/turnstile";

// Cloudflare Turnstile widget (app/lib/turnstile.ts). Always visible (#255):
// the player sees it working, the tick box when Cloudflare asks for one, and
// its result, instead of a hidden check that can hang without a trace.
// The widget adds the hidden `cf-turnstile-response` field to the form.

type TurnstileApi = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string | undefined;
  reset: (id: string) => void;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
// Most checks pass in a second or two; past this the player gets the hint.
const SLOW_MS = 15_000;
let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile missing")));
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("turnstile script failed to load"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

// A token is single use: change `resetKey` after the server has checked one,
// so a retry gets a fresh token. `onReady` tells the form whether it holds a
// valid token, so it can keep the send button disabled until then.
export function Turnstile({
  siteKey,
  action,
  resetKey,
  onReady,
}: {
  siteKey: string;
  action: string;
  resetKey?: unknown;
  onReady?: (ready: boolean) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | undefined>(undefined);
  const ready = useRef(false);
  const [stuck, setStuck] = useState(false);
  // The script itself didn't load (blocked or offline): no widget to show.
  const [noScript, setNoScript] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  function setReady(value: boolean) {
    ready.current = value;
    onReadyRef.current?.(value);
    if (value) setStuck(false);
  }

  function startTimer() {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!ready.current) setStuck(true);
    }, SLOW_MS);
  }

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    startTimer();
    loadTurnstile()
      .then((api) => {
        if (cancelled || !el.current) return;
        widgetId.current = api.render(el.current, {
          sitekey: siteKey,
          action,
          appearance: "always",
          size: "flexible",
          language: "hu",
          "refresh-expired": "auto",
          callback: () => setReady(true),
          "expired-callback": () => setReady(false),
          "timeout-callback": () => setReady(false),
          "error-callback": () => {
            setReady(false);
            setStuck(true);
          },
        });
      })
      .catch((error) => {
        console.error(error);
        if (cancelled) return;
        setNoScript(true);
        setStuck(true);
      });
    return () => {
      cancelled = true;
      clearTimeout(timer.current);
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = undefined;
    };
    // setReady and startTimer only touch refs and state setters.
  }, [siteKey, action]);

  useEffect(() => {
    if (resetKey === undefined || !widgetId.current) return;
    setReady(false);
    setStuck(false);
    startTimer();
    window.turnstile?.reset(widgetId.current);
  }, [resetKey]);

  return (
    <div className="grid gap-2">
      <div ref={el} className={noScript ? "hidden" : "min-h-[65px]"} />
      {stuck && (
        <p role="status" className="text-sm text-muted-foreground">
          {noScript && "Nem töltött be a robotszűrő. "}
          {TURNSTILE_HINT}
        </p>
      )}
    </div>
  );
}
