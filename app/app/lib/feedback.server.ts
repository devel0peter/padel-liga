// Feedback in the database (spec 19, D94): storing a message with its
// context under the rate limits (#239), the form's submit (#240) and the
// Admin's Visszajelzések list (#241). Nothing here sends mail, push or a
// notification, to anyone.
import { and, count, desc, eq, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { db } from "~/db/client.server";
import { rowSelect } from "~/db/insert-select";
import { feedback, users } from "~/db/schema";

import { APP_VERSION } from "./app-version";
import { auditIfChanged } from "./audit.server";
import {
  browserFamily,
  deviceClass,
  ERRORS,
  FEEDBACK_PAGE_SIZE,
  feedbackCounts,
  isFormKind,
  pagePath,
  rateLimits,
  validateFeedback,
  type DeviceClass,
  type FeedbackCounts,
  type FeedbackFilters,
  type FeedbackInput,
  type FeedbackKind,
} from "./feedback";
import { logInfo, logWarn } from "./log";
import { turnstileError } from "./turnstile";
import { verifyTurnstile } from "./turnstile.server";

export type NewFeedback = FeedbackInput & {
  page: string;
  device: DeviceClass;
  browser: string;
  appVersion: string;
  userId: string | null;
};

const unix = (d: Date) => Math.floor(d.getTime() / 1000);

// Stores one message if its sender is within the rate limits (feedback.ts
// rateLimits: an account's own messages, or all visitors' together). The
// count and the insert are one statement, so two sends at once can't both
// slip past the limit. Returns the new id, or null over the limit.
export async function storeFeedback(input: NewFeedback, now = new Date()): Promise<number | null> {
  const at = unix(now);
  const owner = input.userId === null ? isNull(feedback.userId) : eq(feedback.userId, input.userId);
  const within = rateLimits(input.userId).map(
    (w) => sql`(select count(*) from ${feedback} where ${owner} and ${feedback.createdAt} > ${at - w.seconds}) < ${w.max}`,
  );
  const [row] = await db
    .insert(feedback)
    .select(
      rowSelect(
        feedback,
        {
          id: sql`null`,
          kind: sql`${input.kind}`,
          message: sql`${input.message}`,
          rating: sql`${input.rating}`,
          page: sql`${input.page}`,
          device: sql`${input.device}`,
          browser: sql`${input.browser}`,
          appVersion: sql`${input.appVersion}`,
          userId: sql`${input.userId}`,
          createdAt: sql`${at}`,
          doneAt: sql`null`,
          doneBy: sql`null`,
          reopenedAt: sql`null`,
          reopenedBy: sql`null`,
        },
        sql`where ${sql.join(within, sql` and `)}`,
      ),
    )
    .returning({ id: feedback.id });
  if (!row) {
    logWarn("feedback rate limited", { visitor: input.userId === null });
    return null;
  }
  logInfo("feedback stored", { id: row.id, kind: input.kind, visitor: input.userId === null });
  return row.id;
}

export type SubmitResult = { ok: true } | { ok: false; error: string };

// The Visszajelzés form's send (#240): the type and message from the form,
// the context from the request, the bot check for visitors. A failure stores
// nothing.
export async function submitFeedback(form: FormData, request: Request, userId: string | null, now = new Date()): Promise<SubmitResult> {
  const kind = form.get("kind");
  if (!isFormKind(kind)) return { ok: false, error: ERRORS.kind };
  const checked = validateFeedback({ kind, message: form.get("message") });
  if (!checked.ok) return checked;
  if (userId === null) {
    const bot = await verifyTurnstile(form, request, "feedback");
    if (bot !== "ok") return { ok: false, error: turnstileError(bot) };
  }
  const userAgent = request.headers.get("User-Agent");
  const id = await storeFeedback(
    {
      ...checked.value,
      page: pagePath(String(form.get("from") ?? "")),
      device: deviceClass(userAgent),
      browser: browserFamily(userAgent),
      appVersion: APP_VERSION,
      userId,
    },
    now,
  );
  return id === null ? { ok: false, error: ERRORS.limit } : { ok: true };
}

// --- Visszajelzések (#241) --------------------------------------------------------

export type FeedbackRow = {
  id: number;
  kind: FeedbackKind;
  message: string;
  rating: number | null;
  createdAt: Date;
  done: boolean;
  // The sender; null for a visitor. Never the email or phone.
  sender: { id: string; name: string } | null;
};

export type FeedbackListPage = { rows: FeedbackRow[]; total: number; pages: number; counts: FeedbackCounts };

function filterWhere(filters: Pick<FeedbackFilters, "kind" | "state">): SQL | undefined {
  return and(
    filters.kind ? eq(feedback.kind, filters.kind) : undefined,
    filters.state === "open" ? isNull(feedback.doneAt) : filters.state === "done" ? isNotNull(feedback.doneAt) : undefined,
  );
}

// One page of the list, newest first, with the counts beside the filters.
export async function feedbackPage(filters: FeedbackFilters): Promise<FeedbackListPage> {
  const groups = await db
    .select({ kind: feedback.kind, done: sql<number>`${feedback.doneAt} is not null`, count: count() })
    .from(feedback)
    .groupBy(feedback.kind, sql`${feedback.doneAt} is not null`);
  const counts = feedbackCounts(
    groups.map((g) => ({ kind: g.kind, done: Boolean(g.done), count: g.count })),
    filters,
  );
  const total = filters.kind ? counts.kinds[filters.kind] : filters.state ? counts.states[filters.state] : counts.states.open + counts.states.done;
  const pages = Math.max(1, Math.ceil(total / FEEDBACK_PAGE_SIZE));
  const page = Math.min(filters.page, pages);
  const rows = await db
    .select({
      id: feedback.id,
      kind: feedback.kind,
      message: feedback.message,
      rating: feedback.rating,
      createdAt: feedback.createdAt,
      doneAt: feedback.doneAt,
      userId: feedback.userId,
      name: users.name,
    })
    .from(feedback)
    .leftJoin(users, eq(users.id, feedback.userId))
    .where(filterWhere(filters))
    .orderBy(desc(feedback.createdAt), desc(feedback.id))
    .limit(FEEDBACK_PAGE_SIZE)
    .offset((page - 1) * FEEDBACK_PAGE_SIZE);
  return {
    rows: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      message: r.message,
      rating: r.rating,
      createdAt: r.createdAt,
      done: r.doneAt !== null,
      sender: r.userId ? { id: r.userId, name: r.name || "Névtelen" } : null,
    })),
    total,
    pages,
    counts,
  };
}

