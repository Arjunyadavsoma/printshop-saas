import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'How it works' };

export default function HowItWorksPage() {
  return (
    <div className="min-h-[100dvh] bg-[var(--ground)]">
      <main className="max-w-2xl mx-auto px-5 py-12">
        <h1 className="text-[24px] font-bold text-[var(--label)] tracking-[-0.01em]">How it works</h1>
        <div className="mt-6 space-y-6 text-[16px] text-[var(--label-2)] leading-[1.5]">
          <div>
            <h2 className="text-[17px] font-semibold text-[var(--label)]">1. Find a shop</h2>
            <p>Scan the shop QR code or search for a nearby print shop.</p>
          </div>
          <div>
            <h2 className="text-[17px] font-semibold text-[var(--label)]">2. Upload files</h2>
            <p>Add PDFs, photos, or Word documents. We count the pages and calculate the exact price.</p>
          </div>
          <div>
            <h2 className="text-[17px] font-semibold text-[var(--label)]">3. Choose print options</h2>
            <p>Pick B&W or colour, single or double-sided, paper size, and copies. Mark specific pages as colour if you want.</p>
          </div>
          <div>
            <h2 className="text-[17px] font-semibold text-[var(--label)]">4. Pay by UPI</h2>
            <p>Pay the shop directly using GPay, PhonePe, Paytm, or BHIM. Zero commission — no extra fees.</p>
          </div>
          <div>
            <h2 className="text-[17px] font-semibold text-[var(--label)]">5. Collect your prints</h2>
            <p>Track your order live. When it is ready, show your pickup code at the counter.</p>
          </div>
        </div>
      </main>
    </div>
  );
}
