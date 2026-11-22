/**
 * Local notifications bridge — "Your prints are ready" push notifications.
 *
 * The web app polls `/api/v1/orders/[id]/status` every 30 seconds when an
 * order is being processed. When the status transitions to `ready` or
 * `completed`, the companion app fires a local notification (so the user
 * knows to pick up their prints even if they've switched away from the app).
 *
 * This is LOCAL notifications (no FCM server-side integration needed for the
 * MVP). The poller runs inside the WebView (the existing web app's polling
 * logic) and calls `window.NativeApp.notifications.schedule()` when the
 * status flips. The notification appears in the Android system notification
 * tray + triggers the device's default notification sound + vibration.
 *
 * Tapping the notification re-opens the companion app (via the MainActivity's
 * default intent) and lands the user on the order status page.
 */
import { LocalNotifications } from '@capacitor/local-notifications';

let nextId = 1;

export async function scheduleNotification(
  title: string,
  body: string,
  id?: number,
): Promise<number> {
  try {
    const notificationId = id ?? nextId++;
    await LocalNotifications.schedule({
      notifications: [
        {
          id: notificationId,
          title,
          body,
          // Fire immediately (scheduleAt = now). For future scheduled
          // notifications (e.g. "ready in 15 min"), set scheduleAt to a
          // future Date — but the MVP fires on-demand from the poller.
          schedule: { at: new Date() },
          // Small icon must exist as a drawable resource in the Android
          // project (res/drawable/ic_notification.xml — a white-on-transparent
          // vector for Android 5+ status bar rendering).
          smallIcon: 'ic_notification',
          iconColor: '#2563eb', // brand blue
          sound: undefined, // use the system default
          // Tap action: re-open the app (default MainActivity intent).
          actionTypeId: 'OPEN_APP',
        },
      ],
    });
    return notificationId;
  } catch {
    // Notification permission denied or plugin unavailable — fail silently.
    // The web app's in-page toast still fires (it's independent of this bridge).
    return -1;
  }
}

export async function cancelNotification(id: number): Promise<void> {
  try {
    await LocalNotifications.cancel({ notifications: [{ id }] });
  } catch {
    // best-effort
  }
}
