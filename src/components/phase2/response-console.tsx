'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { CheckCircle2, XCircle, Terminal } from 'lucide-react';
import type { LogEntry } from './use-api-client';

export function ResponseConsole({ log }: { log: LogEntry[] }) {
  return (
    <Card className="border-border bg-[oklch(0.16_0_0)] text-[oklch(0.92_0_0)]">
      <CardContent className="p-0">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2">
          <Terminal className="h-3.5 w-3.5 text-emerald-400" />
          <span className="text-xs font-medium text-white/70">Live request log (most recent first)</span>
          <Badge className="ml-auto bg-white/10 text-white hover:bg-white/20">{log.length} calls</Badge>
        </div>
        <div className="max-h-72 overflow-y-auto p-3 font-mono text-[11px] leading-relaxed">
          {log.length === 0 ? (
            <p className="text-white/40">No calls yet — run a step above.</p>
          ) : (
            log.map((e) => (
              <div key={e.ts} className="mb-1.5 flex items-start gap-2">
                {e.status >= 200 && e.status < 300 ? (
                  <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />
                ) : (
                  <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-rose-400" />
                )}
                <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-white/80">
                  {e.method} {e.status}
                </span>
                <span className="shrink-0 text-sky-300">{e.path}</span>
                {e.bodyPreview && (
                  <span className="truncate text-white/50">{e.bodyPreview}</span>
                )}
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
