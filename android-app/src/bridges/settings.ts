/**
 * Settings bridge — sends the user to the system app-settings screen.
 *
 * Android silently ignores repeated permission prompts after a permanent
 * denial ("don't ask again"), so the only honest recovery path is the
 * settings page. The web permission flows render an "Open app settings"
 * button (only when running inside the companion app) that calls
 * `NativeApp.permissions.openSettings()` → the AppSettings plugin.
 */
import { registerPlugin } from '@capacitor/core';

interface AppSettingsPlugin {
  openSettings(): Promise<void>;
}

const AppSettings = registerPlugin<AppSettingsPlugin>('AppSettings');

export async function openAppSettings(): Promise<void> {
  await AppSettings.openSettings();
}
