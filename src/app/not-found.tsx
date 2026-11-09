import Link from 'next/link';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <Search className="size-10 text-muted-foreground" aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">Page not found</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The page you&apos;re looking for doesn&apos;t exist or has been moved.
          </p>
        </div>
        <Button asChild className="h-11 bg-brand text-brand-foreground hover:bg-brand/90">
          <Link href="/">Back to home</Link>
        </Button>
      </div>
    </div>
  );
}
