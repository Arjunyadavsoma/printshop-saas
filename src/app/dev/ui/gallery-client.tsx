'use client';

import { useState, type ReactNode } from 'react';
import { AppBar } from '@/components/customer/app-bar';
import { PrimaryButton, SecondaryButton, TextButton } from '@/components/customer/button';
import { StickyActionBar } from '@/components/customer/sticky-action-bar';
import { Stepper } from '@/components/customer/stepper';
import { SegmentedControl } from '@/components/customer/segmented-control';
import { Chip, ChipGroup } from '@/components/customer/chip';
import { NumberStepper } from '@/components/customer/number-stepper';
import { BottomSheet } from '@/components/customer/bottom-sheet';
import { UploadDropzone } from '@/components/customer/upload-dropzone';
import { FileCard } from '@/components/customer/file-card';
import { PageThumb } from '@/components/customer/page-thumb';
import { PageStrip } from '@/components/customer/page-strip';
import { PriceBreakdown } from '@/components/customer/price-breakdown';
import { PaymentSheet } from '@/components/customer/payment-sheet';
import { UTRInput } from '@/components/customer/utr-input';
import { StatusTimeline } from '@/components/customer/status-timeline';
import { TokenSlip } from '@/components/customer/token-slip';
import { StatusPill } from '@/components/customer/status-pill';
import { SkeletonBox, SkeletonText, SkeletonCard, SkeletonPageStrip } from '@/components/customer/skeleton';
import { EmptyState } from '@/components/customer/empty-state';
import { ErrorState } from '@/components/customer/error-state';
import { Toast } from '@/components/customer/toast';
import { OfflineBanner } from '@/components/customer/offline-banner';
import { TextField } from '@/components/customer/text-field';
import { PhoneField } from '@/components/customer/phone-field';
import { CustomerThemeToggle } from '@/components/customer/theme-toggle';
import { type PageMode } from '@/components/customer/tokens';
import { FileText, Upload, AlertCircle, CheckCircle2, WifiOff } from 'lucide-react';

/**
 * GalleryClient — the interactive dev gallery.
 * Renders every customer component in every state so designers + devs
 * can verify the design system at a glance.
 */
