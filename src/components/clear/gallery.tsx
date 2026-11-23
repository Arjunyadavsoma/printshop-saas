'use client';

import { useState } from 'react';
import { PrimaryButton, TintedButton, DestructiveButton, TextButton } from '@/components/clear/button';
import { IconButton } from '@/components/clear/icon-button';
import { Input } from '@/components/clear/input';
import { PhoneInput } from '@/components/clear/phone-input';
import { UTRInput } from '@/components/clear/utr-input';
import { Chip } from '@/components/clear/chip';
import { Badge } from '@/components/clear/badge';
import { StatusPill } from '@/components/clear/status-pill';
import { Switch } from '@/components/clear/switch';
import { SegmentedControl } from '@/components/clear/segmented-control';
import RadioRowGroup from '@/components/clear/radio-row';
import { Checkbox } from '@/components/clear/checkbox';
import { Group } from '@/components/clear/group';
import { InsetList, ChevronRow, ValueRow, SwitchRow } from '@/components/clear/inset-list';
import { Sheet } from '@/components/clear/sheet';
import { PriceBar } from '@/components/clear/price-bar';
import { PriceBreakdown } from '@/components/clear/price-breakdown';
import { EmptyState } from '@/components/clear/empty-state';
import { ErrorState } from '@/components/clear/error-state';
import { Stepper } from '@/components/clear/stepper';
import { Accordion } from '@/components/clear/accordion';
import { PageTile } from '@/components/clear/page-tile';
import { PageStrip } from '@/components/clear/page-strip';
import { ColourSummary } from '@/components/clear/page-tile';
import { SkeletonBox, SkeletonLabel, SkeletonCard } from '@/components/clear/skeleton';
import { type PageMode } from '@/components/clear/tokens';
import { Upload, ArrowLeft, Bell, Search } from 'lucide-react';

/**
 * /dev/ui — Clear design system gallery.
 * Shows every component in every state. Dev-only.
 */
