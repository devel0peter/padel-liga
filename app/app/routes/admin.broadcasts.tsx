import { Link } from "react-router";

import type { Route } from "./+types/admin.broadcasts";
import { AppPage } from "~/components/app-page";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { requirePermission } from "~/lib/auth/admin.server";
import { dailyLimit, listBroadcasts, suppressedSet } from "~/lib/email/outbox.server";
import { formatDateTime } from "~/lib/format";

export async function loader({ request }: Route.LoaderArgs) {
  await requirePermission(request, { kind: "broadcasts.send" });
  const [broadcasts, suppressed] = await Promise.all([listBroadcasts(), suppressedSet()]);
  return { broadcasts, unsubscribed: suppressed.size, limit: dailyLimit() };
}

export default function AdminBroadcasts({ loaderData }: Route.ComponentProps) {
  const { broadcasts, unsubscribed, limit } = loaderData;
  return (
    <AppPage
      title="Körlevelek"
      description={<>{unsubscribed} leiratkozott cím, nekik nem megy körlevél.</>}
      actions={
        <Button asChild>
          <Link to="/admin/broadcasts/new">Új körlevél</Link>
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">
        Címzetteket a <Link to="/admin/signups" className="underline">Jelentkezők</Link> oldalon szűrhetsz,
        onnan a „Levél nekik” gombbal. Az új körlevél azonnal indul. Naponta legfeljebb {limit} levél megy ki; a
        többi a következő napokon automatikusan.
      </p>

      {broadcasts.length === 0 ? (
        <p className="py-10 text-center text-muted-foreground">Még nem küldtél körlevelet.</p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Küldve</TableHead>
                <TableHead>Tárgy</TableHead>
                <TableHead>Címzettek</TableHead>
                <TableHead>Állapot</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {broadcasts.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                    {formatDateTime(new Date(b.createdAt))}
                  </TableCell>
                  <TableCell className="font-medium whitespace-normal">{b.subject}</TableCell>
                  <TableCell className="text-sm whitespace-normal">
                    {b.audience} ({b.recipients})
                  </TableCell>
                  <TableCell className="flex flex-wrap gap-1">
                    <Badge variant="secondary">{b.sent} kiment</Badge>
                    {b.pending > 0 && <Badge variant="outline">{b.pending} sorban</Badge>}
                    {b.failed > 0 && <Badge variant="destructive">{b.failed} hiba</Badge>}
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
