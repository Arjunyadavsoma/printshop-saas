import { Loader2 } from 'lucide-react';

export default function Loading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="size-8 animate-spin text-brand" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    </div>
  );
}
