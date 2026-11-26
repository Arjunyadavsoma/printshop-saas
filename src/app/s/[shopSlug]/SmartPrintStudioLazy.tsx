'use client';

import dynamic from 'next/dynamic';
import { SkeletonBox } from '@/components/clear/skeleton';

/**
 * SmartPrintStudioLazy — client-only dynamic import of the Smart Print
 * Studio (the 5-step premium upload → settings → review → payment →
 * confirmation flow). SSR is disabled because the studio reads localStorage
 * draft state on mount (restoring an in-progress order) and uses browser
 * APIs (crypto.subtle for chunk checksums, drag-and-drop).
 *
 * Matches the CustomerOrderFlowV2Lazy pattern so the shop landing page can
 * swap between them without changing its mount logic.
 */
const SmartPrintStudioInner = dynamic(
  () => import('@/components/studio/SmartPrintStudio').then((m) => m.SmartPrintStudio),
  {
    ssr: false,
    loading: () => <SkeletonBox className="min-h-[400px]" />,
  },
);

export interface SmartPrintStudioLazyProps {
  shopSlug: string;
  shopName: string;
  upiId: string;
  colorPerPagePaise: number | null;
  bwPerPagePaise: number | null;
  doubleBwPrice: string | null;
  paymentMode: string;
  closed: boolean;
}

export function SmartPrintStudioLazy(props: SmartPrintStudioLazyProps) {
  // Construct the ShopCapabilities the studio needs from the props the shop
  // landing page already has. The studio only reads capabilities that are
  // actually exposed — colour support is inferred from whether the shop has
  // a colour price; duplex from whether a double-sided price exists.
  const supportsColor = props.colorPerPagePaise != null && props.colorPerPagePaise > 0;
  const supportsDuplex = props.doubleBwPrice != null;

  return (
    <SmartPrintStudioInner
      shop={{
        slug: props.shopSlug,
        name: props.shopName,
        supportsColor,
        supportsDuplex,
        paperSizes: ['A4', 'A3', 'Letter'],
        addons: [],
        upiId: props.upiId,
        paymentMethods: 'both',
        isOpen: !props.closed,
        acceptingOrders: !props.closed,
        pricingSummary: {
          bwA4PerPage: props.bwPerPagePaise ?? 200,
          colorA4PerPage: props.colorPerPagePaise ?? 500,
          minOrderValue: 500,
        },
      }}
      shopName={props.shopName}
    />
  );
}
