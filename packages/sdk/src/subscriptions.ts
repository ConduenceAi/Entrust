/**
 * Subscriptions an owner records on an agent's token, so the agent can say
 * what renews when. Each is a public registry record `subscriptions.<id>`
 * holding JSON. Records never grant authority: paying a renewal is still an
 * ordinary payment that the owner's policy checks on-chain.
 */
import { z } from "zod";
import { formatNear, parseNear } from "./amounts.ts";
import { AccountId, type RecordEntry } from "./types.ts";

export const SUBSCRIPTION_NAMESPACE = "subscriptions";

export const SubscriptionRecord = z.object({
  name: z.string().min(1).max(60),
  url: z.string().url().max(200).optional(),
  /** The price of one renewal, in NEAR. */
  price_near: z.string().regex(/^\d+(\.\d{1,24})?$/),
  period: z.enum(["weekly", "monthly"]),
  /** A renewal date (YYYY-MM-DD, UTC). Later renewals repeat from it. */
  anchor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** The account a renewal is paid to. */
  pay_to: AccountId,
});
export type SubscriptionRecord = z.infer<typeof SubscriptionRecord>;

export interface Subscription {
  /** The record key's name part, such as `newsliquid`. */
  id: string;
  name: string;
  url?: string;
  price: bigint;
  period: "weekly" | "monthly";
  payTo: string;
  /** The next renewal on or after today, at 00:00 UTC. */
  nextRenewal: Date;
  /** Whole days from today (UTC) to the next renewal: 0 is today, 1 is tomorrow. */
  daysUntil: number;
}

const DAY_MS = 86_400_000;

function utcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** The first renewal on or after `today`, repeating weekly or monthly from `anchor`. */
export function nextRenewal(anchor: string, period: "weekly" | "monthly", today = new Date()): Date {
  const [y, m, d] = anchor.split("-").map(Number) as [number, number, number];
  const start = Date.UTC(y, m - 1, d);
  const now = utcDay(today);
  if (start >= now) return new Date(start);
  if (period === "weekly") {
    const weeks = Math.ceil((now - start) / (7 * DAY_MS));
    return new Date(start + weeks * 7 * DAY_MS);
  }
  // Monthly: the same day of the month, or the month's last day if it is shorter.
  for (let k = 1; ; k++) {
    const month = m - 1 + k;
    const year = y + Math.floor(month / 12);
    const mm = ((month % 12) + 12) % 12;
    const date = Date.UTC(year, mm, Math.min(d, daysInMonth(year, mm)));
    if (date >= now) return new Date(date);
  }
}

/** The record (key and JSON value) for a subscription. */
export function subscriptionRecord(id: string, record: SubscriptionRecord): { key: string; value: string } {
  if (!/^[a-z0-9-]{1,64}$/.test(id)) throw new Error("A subscription ID is 1-64 characters of a-z, 0-9 and '-'");
  return { key: `${SUBSCRIPTION_NAMESPACE}.${id}`, value: JSON.stringify(SubscriptionRecord.parse(record)) };
}

/**
 * An anchor that makes the next renewal fall `daysFromToday` days from today:
 * the same date one period earlier.
 */
export function anchorFor(daysFromToday: number, period: "weekly" | "monthly", today = new Date()): string {
  const next = new Date(utcDay(today) + daysFromToday * DAY_MS);
  const anchor =
    period === "weekly"
      ? new Date(next.getTime() - 7 * DAY_MS)
      : new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() - 1, Math.min(next.getUTCDate(), daysInMonth(next.getUTCFullYear(), next.getUTCMonth() - 1))));
  return anchor.toISOString().slice(0, 10);
}

/** Reads the subscriptions among an agent's records, soonest renewal first. Malformed records are skipped. */
export function parseSubscriptions(records: RecordEntry[], today = new Date()): Subscription[] {
  const out: Subscription[] = [];
  for (const { key, value } of records) {
    if (!key.startsWith(`${SUBSCRIPTION_NAMESPACE}.`)) continue;
    let parsed: SubscriptionRecord;
    try {
      parsed = SubscriptionRecord.parse(JSON.parse(value));
    } catch {
      continue;
    }
    const next = nextRenewal(parsed.anchor, parsed.period, today);
    out.push({
      id: key.slice(SUBSCRIPTION_NAMESPACE.length + 1),
      name: parsed.name,
      ...(parsed.url ? { url: parsed.url } : {}),
      price: parseNear(parsed.price_near),
      period: parsed.period,
      payTo: parsed.pay_to,
      nextRenewal: next,
      daysUntil: Math.round((next.getTime() - utcDay(today)) / DAY_MS),
    });
  }
  return out.sort((a, b) => a.nextRenewal.getTime() - b.nextRenewal.getTime());
}

/** "today", "tomorrow", or "in N days". */
export function whenText(daysUntil: number): string {
  return daysUntil === 0 ? "today" : daysUntil === 1 ? "tomorrow" : `in ${daysUntil} days`;
}

export function describeSubscription(s: Subscription): string {
  const date = s.nextRenewal.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  return `${s.name}: ${formatNear(s.price)} NEAR ${s.period}, next renewal ${date} (${whenText(s.daysUntil)}), paid to ${s.payTo}`;
}
