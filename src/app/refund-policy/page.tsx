import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Refund policy' };

export default function RefundPolicyPage() {
  return (
    <div className="min-h-[100dvh] bg-[var(--ground)]">
      <main className="max-w-2xl mx-auto px-5 py-12">
        <h1 className="text-[24px] font-bold text-[var(--label)] tracking-[-0.01em]">Refund policy</h1>
        <div className="mt-6 space-y-4 text-[16px] text-[var(--label-2)] leading-[1.5]">
          <p>Payment is made directly to the print shop via UPI. Printelyx does not hold or process your money.</p>
          <h2 className="text-[17px] font-semibold text-[var(--label)]">If prints are incorrect</h2>
          <p>If your prints have errors caused by the shop (wrong pages, wrong colour, missing pages), ask the shop to reprint them at no charge.</p>
          <h2 className="text-[17px] font-semibold text-[var(--label)]">If you paid but did not receive prints</h2>
          <p>Contact the shop directly with your UTR number and order number. If unresolved, contact Printelyx support with the same details.</p>
          <h2 className="text-[17px] font-semibold text-[var(--label)]">Cancellation</h2>
          <p>You can cancel an order any time before printing starts. After printing starts, cancellation is at the shop's discretion.</p>
          <h2 className="text-[17px] font-semibold text-[var(--label)]">Refunds</h2>
          <p>Refunds are issued directly by the shop to your UPI account. Printelyx facilitates the request but does not process refunds.</p>
        </div>
      </main>
    </div>
  );
}
