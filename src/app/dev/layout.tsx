import { redirect } from 'next/navigation';

/**
 * Dev-only layout — blocks access in production.
 * Redirects to the homepage when NODE_ENV is production.
 */
export default function DevLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === 'production') {
    redirect('/');
  }
  return <>{children}</>;
}