export function GalleryClient() {
  return (
    <div className="customer-flow min-h-[100dvh] bg-[var(--color-paper)]">
      {/* Gallery header (not the AppBar component — this is meta) */}
      <header className="border-b border-[var(--color-border-ink)] bg-[var(--color-surface)] px-4 py-6 safe-top">
        <h1 className="text-2xl font-bold text-[var(--color-ink)]">Customer Component Gallery</h1>
        <p className="text-sm text-[var(--color-muted)] mt-1">
          Every component in every state. Dev-only — not in production navigation.
        </p>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-10">
        <Section title="AppBar" subtitle="Top bar — shop name + open/closed dot">
          <AppBar title="QuickPrint Demo" subtitle="B&W ₹2 · Colour ₹8 /page" status="open" />
          <AppBar title="QuickPrint Demo" subtitle="B&W ₹2 · Colour ₹8 /page" status="closed" />
          <AppBar
            title="QuickPrint Demo"
            subtitle="B&W ₹2 · Colour ₹8 /page"
            status="open"
            actions={<CustomerThemeToggle />}
          />
        </Section>

        <Section title="Buttons" subtitle="PrimaryButton, SecondaryButton, TextButton — 48px min, loading preserves width">
          <div className="space-y-3">
            <PrimaryButton>Pay ₹48</PrimaryButton>
            <PrimaryButton loading>Pay ₹48</PrimaryButton>
            <PrimaryButton disabled>Pay ₹48</PrimaryButton>
            <SecondaryButton>More options</SecondaryButton>
            <SecondaryButton disabled>More options</SecondaryButton>
            <TextButton>Enter UTR again</TextButton>
          </div>
        </Section>

        <Section title="StickyActionBar" subtitle="Bottom bar — live total + CTA, safe-area aware">
          <div className="relative border border-[var(--color-border-ink)] rounded-[var(--radius-default)] overflow-hidden" style={{ height: 120 }}>
            <div className="p-4 text-sm text-[var(--color-muted)]">Screen content above the bar…</div>
            <StickyActionBar total="₹48">
              <PrimaryButton>Pay ₹48</PrimaryButton>
            </StickyActionBar>
          </div>
        </Section>

        <Section title="Stepper" subtitle="3 steps — numbered because it IS a sequence">
          <Stepper steps={['Files', 'Options', 'Pay']} current={0} />
          <Stepper steps={['Files', 'Options', 'Pay']} current={1} />
          <Stepper steps={['Files', 'Options', 'Pay']} current={2} />
        </Section>

        <Section title="SegmentedControl" subtitle="One-sided / Double-sided, Portrait / Landscape">
          <SegmentedControlDemo />
        </Section>

        <Section title="Chips" subtitle="Paper size, presets — 36px pills, toggle selected">
          <ChipGroupDemo />
        </Section>

        <Section title="NumberStepper" subtitle="Copies — large ± targets, typing allowed, 1–100">
          <NumberStepperDemo />
        </Section>

        <Section title="BottomSheet" subtitle="Drag handle, scroll lock, focus trap, back-gesture closes">
          <BottomSheetDemo />
        </Section>

        <Section title="UploadDropzone" subtitle="Tap to choose, camera, gallery; drag/drop on desktop">
          <UploadDropzone onFiles={(files) => console.log('files:', files)} />
        </Section>

        <Section title="FileCard" subtitle="Thumbnail, name, pages, size, progress, remove, retry">
          <div className="space-y-3">
            <FileCard
              file={{ name: 'notes.pdf', size: 245678, pageCount: 12, status: 'ready' }}
              onRemove={() => {}}
            />
            <FileCard
              file={{ name: 'photo.jpg', size: 1023456, pageCount: 1, status: 'uploading', progress: 67 }}
              onRemove={() => {}}
            />
            <FileCard
              file={{ name: 'thesis.pdf', size: 8901234, pageCount: 87, status: 'failed', error: 'File is too large (max 50 MB)' }}
              onRemove={() => {}}
              onRetry={() => {}}
            />
          </div>
        </Section>

        <Section title="PageThumb (signature element)" subtitle="Tap to toggle B&W → Colour → Skip. Halftone textures.">
          <PageThumbDemo />
        </Section>

        <Section title="PageStrip (the signature screen)" subtitle="Virtualized grid + running totals + bulk actions">
          <PageStripDemo />
        </Section>

        <Section title="PriceBreakdown" subtitle="Collapsed total → expandable itemised lines">
          <PriceBreakdown
            totalPaise={4800}
            lines={[
              { label: '12 B&W pages (₹2 each)', amountPaise: 2400 },
              { label: '3 Colour pages (₹8 each)', amountPaise: 2400 },
              { label: 'Double-sided discount', amountPaise: -0 },
            ]}
          />
        </Section>

        <Section title="PaymentSheet" subtitle="UPI app buttons + copy UPI ID">
          <PaymentSheet upiId="quickprint@upi" upiUri="upi://pay?pa=quickprint@upi" onAppTap={(app) => console.log(app)} />
        </Section>

        <Section title="UTRInput" subtitle="12 digits, numeric keypad, paste detection, inline validation">
          <UTRInputDemo />
        </Section>

        <Section title="StatusTimeline" subtitle="Numbered sequence — Placed → Payment → Printing → Ready → Collected">
          <StatusTimeline
            steps={[
              { label: 'Placed', status: 'done', timestamp: '2:15 PM' },
              { label: 'Payment', status: 'done', timestamp: '2:16 PM' },
              { label: 'Printing', status: 'current', subProgress: 'Colour: 3 of 5 pages done' },
              { label: 'Ready', status: 'future' },
              { label: 'Collected', status: 'future' },
            ]}
          />
        </Section>

        <Section title="TokenSlip" subtitle="Perforated edge, big pickup code, order number, QR">
          <TokenSlip
            pickupCode="A-7"
            orderNumber="#1247"
            shopName="QuickPrint Demo"
            summary="12 B&W · 3 Colour · ₹48"
          />
        </Section>

        <Section title="StatusPill" subtitle="Payment pending / Printing / Ready / Collected / Error">
          <div className="flex flex-wrap gap-2">
            <StatusPill status="pending" />
            <StatusPill status="printing" />
            <StatusPill status="ready" />
            <StatusPill status="collected" />
            <StatusPill status="error" />
          </div>
        </Section>

        <Section title="Skeletons" subtitle="Shimmer boxes for every async region">
          <div className="space-y-3">
            <SkeletonCard />
            <SkeletonText lines={2} />
            <SkeletonPageStrip />
          </div>
        </Section>

        <Section title="EmptyState" subtitle="Inviting next step — no clinical 'no data'">
          <EmptyState
            icon={<Upload className="size-6" />}
            title="Add a file to start"
            description="Drop a PDF, photo or Word file. We'll count the pages and price your print."
          />
        </Section>

        <Section title="ErrorState" subtitle="What happened + how to fix it — never sorry, never vague">
          <ErrorState
            message="We couldn't load this shop."
            fix="Check your connection and try again. If the problem continues, the shop may be temporarily closed."
          />
        </Section>

        <Section title="Toast" subtitle="aria-live, auto-dismiss, above the sticky bar">
          <ToastDemo />
        </Section>

        <Section title="OfflineBanner" subtitle="Appears when navigator.onLine is false">
          <OfflineBanner online={false} />
          <p className="text-xs text-[var(--color-muted)] mt-2">↑ Shows when online=false</p>
        </Section>

        <Section title="TextField" subtitle="16px text (no iOS zoom), visible label, error + hint">
          <TextFieldDemo />
        </Section>

        <Section title="PhoneField" subtitle="+91 prefix, 10-digit Indian mobile, inline validation">
          <PhoneFieldDemo />
        </Section>
      </main>
    </div>
  );
}

