import { Loader2 } from 'lucide-react';

export default function OrderFlowLoading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="size-8 animate-spin text-brand" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">Loading your order…</p>
      </div>
    </div>
  );
}
