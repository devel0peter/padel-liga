import { describe, expect, it } from "vitest";

import { ReplyParser, smtpSend, type SmtpMessage, type SmtpReply, type SmtpTransport } from "./smtp";

// A scripted relay: answers each command like smtp-relay.gmail.com, refuses
// the recipients in `refuse`, and can drop the connection at a given step.
function fakeRelay(
  opts: { refuse?: string[]; auth?: number; greeting?: number; dropAfter?: string; dataReply?: number; dropAfterData?: boolean } = {},
) {
  const log: string[] = [];
  let tls = false;
  let inData = false;
  let pending: SmtpReply[] = [];
  let closed = false;
  const respond = (code: number, text = "OK") => pending.push({ code, text });

  const transport: SmtpTransport = {
    async write(data) {
      if (closed) throw new Error("connection closed");
      if (inData) {
        expect(data.endsWith("\r\n.\r\n")).toBe(true);
        log.push(`DATA:${data.length}`);
        inData = false;
        if (opts.dropAfterData) closed = true;
        else respond(opts.dataReply ?? 250, "2.0.0 OK");
        return;
      }
      const line = data.replace(/\r\n$/, "");
      log.push(tls || !line.startsWith("AUTH") ? line : `INSECURE ${line}`);
      const verb = line.split(/[ :]/)[0];
      if (opts.dropAfter && line.startsWith(opts.dropAfter)) {
        closed = true;
        return;
      }
      if (verb === "EHLO") respond(250, tls ? "smtp-relay.gmail.com\nAUTH LOGIN PLAIN" : "smtp-relay.gmail.com\nSTARTTLS");
      else if (verb === "STARTTLS") respond(220, "2.0.0 Ready to start TLS");
      else if (verb === "AUTH") respond(opts.auth ?? 235, "2.7.0 Accepted");
      else if (verb === "MAIL") respond(250);
      else if (verb === "RCPT") {
        const to = /<(.*)>/.exec(line)![1];
        respond(opts.refuse?.includes(to) ? 550 : 250, opts.refuse?.includes(to) ? "5.1.1 Invalid recipient" : "OK");
      } else if (verb === "DATA") {
        inData = true;
        respond(354, "Go ahead");
      } else if (verb === "RSET") respond(250);
      else if (verb === "QUIT") respond(221);
    },
    async reply() {
      if (closed) throw new Error("connection closed");
      const r = pending.shift();
      if (!r) throw new Error("no reply");
      return r;
    },
    async startTls() {
      log.push("<tls>");
      tls = true;
    },
    close() {
      log.push("<close>");
    },
  };
  pending.push({ code: opts.greeting ?? 220, text: "smtp-relay.gmail.com ESMTP" });
  return { transport, log };
}

const session = { hostname: "padelparbaj.hu", from: "hello@padelparbaj.hu", user: "peter@padelparbaj.hu", password: "pw" };
const msg = (to: string): SmtpMessage => ({ to, data: `Subject: x\r\n\r\nhi\r\n.\r\n`, id: `${to}-id` });

describe("ReplyParser", () => {
  it("joins a multi-line reply and handles replies split across chunks", () => {
    const p = new ReplyParser();
    expect(p.push("250-smtp-relay.gmail.com at your service\r\n250-STARTT")).toEqual([]);
    expect(p.push("LS\r\n250 SMTPUTF8\r\n354 Go")).toEqual([
      { code: 250, text: "smtp-relay.gmail.com at your service\nSTARTTLS\nSMTPUTF8" },
    ]);
    expect(p.push(" ahead\r\n")).toEqual([{ code: 354, text: "Go ahead" }]);
  });
});

describe("smtpSend", () => {
  it("upgrades to TLS before logging in, then sends each email in its own transaction", async () => {
    const { transport, log } = fakeRelay();
    const results = await smtpSend(async () => transport, session, [msg("a@x.hu"), msg("b@x.hu")]);
    expect(results).toEqual([
      { ok: true, id: "a@x.hu-id" },
      { ok: true, id: "b@x.hu-id" },
    ]);
    expect(log).toEqual([
      "EHLO padelparbaj.hu",
      "STARTTLS",
      "<tls>",
      "EHLO padelparbaj.hu",
      `AUTH PLAIN ${btoa("\0peter@padelparbaj.hu\0pw")}`,
      "MAIL FROM:<hello@padelparbaj.hu>",
      "RCPT TO:<a@x.hu>",
      "DATA",
      `DATA:${msg("a@x.hu").data.length}`,
      "MAIL FROM:<hello@padelparbaj.hu>",
      "RCPT TO:<b@x.hu>",
      "DATA",
      `DATA:${msg("b@x.hu").data.length}`,
      "QUIT",
      "<close>",
    ]);
  });

  it("fails only the refused recipient and carries on with the others", async () => {
    const { transport, log } = fakeRelay({ refuse: ["bad@x.hu"] });
    const results = await smtpSend(async () => transport, session, [msg("a@x.hu"), msg("bad@x.hu"), msg("c@x.hu")]);
    expect(results).toEqual([
      { ok: true, id: "a@x.hu-id" },
      { ok: false, error: "RCPT TO: 550 5.1.1 Invalid recipient" },
      { ok: true, id: "c@x.hu-id" },
    ]);
    expect(log).toContain("RSET");
  });

  it("fails every email with the reason when the login is refused", async () => {
    const { transport } = fakeRelay({ auth: 535 });
    const results = await smtpSend(async () => transport, session, [msg("a@x.hu"), msg("b@x.hu")]);
    expect(results).toEqual([
      { ok: false, error: "AUTH: 535 2.7.0 Accepted" },
      { ok: false, error: "AUTH: 535 2.7.0 Accepted" },
    ]);
  });

  it("fails every email when the relay can't be reached", async () => {
    const results = await smtpSend(
      async () => {
        throw new Error("connect ECONNREFUSED");
      },
      session,
      [msg("a@x.hu")],
    );
    expect(results).toEqual([{ ok: false, error: "connection: connect ECONNREFUSED" }]);
  });

  it("keeps what was sent and fails the rest when the connection drops mid-run", async () => {
    const { transport, log } = fakeRelay({ dropAfter: "RCPT TO:<b@x.hu>" });
    const results = await smtpSend(async () => transport, session, [msg("a@x.hu"), msg("b@x.hu"), msg("c@x.hu")]);
    expect(results).toEqual([
      { ok: true, id: "a@x.hu-id" },
      { ok: false, error: "connection: connection closed" },
      { ok: false, error: "connection: connection closed" },
    ]);
    expect(log.at(-1)).toBe("<close>");
  });

  it("marks the email in flight unknown when the answer to its message never comes, and fails the rest", async () => {
    const { transport } = fakeRelay({ dropAfterData: true });
    expect(await smtpSend(async () => transport, session, [msg("a@x.hu"), msg("b@x.hu")])).toEqual([
      { ok: false, error: "no answer after the message, it may have been sent: connection: connection closed", unknown: true },
      { ok: false, error: "connection: connection closed" },
    ]);
  });

  it("fails an email the relay doesn't accept after DATA", async () => {
    const { transport } = fakeRelay({ dataReply: 452 });
    expect(await smtpSend(async () => transport, session, [msg("a@x.hu")])).toEqual([
      { ok: false, error: "message: 452 2.0.0 OK" },
    ]);
  });

  it("does nothing for no emails", async () => {
    expect(
      await smtpSend(
        async () => {
          throw new Error("must not connect");
        },
        session,
        [],
      ),
    ).toEqual([]);
  });
});
