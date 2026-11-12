import { checkHealth, checkLine, writeLine } from "./check";

// The watchdog Worker (#318, D169): on every Cron Trigger (once a minute, see
// wrangler.jsonc) one check of the health address and one check line. It
// never throws, so every run leaves exactly one line.
export async function runCheck(url: string): Promise<void> {
  writeLine(checkLine(url, await checkHealth(url)));
}

export default {
  async scheduled(_controller, env) {
    await runCheck(env.HEALTH_URL);
  },
} satisfies ExportedHandler<Env>;
