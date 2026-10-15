import { Github, ShieldCheck } from 'lucide-react';

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border bg-card">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-600 font-bold text-white">
            P
          </div>
          <div>
            <p className="font-semibold text-foreground">PrintShop SaaS</p>
            <p className="text-xs text-muted-foreground">
              Phase 1 foundation · adapter-pattern architecture · MIT licensed
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            0% commission · money to shopkeeper’s UPI
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Github className="h-3.5 w-3.5" />
            see README.md · ARCHITECTURE.md · packages/core/README.md
          </span>
        </div>
      </div>
    </footer>
  );
}
