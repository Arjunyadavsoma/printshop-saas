'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Sun, Moon, MonitorSmartphone } from 'lucide-react';

/**
 * CustomerThemeToggle — a small icon button for the customer AppBar that
 * cycles through the three theme states:
 *
 *   system → light → dark → system → …
 *
 * Each tap advances the cycle by one step. The icon reflects the CURRENT
 * resolved theme (sun for light, moon for dark, monitor for system-follows-
 * device). The accessible label announces both the current state AND the
 * next state on tap so a screen-reader user knows what the button will do
 * before they press it.
 *
 * FOUC: handled by next-themes (the `<ThemeProvider attribute="class"
 * defaultTheme="system" enableSystem>` in `src/app/layout.tsx` injects an
 * inline script that sets the `dark` class on `<html>` before React
 * hydrates). This component ONLY reads + writes the theme preference; it
 * does not perform the class toggle itself.
 *
 * SSR-safe: renders a stable placeholder (the system icon) until mounted,
 * so the server-rendered markup is deterministic and the client does not
 * see a hydration mismatch when the resolved theme is dark.
 */
type ThemeMode = 'system' | 'light' | 'dark';

/** The cycle order — advancing from any state moves to the next in this list. */
const CYCLE: readonly ThemeMode[] = ['system', 'light', 'dark'] as const;

const ICONS: Record<ThemeMode, typeof Sun> = {
  system: MonitorSmartphone,
  light: Sun,
  dark: Moon,
};

const LABELS: Record<ThemeMode, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

/**
 * Returns the next mode in the cycle (system → light → dark → system).
 */
function nextMode(current: ThemeMode): ThemeMode {
  const idx = CYCLE.indexOf(current);
  if (idx === -1) return 'system';
  return CYCLE[(idx + 1) % CYCLE.length];
}

export function CustomerThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // The current mode the user has chosen (may be 'system' even when the
  // resolved theme is dark). Until mounted, we optimistically render the
  // 'system' state so SSR markup is deterministic.
  const currentMode: ThemeMode = mounted && theme ? (theme as ThemeMode) : 'system';
  // The resolved (effective) theme — what the user actually sees. Used for
  // the icon colour + the `aria-label` so screen readers announce the
  // visible state.
  const currentResolved: ThemeMode = mounted
    ? ((resolvedTheme === 'dark' ? 'dark' : 'light') as ThemeMode)
    : 'system';

  const Icon = ICONS[currentMode];
  const NextIcon = ICONS[nextMode(currentMode)];
  const nextLabel = LABELS[nextMode(currentMode)];

  const handleToggle = () => {
    setTheme(nextMode(currentMode));
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-label={`Theme: ${LABELS[currentMode]}. Tap for ${nextLabel}.`}
      title={`Theme: ${LABELS[currentMode]} (tap for ${nextLabel})`}
      className="touch-target flex items-center justify-center size-12 -mr-2 rounded-[var(--radius-default)] text-[var(--color-ink)] hover:bg-[var(--color-border-ink)] active:bg-[var(--color-border-ink-strong)] transition-colors"
    >
      {/* Render the current-mode icon prominently. The next-mode icon is
          a tiny affordance in the bottom-right that hints at what a tap
          will do (visual feedback for sighted users; screen readers get
          the same info from aria-label). */}
      <span className="relative inline-flex">
        <Icon
          className="size-5"
          strokeWidth={2}
          aria-hidden="true"
        />
        <NextIcon
          className="absolute -bottom-1 -right-1 size-3 opacity-60"
          strokeWidth={2.5}
          aria-hidden="true"
        />
      </span>
      {/* Screen-reader-only live region announcing the resolved theme so a
          voice-over user knows whether they're currently in light or dark
          mode (not just their preference). */}
      <span className="sr-only" aria-live="polite">
        Current appearance: {mounted ? LABELS[currentResolved] : 'system'}.
        Preference: {LABELS[currentMode]}.
      </span>
    </button>
  );
}
