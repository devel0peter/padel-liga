import type { Route } from "./+types/admin.outbox";
import { AppPage } from "~/components/app-page";
import { Badge } from "~/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { requirePermission } from "~/lib/auth/admin.server";
import { kindLabel } from "~/lib/email/outbox-view";
import { dailyLimit, outboxLog, sentLast24h } from "~/lib/email/outbox.server";
import { formatDateTime } from "~/lib/format";
import { SITE_NAME } from "~/lib/site";

// "Kimenő levelek" (#112): every email goes out by itself, so this is only
// the log, per kind: how many wait, went out and failed, with the newest
// failure's reason. No address, no buttons.

export function meta({}: Route.MetaArgs) {
  return [{ title: `Kimenő levelek – ${SITE_NAME}` }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requirePermission(request, { kind: "outbox.manage" });
  const [log, sent] = await Promise.all([outboxLog(), sentLast24h()]);
  return { log, sent, limit: dailyLimit() };
}

export default function AdminOutbox({ loaderData }: Route.ComponentProps) {
  const { log, sent, limit } = loaderData;
  return (
    <AppPage
      title="Kimenő levelek"
      description={`Minden levél magától megy ki, naponta legfeljebb ${limit}; ami ma nem fér bele, a következő napokon. Az elmúlt 24 órában ${sent} ment ki.`}
    >
      {log.length === 0 ? (
        <p className="py-10 text-center text-muted-foreground">Még nem ment ki levél.</p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fajta</TableHead>
                <TableHead className="text-right">Vár</TableHead>
                <TableHead className="text-right">Kiment</TableHead>
                <TableHead className="text-right">Hiba</TableHead>
                <TableHead>Utolsó hiba</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {log.map((k) => (
                <TableRow key={k.kind}>
                  <TableCell className="font-medium">{kindLabel(k.kind)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {k.waiting > 0 ? <Badge variant="outline">{k.waiting}</Badge> : 0}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{k.sent}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {k.failed > 0 ? <Badge variant="destructive">{k.failed}</Badge> : 0}
                  </TableCell>
                  <TableCell className="max-w-md text-xs whitespace-normal text-muted-foreground">
                    {k.lastError ? (
                      <>
                        {k.lastError.at && <span className="whitespace-nowrap">{formatDateTime(new Date(k.lastError.at))}: </span>}
                        <span className="break-words">{k.lastError.reason}</span>
                      </>
                    ) : (
                      "–"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </AppPage>
  );
}
