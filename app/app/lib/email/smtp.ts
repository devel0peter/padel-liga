// A minimal SMTP client (RFC 5321) for Google's SMTP relay: EHLO, STARTTLS,
// AUTH PLAIN, then one transaction per email over the same connection. Pure:
// the connection is passed in (smtp.server.ts opens a Cloudflare TCP socket),
// so the dialogue can be tested against a scripted server.

export type SmtpReply = { code: number; text: string };

export interface SmtpTransport {
  write(data: string): Promise<void>;
  // The next complete reply; rejects when the connection closes or times out.
  reply(): Promise<SmtpReply>;
  // Upgrades the connection to TLS (after the server's 220 to STARTTLS).
  startTls(): Promise<void>;
  close(): void;
}

// Splits what the server sends into replies. A multi-line reply is
// "250-first", "250-second", "250 last"; it is complete at the line whose
// fourth character is a space.
export class ReplyParser {
  private buffer = "";
  private lines: string[] = [];

  push(chunk: string): SmtpReply[] {
    this.buffer += chunk;
    const replies: SmtpReply[] = [];
    let end: number;
    while ((end = this.buffer.indexOf("\r\n")) >= 0) {
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      this.lines.push(line.slice(4));
      if (line[3] !== "-") {
        replies.push({ code: Number(line.slice(0, 3)) || 0, text: this.lines.join("\n") });
        this.lines = [];
      }
    }
    return replies;
  }
}

export type SmtpMessage = {
  to: string;
  // The whole message (mime.ts buildMessage), dot-stuffed and ended with
  // "\r\n.\r\n" (smtpData).
  data: string;
  // Our Message-ID, the email's id once sent.
  id: string;
};

// unknown: the whole message was written but the relay's answer never came
// (timeout, dropped connection). It may have been accepted, so it must not be
// sent again anywhere.
export type SmtpResult = { ok: true; id: string } | { ok: false; error: string; unknown?: true };

export type SmtpSession = {
  // Our name in EHLO.
  hostname: string;
  // The envelope sender (MAIL FROM).
  from: string;
  user: string;
  password: string;
};

class SmtpError extends Error {}

const utf8Base64 = (s: string) => {
  let bin = "";
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  return btoa(bin);
};

// Sends each message in its own transaction and returns one result per
// message, in order. A refused recipient or message fails only that email
// (RSET, then the next one). A connection, TLS or login failure fails every
// email not sent yet with the same reason; the email in flight at that moment
// is "unknown" once its message was written.
export async function smtpSend(
  open: () => Promise<SmtpTransport>,
  session: SmtpSession,
  messages: SmtpMessage[],
): Promise<SmtpResult[]> {
  const results: SmtpResult[] = [];
  if (messages.length === 0) return results;
  let transport: SmtpTransport | null = null;
  let inFlight = false;

  const command = async (line: string | null, expected: number[], what: string): Promise<SmtpReply> => {
    if (line !== null) await transport!.write(`${line}\r\n`);
    const reply = await transport!.reply();
    if (!expected.includes(reply.code)) throw new SmtpError(`${what}: ${reply.code} ${reply.text}`.trim());
    return reply;
  };

  try {
    transport = await open();
    await command(null, [220], "greeting");
    await command(`EHLO ${session.hostname}`, [250], "EHLO");
    await command("STARTTLS", [220], "STARTTLS");
    await transport.startTls();
    await command(`EHLO ${session.hostname}`, [250], "EHLO");
    await command(`AUTH PLAIN ${utf8Base64(`\0${session.user}\0${session.password}`)}`, [235], "AUTH");

    for (const m of messages) {
      try {
        await command(`MAIL FROM:<${session.from}>`, [250], "MAIL FROM");
        await command(`RCPT TO:<${m.to}>`, [250, 251], "RCPT TO");
        await command("DATA", [354], "DATA");
        inFlight = true;
        await transport.write(m.data);
        const reply = await transport.reply();
        inFlight = false;
        if (reply.code !== 250) throw new SmtpError(`message: ${reply.code} ${reply.text}`.trim());
        results.push({ ok: true, id: m.id });
      } catch (e) {
        if (!(e instanceof SmtpError)) throw e;
        results.push({ ok: false, error: e.message });
        await command("RSET", [250], "RSET");
      }
    }
    await transport.write("QUIT\r\n").catch(() => {});
  } catch (e) {
    const error = e instanceof SmtpError ? e.message : `connection: ${e instanceof Error ? e.message : String(e)}`;
    if (inFlight && results.length < messages.length)
      results.push({ ok: false, error: `no answer after the message, it may have been sent: ${error}`, unknown: true });
    while (results.length < messages.length) results.push({ ok: false, error });
  } finally {
    transport?.close();
  }
  return results;
}
