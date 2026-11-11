import { Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { data, Link, useFetcher } from "react-router";

import type { Route } from "./+types/admin.user";
import { AppPage } from "~/components/app-page";
import { ChangeDialog, CreateDialog, DissolveButton, EntryCell } from "~/components/pair-actions";
import { PersonLink } from "~/components/person-link";
import { PhoneLink } from "~/components/phone-link";
import { StatusChips } from "~/components/status-chips";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { requirePermission } from "~/lib/auth/admin.server";
import { can } from "~/lib/auth/permissions";
import { SEXES } from "~/lib/auth/rules";
import { auditLogPage } from "~/lib/audit-log.server";
import { personCommsLog } from "~/lib/email/comms-log.server";
import { COMMS_LOG_LIMIT, suppressionNote, VIA_LABELS } from "~/lib/email/delivery";
import { formatDate, formatDateTime } from "~/lib/format";
import { LEVELS } from "~/lib/interest";
import { DISSOLVE_REFUSED, SOURCE_LABELS } from "~/lib/pairs";
import { adminPlayerProfile, setSeekingByAdmin, updatePlayerByAdmin } from "~/lib/player-admin.server";
import { LEVEL_LOCKED_ADMIN, type AdminProfileErrors } from "~/lib/player-admin";
import { ENTRY_STATUS_LABELS } from "~/lib/season-entries";
import { levelLabel } from "~/lib/signups-admin";
import { SITE_NAME } from "~/lib/site";

// A player's profile for the Admin (#301, D156): every admin page links a
// player's name here. Name, email, phone, level, sex, role, login; the pair
// per league with Párok's actions (they post to Párok, so the same server
// functions run); "Párt keresek"; every pair with its entries; every email
// sent to them and what became of it (#242); the Napló entries about them. Admin only: it shows the email address, and only the
// Admin edits someone else's account. An anonymized or deleted account has
// no profile (404).

export function meta({ loaderData: d }: Route.MetaArgs) {
  return [{ title: `${d?.profile.name || "Játékos"} – ${SITE_NAME}` }, { name: "robots", content: "noindex, nofollow" }];
}

const LOG_ROWS = 20;

export async function loader({ request, params }: Route.LoaderArgs) {
  const actor = await requirePermission(request, { kind: "users.view" });
  const profile = await adminPlayerProfile(params.id);
  if (!profile) throw data("Nincs ilyen fiók.", { status: 404 });
  const [log, mail] = await Promise.all([
    auditLogPage({ action: null, actor: null, league: null, from: null, to: null, page: 1, person: profile.id }),
    // The email log (#242): Admin only, like the whole profile.
    personCommsLog(profile.email),
  ]);
  return {
    profile,
    mail,
    log: { rows: log.rows.slice(0, LOG_ROWS), total: log.total },
    canEdit: can(actor, { kind: "users.edit" }),
    canMail: can(actor, { kind: "broadcasts.send" }),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const actor = await requirePermission(request, { kind: "users.edit" });
  const form = await request.formData();
  const intent = form.get("intent");
  if (intent === "edit") {
    const result = await updatePlayerByAdmin(actor.id, params.id, {
      name: form.get("name"),
      phone: form.get("phone"),
      level: form.get("level"),
      sex: form.get("sex"),
    });
    return result.ok ? { intent: "edit" as const, ok: true as const, changed: result.changed } : { intent: "edit" as const, errors: result.errors };
  }
  if (intent === "seeking") {
    const ok = await setSeekingByAdmin(actor.id, params.id, Number(form.get("league")), form.get("seeking") === "1");
    if (!ok) throw new Response("Hibás kérés.", { status: 400 });
    return { intent: "seeking" as const, ok: true as const };
  }
  throw new Response("Hibás kérés.", { status: 400 });
}

type Profile = Route.ComponentProps["loaderData"]["profile"];
type EditResult = { intent: "edit"; ok?: true; changed?: number; errors?: AdminProfileErrors };

function FieldError({ text }: { text?: string }) {
  return text ? <p className="text-sm font-semibold text-destructive">{text}</p> : null;
}

const NONE = "none";

// "Adatok módosítása" (#301, D156): name, phone, level, sex. Napló records
// which fields changed. A locked level (D79) is shown, not offered.
function EditDialog({ profile }: { profile: Profile }) {
  const fetcher = useFetcher<EditResult>();
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState(profile.editable.level ?? NONE);
  const [sex, setSex] = useState(profile.editable.sex ?? "");
  const errors = fetcher.data?.errors ?? {};
  const busy = fetcher.state !== "idle";
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) setOpen(false);
  }, [fetcher.state, fetcher.data]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Adatok módosítása</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{profile.name} adatai</DialogTitle>
          <DialogDescription>
            A változás a Naplóba kerül (csak az, hogy mi változott). A játékos nem kap róla értesítést. Az e-mail-címet itt
            nem lehet módosítani.
          </DialogDescription>
        </DialogHeader>
        <fetcher.Form method="post" className="grid gap-4" id="profile-edit">
          <input type="hidden" name="intent" value="edit" />
          <div className="grid gap-1.5">
            <Label htmlFor="edit-name">Név</Label>
            <Input id="edit-name" name="name" defaultValue={profile.editable.name} maxLength={80} required />
            <FieldError text={errors.name} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-phone">Telefonszám</Label>
            <Input id="edit-phone" name="phone" type="tel" defaultValue={profile.phone} placeholder="+36 30 123 4567" />
            <FieldError text={errors.phone} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-level">Szint</Label>
            {profile.levelLocked ? (
              <p className="text-sm text-muted-foreground">
                {profile.editable.level ? levelLabel(profile.editable.level) : "Nincs megadva"}. {LEVEL_LOCKED_ADMIN}
              </p>
            ) : (
              <>
                <input type="hidden" name="level" value={level === NONE ? "" : level} />
                <Select value={level} onValueChange={setLevel}>
                  <SelectTrigger id="edit-level" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {!profile.editable.level && <SelectItem value={NONE}>Nincs megadva</SelectItem>}
                    {Object.entries(LEVELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}
            <FieldError text={errors.level} />
          </div>
          <div className="grid gap-1.5">
            <Label>Nem</Label>
            <input type="hidden" name="sex" value={sex} />
            <RadioGroup value={sex} onValueChange={setSex} className="flex gap-4">
              {Object.entries(SEXES).map(([value, label]) => (
                <div key={value} className="flex items-center gap-2">
                  <RadioGroupItem id={`edit-sex-${value}`} value={value} />
                  <Label htmlFor={`edit-sex-${value}`} className="font-normal">
                    {label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
            <FieldError text={errors.sex} />
          </div>
        </fetcher.Form>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Mégse</Button>
          </DialogClose>
          <Button type="submit" form="profile-edit" disabled={busy}>
            Mentés
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

const missing = <span className="text-muted-foreground">nincs megadva</span>;

function Facts({ profile }: { profile: Profile }) {
  const e = profile.editable;
  return (
    <section aria-labelledby="adatok" className="grid gap-3 rounded-lg border p-4 sm:p-6">
      <h2 id="adatok" className="font-display text-lg font-bold">
        Adatok
      </h2>
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Fact label="E-mail">{profile.email}</Fact>
        <Fact label="Telefon">{profile.phone ? <PhoneLink phone={profile.phone} /> : missing}</Fact>
        <Fact label="Szint">
          {e.level ? levelLabel(e.level) : missing}
          {profile.levelLocked && <span className="text-xs text-muted-foreground"> · lezárult</span>}
        </Fact>
        <Fact label="Nem">{e.sex ? SEXES[e.sex] : missing}</Fact>
        <Fact label="Szerep">
          {profile.role}
          {profile.organizes.length > 0 && <span className="text-muted-foreground"> ({profile.organizes.join(", ")})</span>}
        </Fact>
        <Fact label="Belépés">{profile.google ? "Google, kód" : "Kód"}</Fact>
        <Fact label="Regisztrált">{formatDateTime(new Date(profile.createdAt))}</Fact>
        <Fact label="Utolsó belépés">{profile.lastLoginAt ? formatDateTime(new Date(profile.lastLoginAt)) : "–"}</Fact>
        <Fact label="Állapot">
          <StatusChips chips={profile.status} />
        </Fact>
      </dl>
    </section>
  );
}

function SeekingSwitch({ leagueId, seeking, canEdit }: { leagueId: number; seeking: boolean; canEdit: boolean }) {
  const fetcher = useFetcher();
  const pending = fetcher.formData?.get("seeking");
  const on = pending === undefined || pending === null ? seeking : pending === "1";
  const id = `seeking-${leagueId}`;
  return (
    <div className="flex items-center gap-2">
      <Switch
        id={id}
        checked={on}
        disabled={!canEdit || fetcher.state !== "idle"}
        onCheckedChange={(v) => fetcher.submit({ intent: "seeking", league: String(leagueId), seeking: v ? "1" : "0" }, { method: "post" })}
      />
      <Label htmlFor={id} className="font-normal">
        Párt keres
      </Label>
    </div>
  );
}

// Per league: the active pair with Párok's actions, or "Nincs párja" with
// "Párt keresek" and "Párba teszem".
function Leagues({ profile, canEdit }: { profile: Profile; canEdit: boolean }) {
  return (
    <section aria-labelledby="ligak" className="grid gap-3">
      <h2 id="ligak" className="font-display text-lg font-bold">
        Ligák
      </h2>
      {profile.leagues.length === 0 ? (
        <p className="text-sm text-muted-foreground">Még egy ligához sem csatlakozott.</p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {profile.leagues.map((l) => {
            const pairs = `/admin/leagues/${l.slug}/pairs`;
            const partner = l.pair?.players.find((p) => p.id !== profile.id);
            return (
              <div key={l.id} className="grid content-start gap-3 rounded-lg border p-4" data-testid={`league-${l.slug}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link to={`/admin/leagues/${l.slug}/players`} className="font-medium">
                    {l.name}
                  </Link>
                  {l.pair ? <Badge>Van párja</Badge> : <Badge variant="outline">Nincs párja</Badge>}
                </div>
                {l.pair && partner ? (
                  <>
                    <p className="text-sm">
                      Párja: <PersonLink id={partner.id} name={partner.name} className="font-medium" />
                    </p>
                    <EntryCell pair={l.pair} action={pairs} />
                    <div className="flex flex-wrap gap-1">
                      <ChangeDialog pair={l.pair} candidates={l.candidates} action={pairs} />
                      <DissolveButton pair={l.pair} action={pairs} />
                    </div>
                    {l.pair.locked && <p className="text-xs text-muted-foreground">{DISSOLVE_REFUSED}</p>}
                  </>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <SeekingSwitch leagueId={l.id} seeking={l.seeking} canEdit={canEdit} />
                    <CreateDialog
                      candidates={l.candidates}
                      fixed={{ id: profile.id, name: profile.name, level: profile.editable.level }}
                      action={pairs}
                      label="Párba teszem"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function PairHistory({ profile }: { profile: Profile }) {
  return (
    <section aria-labelledby="parok" className="grid gap-3">
      <h2 id="parok" className="font-display text-lg font-bold">
        Párok és nevezések
      </h2>
      {profile.pairs.length === 0 ? (
        <p className="text-sm text-muted-foreground">Még nem volt párja.</p>
      ) : (
        <div className="rounded-lg border">
          <Table aria-label="Párjai">
            <TableHeader>
              <TableRow>
                <TableHead>Partner</TableHead>
                <TableHead className="hidden sm:table-cell">Liga</TableHead>
                <TableHead>Állapot</TableHead>
                <TableHead>Nevezések</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profile.pairs.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="whitespace-normal">
                    <PersonLink id={p.partner.deleted ? null : p.partner.id} name={p.partner.deleted ? "Törölt játékos" : p.partner.name} />
                    <div className="text-xs text-muted-foreground">{SOURCE_LABELS[p.source]}</div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{p.league}</TableCell>
                  <TableCell className="text-sm whitespace-normal">
                    {p.status === "active" ? "Aktív" : "Felbontva"}
                    <div className="text-xs text-muted-foreground">
                      {formatDate(new Date(p.createdAt))} – {p.dissolvedAt ? formatDate(new Date(p.dissolvedAt)) : ""}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm whitespace-normal">
                    {p.entries.length === 0
                      ? "–"
                      : p.entries.map((e) => (
                          <div key={e.season}>
                            {e.season}: {ENTRY_STATUS_LABELS[e.status]}
                          </div>
                        ))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

const TONE = { ok: "secondary", todo: "outline", bad: "destructive", muted: "outline" } as const;

// Every email made for their address, newest first (#242, D157): made and
// sent (Budapest time), kind, subject, how it went out and what became of it.
// Only this person's address is on the page (in Adatok); subjects and
// failure reasons have every address hidden.
function MailLog({ mail }: { mail: Route.ComponentProps["loaderData"]["mail"] }) {
  const blocked = suppressionNote(mail.suppression ? { ...mail.suppression, since: new Date(mail.suppression.since) } : null);
  return (
    <section aria-labelledby="levelek" className="grid gap-3">
      <h2 id="levelek" className="font-display text-lg font-bold">
        Levelek
      </h2>
      {blocked && (
        <p role="status" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          {blocked}
        </p>
      )}
      {mail.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Még nem kapott tőlünk levelet.</p>
      ) : (
        <>
          {mail.total > mail.rows.length && (
            <p className="text-sm text-muted-foreground">
              A legújabb {COMMS_LOG_LIMIT} a {mail.total} levélből.
            </p>
          )}
          <div className="rounded-lg border">
            <Table aria-label="Levelei">
              <TableHeader>
                <TableRow>
                  <TableHead>Levél</TableHead>
                  <TableHead className="hidden sm:table-cell">Elkészült</TableHead>
                  <TableHead className="hidden sm:table-cell">Kiment</TableHead>
                  <TableHead>Állapot</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mail.rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="min-w-48 whitespace-normal">
                      <div className="font-medium">{r.kindLabel}</div>
                      <div className="text-sm break-words text-muted-foreground">{r.subject}</div>
                      <div className="text-xs text-muted-foreground tabular-nums sm:hidden">
                        {formatDateTime(new Date(r.createdAt))}
                        {r.sentAt && ` · kiment: ${formatDateTime(new Date(r.sentAt))}`}
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-sm whitespace-nowrap tabular-nums sm:table-cell">{formatDateTime(new Date(r.createdAt))}</TableCell>
                    <TableCell className="hidden text-sm whitespace-nowrap tabular-nums sm:table-cell">
                      {r.sentAt ? formatDateTime(new Date(r.sentAt)) : "–"}
                      {r.via && <div className="text-xs text-muted-foreground">{VIA_LABELS[r.via]}</div>}
                    </TableCell>
                    <TableCell className="min-w-40 whitespace-normal">
                      <Badge variant={TONE[r.tone]}>{r.status}</Badge>
                      {r.deliveryAt && <div className="text-xs text-muted-foreground tabular-nums">{formatDateTime(new Date(r.deliveryAt))}</div>}
                      {r.note && <div className="text-xs break-words text-muted-foreground">{r.note}</div>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </section>
  );
}

function Log({ log, id }: { log: Route.ComponentProps["loaderData"]["log"]; id: string }) {
  return (
    <section aria-labelledby="naplo" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="naplo" className="font-display text-lg font-bold">
          Napló
        </h2>
        {log.total > log.rows.length && (
          <Link to={`/admin/log?person=${encodeURIComponent(id)}`} className="text-sm">
            Mind a {log.total} bejegyzés a Naplóban
          </Link>
        )}
      </div>
      {log.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Még nincs róla bejegyzés.</p>
      ) : (
        <ol className="grid gap-2 text-sm">
          {log.rows.map((r) => (
            <li key={r.id} className="grid gap-0.5 rounded-lg border p-3">
              <span className="text-xs text-muted-foreground tabular-nums">
                {formatDateTime(new Date(r.at))} · {r.actor}
                {r.league && ` · ${r.league}`}
              </span>
              <span>
                <span className="font-medium">{r.actionLabel}</span>
                {r.target && `: ${r.target}`}
              </span>
              {r.detail && <span className="text-muted-foreground">{r.detail}</span>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export default function AdminUser({ loaderData }: Route.ComponentProps) {
  const { profile, log, mail, canEdit, canMail } = loaderData;
  return (
    <AppPage
      title={profile.name || "Névtelen"}
      description={`${profile.role} · ${profile.email}`}
      back={{ to: "/admin/users", label: "Felhasználók" }}
      actions={
        <div className="flex flex-wrap gap-2">
          {canMail && (
            <Button variant="outline" asChild>
              <Link to={`/admin/broadcasts/new?user=${encodeURIComponent(profile.id)}`}>
                <Mail /> Levél neki
              </Link>
            </Button>
          )}
          {canEdit && <EditDialog profile={profile} />}
        </div>
      }
    >
      <Facts profile={profile} />
      <Leagues profile={profile} canEdit={canEdit} />
      <PairHistory profile={profile} />
      <MailLog mail={mail} />
      <Log log={log} id={profile.id} />
    </AppPage>
  );
}