export function ClearGallery() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [segmented, setSegmented] = useState('mixed');
  const [radioVal, setRadioVal] = useState('mix');
  const [switchOn, setSwitchOn] = useState(true);
  const [chip, setChip] = useState('a4');
  const [pages, setPages] = useState(
    Array.from({ length: 12 }, (_, i) => ({
      pageNumber: i + 1,
      mode: (i < 9 ? 'bw' : i === 9 ? 'skip' : 'colour') as PageMode,
    })),
  );

  const togglePage = (n: number) => {
    setPages((prev) => prev.map((p) => {
      if (p.pageNumber !== n) return p;
      const next: PageMode = p.mode === 'bw' ? 'colour' : p.mode === 'colour' ? 'skip' : 'bw';
      return { ...p, mode: next };
    }));
  };

  return (
    <div className="min-h-[100dvh] bg-[var(--ground)]">
      {/* Gallery header */}
      <header className="sticky top-0 z-10 frosted-bar border-b border-[var(--hairline)] px-5 py-6">
        <h1 className="text-[24px] font-bold text-[var(--label)] tracking-[-0.01em]">Clear Design System</h1>
        <p className="text-[14px] text-[var(--label-2)] mt-1">Every component, every state. Dev-only.</p>
      </header>

      <main className="max-w-2xl mx-auto px-5 py-6 space-y-8">
        {/* Buttons */}
        <Section title="Buttons">
          <div className="space-y-3">
            <PrimaryButton>Pay ₹58</PrimaryButton>
            <PrimaryButton loading>Pay ₹58</PrimaryButton>
            <PrimaryButton disabled>Pay ₹58</PrimaryButton>
            <PrimaryButton size="compact">Continue</PrimaryButton>
            <TintedButton>Add more files</TintedButton>
            <DestructiveButton>Reject</DestructiveButton>
            <TextButton>Enter UTR again</TextButton>
          </div>
        </Section>

        {/* IconButton */}
        <Section title="Icon Button">
          <div className="flex gap-2">
            <IconButton aria-label="Back" onClick={() => {}}><ArrowLeft className="size-5" /></IconButton>
            <IconButton aria-label="Notifications" onClick={() => {}}><Bell className="size-5" /></IconButton>
            <IconButton aria-label="Search" onClick={() => {}}><Search className="size-5" /></IconButton>
          </div>
        </Section>

        {/* Inputs */}
        <Section title="Inputs">
          <div className="space-y-4">
            <Input id="name" label="Name (optional)" placeholder="Enter your name" value="" onChange={() => {}} />
            <Input id="note" label="Note to shop" hint="Optional — e.g. 'Bind the first 10 pages'" placeholder="Add a note…" value="" onChange={() => {}} />
            <Input id="error-demo" label="Mobile number" error="Enter all 10 digits" placeholder="98765 43210" inputMode="tel" value="" onChange={() => {}} />
          </div>
        </Section>

        {/* PhoneInput */}
        <Section title="Phone Input">
          <PhoneInput id="phone" label="Mobile number" value="" onChange={() => {}} />
        </Section>

        {/* UTRInput */}
        <Section title="UTR Input">
          <UTRInput id="utr" value="" onChange={() => {}} />
        </Section>

        {/* Chips */}
        <Section title="Chips">
          <div className="flex flex-wrap gap-2">
            <Chip label="A4" selected={chip === 'a4'} onClick={() => setChip('a4')} />
            <Chip label="A3" selected={chip === 'a3'} onClick={() => setChip('a3')} />
            <Chip label="Letter" selected={chip === 'letter'} onClick={() => setChip('letter')} />
            <Chip label="Legal" selected={chip === 'legal'} onClick={() => setChip('legal')} />
          </div>
        </Section>

        {/* Badge */}
        <Section title="Badge">
          <div className="flex gap-3">
            <span className="relative"><span className="size-10 rounded-full bg-[var(--fill)]" /><Badge count={3} /></span>
            <span className="relative"><span className="size-10 rounded-full bg-[var(--fill)]" /><Badge count={12} /></span>
          </div>
        </Section>

        {/* StatusPill */}
        <Section title="Status Pills">
          <div className="flex flex-wrap gap-2">
            <StatusPill status="pending" />
            <StatusPill status="printing" />
            <StatusPill status="ready" />
            <StatusPill status="collected" />
            <StatusPill status="error" />
          </div>
        </Section>

        {/* Switch */}
        <Section title="Switch">
          <Group>
            <SwitchRow label="Open for orders"><Switch checked={switchOn} onChange={setSwitchOn} /></SwitchRow>
            <SwitchRow label="Accepting new orders"><Switch checked={false} onChange={() => {}} /></SwitchRow>
          </Group>
        </Section>

        {/* SegmentedControl */}
        <Section title="Segmented Control">
          <SegmentedControl
            options={[{ value: 'bw', label: 'All B&W' }, { value: 'mixed', label: 'Mixed' }, { value: 'colour', label: 'All colour' }]}
            value={segmented}
            onChange={setSegmented}
          />
        </Section>

        {/* RadioRow */}
        <Section title="Radio Rows (Presets)">
          <Group>
            <RadioRowGroup
              ariaLabel="Print style preset"
              options={[
                { label: 'Notes', subtitle: 'Black & white, double-sided', value: 'notes', valueLabel: '₹30' },
                { label: 'Colour everything', subtitle: 'All pages in colour', value: 'colour', valueLabel: '₹120' },
                { label: 'Photo or ID copy', subtitle: '1 page, colour, single-sided', value: 'photo', valueLabel: '₹10' },
                { label: 'Mix', subtitle: '3 pages look colourful', value: 'mix', valueLabel: '₹48' },
              ]}
              value={radioVal}
              onChange={setRadioVal}
            />
          </Group>
        </Section>

        {/* Stepper */}
        <Section title="Stepper">
          <Stepper steps={3} current={0} />
          <Stepper steps={3} current={1} />
          <Stepper steps={3} current={2} />
        </Section>

        {/* Group + InsetList */}
        <Section title="Group + InsetList">
          <Group title="Shop info">
            <InsetList>
              <ValueRow label="Open today" value="9 am to 9 pm" />
              <ChevronRow label="Call shop" onClick={() => {}} />
              <ChevronRow label="Directions" onClick={() => {}} />
            </InsetList>
          </Group>
        </Section>

        {/* PriceBar */}
        <Section title="Price Bar">
          <div className="relative border border-[var(--hairline)] rounded-[var(--radius-card)] overflow-hidden" style={{ height: 100 }}>
            <div className="p-4 text-[14px] text-[var(--label-2)]">Content above…</div>
            <PriceBar caption="9 B&W, 3 colour" total="₹48" action={<PrimaryButton>Review order</PrimaryButton>} />
          </div>
        </Section>

        {/* PriceBreakdown */}
        <Section title="Price Breakdown">
          <PriceBreakdown
            totalPaise={4800}
            lines={[
              { label: '9 B&W pages (₹2 each)', amountPaise: 1800 },
              { label: '3 colour pages (₹10 each)', amountPaise: 3000 },
            ]}
          />
        </Section>

        {/* PageTile + PageStrip (signature) */}
        <Section title="Page Tile (Signature)">
          <div className="flex gap-2">
            <div className="w-20"><PageTile pageNumber={1} mode="bw" onToggle={() => {}} /></div>
            <div className="w-20"><PageTile pageNumber={2} mode="colour" onToggle={() => {}} /></div>
            <div className="w-20"><PageTile pageNumber={3} mode="skip" onToggle={() => {}} /></div>
          </div>
        </Section>

        <Section title="Page Strip (Full)">
          <PageStrip
            pages={pages}
            onToggle={togglePage}
            onBulkSet={(mode) => setPages((prev) => prev.map((p) => ({ ...p, mode })))}
            suggestionAvailable
            onUseSuggestion={() => setPages((prev) => prev.map((p) => ({ ...p, mode: p.pageNumber > 9 ? 'colour' : 'bw' })))}
            moneyNudge="Double-sided saves ₹12."
          />
        </Section>

        {/* EmptyState */}
        <Section title="Empty State">
          <EmptyState
            icon={<Upload className="size-6" />}
            title="Add a file to start"
            description="Drop a PDF, photo or Word file. We'll count the pages and price your print."
          />
        </Section>

        {/* ErrorState */}
        <Section title="Error State">
          <ErrorState
            message="We couldn't load this shop."
            fix="Check your connection and try again."
            referenceCode="ERR_8F3A"
          />
        </Section>

        {/* Skeletons */}
        <Section title="Skeletons">
          <div className="space-y-3">
            <SkeletonCard />
            <SkeletonLabel width="long" />
          </div>
        </Section>

        {/* Accordion */}
        <Section title="Accordion (FAQ)">
          <Group>
            <Accordion title="How do I pay?">
              <p className="text-[14px] text-[var(--label-2)] pb-3">Tap a UPI app (GPay, PhonePe). After paying, enter the 12-digit UTR number.</p>
            </Accordion>
            <Accordion title="When will my prints be ready?">
              <p className="text-[14px] text-[var(--label-2)] pb-3">Most orders are ready in 10-20 minutes. Check the tracking page for live status.</p>
            </Accordion>
          </Group>
        </Section>

        {/* Sheet */}
        <Section title="Sheet">
          <TintedButton onClick={() => setSheetOpen(true)}>Open "More options" sheet</TintedButton>
          <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="More options">
            <div className="p-4 space-y-4">
              <p className="text-[14px] text-[var(--label-2)]">Copies, paper, binding, orientation, note to shop.</p>
              <PrimaryButton className="w-full" onClick={() => setSheetOpen(false)}>Done</PrimaryButton>
            </div>
          </Sheet>
        </Section>

        {/* ColourSummary */}
        <Section title="Colour Summary">
          <ColourSummary bw={9} colour={3} skip={1} />
        </Section>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-[17px] font-semibold text-[var(--label)]">{title}</h2>
      <div className="space-y-3">
        {children}
      </div>
    </section>
  );
}
