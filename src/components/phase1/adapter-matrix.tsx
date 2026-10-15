import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { GitBranch } from 'lucide-react';

interface Row {
  want: string;
  env: string;
  from: string;
  to: string;
  logicEdited: '0 lines' | string;
}

const ROWS: Row[] = [
  { want: 'Outgrow Supabase 500MB', env: 'DATABASE_PROVIDER', from: 'supabase', to: 'postgres', logicEdited: '0 lines' },
  { want: 'Need S3 bucket policies', env: 'STORAGE_PROVIDER', from: 'r2', to: 's3', logicEdited: '0 lines' },
  { want: 'Exceed Upstash 500K cmd/mo', env: 'CACHE_PROVIDER', from: 'upstash', to: 'redis', logicEdited: '0 lines' },
  { want: 'Cross 200 realtime conc.', env: 'REALTIME_PROVIDER', from: 'supabase', to: 'socketio', logicEdited: '0 lines' },
  { want: 'Past Resend 3K emails/mo', env: 'EMAIL_PROVIDER', from: 'resend', to: 'postmark', logicEdited: '0 lines' },
  { want: 'Add Razorpay “easy button”', env: 'PAYMENT_PROVIDER', from: 'googlepay', to: 'razorpay', logicEdited: '0 lines' },
];

export function AdapterMatrix() {
  return (
    <section className="border-y border-border bg-muted/30">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="flex items-center gap-2">
          <GitBranch className="h-5 w-5 text-amber-600" />
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">The one-line swap matrix</h2>
        </div>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Each row is a real scaling scenario from the spec’s expansion roadmap. In every case, the
          business logic files stay untouched — only a new concrete class and one env-var flip are
          needed.
        </p>

        <Card className="mt-6 overflow-hidden border-border">
          <CardHeader className="border-b border-border bg-card pb-3">
            <CardTitle className="text-base">Swap scenarios</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Scenario</th>
                    <th className="px-4 py-2.5 font-medium">Env var</th>
                    <th className="px-4 py-2.5 font-medium">From</th>
                    <th className="px-4 py-2.5 font-medium">To</th>
                    <th className="px-4 py-2.5 font-medium">Logic edited</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {ROWS.map((r) => (
                    <tr key={r.want} className="hover:bg-muted/40">
                      <td className="px-4 py-3 font-medium text-foreground">{r.want}</td>
                      <td className="px-4 py-3">
                        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{r.env}</code>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{r.from}</td>
                      <td className="px-4 py-3 font-mono text-xs text-emerald-700">{r.to}</td>
                      <td className="px-4 py-3">
                        <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-200">
                          {r.logicEdited}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
