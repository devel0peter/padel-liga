import { useEffect, useRef } from "react";

// Cloudflare Turnstile widget (app/lib/turnstile.ts). "interaction-only": most
// visitors see nothing; a checkbox appears only when Cloudflare isn't sure.
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
// so a retry gets a fresh token.
export function Turnstile({ siteKey, action, resetKey }: { siteKey: string; action: string; resetKey?: unknown }) {
  const el = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    loadTurnstile()
      .then((api) => {
        if (cancelled || !el.current) return;
        widgetId.current = api.render(el.current, {
          sitekey: siteKey,
          action,
          appearance: "interaction-only",
          language: "hu",
        });
      })
      .catch((error) => console.error(error));
    return () => {
      cancelled = true;
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = undefined;
    };
  }, [siteKey, action]);

  useEffect(() => {
    if (resetKey !== undefined && widgetId.current) window.turnstile?.reset(widgetId.current);
  }, [resetKey]);

  return <div ref={el} className="empty:hidden" />;
}