export type FeedbackItem = FeedbackRow & {
  page: string;
  device: DeviceClass;
  browser: string;
  appVersion: string;
  doneAt: Date | null;
  doneBy: { id: string; name: string } | null;
  reopenedAt: Date | null;
  reopenedBy: { id: string; name: string } | null;
};

const doneUser = alias(users, "done_user");
const reopenUser = alias(users, "reopen_user");

const person = (id: string | null, name: string | null) => (id ? { id, name: name || "Névtelen" } : null);

// One message with its context, for its own page. Null: no such message.
export async function feedbackItem(id: number): Promise<FeedbackItem | null> {
  const [r] = await db
    .select({
      f: feedback,
      name: users.name,
      doneName: doneUser.name,
      reopenName: reopenUser.name,
    })
    .from(feedback)
    .leftJoin(users, eq(users.id, feedback.userId))
    .leftJoin(doneUser, eq(doneUser.id, feedback.doneBy))
    .leftJoin(reopenUser, eq(reopenUser.id, feedback.reopenedBy))
    .where(eq(feedback.id, id));
  if (!r) return null;
  const f = r.f;
  return {
    id: f.id,
    kind: f.kind,
    message: f.message,
    rating: f.rating,
    createdAt: f.createdAt,
    done: f.doneAt !== null,
    sender: person(f.userId, r.name),
    page: f.page,
    device: f.device,
    browser: f.browser,
    appVersion: f.appVersion,
    doneAt: f.doneAt,
    doneBy: person(f.doneBy, r.doneName),
    reopenedAt: f.reopenedAt,
    reopenedBy: person(f.reopenedBy, r.reopenName),
  };
}

// Marks a message done, or open again, keeping who and when; audited
// (D91). A message already in that state is left alone and logs nothing.
export async function setFeedbackDone(id: number, done: boolean, actorId: string, now = new Date()): Promise<void> {
  const change = done
    ? db
        .update(feedback)
        .set({ doneAt: now, doneBy: actorId })
        .where(and(eq(feedback.id, id), isNull(feedback.doneAt)))
    : db
        .update(feedback)
        .set({ doneAt: null, doneBy: null, reopenedAt: now, reopenedBy: actorId })
        .where(and(eq(feedback.id, id), isNotNull(feedback.doneAt)));
  await db.batch([change, auditIfChanged({ actorId, action: done ? "feedback.done" : "feedback.reopen", target: `feedback:${id}`, at: now })]);
}
