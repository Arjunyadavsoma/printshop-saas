'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sun, Moon, Monitor, Check } from 'lucide-react';

/**
 * Square UI: accessible theme toggle.
 * Renders a dropdown with Light / Dark / System options.
 * The trigger icon swaps between sun/moon based on the resolved theme.
 * SSR-safe: renders a stable placeholder until mounted to avoid hydration
 * mismatch (the resolved theme is only known client-side).
 */
export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const isDark = mounted && resolvedTheme === 'dark';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative size-9 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Change theme"
        >
          {/* Render both icons; toggle visibility via CSS so the server-rendered
              markup is deterministic (no hydration mismatch). */}
          <Sun className="size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" aria-hidden="true" />
          <Moon className="absolute size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" aria-hidden="true" />
          <span className="sr-only">Current theme: {mounted ? (isDark ? 'dark' : 'light') : 'system'}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onClick={() => setTheme('light')} className="gap-2">
          <Sun className="size-4" aria-hidden="true" />
          <span>Light</span>
          {mounted && theme === 'light' && <Check className="ml-auto size-4 text-brand" aria-hidden="true" />}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('dark')} className="gap-2">
          <Moon className="size-4" aria-hidden="true" />
          <span>Dark</span>
          {mounted && theme === 'dark' && <Check className="ml-auto size-4 text-brand" aria-hidden="true" />}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('system')} className="gap-2">
          <Monitor className="size-4" aria-hidden="true" />
          <span>System</span>
          {mounted && theme === 'system' && <Check className="ml-auto size-4 text-brand" aria-hidden="true" />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
