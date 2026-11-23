import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'about' };

/** /about — public info page. */
export default function aboutPage() {
  return (
    <div className="min-h-[100dvh] bg-[var(--ground)]">
      <main className="max-w-2xl mx-auto px-5 py-12">
        <h1 className="text-[24px] font-bold text-[var(--label)] tracking-[-0.01em]">about</h1>
        <p className="mt-4 text-[16px] text-[var(--label-2)] leading-[1.5]">
          This page is being written. For questions, visit <a href="/help" className="text-[var(--accent)] underline">Help</a>.
        </p>
      </main>
    </div>
  );
}
