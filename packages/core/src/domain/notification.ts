import { z } from 'zod';

/**
 * A durable notification outbox row.
 *
 * The NotificationService writes a row when an event occurs. A cron
 * drains the outbox by calling the channel adapter and updating the
 * row's status. This is the **outbox pattern** — the row is the
 * source of truth for "did we send this notification", and a retried
 * event does not create a duplicate (the `dedupKey` is unique).
 */
export interface Notification {
  id: string;
  shopId: string | null;
  recipientId: string | null;
  recipientEmail: string | null;
  recipientPhone: string | null;
  channel: NotificationChannel;
  eventType: string;
  entityId: string | null;
  subject: string | null;
  body: string;
  payload: string | null;
  dedupKey: string | null;
  status: NotificationStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: Date;
  lastError: string | null;
  sentAt: Date | null;
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type NotificationChannel = 'email' | 'sms' | 'in_app' | 'push';
export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] = [
  'email',
  'sms',
  'in_app',
  'push',
] as const;

export type NotificationStatus = 'pending' | 'sent' | 'failed' | 'skipped';
export const NOTIFICATION_STATUSES: readonly NotificationStatus[] = [
  'pending',
  'sent',
  'failed',
  'skipped',
] as const;

export const NotificationSchema = z.object({
  id: z.string().uuid(),
  shopId: z.string().nullable(),
  recipientId: z.string().nullable(),
  recipientEmail: z.string().nullable(),
  recipientPhone: z.string().nullable(),
  channel: z.enum(NOTIFICATION_CHANNELS as [NotificationChannel, ...NotificationChannel[]]),
  eventType: z.string().min(1).max(80),
  entityId: z.string().nullable(),
  subject: z.string().nullable(),
  body: z.string().min(1),
  payload: z.string().nullable(),
  dedupKey: z.string().nullable(),
  status: z.enum(NOTIFICATION_STATUSES as [NotificationStatus, ...NotificationStatus[]]),
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  nextAttemptAt: z.date(),
  lastError: z.string().nullable(),
  sentAt: z.date().nullable(),
  readAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

/** Public projection for the in-app notification list. */
export interface NotificationPublic {
  id: string;
  eventType: string;
  subject: string | null;
  body: string;
  readAt: Date | null;
  createdAt: Date;
}

export function toNotificationPublic(n: Notification): NotificationPublic {
  return {
    id: n.id,
    eventType: n.eventType,
    subject: n.subject,
    body: n.body,
    readAt: n.readAt,
    createdAt: n.createdAt,
  };
}
