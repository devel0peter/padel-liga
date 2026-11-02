// The login code step (#123) on a real SQLite (~/test/sqlite): the real
// action sends (or skips) the code, then the page is rendered from what the
// action returned. The code step must look the same for every address, sent
// or skipped, and name the other ways in: Google login (when set up) and the
// contact address. The login code email is stubbed; nothing leaves the process.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  raw: null as any,
  limit: 8, // cap for new, uninvited addresses: 2
  codes: [] as string[],
  env: { GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", TURNSTILE_SITE_KEY: "" } as Record<string, string>,
}));

vi.mock("cloudflare:workers", () => ({ env: h.env }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/email/outbox.server", () => ({
  dailyLimit: () => h.limit,
  queueLoginCode: async (to: string) => {
    h.codes.push(to);
    h.raw
      .prepare("insert into email_messages (kind, to_email, subject, created_at) values ('login_code', ?, 'kód', ?)")
      .run(to, Math.floor(Date.now() / 1000));
  },
}));

const { migratedDatabase } = await import("~/test/sqlite");
const R = await import("~/routes/login");
type AuthMode = import("~/routes/login").AuthMode;

const args = (request: Request) => ({ request, params: {}, context: {} }) as any;
const run = (q: string, ...p: unknown[]) => h.raw.prepare(q).run(...p);

async function requestCode(email: string) {
  const body = new URLSearchParams({ email, returnTo: "/home", intent: "send" });
  return R.action(args(new Request("http://localhost/login", { method: "POST", body })));
}

async function render(mode: AuthMode, actionData: unknown): Promise<string> {
  const loaderData = await R.loader(args(new Request("http://localhost/login?returnTo=/home")));
  const Stub = createRoutesStub([
    { path: "/login", Component: () => createElement(R.AuthForm, { loaderData, actionData, mode } as any) },
  ]);
  return renderToStaticMarkup(createElement(Stub, { initialEntries: ["/login"] }));
}

// The "Nem jött meg?" line as plain text.
function hint(html: string): string {
  const p = html.match(/<p[^>]*>Nem jött meg\?.*?<\/p>/s)?.[0] ?? "";
  return p.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");
}

beforeEach(() => {
  h.raw = migratedDatabase();
  h.codes = [];
  h.env.GOOGLE_CLIENT_ID = "";
  h.env.GOOGLE_CLIENT_SECRET = "";
});

describe("code step hint (#123)", () => {
  it("names Google login and the contact address, the address as a mailto link", async () => {
    h.env.GOOGLE_CLIENT_ID = "id";
    h.env.GOOGLE_CLIENT_SECRET = "secret";
    const html = await render("login", await requestCode("anna@example.com"));
    expect(hint(html)).toBe(
      "Nem jött meg? Nézd meg a spam mappát is, adj meg másik címet, lépj be Google-lel, vagy írj nekünk: hello@padelparbaj.hu.",
    );
    expect(html).toContain('<a href="/auth/google?returnTo=%2Fhome" class="underline">lépj be Google-lel</a>');
    expect(html).toContain('<a href="mailto:hello@padelparbaj.hu" class="underline">hello@padelparbaj.hu</a>');
  });

  it("uses the registration words on /register", async () => {
    h.env.GOOGLE_CLIENT_ID = "id";
    h.env.GOOGLE_CLIENT_SECRET = "secret";
    const html = await render("register", await requestCode("anna@example.com"));
    expect(hint(html)).toBe(
      "Nem jött meg? Nézd meg a spam mappát is, adj meg másik címet, regisztrálj Google-lel, vagy írj nekünk: hello@padelparbaj.hu.",
    );
  });

  it("leaves Google out when Google login is not set up, and still names the contact address", async () => {
    h.env.GOOGLE_CLIENT_ID = "id"; // no secret: not set up
    const html = await render("login", await requestCode("anna@example.com"));
    expect(hint(html)).toBe("Nem jött meg? Nézd meg a spam mappát is, adj meg másik címet, vagy írj nekünk: hello@padelparbaj.hu.");
    expect(html).not.toContain("/auth/google");
    expect(html).toContain('href="mailto:hello@padelparbaj.hu"');
  });

  for (const google of [true, false]) {
    it(`looks identical for an account, a new address, one past the daily cap and one that bounced (Google ${google ? "on" : "off"})`, async () => {
      if (google) Object.assign(h.env, { GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" });
      run("insert into users (id, email, name) values ('u1', 'fiok@example.com', 'Fiók')");
      run("insert into email_suppressions (email, reason) values ('visszapattant@example.com', 'bounced')");
      // Two codes to new addresses use up the cap of 2.
      const cases = ["fiok@example.com", "uj1@example.com", "uj2@example.com", "korlat@example.com", "visszapattant@example.com"];
      const results = [];
      for (const email of cases) results.push(await requestCode(email));

      // Only the account and the first two new addresses got a code.
      expect(h.codes).toEqual(["fiok@example.com", "uj1@example.com", "uj2@example.com"]);
      for (const [i, email] of cases.entries()) expect(results[i]).toEqual({ step: "code", email, resent: false });

      const pages = await Promise.all(
        results.map(async (r, i) => (await render("login", r)).replaceAll(cases[i]!, "CIM")),
      );
      expect(pages[0]).toContain("Nézd meg a leveleidet");
      expect(pages[0]).toContain("CIM");
      // Account, new and sent (twice), past the cap, bounced: all the same page.
      for (const page of pages.slice(1)) expect(page).toBe(pages[0]);
    });
  }

  it("stays identical after wrong codes and resends, up to the code limits", async () => {
    run("insert into users (id, email, name) values ('u1', 'fiok@example.com', 'Fiók')");
    run("insert into email_suppressions (email, reason) values ('visszapattant@example.com', 'bounced')");
    const cases = ["fiok@example.com", "uj1@example.com", "uj2@example.com", "korlat@example.com", "visszapattant@example.com"];
    // Nobody types a code that could be right: a wrong one, never sent.
    const wrong = async (email: string) => {
      const sent = h.codes.includes(email);
      return post({ email, intent: "verify", code: sent ? "000000" : "123456" });
    };
    const steps = async (email: string) => {
      const out: unknown[] = [await requestCode(email)];
      out.push(await wrong(email));
      // 5 codes per hour: 4 more resends work, the 5th is refused.
      for (let i = 0; i < 5; i++) out.push(await post({ email, intent: "resend" }));
      // 5 attempts per code: the 6th wrong code finds it locked.
      for (let i = 0; i < 6; i++) out.push(await wrong(email));
      return out;
    };
    const runs = [];
    for (const email of cases) runs.push(await steps(email));

    const masked = await Promise.all(
      runs.map(async (results, i) => {
        const pages = await Promise.all(results.map((r) => render("login", r)));
        return JSON.stringify({ results, pages }).replaceAll(cases[i]!, "CIM");
      }),
    );
    // The account's run shows each message: wrong code, new code sent, too
    // many codes, locked.
    expect(masked[0]).toContain("Ez nem jó kód.");
    expect(masked[0]).toContain("Új kódot küldtünk.");
    expect(masked[0]).toContain("Túl sok kódot kértél.");
    expect(masked[0]).toContain("Túl sok hibás próbálkozás.");
    for (const run of masked.slice(1)) expect(run).toBe(masked[0]);
  });
});

async function post(fields: Record<string, string>) {
  const body = new URLSearchParams({ returnTo: "/home", ...fields });
  return R.action(args(new Request("http://localhost/login", { method: "POST", body })));
}