// ── Section wrapper ──────────────────────────────────────────────────
function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-[var(--color-ink)]">{title}</h2>
        {subtitle && <p className="text-sm text-[var(--color-muted)]">{subtitle}</p>}
      </div>
      <div className="space-y-3 bg-[var(--color-surface)] border border-[var(--color-border-ink)] rounded-[var(--radius-default)] p-4">
        {children}
      </div>
    </section>
  );
}

// ── Interactive demo components ──────────────────────────────────────
function SegmentedControlDemo() {
  const [sides, setSides] = useState('double');
  const [orient, setOrient] = useState('portrait');
  return (
    <div className="space-y-4">
      <SegmentedControl
        options={[{ value: 'single', label: 'One-sided' }, { value: 'double', label: 'Double-sided' }]}
        value={sides}
        onChange={setSides}
      />
      <SegmentedControl
        options={[{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]}
        value={orient}
        onChange={setOrient}
      />
    </div>
  );
}

function ChipGroupDemo() {
  const [selected, setSelected] = useState('a4');
  return (
    <ChipGroup label="Paper size">
      <Chip label="A4" selected={selected === 'a4'} onClick={() => setSelected('a4')} />
      <Chip label="A3" selected={selected === 'a3'} onClick={() => setSelected('a3')} />
      <Chip label="Letter" selected={selected === 'letter'} onClick={() => setSelected('letter')} />
      <Chip label="Legal" selected={selected === 'legal'} onClick={() => setSelected('legal')} />
    </ChipGroup>
  );
}

function NumberStepperDemo() {
  const [copies, setCopies] = useState(2);
  return <NumberStepper label="Copies" value={copies} onChange={setCopies} />;
}

function BottomSheetDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <SecondaryButton onClick={() => setOpen(true)}>Open "More options" sheet</SecondaryButton>
      <BottomSheet open={open} onClose={() => setOpen(false)} title="More options">
        <div className="space-y-4 p-4">
          <p className="text-sm text-[var(--color-muted)]">
            Copies, paper type, orientation, pages per sheet, scale, collate, add-ons, note to shop.
          </p>
          <PrimaryButton className="w-full" onClick={() => setOpen(false)}>Done</PrimaryButton>
        </div>
      </BottomSheet>
    </>
  );
}

function PageThumbDemo() {
  const [modes, setModes] = useState<PageMode[]>(['bw', 'colour', 'skip', 'bw', 'colour']);
  return (
    <div className="flex gap-2">
      {modes.map((mode, i) => (
        <div key={i} className="w-20">
          <PageThumb
            pageNumber={i + 1}
            mode={mode}
            onToggle={() => {
              const next: PageMode[] = [...modes];
              next[i] = mode === 'bw' ? 'colour' : mode === 'colour' ? 'skip' : 'bw';
              setModes(next);
            }}
          />
        </div>
      ))}
    </div>
  );
}

function PageStripDemo() {
  const [pages, setPages] = useState(
    Array.from({ length: 15 }, (_, i) => ({
      pageNumber: i + 1,
      mode: (i % 3 === 0 ? 'colour' : i % 5 === 0 ? 'skip' : 'bw') as PageMode,
    })),
  );
  const toggle = (n: number) => {
    setPages((prev) =>
      prev.map((p) => {
        if (p.pageNumber !== n) return p;
        const next: PageMode = p.mode === 'bw' ? 'colour' : p.mode === 'colour' ? 'skip' : 'bw';
        return { ...p, mode: next };
      }),
    );
  };
  const bulkSet = (mode: PageMode) => setPages((prev) => prev.map((p) => ({ ...p, mode })));
  return (
    <PageStrip
      pages={pages}
      onToggle={toggle}
      onBulkSet={bulkSet}
      suggestionAvailable
      onUseSuggestion={() => bulkSet('colour')}
      moneyNudge="Double-sided saves ₹12."
    />
  );
}

function UTRInputDemo() {
  const [utr, setUtr] = useState('');
  return <UTRInput value={utr} onChange={setUtr} />;
}

function ToastDemo() {
  const [toast, setToast] = useState<{ variant: 'success' | 'error' | 'info'; message: string } | null>(null);
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <SecondaryButton onClick={() => setToast({ variant: 'success', message: 'Payment sent to shop.' })}>Show success</SecondaryButton>
        <SecondaryButton onClick={() => setToast({ variant: 'error', message: 'Could not submit UTR. Check the 12 digits.' })}>Show error</SecondaryButton>
      </div>
      {toast && <Toast variant={toast.variant} message={toast.message} onDismiss={() => setToast(null)} />}
    </div>
  );
}

function TextFieldDemo() {
  const [val, setVal] = useState('');
  return (
    <TextField
      label="Note to shop"
      id="note-demo"
      value={val}
      onChange={setVal}
      hint="Optional — e.g. 'Bind the first 10 pages'"
      placeholder="Add a note for the shopkeeper…"
      maxLength={300}
    />
  );
}

function PhoneFieldDemo() {
  const [phone, setPhone] = useState('');
  return <PhoneField id="phone-demo" value={phone} onChange={setPhone} />;
}
